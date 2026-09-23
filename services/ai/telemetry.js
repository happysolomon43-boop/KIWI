'use strict';

const { pacificDayKey } = require('./quota-manager');

function createTelemetry({
  store = null,
  clock = () => new Date(),
  logger = console,
  memoryWindowMs = 15 * 60 * 1000,
  memoryCap = 2000,
} = {}) {
  let recentAttempts = [];
  let recentRequests = [];

  function nowDate() {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  }

  function pruneMemory(now = nowDate()) {
    const cutoff = now.getTime() - memoryWindowMs;
    recentAttempts = recentAttempts
      .filter((entry) => entry.at >= cutoff)
      .slice(-memoryCap);
    recentRequests = recentRequests
      .filter((entry) => entry.at >= cutoff)
      .slice(-memoryCap);
  }

  function rememberAttempt(record) {
    const now = nowDate();
    recentAttempts.push({
      at: now.getTime(),
      modelId: record.modelId || null,
      projectSlot: record.projectSlot || null,
      outcome: record.outcome || null,
      errorCode: record.errorCode || null,
      httpStatus: record.httpStatus ?? null,
      latencyMs: Number(record.latencyMs) || 0,
    });
    pruneMemory(now);
  }

  function rememberRequest(record) {
    const now = nowDate();
    recentRequests.push({
      at: now.getTime(),
      outcome: record.outcome || null,
      errorCode: record.errorCode || null,
      fallbackDepth: Number(record.fallbackDepth) || 0,
      latencyMs: Number(record.latencyMs) || 0,
      queueWaitMs: Number(record.queueWaitMs) || 0,
      congestionLevel: record.congestionLevel || null,
    });
    pruneMemory(now);
  }

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
      startedAt: nowDate(),
    }));
  }

  async function recordAttempt(record) {
    rememberAttempt(record);
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
    queueWaitMs = 0,
    admissionLimit = null,
    congestionLevel = null,
  }) {
    const completedAt = nowDate();

    rememberRequest({
      outcome,
      errorCode,
      fallbackDepth,
      latencyMs,
      queueWaitMs,
      congestionLevel,
    });

    if (!requestId) return null;

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
      queueWaitMs,
      admissionLimit,
      congestionLevel,
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
      startedAt: nowDate(),
      completedAt: nowDate(),
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

  function snapshot(windowMs = 5 * 60 * 1000) {
    const now = nowDate();
    pruneMemory(now);
    const cutoff = now.getTime() - Math.max(1000, Number(windowMs) || 300000);

    const attempts = recentAttempts.filter((entry) => entry.at >= cutoff);
    const requests = recentRequests.filter((entry) => entry.at >= cutoff);

    const errorsByCode = {};
    const httpStatuses = {};
    const attemptsByModel = {};
    let successfulAttempts = 0;
    let failedAttempts = 0;

    for (const attempt of attempts) {
      if (attempt.outcome === 'SUCCESS') successfulAttempts += 1;
      if (attempt.outcome === 'FAILED') failedAttempts += 1;
      if (attempt.errorCode) {
        errorsByCode[attempt.errorCode] = (errorsByCode[attempt.errorCode] || 0) + 1;
      }
      if (attempt.httpStatus != null) {
        const status = String(attempt.httpStatus);
        httpStatuses[status] = (httpStatuses[status] || 0) + 1;
      }
      if (attempt.modelId) {
        attemptsByModel[attempt.modelId] = (attemptsByModel[attempt.modelId] || 0) + 1;
      }
    }

    const requestOutcomes = {};
    let fallbackRequests = 0;
    let totalLatencyMs = 0;
    let totalQueueWaitMs = 0;
    for (const request of requests) {
      if (request.outcome) {
        requestOutcomes[request.outcome] = (requestOutcomes[request.outcome] || 0) + 1;
      }
      if (request.fallbackDepth > 0) fallbackRequests += 1;
      totalLatencyMs += request.latencyMs;
      totalQueueWaitMs += request.queueWaitMs;
    }

    return Object.freeze({
      windowMs: Math.max(1000, Number(windowMs) || 300000),
      attempts: attempts.length,
      successfulAttempts,
      failedAttempts,
      errorsByCode: Object.freeze(errorsByCode),
      httpStatuses: Object.freeze(httpStatuses),
      attemptsByModel: Object.freeze(attemptsByModel),
      requests: requests.length,
      requestOutcomes: Object.freeze(requestOutcomes),
      fallbackRequests,
      averageLatencyMs: requests.length
        ? Math.round(totalLatencyMs / requests.length)
        : 0,
      averageQueueWaitMs: requests.length
        ? Math.round(totalQueueWaitMs / requests.length)
        : 0,
    });
  }

  return Object.freeze({
    beginRequest,
    recordAttempt,
    finishRequest,
    recordShadowDecision,
    snapshot,
  });
}

module.exports = {
  createTelemetry,
};
