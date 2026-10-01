'use strict';

const { AI_PROVIDERS, providerModelKey } = require('./providers');
const { MODEL_STATUS } = require('./model-catalog');
const { AI_ERROR_CODES } = require('./errors');

const CIRCUIT_BREAKER_CODES = new Set([
  AI_ERROR_CODES.BAD_REQUEST,
  AI_ERROR_CODES.MODEL_NOT_FOUND,
  AI_ERROR_CODES.EMPTY_RESPONSE,
]);

function storedModelIdentity(row, metadata = {}) {
  const stored = String(row?.model_id || '').trim();
  const provider = metadata.provider || (stored.includes('::') ? stored.split('::', 1)[0] : AI_PROVIDERS.GOOGLE);
  const modelId = metadata.modelId || (stored.includes('::') ? stored.slice(stored.indexOf('::') + 2) : stored);
  const routeKey = metadata.routeKey || (provider && modelId ? providerModelKey(provider, modelId) : null);
  return { provider, modelId, routeKey };
}

function rowToModel(row) {
  const metadata = row.metadata || {};
  const identity = storedModelIdentity(row, metadata);
  return {
    id: identity.modelId,
    provider: identity.provider,
    routeKey: identity.routeKey,
    family: row.family,
    channel: row.channel,
    status: row.status,
    rank: Number(row.rank) || 0,
    supportedReasoning: Array.isArray(row.supported_thinking) ? row.supported_thinking : [],
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    ...(Array.isArray(metadata.inputModalities)
      ? { inputModalities: [...metadata.inputModalities] }
      : {}),
    ...(Array.isArray(metadata.outputModalities)
      ? { outputModalities: [...metadata.outputModalities] }
      : {}),
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

  function resolve(ref, provider = null) {
    if (!ref) return null;
    if (typeof ref === 'object') {
      if (ref.routeKey) return catalog.get(ref.routeKey);
      if (ref.provider && (ref.modelId || ref.id)) {
        return catalog.get(ref.modelId || ref.id, ref.provider);
      }
    }
    return catalog.get(ref, provider);
  }

  function modelKey(model) {
    return model?.routeKey || (model?.provider && model?.id
      ? providerModelKey(model.provider, model.id)
      : null);
  }

  async function persist(model) {
    if (!store?.upsertCatalogModel || !model) return null;
    const routeKey = modelKey(model);
    // The database still calls this column model_id. Persist the composite
    // route identity there so different providers can never collide, while
    // preserving the existing production schema during this cleanup.
    return store.upsertCatalogModel({
      ...model,
      id: routeKey,
      supportedThinking: model.supportedReasoning || [],
      metadata: {
        ...(model.metadata || {}),
        provider: model.provider,
        modelId: model.id,
        routeKey,
        inputModalities: [...(model.inputModalities || [])],
        outputModalities: [...(model.outputModalities || [])],
      },
    });
  }

  async function hydratePersistedCatalog() {
    if (!store?.loadCatalogModels) return 0;
    const rows = await store.loadCatalogModels();
    const byRoute = new Map();

    // During migration an old provider-less row and a new composite-key row may
    // coexist. Prefer the composite record without destructively rewriting the
    // production table; legacy rows remain historical evidence only.
    for (const row of rows || []) {
      const model = rowToModel(row);
      if (!model.routeKey) continue;
      const current = byRoute.get(model.routeKey);
      const composite = String(row.model_id || '').includes('::');
      if (!current || (composite && !current.composite)) {
        byRoute.set(model.routeKey, { model, composite });
      }
    }

    for (const { model } of byRoute.values()) catalog.upsert(model);
    return byRoute.size;
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

  async function markQualifying(ref, provider = null) {
    const current = resolve(ref, provider);
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

  async function approve(ref, {
    provider = null,
    supportedReasoning,
    capabilities,
    qualification = {},
  } = {}) {
    const current = resolve(ref, provider);
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

  async function deny(ref, reason, provider = null) {
    const current = resolve(ref, provider);
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

  async function suspend(ref, reason, provider = null) {
    const current = resolve(ref, provider);
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
    logger?.warn?.('[KIWI AI] model route suspended', {
      provider: next.provider,
      modelId: next.id,
      routeKey: next.routeKey,
      reason,
    });
    return next;
  }

  async function resume(ref, reason = 'manual suspension cleared', provider = null) {
    const current = resolve(ref, provider);
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

  async function recordSuccess(ref, provider = null) {
    const current = resolve(ref, provider);
    if (!current?.metadata?.autoPromoted) return { suspended: false };
    failures.delete(modelKey(current));
    return { suspended: false };
  }

  async function recordFailure(ref, error, provider = null) {
    const current = resolve(ref, provider);
    if (!current?.metadata?.autoPromoted) return { suspended: false };
    if (!CIRCUIT_BREAKER_CODES.has(error?.code)) return { suspended: false };

    if (error.code === AI_ERROR_CODES.MODEL_NOT_FOUND || error.code === AI_ERROR_CODES.BAD_REQUEST) {
      await suspend(current, `automatic rollback after ${error.code}`);
      return { suspended: true };
    }

    const key = modelKey(current);
    const now = Date.now();
    const recent = pruneFailures(key, now);
    recent.push({ at: now, code: error.code });
    failures.set(key, recent);

    if (recent.length >= failureThreshold) {
      await suspend(
        current,
        `automatic rollback after ${recent.length} failures in ${Math.round(failureWindowMs / 60000)}m`
      );
      return { suspended: true };
    }
    return { suspended: false };
  }

  async function reportValidationFailure(ref, reason = 'task validation failed', provider = null) {
    const current = resolve(ref, provider);
    if (!current?.metadata?.autoPromoted) return { suspended: false };
    const key = modelKey(current);
    const now = Date.now();
    const recent = pruneFailures(key, now);
    recent.push({ at: now, code: 'VALIDATION' });
    failures.set(key, recent);

    if (recent.length >= Math.max(2, failureThreshold - 1)) {
      await suspend(current, `automatic rollback: ${reason}`);
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
  storedModelIdentity,
  rowToModel,
  createModelLifecycle,
};
