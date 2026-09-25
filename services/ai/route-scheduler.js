'use strict';

const { AI_ERROR_CODES } = require('./errors');

const SHORT_WINDOW_RATE_CODES = new Set([
  AI_ERROR_CODES.RATE_LIMIT_RPM,
  AI_ERROR_CODES.RATE_LIMIT_TPM,
  AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
]);

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function createRouteScheduler({
  store = null,
  env = process.env,
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
} = {}) {
  const maxInFlightPerRoute = Math.floor(
    boundedNumber(env.AI_ROUTE_MAX_IN_FLIGHT, 1, 1, 8)
  );
  const routeLeaseMs = boundedNumber(
    env.AI_ROUTE_LEASE_MS,
    190000,
    5000,
    10 * 60 * 1000
  );
  const shortBackoffBaseMs = boundedNumber(
    env.AI_SHORT_RATE_LIMIT_BACKOFF_BASE_MS,
    100,
    25,
    10000
  );
  const shortBackoffMaxMs = boundedNumber(
    env.AI_SHORT_RATE_LIMIT_BACKOFF_MAX_MS,
    1500,
    shortBackoffBaseMs,
    30000
  );

  const routes = new Map();
  const models = new Map();

  function nowMs() {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function routeKey(projectSlot, modelId) {
    return `${projectSlot}::${modelId}`;
  }

  function ensureRoute(projectSlot, modelId) {
    const key = routeKey(projectSlot, modelId);
    let state = routes.get(key);
    if (!state) {
      state = {
        projectSlot,
        modelId,
        inFlight: 0,
        lastSelectedAt: 0,
        lastSuccessAt: 0,
        lastFailureAt: 0,
        lastErrorCode: null,
      };
      routes.set(key, state);
    }
    return state;
  }

  function ensureModel(modelId) {
    let state = models.get(modelId);
    if (!state) {
      state = {
        modelId,
        shortRateLimitStreak: 0,
        nextDispatchAt: 0,
        lastShortRateLimitAt: 0,
      };
      models.set(modelId, state);
    }
    return state;
  }

  function quotaScore(quotaManager, projectSlot, modelId) {
    if (!quotaManager?.slotHealthScore) return 0;
    try {
      return Number(quotaManager.slotHealthScore(projectSlot, modelId)) || 0;
    } catch (_) {
      return 0;
    }
  }

  function orderSlots(modelId, slots, quotaManager = null) {
    return (slots || [])
      .map((slot, index) => {
        const route = ensureRoute(slot.id, modelId);
        const quotaEligible = quotaManager?.isEligible
          ? quotaManager.isEligible(slot.id, modelId)
          : true;
        return {
          slot,
          index,
          route,
          quotaEligible,
          score: quotaScore(quotaManager, slot.id, modelId),
        };
      })
      .filter((entry) => (
        entry.quotaEligible &&
        entry.route.inFlight < maxInFlightPerRoute
      ))
      .sort((a, b) => (
        a.route.inFlight - b.route.inFlight ||
        b.score - a.score ||
        a.route.lastSelectedAt - b.route.lastSelectedAt ||
        a.index - b.index
      ))
      .map((entry) => entry.slot);
  }

  function shortBackoffMs(streak) {
    const exponent = Math.max(0, Math.min(8, Number(streak) - 1));
    const raw = Math.min(shortBackoffMaxMs, shortBackoffBaseMs * (2 ** exponent));
    const jitterFactor = 0.75 + (Math.max(0, Math.min(1, Number(random()) || 0)) * 0.5);
    return Math.max(25, Math.round(raw * jitterFactor));
  }

  function modelWaitMs(modelId) {
    const state = ensureModel(modelId);
    return Math.max(0, state.nextDispatchAt - nowMs());
  }

  async function waitForModel(modelId) {
    const waitMs = modelWaitMs(modelId);
    if (waitMs > 0) await sleep(waitMs);
    return waitMs;
  }

  async function acquire(modelId, slot) {
    const pacingWaitMs = await waitForModel(modelId);
    const route = ensureRoute(slot.id, modelId);

    if (route.inFlight >= maxInFlightPerRoute) {
      return Object.freeze({
        available: false,
        reason: 'LOCAL_ROUTE_BUSY',
        pacingWaitMs,
      });
    }

    let remoteLease = null;
    if (store?.acquireRouteRuntimeLease) {
      remoteLease = await store.acquireRouteRuntimeLease({
        projectSlot: slot.id,
        modelId,
        leaseMs: routeLeaseMs,
        maxInFlight: maxInFlightPerRoute,
      });
      if (!remoteLease) {
        return Object.freeze({
          available: false,
          reason: 'DISTRIBUTED_ROUTE_BUSY',
          pacingWaitMs,
        });
      }
    }

    route.inFlight += 1;
    route.lastSelectedAt = nowMs();
    let released = false;

    return Object.freeze({
      available: true,
      reason: null,
      pacingWaitMs,
      routeStateBefore: Object.freeze({
        inFlight: route.inFlight - 1,
        lastErrorCode: route.lastErrorCode,
      }),
      async release() {
        if (released) return false;
        released = true;
        route.inFlight = Math.max(0, route.inFlight - 1);
        if (store?.releaseRouteRuntimeLease && remoteLease) {
          await store.releaseRouteRuntimeLease(slot.id, modelId);
        }
        return true;
      },
    });
  }

  async function recordSuccess(modelId, projectSlot) {
    const now = nowMs();
    const route = ensureRoute(projectSlot, modelId);
    const model = ensureModel(modelId);

    route.lastSuccessAt = now;
    route.lastErrorCode = null;
    model.shortRateLimitStreak = 0;
    model.nextDispatchAt = 0;

    if (store?.recordRouteRuntimeOutcome) {
      await store.recordRouteRuntimeOutcome({
        projectSlot,
        modelId,
        success: true,
        shortRateLimitStreak: 0,
        nextEligibleAt: null,
      });
    }

    return snapshotRoute(projectSlot, modelId);
  }

  async function recordFailure(modelId, projectSlot, error) {
    const now = nowMs();
    const route = ensureRoute(projectSlot, modelId);
    const model = ensureModel(modelId);
    route.lastFailureAt = now;
    route.lastErrorCode = error?.code || AI_ERROR_CODES.UNKNOWN;

    let pacingDelayMs = 0;
    if (SHORT_WINDOW_RATE_CODES.has(error?.code)) {
      model.shortRateLimitStreak += 1;
      model.lastShortRateLimitAt = now;
      pacingDelayMs = shortBackoffMs(model.shortRateLimitStreak);
      model.nextDispatchAt = Math.max(model.nextDispatchAt, now + pacingDelayMs);
    }

    if (store?.recordRouteRuntimeOutcome) {
      const providerDelay = Number(error?.retryAfterMs);
      const routeDelay = Number.isFinite(providerDelay) && providerDelay > 0
        ? providerDelay
        : pacingDelayMs;
      await store.recordRouteRuntimeOutcome({
        projectSlot,
        modelId,
        success: false,
        errorCode: route.lastErrorCode,
        shortRateLimitStreak: model.shortRateLimitStreak,
        nextEligibleAt: routeDelay > 0
          ? new Date(now + routeDelay)
          : null,
      });
    }

    return Object.freeze({
      route: snapshotRoute(projectSlot, modelId),
      model: snapshotModel(modelId),
      pacingDelayMs,
    });
  }

  function snapshotRoute(projectSlot, modelId) {
    const state = ensureRoute(projectSlot, modelId);
    return Object.freeze({
      projectSlot: state.projectSlot,
      modelId: state.modelId,
      inFlight: state.inFlight,
      lastSelectedAt: state.lastSelectedAt ? new Date(state.lastSelectedAt) : null,
      lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt) : null,
      lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt) : null,
      lastErrorCode: state.lastErrorCode,
    });
  }

  function snapshotModel(modelId) {
    const state = ensureModel(modelId);
    return Object.freeze({
      modelId: state.modelId,
      shortRateLimitStreak: state.shortRateLimitStreak,
      nextDispatchAt: state.nextDispatchAt ? new Date(state.nextDispatchAt) : null,
      waitMs: modelWaitMs(modelId),
      lastShortRateLimitAt: state.lastShortRateLimitAt
        ? new Date(state.lastShortRateLimitAt)
        : null,
    });
  }

  function snapshot() {
    return Object.freeze({
      maxInFlightPerRoute,
      routeLeaseMs,
      shortBackoffBaseMs,
      shortBackoffMaxMs,
      routes: Object.freeze(Array.from(routes.values()).map((state) => snapshotRoute(
        state.projectSlot,
        state.modelId
      ))),
      models: Object.freeze(Array.from(models.keys()).map(snapshotModel)),
    });
  }

  return Object.freeze({
    orderSlots,
    acquire,
    recordSuccess,
    recordFailure,
    modelWaitMs,
    snapshotRoute,
    snapshotModel,
    snapshot,
  });
}

module.exports = {
  SHORT_WINDOW_RATE_CODES,
  createRouteScheduler,
};
