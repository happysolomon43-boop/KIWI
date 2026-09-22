'use strict';

const { MODEL_STATUS } = require('./model-catalog');
const { AI_ERROR_CODES } = require('./errors');

const CIRCUIT_BREAKER_CODES = new Set([
  AI_ERROR_CODES.BAD_REQUEST,
  AI_ERROR_CODES.MODEL_NOT_FOUND,
  AI_ERROR_CODES.EMPTY_RESPONSE,
  AI_ERROR_CODES.TRANSIENT,
  AI_ERROR_CODES.TIMEOUT,
]);

function rowToModel(row) {
  return {
    id: row.model_id,
    family: row.family,
    channel: row.channel,
    status: row.status,
    rank: Number(row.rank) || 0,
    supportedThinking: Array.isArray(row.supported_thinking) ? row.supported_thinking : [],
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    inputTokenLimit: row.input_token_limit == null ? null : Number(row.input_token_limit),
    outputTokenLimit: row.output_token_limit == null ? null : Number(row.output_token_limit),
    metadata: row.metadata || {},
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

  async function persist(model) {
    if (store?.upsertCatalogModel) {
      await store.upsertCatalogModel(model);
    }
  }

  async function hydratePersistedCatalog() {
    if (!store?.loadCatalogModels) return 0;
    const rows = await store.loadCatalogModels();
    for (const row of rows || []) {
      catalog.upsert(rowToModel(row));
    }
    return rows?.length || 0;
  }

  function isAutoPromoted(modelId) {
    return Boolean(catalog.get(modelId)?.metadata?.autoPromoted);
  }

  async function discover(model) {
    const existing = catalog.get(model.id);
    const merged = catalog.upsert({
      ...model,
      status: model.status || existing?.status || MODEL_STATUS.DISCOVERED,
      metadata: {
        ...(existing?.metadata || {}),
        ...(model.metadata || {}),
      },
      firstSeenAt: existing?.firstSeenAt || model.firstSeenAt || new Date(),
    });
    await persist(merged);
    return merged;
  }

  async function markQualifying(modelId) {
    const current = catalog.get(modelId);
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
    supportedThinking,
    capabilities,
    qualification = {},
  } = {}) {
    const current = catalog.get(modelId);
    if (!current) return null;
    const now = new Date();
    const next = catalog.upsert({
      ...current,
      status: MODEL_STATUS.APPROVED,
      supportedThinking: supportedThinking || current.supportedThinking || [],
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
    failures.delete(modelId);
    await persist(next);
    return next;
  }

  async function deny(modelId, reason) {
    const current = catalog.get(modelId);
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

  async function suspend(modelId, reason) {
    const current = catalog.get(modelId);
    if (!current) return null;
    const now = new Date();
    const next = catalog.upsert({
      ...current,
      status: MODEL_STATUS.SUSPENDED,
      suspendedAt: now,
      metadata: {
        ...(current.metadata || {}),
        suspendedReason: reason || 'automatic circuit breaker',
        suspendedAt: now.toISOString(),
      },
    });
    failures.delete(modelId);
    await persist(next);
    if (typeof logger?.warn === 'function') {
      logger.warn('[KIWI AI] model suspended', { modelId, reason });
    }
    return next;
  }

  function pruneFailures(modelId, now) {
    const recent = (failures.get(modelId) || []).filter(
      (entry) => now - entry.at <= failureWindowMs
    );
    failures.set(modelId, recent);
    return recent;
  }

  async function recordSuccess(modelId) {
    if (!isAutoPromoted(modelId)) return { suspended: false };
    failures.delete(modelId);
    return { suspended: false };
  }

  async function recordFailure(modelId, error) {
    if (!isAutoPromoted(modelId)) return { suspended: false };
    if (!CIRCUIT_BREAKER_CODES.has(error?.code)) return { suspended: false };

    if (
      error.code === AI_ERROR_CODES.MODEL_NOT_FOUND ||
      error.code === AI_ERROR_CODES.BAD_REQUEST
    ) {
      await suspend(modelId, `automatic rollback after ${error.code}`);
      return { suspended: true };
    }

    const now = Date.now();
    const recent = pruneFailures(modelId, now);
    recent.push({ at: now, code: error.code });
    failures.set(modelId, recent);

    if (recent.length >= failureThreshold) {
      await suspend(
        modelId,
        `automatic rollback after ${recent.length} failures in ${Math.round(failureWindowMs / 60000)}m`
      );
      return { suspended: true };
    }

    return { suspended: false };
  }

  async function reportValidationFailure(modelId, reason = 'task validation failed') {
    if (!isAutoPromoted(modelId)) return { suspended: false };
    const now = Date.now();
    const recent = pruneFailures(modelId, now);
    recent.push({ at: now, code: 'VALIDATION' });
    failures.set(modelId, recent);

    if (recent.length >= Math.max(2, failureThreshold - 1)) {
      await suspend(modelId, `automatic rollback: ${reason}`);
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
