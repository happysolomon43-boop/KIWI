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
  GENERAL_EMERGENCY_FALLBACK_MODEL_ID,
  createModelCatalog,
} = require('./model-catalog');
const {
  buildGeminiThinkingConfig,
  buildReasoningDirective,
  modelSupportsCapabilities,
  resolveThinkingLevel,
} = require('./capability-adapter');
const { createProviderModelRef } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');

function createModelRouter({
  registry = AI_TASKS,
  catalog = createModelCatalog(),
  pins = {},
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

  function eligibleFamily(family, task) {
    return catalog.list({
      family,
      channel: MODEL_CHANNELS.STABLE,
      status: MODEL_STATUS.APPROVED,
      requiredCapabilities: task.capabilities,
    }).filter((model) => (
      modelSupportsCapabilities(model, task.capabilities) &&
      resolveThinkingLevel(model, task.reasoning)
    ));
  }

  function pinAsCeiling(models, modelId) {
    if (!modelId) return models;
    const index = models.findIndex((model) => model.id === modelId);
    if (index < 0) return models;

    // A manual pin is an emergency ceiling, not just a preferred first hop.
    // If a newest model is suspect and the class is pinned lower, fallbacks
    // must continue downward rather than re-entering the stronger model.
    return models.slice(index);
  }

  function applyPreferredModel(candidates, preferredModelId) {
    if (!preferredModelId) return candidates;
    const index = candidates.findIndex((entry) => entry.model.id === preferredModelId);
    if (index < 0) return candidates;

    // Generation affinity is a ceiling: when a multi-call workflow has already
    // settled on a lower model, later calls should prefer it and weaker approved
    // fallbacks rather than unexpectedly upgrading.
    return candidates.slice(index);
  }

  function appendGeneralEmergencyFallback(models, task) {
    const fallback = catalog.get(GENERAL_EMERGENCY_FALLBACK_MODEL_ID);
    if (!fallback || fallback.status !== MODEL_STATUS.APPROVED) return models;
    if (models.some((model) => model.id === fallback.id)) return models;
    if (!modelSupportsCapabilities(fallback, task.capabilities)) return models;
    if (!resolveThinkingLevel(fallback, 'HIGH')) return models;
    return models.concat(fallback);
  }

  function resolveCandidates(taskId, { preferredModelId = null } = {}) {
    const task = getTask(taskId);
    const flash = eligibleFamily(MODEL_FAMILIES.FLASH, task);
    const lite = eligibleFamily(MODEL_FAMILIES.FLASH_LITE, task);

    let models = [];

    switch (task.modelPolicy) {
      case MODEL_POLICIES.TOP_STABLE_FLASH:
        // Keep four approved stable Flash generations, then add the explicit
        // high-thinking 3.5 Lite availability route as the final fallback.
        models = appendGeneralEmergencyFallback(
          pinAsCeiling(flash, pins.VVIP).slice(0, 4),
          task
        );
        break;

      case MODEL_POLICIES.VIP_STABLE_FLASH:
        // VIP starts one generation below the VVIP primary so it cannot consume
        // the newest model's normal capacity. An emergency VIP pin overrides
        // only this starting point and still keeps bounded fallbacks.
        if (pins.VIP) {
          models = pinAsCeiling(flash, pins.VIP).slice(0, 3);
        } else {
          models = flash.length > 1 ? flash.slice(1, 4) : flash.slice(0, 3);
        }
        if (
          task.degradationAllowed &&
          task.qualityFloor === QUALITY_FLOORS.FLASH_LITE
        ) {
          models = models.concat(lite.slice(0, 2));
        }
        models = appendGeneralEmergencyFallback(models, task);
        break;

      case MODEL_POLICIES.TOP_STABLE_FLASH_LITE:
        models = pinAsCeiling(lite, pins.IP).slice(0, 2);
        break;

      default:
        throw new AIError(
          `Unsupported model policy ${task.modelPolicy} for task ${taskId}`,
          {
            code: AI_ERROR_CODES.CONFIG,
            retryable: false,
            scope: 'REQUEST',
          }
        );
    }

    const routed = models.map((model) => {
      // The 3.5 Lite availability route always retains HIGH thinking even for
      // lower-class tasks; it is a last-resort model fallback, not a quality
      // shortcut. Lite-native tasks use the same high-quality configuration.
      const requestedReasoning = model.id === GENERAL_EMERGENCY_FALLBACK_MODEL_ID
        ? 'HIGH'
        : task.reasoning;
      const reasoning = buildReasoningDirective(model, requestedReasoning);

      // Compatibility bridge: the current orchestrator still merges this field
      // into generationConfig before transport. The Google compatibility
      // transport immediately re-normalizes it into the neutral execution
      // contract before provider serialization. AIM-D03 removes this legacy
      // field when provider-aware routing replaces Gemini-era family routing.
      const thinking = buildGeminiThinkingConfig(model, requestedReasoning);
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
        requestedReasoning: reasoning.requested,
        resolvedReasoning: reasoning.resolved,
        reasoning: Object.freeze({ ...reasoning }),
        thinkingGenerationConfig: thinking.generationConfig,
        timeoutMs: task.timeoutMs,
        retryPolicy: task.retryPolicy,
        class: task.class,
        qualityFloor: task.qualityFloor,
        affinityGroup: task.affinityGroup || null,
      });
    });

    const preferred = applyPreferredModel(routed, preferredModelId);

    if (preferred.length === 0) {
      throw new AIError(
        `No approved model satisfies task ${taskId}`,
        {
          code: AI_ERROR_CODES.CONFIG,
          retryable: false,
          scope: 'REQUEST',
        }
      );
    }

    return preferred;
  }

  return Object.freeze({
    getTask,
    resolveCandidates,
  });
}

module.exports = {
  createModelRouter,
};
