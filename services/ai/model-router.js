'use strict';

const {
  AI_TASKS,
  MODEL_POLICIES,
  QUALITY_FLOORS,
} = require('./task-registry');
const {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  GROQ_MODEL_IDS,
  GROQ_PRODUCTION_MODEL_CATALOG,
  GENERAL_EMERGENCY_FALLBACK_MODEL_ID,
  modelMeetsQuality,
  createModelCatalog,
} = require('./model-catalog');
const {
  buildGeminiThinkingConfig,
  buildReasoningDirective,
  modelSupportsCapabilities,
  resolveThinkingLevel,
} = require('./capability-adapter');
const { createProviderModelRef, AI_PROVIDERS } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');
const {
  PROVIDER_MODES,
  routingRequirement,
} = require('./routing-policy');

function createModelRouter({
  registry = AI_TASKS,
  catalog = createModelCatalog(),
  pins = {},
  env = process.env,
} = {}) {
  function getTask(taskId) {
    const task = registry[taskId];
    if (!task) {
      throw new AIError(`Unknown AI task: ${taskId}`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
      });
    }
    return task;
  }

  function ensureGroqProductionCatalog() {
    for (const model of GROQ_PRODUCTION_MODEL_CATALOG) {
      const current = catalog.get(model.id);
      if (current && current.status !== MODEL_STATUS.APPROVED) continue;
      catalog.upsert({
        ...model,
        status: current?.status || model.status,
        metadata: {
          ...(current?.metadata || {}),
          ...(model.metadata || {}),
        },
      });
    }
  }

  function eligibleFamily(family, task) {
    return catalog.list({
      provider: AI_PROVIDERS.GOOGLE,
      family,
      channel: MODEL_CHANNELS.STABLE,
      status: MODEL_STATUS.APPROVED,
      requiredCapabilities: task.capabilities,
    }).filter((model) => (
      model.productionEligible !== false &&
      modelSupportsCapabilities(model, task.capabilities) &&
      resolveThinkingLevel(model, task.reasoning)
    ));
  }

  function pinAsCeiling(models, modelId) {
    if (!modelId) return models;
    const index = models.findIndex((model) => model.id === modelId);
    if (index < 0) return models;
    return models.slice(index);
  }

  function appendGeneralEmergencyFallback(models, task) {
    const fallback = catalog.get(GENERAL_EMERGENCY_FALLBACK_MODEL_ID);
    if (!fallback || fallback.status !== MODEL_STATUS.APPROVED) return models;
    if (models.some((model) => model.id === fallback.id)) return models;
    if (!modelSupportsCapabilities(fallback, task.capabilities)) return models;
    if (!resolveThinkingLevel(fallback, 'HIGH')) return models;
    return models.concat(fallback);
  }

  function legacyGoogleModels(task) {
    const flash = eligibleFamily(MODEL_FAMILIES.FLASH, task);
    const lite = eligibleFamily(MODEL_FAMILIES.FLASH_LITE, task);
    let models = [];

    switch (task.modelPolicy) {
      case MODEL_POLICIES.TOP_STABLE_FLASH:
        models = appendGeneralEmergencyFallback(
          pinAsCeiling(flash, pins.VVIP).slice(0, 4),
          task
        );
        break;
      case MODEL_POLICIES.VIP_STABLE_FLASH:
        if (pins.VIP) models = pinAsCeiling(flash, pins.VIP).slice(0, 3);
        else models = flash.length > 1 ? flash.slice(1, 4) : flash.slice(0, 3);
        if (task.degradationAllowed && task.qualityFloor === QUALITY_FLOORS.FLASH_LITE) {
          models = models.concat(lite.slice(0, 2));
        }
        models = appendGeneralEmergencyFallback(models, task);
        break;
      case MODEL_POLICIES.TOP_STABLE_FLASH_LITE:
        models = pinAsCeiling(lite, pins.IP).slice(0, 2);
        break;
      default:
        throw new AIError(`Unsupported model policy ${task.modelPolicy}`, {
          code: AI_ERROR_CODES.CONFIG,
          retryable: false,
          scope: 'REQUEST',
        });
    }
    return models;
  }

  function eligibleGroqModels(taskId, task, requirement) {
    ensureGroqProductionCatalog();
    let models = catalog.list({
      provider: AI_PROVIDERS.GROQ,
      channel: MODEL_CHANNELS.STABLE,
      status: MODEL_STATUS.APPROVED,
      requiredCapabilities: task.capabilities,
    }).filter((model) => (
      model.productionEligible !== false &&
      modelSupportsCapabilities(model, task.capabilities) &&
      modelMeetsQuality(model, requirement.requiredQualityTier)
    ));

    models = models.filter((model) => {
      if (task.reasoning === 'MINIMAL') return model.supportedThinking.includes('LOW');
      return model.supportedThinking.includes(task.reasoning);
    });

    const preferred = requirement.preferEfficientGroqModel
      ? [GROQ_MODEL_IDS.GPT_OSS_20B, GROQ_MODEL_IDS.GPT_OSS_120B]
      : [GROQ_MODEL_IDS.GPT_OSS_120B, GROQ_MODEL_IDS.GPT_OSS_20B];
    const rank = new Map(preferred.map((id, index) => [id, index]));
    return models.sort((a, b) =>
      (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || b.rank - a.rank
    );
  }

  function neutralGoogleModels(task, requirement) {
    const legacy = legacyGoogleModels(task);
    if (requirement.assessmentProtected) return legacy;
    return legacy.filter((model) =>
      modelMeetsQuality(model, requirement.requiredQualityTier) || task.degradationAllowed
    );
  }

  function requestedReasoningFor(model, task) {
    if (
      model.provider === AI_PROVIDERS.GOOGLE &&
      model.id === GENERAL_EMERGENCY_FALLBACK_MODEL_ID
    ) return 'HIGH';
    return task.reasoning;
  }

  function routeEntry(model, task, requirement) {
    const requested = requestedReasoningFor(model, task);
    let resolved;
    let thinkingGenerationConfig;

    if (model.provider === AI_PROVIDERS.GROQ) {
      resolved = requested === 'MINIMAL' ? 'LOW' : requested;
      if (!model.supportedThinking.includes(resolved)) {
        throw new AIError(`${model.id} cannot satisfy reasoning level ${requested}`, {
          code: AI_ERROR_CODES.CONFIG,
          retryable: false,
          scope: 'MODEL',
          provider: model.provider,
        });
      }
      thinkingGenerationConfig = {
        reasoning: Object.freeze({ requested, resolved }),
      };
    } else {
      const reasoning = buildReasoningDirective(model, requested);
      resolved = reasoning.resolved;
      thinkingGenerationConfig = buildGeminiThinkingConfig(
        model,
        requested
      ).generationConfig;
    }

    const modelRef = createProviderModelRef({
      provider: model.provider,
      modelId: model.id,
    });

    return Object.freeze({
      model,
      modelRef,
      provider: modelRef.provider,
      routeKey: modelRef.key,
      modelId: model.id,
      requestedReasoning: requested,
      resolvedReasoning: resolved,
      reasoning: Object.freeze({ requested, resolved }),
      thinkingGenerationConfig: Object.freeze({ ...thinkingGenerationConfig }),
      timeoutMs: task.timeoutMs,
      retryPolicy: task.retryPolicy,
      class: task.class,
      qualityFloor: requirement.requiredQualityTier,
      legacyQualityFloor: task.qualityFloor,
      requiredCapabilities: requirement.requiredCapabilities,
      providerMode: requirement.providerMode,
      affinityGroup: task.affinityGroup || null,
    });
  }

  function applyPreferredModel(candidates, preferredModelId) {
    if (!preferredModelId) return candidates;
    const index = candidates.findIndex((entry) => entry.modelId === preferredModelId);
    if (index < 0) return candidates;
    return candidates.slice(index);
  }

  function resolveCandidates(taskId, { preferredModelId = null } = {}) {
    const task = getTask(taskId);
    const requirement = routingRequirement(taskId, task, env);
    const google = neutralGoogleModels(task, requirement);

    let models;
    if (requirement.providerMode === PROVIDER_MODES.GOOGLE_ONLY) {
      models = google;
    } else {
      const groq = eligibleGroqModels(taskId, task, requirement);
      models = requirement.providerMode === PROVIDER_MODES.GOOGLE_FIRST
        ? [...google, ...groq]
        : [...groq, ...google];
    }

    const candidates = models.map((model) => routeEntry(model, task, requirement));
    const preferred = applyPreferredModel(candidates, preferredModelId);

    if (preferred.length === 0) {
      throw new AIError(`No approved model satisfies task ${taskId}`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
        details: {
          requiredQualityTier: requirement.requiredQualityTier,
          requiredCapabilities: requirement.requiredCapabilities,
          providerMode: requirement.providerMode,
        },
      });
    }
    return Object.freeze(preferred);
  }

  function describeRequirement(taskId) {
    const task = getTask(taskId);
    return routingRequirement(taskId, task, env);
  }

  return Object.freeze({ getTask, resolveCandidates, describeRequirement });
}

module.exports = { createModelRouter };
