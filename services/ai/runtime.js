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
const { createProviderHealth } = require('./provider-health');
const { createAITrafficController } = require('./traffic-controller');
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

function parseBoundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function parseHealthSyncIntervalMs(value, fallback = 15000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(5000, Math.min(parsed, 5 * 60 * 1000));
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
  const providerHealth = createProviderHealth({
    store,
    failureEvidenceWindowMs: parseBoundedNumber(
      env.AI_PROVIDER_FAILURE_EVIDENCE_WINDOW_MS,
      30000,
      5000,
      300000
    ),
    openCooldownMs: parseBoundedNumber(
      env.AI_MODEL_TRANSIENT_COOLDOWN_MS,
      20000,
      5000,
      120000
    ),
    minDistinctFailureSlots: parseBoundedNumber(
      env.AI_PROVIDER_FAILURE_EVIDENCE_SLOTS,
      2,
      1,
      5
    ),
  });
  const trafficController = createAITrafficController({ env, logger });
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
    trafficController,
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
    trafficController,
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
    providerHealth,
    trafficController,
    transport,
    logger,
    env,
  });

  let discoveryTimer = null;
  let discoveryRunning = false;
  let retentionTimer = null;
  let retentionRunning = false;
  let healthSyncTimer = null;
  let healthSyncRunning = false;

  const operationalState = {
    lastDiscoveryStartedAt: null,
    lastDiscoveryCompletedAt: null,
    lastDiscoverySummary: null,
    lastDiscoveryError: null,
    lastRetentionStartedAt: null,
    lastRetentionCompletedAt: null,
    lastRetentionSummary: null,
    lastRetentionError: null,
    lastHealthSyncStartedAt: null,
    lastHealthSyncCompletedAt: null,
    lastHealthSyncSummary: null,
    lastHealthSyncError: null,
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

  function retentionPolicy() {
    return {
      requestRetentionDays: parseRetentionDays(env.AI_REQUEST_RETENTION_DAYS, 30, 7, 180),
      qualificationRetentionDays: parseRetentionDays(env.AI_QUALIFICATION_RETENTION_DAYS, 180, 30, 730),
      rollupRetentionDays: parseRetentionDays(env.AI_ROLLUP_RETENTION_DAYS, 365, 90, 1825),
    };
  }

  async function runRetentionCleanup() {
    if (retentionRunning) return null;
    retentionRunning = true;
    operationalState.lastRetentionStartedAt = new Date().toISOString();

    try {
      const result = await store.cleanupOperationalHistory(retentionPolicy());
      operationalState.lastRetentionSummary = result;
      operationalState.lastRetentionError = null;

      if (
        typeof logger?.log === 'function' &&
        (result.requestsDeleted > 0 ||
         result.qualificationsDeleted > 0 ||
         result.rollupsDeleted > 0)
      ) {
        logger.log('[KIWI AI] operational history cleanup complete', result);
      }
      return result;
    } catch (error) {
      operationalState.lastRetentionError = {
        message: error?.message || String(error),
      };
      if (typeof logger?.warn === 'function') {
        logger.warn('[KIWI AI] operational history cleanup failed', {
          error: error?.message || String(error),
        });
      }
      return null;
    } finally {
      operationalState.lastRetentionCompletedAt = new Date().toISOString();
      retentionRunning = false;
    }
  }

  function startRetentionScheduler() {
    if (retentionTimer) return false;
    const intervalMs = parseCleanupIntervalMs(env.AI_RETENTION_CLEANUP_INTERVAL_MS);

    if (typeof timers.setImmediate === 'function') {
      timers.setImmediate(() => {
        runRetentionCleanup().catch(() => null);
      });
    }

    if (typeof timers.setInterval === 'function') {
      retentionTimer = timers.setInterval(() => {
        runRetentionCleanup().catch(() => null);
      }, intervalMs);
      retentionTimer?.unref?.();
    }
    return true;
  }

  function stopRetentionScheduler() {
    if (!retentionTimer) return false;
    timers.clearInterval?.(retentionTimer);
    retentionTimer = null;
    return true;
  }

  async function runHealthSyncCycle() {
    if (healthSyncRunning) return null;
    healthSyncRunning = true;
    operationalState.lastHealthSyncStartedAt = new Date().toISOString();

    try {
      const [quotaRows, providerRows] = await Promise.all([
        quotaManager.refresh?.() || 0,
        providerHealth.refreshFromStore?.() || 0,
      ]);
      const result = Object.freeze({
        quotaRows: Number(quotaRows) || 0,
        providerRows: Number(providerRows) || 0,
      });
      operationalState.lastHealthSyncSummary = result;
      operationalState.lastHealthSyncError = null;
      return result;
    } catch (error) {
      operationalState.lastHealthSyncError = {
        message: error?.message || String(error),
      };
      if (typeof logger?.warn === 'function') {
        logger.warn('[KIWI AI] health-state synchronization failed', {
          error: error?.message || String(error),
        });
      }
      return null;
    } finally {
      operationalState.lastHealthSyncCompletedAt = new Date().toISOString();
      healthSyncRunning = false;
    }
  }

  function startHealthSyncScheduler() {
    if (healthSyncTimer || typeof timers.setInterval !== 'function') return false;
    const intervalMs = parseHealthSyncIntervalMs(env.AI_HEALTH_SYNC_INTERVAL_MS);

    healthSyncTimer = timers.setInterval(() => {
      runHealthSyncCycle().catch(() => null);
    }, intervalMs);
    healthSyncTimer?.unref?.();

    if (typeof logger?.log === 'function') {
      logger.log('[KIWI AI] persisted health synchronization scheduled', {
        intervalSeconds: Math.round(intervalMs / 1000),
      });
    }
    return true;
  }

  function stopHealthSyncScheduler() {
    if (!healthSyncTimer) return false;
    timers.clearInterval?.(healthSyncTimer);
    healthSyncTimer = null;
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

  function safePlan(taskId) {
    try {
      const plan = orchestrator.plan(taskId);
      return {
        primaryModel: plan.plannedPrimaryModel || null,
        primaryProjectSlot: plan.plannedPrimaryProjectSlot || null,
        candidates: plan.candidates.map((candidate) => candidate.modelId),
      };
    } catch (error) {
      return {
        primaryModel: null,
        primaryProjectSlot: null,
        candidates: [],
        error: error?.code || error?.message || 'UNKNOWN',
      };
    }
  }

  function status() {
    const slots = projectPool.snapshot();
    const quotaRows = quotaManager.snapshot();
    const catalogRows = catalog.list();
    const providerRows = providerHealth.snapshot();
    const trafficState = trafficController.snapshot();
    const recentTelemetry = telemetry.snapshot();

    const catalogStates = catalogRows.reduce((acc, model) => {
      acc[model.status] = (acc[model.status] || 0) + 1;
      return acc;
    }, {});

    const quotaStates = quotaRows.reduce((acc, row) => {
      acc[row.state] = (acc[row.state] || 0) + 1;
      return acc;
    }, {});
    const providerStates = providerRows.reduce((acc, row) => {
      acc[row.state] = (acc[row.state] || 0) + 1;
      return acc;
    }, {});

    return Object.freeze({
      projectSlots: Object.freeze({
        total: slots.length,
        enabled: slots.filter((slot) => slot.enabled).length,
      }),
      routes: Object.freeze({
        VVIP: Object.freeze(safePlan('MAIN_CBT')),
        VIP: Object.freeze(safePlan('DEEP_AUDIT')),
        IP: Object.freeze(safePlan('CARD_EXPLANATION')),
      }),
      catalog: Object.freeze({
        total: catalogRows.length,
        states: Object.freeze({ ...catalogStates }),
      }),
      quota: Object.freeze({
        trackedRoutes: quotaRows.length,
        states: Object.freeze({ ...quotaStates }),
      }),
      providerHealth: Object.freeze({
        trackedModels: providerRows.length,
        states: Object.freeze({ ...providerStates }),
        models: Object.freeze(providerRows),
      }),
      traffic: trafficState,
      telemetry: recentTelemetry,
      discovery: Object.freeze({
        enabled: discovery.autoDiscoveryEnabled(),
        autoPromote: discovery.autoPromoteEnabled(),
        running: discoveryRunning,
        intervalMs: parseIntervalMs(env.AI_DISCOVERY_INTERVAL_MS),
        lastStartedAt: operationalState.lastDiscoveryStartedAt,
        lastCompletedAt: operationalState.lastDiscoveryCompletedAt,
        lastSummary: operationalState.lastDiscoverySummary,
        lastError: operationalState.lastDiscoveryError,
      }),
      retention: Object.freeze({
        running: retentionRunning,
        intervalMs: parseCleanupIntervalMs(env.AI_RETENTION_CLEANUP_INTERVAL_MS),
        policy: Object.freeze(retentionPolicy()),
        lastStartedAt: operationalState.lastRetentionStartedAt,
        lastCompletedAt: operationalState.lastRetentionCompletedAt,
        lastSummary: operationalState.lastRetentionSummary,
        lastError: operationalState.lastRetentionError,
      }),
      healthSync: Object.freeze({
        running: healthSyncRunning,
        intervalMs: parseHealthSyncIntervalMs(env.AI_HEALTH_SYNC_INTERVAL_MS),
        lastStartedAt: operationalState.lastHealthSyncStartedAt,
        lastCompletedAt: operationalState.lastHealthSyncCompletedAt,
        lastSummary: operationalState.lastHealthSyncSummary,
        lastError: operationalState.lastHealthSyncError,
      }),
    });
  }

  async function operationalReport({
    windowMinutes = 15,
  } = {}) {
    const live = status();
    let persistent = null;
    let persistentError = null;

    try {
      persistent = await store.recentOperationalSummary({ windowMinutes });
    } catch (error) {
      persistentError = error?.message || String(error);
      if (typeof logger?.warn === 'function') {
        logger.warn('[KIWI AI] durable operational report failed', {
          error: persistentError,
        });
      }
    }

    return Object.freeze({
      generatedAt: new Date().toISOString(),
      live,
      persistent,
      persistentError,
    });
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
    startRetentionScheduler();
    startHealthSyncScheduler();

    if (typeof logger?.log === 'function') {
      logger.log(
        `[KIWI AI] orchestrator initialized: ${state.projectSlots} project slot(s), ` +
        `${state.hydratedProjectModelStates} persisted model-state record(s), ` +
        `${state.hydratedProviderModelHealth} persisted provider-health record(s), ` +
        `${hydratedCatalogModels} persisted catalog model(s)`
      );
    }

    return Object.freeze({
      ...state,
      hydratedCatalogModels,
      discoveryScheduled: Boolean(discoveryTimer || discovery.autoDiscoveryEnabled()),
      retentionScheduled: Boolean(retentionTimer),
      healthSyncScheduled: Boolean(healthSyncTimer),
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
    providerHealth,
    trafficController,
    qualifier,
    discovery,
    orchestrator,
    initialize,
    status,
    operationalReport,
    runDiscoveryCycle,
    startDiscoveryScheduler,
    stopDiscoveryScheduler,
    runRetentionCleanup,
    startRetentionScheduler,
    stopRetentionScheduler,
    runHealthSyncCycle,
    startHealthSyncScheduler,
    stopHealthSyncScheduler,
    reportValidationFailure,
  });
}

module.exports = {
  parseIntervalMs,
  parseCleanupIntervalMs,
  parseRetentionDays,
  parseBoundedNumber,
  parseHealthSyncIntervalMs,
  createAIRuntime,
};
