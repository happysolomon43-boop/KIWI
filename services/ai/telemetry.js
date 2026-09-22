'use strict';

const { pacificDayKey } = require('./quota-manager');

function createTelemetry({
  store = null,
  clock = () => new Date(),
  logger = console,
} = {}) {
  async function safe(label, fn) {
    if (!store) return null;
    try {
      return await fn();
    } catch (error) {
      if (typeof logger?.warn === 'function') {
        logger.warn(`[KIWI AI] telemetry ${label} failed`, {
          error: error?.message || String(error),
        });
      }
      return null;
    }
  }

  async function beginRequest({
    taskId,
    taskClass,
    mode,
    requestedReasoning = null,
    plannedModels = [],
    plannedPrimaryModel = null,
    legacyModel = null,
    generationGroupId = null,
  }) {
    return safe('beginRequest', () => store.createRequest({
      taskId,
      class: taskClass,
      mode,
      requestedReasoning,
      plannedModels,
      plannedPrimaryModel,
      legacyModel,
      generationGroupId,
      outcome: 'PENDING',
      startedAt: clock(),
    }));
  }

  async function recordAttempt(record) {
    return safe('recordAttempt', () => store.recordAttempt(record));
  }

  async function finishRequest(requestId, {
    taskId,
    taskClass,
    mode,
    selectedModel = null,
    selectedProjectSlot = null,
    outcome,
    fallbackDepth = 0,
    attemptCount = 0,
    latencyMs = null,
    usage = {},
    finishReason = null,
    errorCode = null,
  }) {
    if (!requestId) return null;
    const completedAt = clock();

    await safe('finishRequest', () => store.finishRequest(requestId, {
      selectedModel,
      selectedProjectSlot,
      outcome,
      fallbackDepth,
      attemptCount,
      latencyMs,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      thoughtTokens: usage.thoughtTokens || 0,
      totalTokens: usage.totalTokens || 0,
      finishReason,
      errorCode,
      completedAt,
    }));

    await safe('rollup', () => store.incrementDailyRollup({
      quotaDay: pacificDayKey(completedAt),
      taskId,
      class: taskClass,
      mode,
      outcome,
      fallbackDepth,
      latencyMs: latencyMs || 0,
      usage,
    }));

    return requestId;
  }

  async function recordShadowDecision({
    taskId,
    taskClass,
    requestedReasoning,
    candidateModels,
    legacyModel = null,
    plannedProjectSlot = null,
  }) {
    const plannedModels = (candidateModels || []).map((candidate) =>
      typeof candidate === 'string' ? candidate : candidate.modelId
    );
    const primary = plannedModels[0] || null;

    const requestId = await beginRequest({
      taskId,
      taskClass,
      mode: 'SHADOW',
      requestedReasoning,
      plannedModels,
      plannedPrimaryModel: primary,
      legacyModel,
    });

    if (!requestId) return null;

    await recordAttempt({
      requestId,
      attemptNumber: 1,
      modelId: primary,
      projectSlot: plannedProjectSlot || null,
      outcome: 'SHADOW_PLAN',
      startedAt: clock(),
      completedAt: clock(),
    });

    await finishRequest(requestId, {
      taskId,
      taskClass,
      mode: 'SHADOW',
      selectedModel: primary,
      selectedProjectSlot: plannedProjectSlot || null,
      outcome: 'SHADOW_ONLY',
      fallbackDepth: 0,
      attemptCount: 0,
      latencyMs: 0,
      usage: {},
      finishReason: 'SHADOW_ONLY',
    });

    return requestId;
  }

  return Object.freeze({
    beginRequest,
    recordAttempt,
    finishRequest,
    recordShadowDecision,
  });
}

module.exports = {
  createTelemetry,
};
