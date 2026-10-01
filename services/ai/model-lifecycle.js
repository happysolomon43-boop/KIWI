'use strict';

const { AI_PROVIDERS } = require('./providers');
const { MODEL_STATUS } = require('./model-catalog');
const { AI_ERROR_CODES } = require('./errors');

const CIRCUIT_BREAKER_CODES = new Set([
  AI_ERROR_CODES.BAD_REQUEST,
  AI_ERROR_CODES.MODEL_NOT_FOUND,
  AI_ERROR_CODES.EMPTY_RESPONSE,
]);

function rowToModel(row) {
  const metadata = row.metadata || {};
  return {
    id: row.model_id,
    provider: metadata.provider || AI_PROVIDERS.GOOGLE,
    family: row.family,
    channel: row.channel,
    status: row.status,
    rank: Number(row.rank) || 0,
    supportedReasoning: Array.isArray(row.supported_thinking) ? row.supported_thinking : [],
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    inputTokenLimit: row.input_token_limit == null ? null : Number(row.input_token_limit),
    outputTokenLimit: row.output_token_limit == null ? null : Number(row.output_token_limit),
    metadata,
    firstSeenAt: row.first_seen_at || null,
    approvedAt: row.approved_at || null,
    suspendedAt: row.suspended_at || null,
  };
}

function createModelLifecycle({
  catalog,
  store = null,
  logger = console,
  failureThreshold = 3,
  failureWindowMs = 10 * 60 * 1000,
} = {}) {
  if (!catalog) throw new Error('Model lifecycle requires catalog');

  const failures = new Map();

  function modelKey(model) {
    return model?.routeKey || `${model?.provider || AI_PROVIDERS.GOOGLE}::${model?.id || ''}`;
  }

  async function persist(model) {
    if (!store?.upsertCatalogModel || !model) return null;
    // The existing table column is named supported_thinking. Keep that schema
    // stable while translating the neutral runtime field only at persistence.
    return store.upsertCatalogModel({
      ...model,
      supportedThinking: model.supportedReasoning || [],
      metadata: {
        ...(model.metadata || {}),
        provider: model.provider,
      },
    });
  }

  async function hydratePersistedCatalog() {
    if (!store?.loadCatalogModels) return 0;
    const rows = await store.loadCatalogModels();
    for (const row of rows || []) catalog.upsert(rowToModel(row));
    return rows?.length || 0;
  }

  function resolve(ref, provider = null) {
    return catalog.get(ref, provider);
  }

  function isAutoPromoted(ref, provider = null) {
    return Boolean(resolve(ref, provider)?.metadata?.autoPromoted);
  }

  async function discover(model) {
    const existing = catalog.get(model.id, model.provider);
    const merged = catalog.upsert({
      ...model,
      status: model.status || existing?.status || MODEL_STATUS.DISCOVERED,
      metadata: {
        ...(existing?.metadata || {}),
        ...(model.metadata || {}),
        provider: model.provider,
      },
      firstSeenAt: existing?.firstSeenAt || model.firstSeenAt || new Date(),
    });
    await persist(merged);
    return merged;
  }

  async function markQualifying(modelId, provider = AI_PROVIDERS.GOOGLE) {
    const current = catalog.get(modelId, provider);
    if (!current) return null;
    const next = catalog.upsert({
      ...current,
      status: MODEL_STATUS.QUALIFYING,
      metadata: {
        ...(current.metadata || {}),
        qualificationStartedAt: new Date().toISOString(),
      },
    });
    await persist(next);
    return next;
  }

  async function approve(modelId, {
    provider = AI_PROVIDERS.GOOGLE,
    supportedReasoning,
    capabilities,
    qualification = {},
  } = {}) {
    const current = catalog.get(modelId, provider);
    if (!current) return null;
    const now = new Date();
    const next = catalog.upsert({
      ...current,
      status: MODEL_STATUS.APPROVED,
      supportedReasoning: supportedReasoning || current.supportedReasoning || [],
      capabilities: capabilities || current.capabilities || [],
      approvedAt: now,
      suspendedAt: null,
      metadata: {
        ...(current.metadata || {}),
        autoPromoted: true,
        qualification,
        approvedAt: now.toISOString(),
      },
    });
    failures.delete(modelKey(next));
    await persist(next);
    return next;
  }

  async function deny(modelId, reason, provider = AI_PROVIDERS.GOOGLE) {
    const current = catalog.get(modelId, provider);
    if (!current) return null;
    const next = catalog.upsert({
      ...current,
      status: MODEL_STATUS.DENIED,
      metadata: {
        ...(current.metadata || {}),
        deniedReason: reason || 'qualification failed',
        deniedAt: new Date().toISOString(),
      },
    });
    await persist(next);
    return next;
  }

  async function suspend(modelId, reason, provider = AI_PROVIDERS.GOOGLE) {
    const current = catalog.get(modelId, provider);
    if (!current) return null;
    const now = new Date();
    const next = catalog.upsert({
      ...current,
      status: MODEL_STATUS.SUSPENDED,
      suspendedAt: now,
      metadata: {
        ...(current.metadata || {}),
        suspendedReason: reason || 'automatic circuit breaker',
        preSuspendStatus: current.metadata?.preSuspendStatus || current.status,
        suspendedAt: now.toISOString(),
      },
    });
    failures.delete(modelKey(next));
    await persist(next);
    logger?.warn?.('[KIWI AI] model suspended', {
      provider: next.provider,
      modelId: next.id,
      reason,
    });
    return next;
  }

  async function resume(modelId, reason = 'manual suspension cleared', provider = AI_PROVIDERS.GOOGLE) {
    const current = catalog.get(modelId, provider);
    if (!current || current.status !== MODEL_STATUS.SUSPENDED) return current;

    const resumeStatus = current.metadata?.preSuspendStatus || MODEL_STATUS.APPROVED;
    const metadata = { ...(current.metadata || {}) };
    delete metadata.suspendedReason;
    delete metadata.suspendedAt;
    delete metadata.preSuspendStatus;
    metadata.resumedAt = new Date().toISOString();
    metadata.resumeReason = reason;

    const next = catalog.upsert({
      ...current,
      status: resumeStatus,
      suspendedAt: null,
      metadata,
    });
    failures.delete(modelKey(next));
    await persist(next);
    return next;
  }

  function pruneFailures(key, now) {
    const recent = (failures.get(key) || []).filter((entry) => now - entry.at <= failureWindowMs);
    failures.set(key, recent);
    return recent;
  }

  async function recordSuccess(modelId, provider = AI_PROVIDERS.GOOGLE) {
    const current = catalog.get(modelId, provider);
    if (!current?.metadata?.autoPromoted) return { suspended: false };
    failures.delete(modelKey(current));
    return { suspended: false };
  }

  async function recordFailure(modelId, error, provider = AI_PROVIDERS.GOOGLE) {
    const current = catalog.get(modelId, provider);
    if (!current?.metadata?.autoPromoted) return { suspended: false };
    if (!CIRCUIT_BREAKER_CODES.has(error?.code)) return { suspended: false };

    if (error.code === AI_ERROR_CODES.MODEL_NOT_FOUND || error.code === AI_ERROR_CODES.BAD_REQUEST) {
      await suspend(modelId, `automatic rollback after ${error.code}`, provider);
      return { suspended: true };
    }

    const key = modelKey(current);
    const now = Date.now();
    const recent = pruneFailures(key, now);
    recent.push({ at: now, code: error.code });
    failures.set(key, recent);

    if (recent.length >= failureThreshold) {
      await suspend(
        modelId,
        `automatic rollback after ${recent.length} failures in ${Math.round(failureWindowMs / 60000)}m`,
        provider
      );
      return { suspended: true };
    }
    return { suspended: false };
  }

  async function reportValidationFailure(modelId, reason = 'task validation failed', provider = AI_PROVIDERS.GOOGLE) {
    const current = catalog.get(modelId, provider);
    if (!current?.metadata?.autoPromoted) return { suspended: false };
    const key = modelKey(current);
    const now = Date.now();
    const recent = pruneFailures(key, now);
    recent.push({ at: now, code: 'VALIDATION' });
    failures.set(key, recent);

    if (recent.length >= Math.max(2, failureThreshold - 1)) {
      await suspend(modelId, `automatic rollback: ${reason}`, provider);
      return { suspended: true };
    }
    return { suspended: false };
  }

  return Object.freeze({
    hydratePersistedCatalog,
    isAutoPromoted,
    discover,
    markQualifying,
    approve,
    deny,
    suspend,
    resume,
    recordSuccess,
    recordFailure,
    reportValidationFailure,
  });
}

module.exports = {
  CIRCUIT_BREAKER_CODES,
  rowToModel,
  createModelLifecycle,
};
