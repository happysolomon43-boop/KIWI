'use strict';

const { AI_ERROR_CODES } = require('./errors');

const ROUTE_AVAILABILITY_CODES = new Set([
  AI_ERROR_CODES.PROVIDER_OVERLOADED,
  AI_ERROR_CODES.TRANSIENT,
]);

const CIRCUIT_STATES = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

function createProviderHealth({
  clock = () => Date.now(),
  failureEvidenceWindowMs = 30000,
  openCooldownMs = 20000,
  minDistinctFailureSlots = 2,
  store = null,
} = {}) {
  const routes = new Map();

  function nowMs() {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function ensure(routeKey) {
    let state = routes.get(routeKey);
    if (!state) {
      state = {
        routeKey,
        state: CIRCUIT_STATES.CLOSED,
        openUntil: 0,
        failuresByCredential: new Map(),
        halfOpenProbeInFlight: false,
        confirmationProbeInFlight: false,
        lastErrorCode: null,
        lastHttpStatus: null,
        lastFailureAt: null,
        lastSuccessAt: null,
        updatedAt: 0,
      };
      routes.set(routeKey, state);
    }
    return state;
  }

  function prune(state, now = nowMs()) {
    for (const [credentialSlotId, failedAt] of state.failuresByCredential.entries()) {
      if (now - failedAt > failureEvidenceWindowMs) {
        state.failuresByCredential.delete(credentialSlotId);
      }
    }
  }

  function refresh(state, now = nowMs()) {
    prune(state, now);
    if (state.state === CIRCUIT_STATES.OPEN && state.openUntil <= now) {
      state.state = CIRCUIT_STATES.HALF_OPEN;
      state.openUntil = 0;
      state.halfOpenProbeInFlight = false;
      state.updatedAt = Math.max(state.updatedAt || 0, now);
    }
    return state;
  }

  function requiredEvidence(totalEligibleSlots) {
    const slots = Math.max(1, Number(totalEligibleSlots) || 1);
    return Math.min(slots, Math.max(1, Number(minDistinctFailureSlots) || 1));
  }

  function retryDelay(error) {
    const providerDelay = Number(error?.retryAfterMs);
    if (Number.isFinite(providerDelay) && providerDelay > 0) {
      return Math.max(5000, Math.min(providerDelay, 120000));
    }
    return Math.max(5000, Math.min(Number(openCooldownMs) || 20000, 120000));
  }

  function availability(routeKey) {
    const state = refresh(ensure(routeKey));
    const now = nowMs();

    if (state.state === CIRCUIT_STATES.OPEN) {
      return Object.freeze({
        available: false,
        state: state.state,
        retryAfterMs: Math.max(0, state.openUntil - now),
        halfOpenProbe: false,
      });
    }
    if (state.state === CIRCUIT_STATES.HALF_OPEN && state.halfOpenProbeInFlight) {
      return Object.freeze({
        available: false,
        state: state.state,
        retryAfterMs: Math.max(1000, Math.min(Number(openCooldownMs) || 20000, 120000)),
        halfOpenProbe: false,
      });
    }
    if (
      state.state === CIRCUIT_STATES.CLOSED &&
      state.failuresByCredential.size > 0 &&
      state.confirmationProbeInFlight
    ) {
      return Object.freeze({
        available: false,
        state: state.state,
        retryAfterMs: 1000,
        halfOpenProbe: false,
        confirmationProbe: false,
      });
    }
    return Object.freeze({
      available: true,
      state: state.state,
      retryAfterMs: 0,
      halfOpenProbe: state.state === CIRCUIT_STATES.HALF_OPEN,
      confirmationProbe: false,
    });
  }

  function acquire(routeKey) {
    const state = refresh(ensure(routeKey));
    const availabilityState = availability(routeKey);
    if (!availabilityState.available) return availabilityState;
    if (state.state === CIRCUIT_STATES.HALF_OPEN) {
      state.halfOpenProbeInFlight = true;
      return Object.freeze({ ...availabilityState, halfOpenProbe: true });
    }
    return availabilityState;
  }

  function beginConfirmationProbe(routeKey) {
    const state = refresh(ensure(routeKey));
    if (
      state.state !== CIRCUIT_STATES.CLOSED ||
      state.failuresByCredential.size === 0 ||
      state.confirmationProbeInFlight
    ) return false;
    state.confirmationProbeInFlight = true;
    state.updatedAt = Math.max(state.updatedAt || 0, nowMs());
    return true;
  }

  function endConfirmationProbe(routeKey) {
    ensure(routeKey).confirmationProbeInFlight = false;
    return true;
  }

  function release(routeKey) {
    const state = ensure(routeKey);
    if (state.state === CIRCUIT_STATES.HALF_OPEN) state.halfOpenProbeInFlight = false;
  }

  function open(state, error) {
    const now = nowMs();
    state.state = CIRCUIT_STATES.OPEN;
    state.openUntil = now + retryDelay(error);
    state.halfOpenProbeInFlight = false;
    state.confirmationProbeInFlight = false;
    state.lastErrorCode = error?.code || null;
    state.lastHttpStatus = error?.status ?? null;
    state.lastFailureAt = new Date(now);
    state.updatedAt = now;
  }

  function recordFailure(routeKey, credentialSlotId, error, { totalEligibleSlots = 1 } = {}) {
    const state = refresh(ensure(routeKey));
    const now = nowMs();
    state.lastErrorCode = error?.code || null;
    state.lastHttpStatus = error?.status ?? null;
    state.lastFailureAt = new Date(now);

    if (!ROUTE_AVAILABILITY_CODES.has(error?.code)) {
      release(routeKey);
      return snapshot(routeKey);
    }
    if (state.state === CIRCUIT_STATES.HALF_OPEN) {
      if (credentialSlotId) state.failuresByCredential.set(String(credentialSlotId), now);
      open(state, error);
      return snapshot(routeKey);
    }
    if (credentialSlotId) state.failuresByCredential.set(String(credentialSlotId), now);
    prune(state, now);
    if (state.failuresByCredential.size >= requiredEvidence(totalEligibleSlots)) open(state, error);
    return snapshot(routeKey);
  }

  function recordSuccess(routeKey) {
    const state = ensure(routeKey);
    const now = nowMs();
    state.state = CIRCUIT_STATES.CLOSED;
    state.openUntil = 0;
    state.failuresByCredential.clear();
    state.halfOpenProbeInFlight = false;
    state.confirmationProbeInFlight = false;
    state.lastErrorCode = null;
    state.lastHttpStatus = 200;
    state.lastSuccessAt = new Date(now);
    state.updatedAt = now;
    return snapshot(routeKey);
  }

  function snapshot(routeKey = null) {
    if (routeKey) {
      const state = refresh(ensure(routeKey));
      return Object.freeze({
        routeKey: state.routeKey,
        state: state.state,
        openUntil: state.openUntil ? new Date(state.openUntil) : null,
        distinctFailureSlots: state.failuresByCredential.size,
        halfOpenProbeInFlight: state.halfOpenProbeInFlight,
        confirmationProbeInFlight: state.confirmationProbeInFlight,
        lastErrorCode: state.lastErrorCode,
        lastHttpStatus: state.lastHttpStatus,
        lastFailureAt: state.lastFailureAt,
        lastSuccessAt: state.lastSuccessAt,
        updatedAt: state.updatedAt ? new Date(state.updatedAt) : null,
      });
    }
    return Object.freeze(Array.from(routes.keys()).map((key) => snapshot(key)));
  }

  function persistenceRecord(routeKey) {
    const state = refresh(ensure(routeKey));
    return {
      // Historical persistence schema calls this modelId; value is routeKey.
      modelId: state.routeKey,
      state: state.state,
      openUntil: state.openUntil ? new Date(state.openUntil) : null,
      failureSlots: Array.from(state.failuresByCredential.entries()).map(
        ([credentialSlotId, failedAt]) => ({
          slotId: credentialSlotId,
          failedAt: new Date(failedAt).toISOString(),
        })
      ),
      lastErrorCode: state.lastErrorCode,
      lastHttpStatus: state.lastHttpStatus,
      lastFailureAt: state.lastFailureAt,
      lastSuccessAt: state.lastSuccessAt,
    };
  }

  async function persist(routeKey) {
    if (!store?.upsertProviderModelHealth || !routeKey) return null;
    const row = await store.upsertProviderModelHealth(persistenceRecord(routeKey));
    const persistedAt = Date.parse(row?.updated_at || '');
    if (Number.isFinite(persistedAt)) {
      const state = ensure(routeKey);
      state.updatedAt = Math.max(state.updatedAt || 0, persistedAt);
    }
    return row;
  }

  function hydrateRow(row, { force = false } = {}) {
    if (!row?.model_id) return false;
    const routeKey = row.model_id;
    const state = ensure(routeKey);
    const rowUpdatedAt = Date.parse(row.updated_at || '');
    if (!force && Number.isFinite(rowUpdatedAt) && state.updatedAt && rowUpdatedAt <= state.updatedAt) {
      return false;
    }

    state.state = Object.values(CIRCUIT_STATES).includes(row.state)
      ? row.state
      : CIRCUIT_STATES.CLOSED;
    state.openUntil = row.open_until ? new Date(row.open_until).getTime() : 0;
    state.failuresByCredential.clear();
    const failures = Array.isArray(row.failure_slots) ? row.failure_slots : [];
    for (const failure of failures) {
      const credentialSlotId = String(failure?.slotId || '').trim();
      const failedAt = Date.parse(failure?.failedAt || '');
      if (!credentialSlotId || !Number.isFinite(failedAt)) continue;
      state.failuresByCredential.set(credentialSlotId, failedAt);
    }

    state.halfOpenProbeInFlight = false;
    state.confirmationProbeInFlight = false;
    state.lastErrorCode = row.last_error_code || null;
    state.lastHttpStatus = row.last_http_status == null ? null : Number(row.last_http_status);
    state.lastFailureAt = row.last_failure_at ? new Date(row.last_failure_at) : null;
    state.lastSuccessAt = row.last_success_at ? new Date(row.last_success_at) : null;
    state.updatedAt = Number.isFinite(rowUpdatedAt)
      ? rowUpdatedAt
      : Math.max(state.lastFailureAt?.getTime?.() || 0, state.lastSuccessAt?.getTime?.() || 0);
    refresh(state);
    return true;
  }

  async function hydrate() {
    if (!store?.loadProviderModelHealth) return 0;
    const rows = await store.loadProviderModelHealth();
    let count = 0;
    for (const row of rows || []) if (hydrateRow(row, { force: true })) count += 1;
    return count;
  }

  async function refreshFromStore() {
    if (!store?.loadProviderModelHealth) return 0;
    const rows = await store.loadProviderModelHealth();
    let count = 0;
    for (const row of rows || []) if (hydrateRow(row)) count += 1;
    return count;
  }

  return Object.freeze({
    availability,
    acquire,
    beginConfirmationProbe,
    endConfirmationProbe,
    release,
    recordFailure,
    recordSuccess,
    snapshot,
    persistenceRecord,
    persist,
    hydrate,
    refreshFromStore,
  });
}

module.exports = {
  ROUTE_AVAILABILITY_CODES,
  CIRCUIT_STATES,
  createProviderHealth,
};
