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
  createModelCatalog,
} = require('./model-catalog');
const {
  buildGeminiThinkingConfig,
  modelSupportsCapabilities,
  resolveThinkingLevel,
} = require('./capability-adapter');
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
    // If 3.9 is suspect and VVIP is pinned to 3.8, fallbacks must continue
    // downward to 3.7/3.6 rather than re-entering 3.9.
    return models.slice(index);
  }

  function applyPreferredModel(candidates, preferredModelId) {
    if (!preferredModelId) return candidates;
    const index = candidates.findIndex((entry) => entry.model.id === preferredModelId);
    if (index < 0) return candidates;

    // Generation affinity is a ceiling: when a multi-call workflow has already
    // settled on 3.7, a repair/completion call should prefer 3.7 then weaker
    // approved fallbacks rather than unexpectedly upgrading back to 3.8.
    return candidates.slice(index);
  }

  function resolveCandidates(taskId, { preferredModelId = null } = {}) {
    const task = getTask(taskId);
    const flash = eligibleFamily(MODEL_FAMILIES.FLASH, task);
    const lite = eligibleFamily(MODEL_FAMILIES.FLASH_LITE, task);

    let models = [];

    switch (task.modelPolicy) {
      case MODEL_POLICIES.TOP_STABLE_FLASH:
        // Keep the strongest three approved stable Flash generations unless an
        // emergency VVIP pin is configured.
        models = pinAsCeiling(flash, pins.VVIP).slice(0, 3);
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
      const thinking = buildGeminiThinkingConfig(model, task.reasoning);
      return Object.freeze({
        model,
        modelId: model.id,
        requestedReasoning: thinking.requested,
        resolvedReasoning: thinking.resolved,
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
