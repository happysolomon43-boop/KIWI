'use strict';

const { AI_TASKS } = require('./task-registry');
const { createModelCatalog, DEFAULT_MODEL_CATALOG, MODEL_STATUS } = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const { createProjectPool } = require('./project-pool');
const { createGeminiTransport } = require('./gemini-transport');
const { createPostgresAIStore } = require('./postgres-store');
const { createQuotaManager } = require('./quota-manager');
const { createTelemetry } = require('./telemetry');
const { createModelLifecycle } = require('./model-lifecycle');
const { createModelQualifier } = require('./model-qualifier');
const { createModelDiscoveryManager } = require('./model-discovery');
const { createAIOrchestrator } = require('./orchestrator');

function parseIntervalMs(value, fallback = 15 * 60 * 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(5 * 60 * 1000, Math.min(parsed, 6 * 60 * 60 * 1000));
}

function parseCleanupIntervalMs(value, fallback = 24 * 60 * 60 * 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(60 * 60 * 1000, Math.min(parsed, 7 * 24 * 60 * 60 * 1000));
}

function parseRetentionDays(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function createAIRuntime({
  query,
  randomUUID,
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  timers = {
    setImmediate: globalThis.setImmediate,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  },
} = {}) {
  const store = createPostgresAIStore({ query, randomUUID });
  const catalog = createModelCatalog();
  const projectPool = createProjectPool({ env });
  const quotaManager = createQuotaManager({ store });
  const telemetry = createTelemetry({ store, logger });
  const modelLifecycle = createModelLifecycle({ catalog, store, logger });
  const router = createModelRouter({
    registry: AI_TASKS,
    catalog,
    pins: {
      VVIP: String(env.AI_PIN_VVIP_MODEL || '').trim() || null,
      VIP: String(env.AI_PIN_VIP_MODEL || '').trim() || null,
      IP: String(env.AI_PIN_IP_MODEL || '').trim() || null,
    },
  });
  const transport = createGeminiTransport({ fetchImpl });

  const qualifier = createModelQualifier({
    transport,
    projectPool,
    quotaManager,
    lifecycle: modelLifecycle,
    store,
    logger,
    env,
  });

  const discovery = createModelDiscoveryManager({
    transport,
    projectPool,
    catalog,
    lifecycle: modelLifecycle,
    qualifier,
    logger,
    env,
  });

  const orchestrator = createAIOrchestrator({
    registry: AI_TASKS,
    catalog,
    router,
    projectPool,
    quotaManager,
    telemetry,
    modelLifecycle,
    transport,
    logger,
    env,
  });

  let discoveryTimer = null;
  let discoveryRunning = false;
  let retentionTimer = null;
  let retentionRunning = false;

  const operationalState = {
    lastDiscoveryStartedAt: null,
    lastDiscoveryCompletedAt: null,
    lastDiscoverySummary: null,
    lastDiscoveryError: null,
    lastRetentionStartedAt: null,
    lastRetentionCompletedAt: null,
    lastRetentionSummary: null,
    lastRetentionError: null,
  };

  async function runDiscoveryCycle() {
    if (discoveryRunning) return null;
    discoveryRunning = true;
    operationalState.lastDiscoveryStartedAt = new Date().toISOString();

    try {
      const result = await discovery.discoverOnce();
      operationalState.lastDiscoverySummary = result
        ? {
            enabled: result.enabled,
            providerModels: Number(result.providerModels) || 0,
            stableFlashModels: Number(result.stableFlashModels) || 0,
            discovered: [...(result.discovered || [])],
            promoted: [...(result.promoted || [])],
          }
        : null;
      operationalState.lastDiscoveryError = null;
      return result;
    } catch (error) {
      operationalState.lastDiscoveryError = {
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || String(error),
      };
      if (typeof logger?.warn === 'function') {
        logger.warn('[KIWI AI] automatic model discovery failed', {
          code: error?.code || null,
          status: error?.status || null,
          error: error?.message || String(error),
        });
      }
      return null;
    } finally {
      operationalState.lastDiscoveryCompletedAt = new Date().toISOString();
      discoveryRunning = false;
    }
  }

  function startDiscoveryScheduler() {
    if (!discovery.autoDiscoveryEnabled() || discoveryTimer) return false;

    const intervalMs = parseIntervalMs(env.AI_DISCOVERY_INTERVAL_MS);

    if (typeof timers.setImmediate === 'function') {
      timers.setImmediate(() => {
        runDiscoveryCycle().catch(() => null);
      });
    }

    if (typeof timers.setInterval === 'function') {
      discoveryTimer = timers.setInterval(() => {
        runDiscoveryCycle().catch(() => null);
      }, intervalMs);
      discoveryTimer?.unref?.();
    }

    if (typeof logger?.log === 'function') {
      logger.log('[KIWI AI] automatic stable-model discovery scheduled', {
        intervalMinutes: Math.round(intervalMs / 60000),
        autoPromote: discovery.autoPromoteEnabled(),
      });
    }

    return true;
  }

  function stopDiscoveryScheduler() {
    if (!discoveryTimer) return false;
    timers.clearInterval?.(discoveryTimer);
    discoveryTimer = null;
    return true;
  }

  async function refreshSeedCatalogPreservingLifecycle() {
    for (const seed of DEFAULT_MODEL_CATALOG) {
      const existing = catalog.get(seed.id);
      catalog.upsert({
        ...seed,
        status: existing?.status || seed.status,
        metadata: {
          ...(existing?.metadata || {}),
          ...(seed.metadata || {}),
          seeded: true,
        },
        approvedAt: existing?.approvedAt || seed.approvedAt || null,
        suspendedAt: existing?.suspendedAt || null,
      });
    }
  }

  async function applyManualDenylist() {
    const denylist = new Set(
      String(env.AI_MODEL_DENYLIST || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    );

    for (const model of catalog.list()) {
      const manuallySuspended =
        model.status === MODEL_STATUS.SUSPENDED &&
        model.metadata?.suspendedReason === 'manual AI_MODEL_DENYLIST';

      if (manuallySuspended && !denylist.has(model.id)) {
        await modelLifecycle.resume(model.id, 'removed from AI_MODEL_DENYLIST');
      }
    }

    for (const modelId of denylist) {
      const current = catalog.get(modelId);
      if (!current) continue;

      // Do not overwrite an automatic circuit-breaker suspension with a manual
      // reason, otherwise removing the denylist could accidentally re-enable
      // a model that was already unhealthy.
      if (
        current.status === MODEL_STATUS.SUSPENDED &&
        current.metadata?.suspendedReason !== 'manual AI_MODEL_DENYLIST'
      ) {
        continue;
      }

      await modelLifecycle.suspend(modelId, 'manual AI_MODEL_DENYLIST');
    }
  }

  async function initialize() {
    // Load persisted discovered/promoted/suspended models before refreshing the
    // built-in seed metadata. This preserves lifecycle state across restarts.
    const hydratedCatalogModels = await modelLifecycle.hydratePersistedCatalog();
    await refreshSeedCatalogPreservingLifecycle();
    await applyManualDenylist();
    await store.seedCatalog(catalog.list());

    const state = await orchestrator.initialize();
    startDiscoveryScheduler();

    if (typeof logger?.log === 'function') {
      logger.log(
        `[KIWI AI] orchestrator initialized: ${state.projectSlots} project slot(s), ` +
        `${state.hydratedProjectModelStates} persisted model-state record(s), ` +
        `${hydratedCatalogModels} persisted catalog model(s)`
      );
    }

    return Object.freeze({
      ...state,
      hydratedCatalogModels,
      discoveryScheduled: Boolean(discoveryTimer || discovery.autoDiscoveryEnabled()),
    });
  }

  function reportValidationFailure(modelId, reason) {
    return modelLifecycle.reportValidationFailure(modelId, reason);
  }

  return Object.freeze({
    store,
    catalog,
    projectPool,
    quotaManager,
    telemetry,
    modelLifecycle,
    qualifier,
    discovery,
    orchestrator,
    initialize,
    runDiscoveryCycle,
    startDiscoveryScheduler,
    stopDiscoveryScheduler,
    reportValidationFailure,
  });
}

module.exports = {
  parseIntervalMs,
  parseCleanupIntervalMs,
  parseRetentionDays,
  createAIRuntime,
};
