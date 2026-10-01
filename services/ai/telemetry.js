'use strict';

const { pacificDayKey } = require('./quota-manager');
const { providerModelKey } = require('./providers');

function routeIdentity(value = {}) {
  if (typeof value === 'string') {
    const routeKey = String(value).trim();
    const splitAt = routeKey.indexOf('::');
    return Object.freeze({
      routeKey: routeKey || null,
      provider: splitAt > 0 ? routeKey.slice(0, splitAt) : null,
      modelId: splitAt > 0 ? routeKey.slice(splitAt + 2) : null,
    });
  }

  const provider = value?.provider || null;
  const modelId = value?.modelId || value?.id || null;
  const routeKey = value?.routeKey || (provider && modelId ? providerModelKey(provider, modelId) : null);
  return Object.freeze({ routeKey, provider, modelId });
}

function routeKeys(values = []) {
  return (values || [])
    .map((value) => routeIdentity(value).routeKey)
    .filter(Boolean);
}

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
      routeKey: record.routeKey || null,
      provider: record.provider || null,
      modelId: record.modelId || null,
      credentialSlotId: record.credentialSlotId || null,
      requestedReasoning: record.requestedReasoning || null,
      resolvedReasoning: record.resolvedReasoning || null,
      fallbackDepth: Number(record.fallbackDepth) || 0,
      outcome: record.outcome || null,
      errorCode: record.errorCode || null,
      httpStatus: record.httpStatus ?? null,
      providerErrorCode: record.providerErrorCode || null,
      quotaDimension: record.quotaDimension || null,
      classificationSource: record.classificationSource || null,
      retryAfterMs: record.retryAfterMs == null ? null : Number(record.retryAfterMs),
      operationId: record.operationId || null,
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
      logger?.warn?.(`[KIWI AI] telemetry ${label} failed`, {
        error: error?.message || String(error),
      });
      return null;
    }
  }

  async function beginRequest({
    taskId,
    taskClass,
    mode,
    requestedReasoning = null,
    plannedRoutes = null,
    plannedPrimaryRoute = null,
    generationGroupId = null,
    // Transitional input aliases are accepted only here while callers are
    // migrated. Persistence receives route keys, never provider-less identity.
    plannedModels = null,
    plannedPrimaryModel = null,
  }) {
    const normalizedPlannedRoutes = routeKeys(plannedRoutes || plannedModels || []);
    const primary = routeIdentity(plannedPrimaryRoute || plannedPrimaryModel || normalizedPlannedRoutes[0] || null);
    return safe('beginRequest', () => store.createRequest({
      taskId,
      class: taskClass,
      mode,
      requestedReasoning,
      plannedModels: normalizedPlannedRoutes,
      plannedPrimaryModel: primary.routeKey,
      legacyModel: null,
      generationGroupId,
      outcome: 'PENDING',
      startedAt: nowDate(),
    }));
  }

  async function recordAttempt(record = {}) {
    const identity = routeIdentity(record.routeKey || {
      provider: record.provider,
      modelId: record.modelId,
    });
    const credentialSlotId = record.credentialSlotId || record.projectSlot || null;
    const normalized = {
      ...record,
      ...identity,
      credentialSlotId,
    };
    rememberAttempt(normalized);

    return safe('recordAttempt', () => store.recordAttempt({
      ...record,
      // Existing storage columns are historical names. The values written are
      // neutral: composite route identity + provider-owned credential slot.
      modelId: identity.routeKey,
      projectSlot: credentialSlotId,
    }));
  }

  async function finishRequest(requestId, {
    taskId,
    taskClass,
    mode,
    selectedRoute = null,
    selectedCredentialSlotId = null,
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
    // Transitional aliases; converted immediately at the storage boundary.
    selectedModel = null,
    selectedProjectSlot = null,
  }) {
    const completedAt = nowDate();
    const selected = routeIdentity(selectedRoute || selectedModel || null);
    const credentialSlotId = selectedCredentialSlotId || selectedProjectSlot || null;

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
      selectedModel: selected.routeKey,
      selectedProjectSlot: credentialSlotId,
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
    candidateRoutes = null,
    plannedCredentialSlotId = null,
    // Transitional aliases while the orchestrator call site is migrated.
    candidateModels = null,
    plannedProjectSlot = null,
  }) {
    const candidates = candidateRoutes || candidateModels || [];
    const plannedRoutes = candidates.map((candidate) => routeIdentity(
      typeof candidate === 'string' ? candidate : candidate.routeKey || candidate
    )).filter((identity) => identity.routeKey);
    const primary = plannedRoutes[0] || null;
    const credentialSlotId = plannedCredentialSlotId || plannedProjectSlot || null;

    const requestId = await beginRequest({
      taskId,
      taskClass,
      mode: 'SHADOW',
      requestedReasoning,
      plannedRoutes,
      plannedPrimaryRoute: primary,
    });

    if (!requestId) return null;

    await recordAttempt({
      requestId,
      attemptNumber: 1,
      ...(primary || {}),
      credentialSlotId,
      requestedReasoning,
      resolvedReasoning: primary?.resolvedReasoning || null,
      fallbackDepth: 0,
      outcome: 'SHADOW_PLAN',
      startedAt: nowDate(),
      completedAt: nowDate(),
    });

    await finishRequest(requestId, {
      taskId,
      taskClass,
      mode: 'SHADOW',
      selectedRoute: primary,
      selectedCredentialSlotId: credentialSlotId,
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
    const attemptsByRoute = {};
    const attemptsByProvider = {};
    const attemptsByModel = {};
    const quotaDimensions = {};
    const classificationSources = {};
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
      if (attempt.routeKey) {
        attemptsByRoute[attempt.routeKey] = (attemptsByRoute[attempt.routeKey] || 0) + 1;
      }
      if (attempt.provider) {
        attemptsByProvider[attempt.provider] = (attemptsByProvider[attempt.provider] || 0) + 1;
      }
      if (attempt.modelId) {
        attemptsByModel[attempt.modelId] = (attemptsByModel[attempt.modelId] || 0) + 1;
      }
      if (attempt.quotaDimension) {
        quotaDimensions[attempt.quotaDimension] = (quotaDimensions[attempt.quotaDimension] || 0) + 1;
      }
      if (attempt.classificationSource) {
        classificationSources[attempt.classificationSource] = (classificationSources[attempt.classificationSource] || 0) + 1;
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
      attemptsByRoute: Object.freeze(attemptsByRoute),
      attemptsByProvider: Object.freeze(attemptsByProvider),
      attemptsByModel: Object.freeze(attemptsByModel),
      quotaDimensions: Object.freeze(quotaDimensions),
      classificationSources: Object.freeze(classificationSources),
      requests: requests.length,
      requestOutcomes: Object.freeze(requestOutcomes),
      fallbackRequests,
      averageLatencyMs: requests.length ? Math.round(totalLatencyMs / requests.length) : 0,
      averageQueueWaitMs: requests.length ? Math.round(totalQueueWaitMs / requests.length) : 0,
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
  routeIdentity,
  createTelemetry,
};
