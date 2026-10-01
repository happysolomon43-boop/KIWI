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
  const maxInFlightPerCredentialRoute = Math.floor(
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

  const credentialRoutes = new Map();
  const routePacing = new Map();

  function nowMs() {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function credentialRouteKey(credentialSlotId, routeKey) {
    return `${credentialSlotId}::${routeKey}`;
  }

  function ensureCredentialRoute(credentialSlotId, routeKey) {
    const key = credentialRouteKey(credentialSlotId, routeKey);
    let state = credentialRoutes.get(key);
    if (!state) {
      state = {
        credentialSlotId,
        routeKey,
        inFlight: 0,
        lastSelectedAt: 0,
        lastSuccessAt: 0,
        lastFailureAt: 0,
        lastErrorCode: null,
      };
      credentialRoutes.set(key, state);
    }
    return state;
  }

  function ensureRoutePacing(routeKey) {
    let state = routePacing.get(routeKey);
    if (!state) {
      state = {
        routeKey,
        shortRateLimitStreak: 0,
        nextDispatchAt: 0,
        lastShortRateLimitAt: 0,
      };
      routePacing.set(routeKey, state);
    }
    return state;
  }

  function quotaScore(quotaManager, credentialSlotId, routeKey) {
    if (!quotaManager?.slotHealthScore) return 0;
    try {
      return Number(quotaManager.slotHealthScore(credentialSlotId, routeKey)) || 0;
    } catch (_) {
      return 0;
    }
  }

  function orderSlots(routeKey, slots, quotaManager = null) {
    return (slots || [])
      .map((slot, index) => {
        const route = ensureCredentialRoute(slot.id, routeKey);
        const quotaEligible = quotaManager?.isEligible
          ? quotaManager.isEligible(slot.id, routeKey)
          : true;
        return {
          slot,
          index,
          route,
          quotaEligible,
          score: quotaScore(quotaManager, slot.id, routeKey),
        };
      })
      .filter((entry) => entry.quotaEligible)
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

  function routeWaitMs(routeKey) {
    const state = ensureRoutePacing(routeKey);
    return Math.max(0, state.nextDispatchAt - nowMs());
  }

  async function waitForRoute(routeKey) {
    const waitMs = routeWaitMs(routeKey);
    if (waitMs > 0) await sleep(waitMs);
    return waitMs;
  }

  async function acquire(routeKey, credential) {
    const pacingWaitMs = await waitForRoute(routeKey);
    const route = ensureCredentialRoute(credential.id, routeKey);

    if (route.inFlight >= maxInFlightPerCredentialRoute) {
      return Object.freeze({ available: false, reason: 'LOCAL_ROUTE_BUSY', pacingWaitMs });
    }

    let remoteLease = null;
    if (store?.acquireRouteRuntimeLease) {
      remoteLease = await store.acquireRouteRuntimeLease({
        projectSlot: credential.id,
        modelId: routeKey,
        leaseMs: routeLeaseMs,
        maxInFlight: maxInFlightPerCredentialRoute,
      });
      if (!remoteLease) {
        return Object.freeze({ available: false, reason: 'DISTRIBUTED_ROUTE_BUSY', pacingWaitMs });
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
          await store.releaseRouteRuntimeLease(credential.id, routeKey);
        }
        return true;
      },
    });
  }

  async function recordSuccess(routeKey, credentialSlotId) {
    const now = nowMs();
    const route = ensureCredentialRoute(credentialSlotId, routeKey);
    const pacing = ensureRoutePacing(routeKey);
    route.lastSuccessAt = now;
    route.lastErrorCode = null;
    pacing.shortRateLimitStreak = 0;
    pacing.nextDispatchAt = 0;

    if (store?.recordRouteRuntimeOutcome) {
      await store.recordRouteRuntimeOutcome({
        projectSlot: credentialSlotId,
        modelId: routeKey,
        success: true,
        shortRateLimitStreak: 0,
        nextEligibleAt: null,
      });
    }
    return snapshotCredentialRoute(credentialSlotId, routeKey);
  }

  async function recordFailure(routeKey, credentialSlotId, error) {
    const now = nowMs();
    const route = ensureCredentialRoute(credentialSlotId, routeKey);
    const pacing = ensureRoutePacing(routeKey);
    route.lastFailureAt = now;
    route.lastErrorCode = error?.code || AI_ERROR_CODES.UNKNOWN;

    let pacingDelayMs = 0;
    if (SHORT_WINDOW_RATE_CODES.has(error?.code)) {
      pacing.shortRateLimitStreak += 1;
      pacing.lastShortRateLimitAt = now;
      pacingDelayMs = shortBackoffMs(pacing.shortRateLimitStreak);
      pacing.nextDispatchAt = Math.max(pacing.nextDispatchAt, now + pacingDelayMs);
    }

    if (store?.recordRouteRuntimeOutcome) {
      const providerDelay = Number(error?.retryAfterMs);
      const routeDelay = Number.isFinite(providerDelay) && providerDelay > 0
        ? providerDelay
        : pacingDelayMs;
      await store.recordRouteRuntimeOutcome({
        projectSlot: credentialSlotId,
        modelId: routeKey,
        success: false,
        errorCode: route.lastErrorCode,
        shortRateLimitStreak: pacing.shortRateLimitStreak,
        nextEligibleAt: routeDelay > 0 ? new Date(now + routeDelay) : null,
      });
    }

    return Object.freeze({
      credentialRoute: snapshotCredentialRoute(credentialSlotId, routeKey),
      route: snapshotRoute(routeKey),
      pacingDelayMs,
    });
  }

  function snapshotCredentialRoute(credentialSlotId, routeKey) {
    const state = ensureCredentialRoute(credentialSlotId, routeKey);
    return Object.freeze({
      credentialSlotId: state.credentialSlotId,
      routeKey: state.routeKey,
      inFlight: state.inFlight,
      lastSelectedAt: state.lastSelectedAt ? new Date(state.lastSelectedAt) : null,
      lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt) : null,
      lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt) : null,
      lastErrorCode: state.lastErrorCode,
    });
  }

  function snapshotRoute(routeKey) {
    const state = ensureRoutePacing(routeKey);
    return Object.freeze({
      routeKey: state.routeKey,
      shortRateLimitStreak: state.shortRateLimitStreak,
      nextDispatchAt: state.nextDispatchAt ? new Date(state.nextDispatchAt) : null,
      waitMs: routeWaitMs(routeKey),
      lastShortRateLimitAt: state.lastShortRateLimitAt ? new Date(state.lastShortRateLimitAt) : null,
    });
  }

  function snapshot() {
    return Object.freeze({
      maxInFlightPerCredentialRoute,
      routeLeaseMs,
      shortBackoffBaseMs,
      shortBackoffMaxMs,
      credentialRoutes: Object.freeze(Array.from(credentialRoutes.values()).map((state) =>
        snapshotCredentialRoute(state.credentialSlotId, state.routeKey)
      )),
      routes: Object.freeze(Array.from(routePacing.keys()).map(snapshotRoute)),
    });
  }

  return Object.freeze({
    orderSlots,
    acquire,
    recordSuccess,
    recordFailure,
    routeWaitMs,
    snapshotCredentialRoute,
    snapshotRoute,
    snapshot,
  });
}

module.exports = {
  SHORT_WINDOW_RATE_CODES,
  createRouteScheduler,
};
