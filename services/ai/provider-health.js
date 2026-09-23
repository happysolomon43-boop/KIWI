'use strict';

const { AI_ERROR_CODES } = require('./errors');

const MODEL_AVAILABILITY_CODES = new Set([
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
  const models = new Map();

  function nowMs() {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function ensure(modelId) {
    let state = models.get(modelId);
    if (!state) {
      state = {
        modelId,
        state: CIRCUIT_STATES.CLOSED,
        openUntil: 0,
        failuresBySlot: new Map(),
        halfOpenProbeInFlight: false,
        lastErrorCode: null,
        lastHttpStatus: null,
        lastFailureAt: null,
        lastSuccessAt: null,
      };
      models.set(modelId, state);
    }
    return state;
  }

  function prune(state, now = nowMs()) {
    for (const [slotId, failedAt] of state.failuresBySlot.entries()) {
      if (now - failedAt > failureEvidenceWindowMs) {
        state.failuresBySlot.delete(slotId);
      }
    }
  }

  function refresh(state, now = nowMs()) {
    prune(state, now);

    if (state.state === CIRCUIT_STATES.OPEN && state.openUntil <= now) {
      state.state = CIRCUIT_STATES.HALF_OPEN;
      state.openUntil = 0;
      state.halfOpenProbeInFlight = false;
    }

    return state;
  }

  function requiredEvidence(totalEligibleSlots) {
    const slots = Math.max(1, Number(totalEligibleSlots) || 1);
    return Math.min(
      slots,
      Math.max(1, Number(minDistinctFailureSlots) || 1)
    );
  }

  function retryDelay(error) {
    const providerDelay = Number(error?.retryAfterMs);
    if (Number.isFinite(providerDelay) && providerDelay > 0) {
      return Math.max(5000, Math.min(providerDelay, 120000));
    }
    return Math.max(5000, Math.min(Number(openCooldownMs) || 20000, 120000));
  }

  function availability(modelId) {
    const state = refresh(ensure(modelId));
    const now = nowMs();

    if (state.state === CIRCUIT_STATES.OPEN) {
      return Object.freeze({
        available: false,
        state: state.state,
        retryAfterMs: Math.max(0, state.openUntil - now),
        halfOpenProbe: false,
      });
    }

    if (
      state.state === CIRCUIT_STATES.HALF_OPEN &&
      state.halfOpenProbeInFlight
    ) {
      return Object.freeze({
        available: false,
        state: state.state,
        retryAfterMs: Math.max(
          1000,
          Math.min(Number(openCooldownMs) || 20000, 120000)
        ),
        halfOpenProbe: false,
      });
    }

    return Object.freeze({
      available: true,
      state: state.state,
      retryAfterMs: 0,
      halfOpenProbe: state.state === CIRCUIT_STATES.HALF_OPEN,
    });
  }

  function acquire(modelId) {
    const state = refresh(ensure(modelId));
    const availabilityState = availability(modelId);
    if (!availabilityState.available) return availabilityState;

    if (state.state === CIRCUIT_STATES.HALF_OPEN) {
      state.halfOpenProbeInFlight = true;
      return Object.freeze({
        ...availabilityState,
        halfOpenProbe: true,
      });
    }

    return availabilityState;
  }

  function release(modelId) {
    const state = ensure(modelId);
    if (state.state === CIRCUIT_STATES.HALF_OPEN) {
      state.halfOpenProbeInFlight = false;
    }
  }

  function open(state, error) {
    const now = nowMs();
    state.state = CIRCUIT_STATES.OPEN;
    state.openUntil = now + retryDelay(error);
    state.halfOpenProbeInFlight = false;
    state.lastErrorCode = error?.code || null;
    state.lastHttpStatus = error?.status ?? null;
    state.lastFailureAt = new Date(now);
  }

  function recordFailure(modelId, slotId, error, {
    totalEligibleSlots = 1,
  } = {}) {
    const state = refresh(ensure(modelId));
    const now = nowMs();

    state.lastErrorCode = error?.code || null;
    state.lastHttpStatus = error?.status ?? null;
    state.lastFailureAt = new Date(now);

    if (!MODEL_AVAILABILITY_CODES.has(error?.code)) {
      release(modelId);
      return snapshot(modelId);
    }

    if (state.state === CIRCUIT_STATES.HALF_OPEN) {
      if (slotId) state.failuresBySlot.set(String(slotId), now);
      open(state, error);
      return snapshot(modelId);
    }

    if (slotId) {
      state.failuresBySlot.set(String(slotId), now);
    }
    prune(state, now);

    if (
      state.failuresBySlot.size >= requiredEvidence(totalEligibleSlots)
    ) {
      open(state, error);
    }

    return snapshot(modelId);
  }

  function recordSuccess(modelId) {
    const state = ensure(modelId);
    const now = nowMs();
    state.state = CIRCUIT_STATES.CLOSED;
    state.openUntil = 0;
    state.failuresBySlot.clear();
    state.halfOpenProbeInFlight = false;
    state.lastErrorCode = null;
    state.lastHttpStatus = 200;
    state.lastSuccessAt = new Date(now);
    return snapshot(modelId);
  }

  function snapshot(modelId = null) {
    if (modelId) {
      const state = refresh(ensure(modelId));
      return Object.freeze({
        modelId: state.modelId,
        state: state.state,
        openUntil: state.openUntil ? new Date(state.openUntil) : null,
        distinctFailureSlots: state.failuresBySlot.size,
        halfOpenProbeInFlight: state.halfOpenProbeInFlight,
        lastErrorCode: state.lastErrorCode,
        lastHttpStatus: state.lastHttpStatus,
        lastFailureAt: state.lastFailureAt,
        lastSuccessAt: state.lastSuccessAt,
      });
    }

    return Array.from(models.keys()).map((id) => snapshot(id));
  }

  function persistenceRecord(modelId) {
    const state = refresh(ensure(modelId));
    return {
      modelId: state.modelId,
      state: state.state,
      openUntil: state.openUntil ? new Date(state.openUntil) : null,
      failureSlots: Array.from(state.failuresBySlot.entries()).map(
        ([slotId, failedAt]) => ({
          slotId,
          failedAt: new Date(failedAt).toISOString(),
        })
      ),
      lastErrorCode: state.lastErrorCode,
      lastHttpStatus: state.lastHttpStatus,
      lastFailureAt: state.lastFailureAt,
      lastSuccessAt: state.lastSuccessAt,
    };
  }

  async function persist(modelId) {
    if (!store?.upsertProviderModelHealth || !modelId) return null;
    return store.upsertProviderModelHealth(persistenceRecord(modelId));
  }

  function hydrateRow(row) {
    if (!row?.model_id) return false;

    const state = ensure(row.model_id);
    state.state = Object.values(CIRCUIT_STATES).includes(row.state)
      ? row.state
      : CIRCUIT_STATES.CLOSED;
    state.openUntil = row.open_until
      ? new Date(row.open_until).getTime()
      : 0;
    state.failuresBySlot.clear();

    const failures = Array.isArray(row.failure_slots) ? row.failure_slots : [];
    for (const failure of failures) {
      const slotId = String(failure?.slotId || '').trim();
      const failedAt = Date.parse(failure?.failedAt || '');
      if (!slotId || !Number.isFinite(failedAt)) continue;
      state.failuresBySlot.set(slotId, failedAt);
    }

    state.halfOpenProbeInFlight = false;
    state.lastErrorCode = row.last_error_code || null;
    state.lastHttpStatus = row.last_http_status == null
      ? null
      : Number(row.last_http_status);
    state.lastFailureAt = row.last_failure_at
      ? new Date(row.last_failure_at)
      : null;
    state.lastSuccessAt = row.last_success_at
      ? new Date(row.last_success_at)
      : null;

    refresh(state);
    return true;
  }

  async function hydrate() {
    if (!store?.loadProviderModelHealth) return 0;
    const rows = await store.loadProviderModelHealth();
    let count = 0;
    for (const row of rows || []) {
      if (hydrateRow(row)) count += 1;
    }
    return count;
  }

  return Object.freeze({
    availability,
    acquire,
    release,
    recordFailure,
    recordSuccess,
    snapshot,
    persistenceRecord,
    persist,
    hydrate,
  });
}

module.exports = {
  MODEL_AVAILABILITY_CODES,
  CIRCUIT_STATES,
  createProviderHealth,
};
