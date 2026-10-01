'use strict';

const { AI_ERROR_CODES } = require('./errors');

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

const ROUTE_QUOTA_STATES = Object.freeze({
  READY: 'READY',
  COOLDOWN_RPM: 'COOLDOWN_RPM',
  COOLDOWN_TPM: 'COOLDOWN_TPM',
  EXHAUSTED_RPD: 'EXHAUSTED_RPD',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  KEY_INVALID: 'KEY_INVALID',
  DISABLED: 'DISABLED',
});

function pacificDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function extractObservedQuotaLimit(details) {
  let found = null;
  function walk(value) {
    if (found != null || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/quota(value|limit)/i.test(key)) {
        const parsed = Number(item);
        if (Number.isFinite(parsed) && parsed >= 0) {
          found = parsed;
          return;
        }
      }
      walk(item);
    }
  }
  walk(details);
  return found;
}

function timestampMs(value) {
  if (value == null) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function createQuotaManager({
  store = null,
  clock = () => new Date(),
  rpmCooldownMs = 65000,
  tpmCooldownMs = 65000,
  unknownRateLimitCooldownMs = 65000,
} = {}) {
  const cache = new Map();

  function key(credentialSlotId, routeKey) {
    return `${credentialSlotId}::${routeKey}`;
  }

  function baseState(credentialSlotId, routeKey, now = clock()) {
    return {
      credentialSlotId,
      routeKey,
      state: ROUTE_QUOTA_STATES.READY,
      quotaDay: pacificDayKey(now),
      attemptsToday: 0,
      successesToday: 0,
      observedQuotaLimit: null,
      observedQuotaDimension: null,
      cooldownUntil: null,
      lastErrorCode: null,
      lastHttpStatus: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      updatedAt: 0,
    };
  }

  function fromRow(row) {
    return {
      credentialSlotId: row.project_slot,
      routeKey: row.model_id,
      state: row.state || ROUTE_QUOTA_STATES.READY,
      quotaDay: row.quota_day ? String(row.quota_day).slice(0, 10) : null,
      attemptsToday: Number(row.attempts_today) || 0,
      successesToday: Number(row.successes_today) || 0,
      observedQuotaLimit: row.observed_quota_limit == null ? null : Number(row.observed_quota_limit),
      observedQuotaDimension: row.observed_quota_dimension || null,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until) : null,
      lastErrorCode: row.last_error_code || null,
      lastHttpStatus: row.last_http_status == null ? null : Number(row.last_http_status),
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
      lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null,
      updatedAt: timestampMs(row.updated_at),
    };
  }

  function normalize(state, now = clock()) {
    const currentDay = pacificDayKey(now);
    let changed = false;

    if (state.quotaDay !== currentDay) {
      state.quotaDay = currentDay;
      state.attemptsToday = 0;
      state.successesToday = 0;
      state.observedQuotaLimit = null;
      state.observedQuotaDimension = null;
      if (
        state.state === ROUTE_QUOTA_STATES.EXHAUSTED_RPD ||
        state.state === ROUTE_QUOTA_STATES.COOLDOWN_RPM ||
        state.state === ROUTE_QUOTA_STATES.COOLDOWN_TPM
      ) {
        state.state = ROUTE_QUOTA_STATES.READY;
        state.cooldownUntil = null;
        state.lastErrorCode = null;
        state.lastHttpStatus = null;
      }
      changed = true;
    }

    if (
      (state.state === ROUTE_QUOTA_STATES.COOLDOWN_RPM || state.state === ROUTE_QUOTA_STATES.COOLDOWN_TPM) &&
      state.cooldownUntil &&
      new Date(state.cooldownUntil).getTime() <= now.getTime()
    ) {
      state.state = ROUTE_QUOTA_STATES.READY;
      state.cooldownUntil = null;
      changed = true;
    }
    return changed;
  }

  async function persist(state) {
    if (!store?.upsertProjectModelState) return null;
    const row = await store.upsertProjectModelState({
      ...state,
      // Historical SQL column names are translated here and nowhere above.
      projectSlot: state.credentialSlotId,
      modelId: state.routeKey,
    });
    const persistedAt = timestampMs(row?.updated_at);
    if (persistedAt) state.updatedAt = Math.max(Number(state.updatedAt) || 0, persistedAt);
    return row;
  }

  async function reconcileFromStore({ force = false } = {}) {
    if (!store?.loadProjectModelStates) return 0;
    const rows = await store.loadProjectModelStates();
    let count = 0;

    for (const row of rows || []) {
      const state = fromRow(row);
      const cacheKey = key(state.credentialSlotId, state.routeKey);
      const existing = cache.get(cacheKey);
      if (!force && existing && state.updatedAt && existing.updatedAt && state.updatedAt <= existing.updatedAt) {
        continue;
      }

      let changed = normalize(state);
      const now = clock();
      if (
        state.state === ROUTE_QUOTA_STATES.READY &&
        state.lastErrorCode === AI_ERROR_CODES.RATE_LIMIT_UNKNOWN &&
        state.lastHttpStatus === 429 &&
        state.lastFailureAt
      ) {
        const cooldownUntil = new Date(new Date(state.lastFailureAt).getTime() + unknownRateLimitCooldownMs);
        if (cooldownUntil.getTime() > now.getTime()) {
          state.state = ROUTE_QUOTA_STATES.COOLDOWN_RPM;
          state.cooldownUntil = cooldownUntil;
          changed = true;
        }
      }

      cache.set(cacheKey, state);
      count += 1;
      if (changed) {
        state.updatedAt = Math.max(Number(state.updatedAt) || 0, now.getTime());
        await persist(state);
      }
    }
    return count;
  }

  async function hydrate() {
    return reconcileFromStore({ force: true });
  }

  async function refresh() {
    return reconcileFromStore({ force: false });
  }

  function get(credentialSlotId, routeKey) {
    const cacheKey = key(credentialSlotId, routeKey);
    let state = cache.get(cacheKey);
    if (!state) {
      state = baseState(credentialSlotId, routeKey);
      cache.set(cacheKey, state);
    }
    normalize(state);
    return state;
  }

  function isEligible(credentialSlotId, routeKey) {
    return get(credentialSlotId, routeKey).state === ROUTE_QUOTA_STATES.READY;
  }

  function slotHealthScore(credentialSlotId, routeKey, now = clock()) {
    const state = get(credentialSlotId, routeKey);
    const attempts = Math.max(0, Number(state.attemptsToday) || 0);
    const successes = Math.max(0, Number(state.successesToday) || 0);
    const failures = Math.max(0, attempts - successes);
    let score = (successes * 6) - (failures * 2);
    const nowMs = now.getTime();

    if (state.lastSuccessAt) {
      const ageMs = Math.max(0, nowMs - new Date(state.lastSuccessAt).getTime());
      if (ageMs <= 5 * 60 * 1000) score += 20;
      else if (ageMs <= 30 * 60 * 1000) score += 8;
    }
    if (state.lastFailureAt) {
      const ageMs = Math.max(0, nowMs - new Date(state.lastFailureAt).getTime());
      if (ageMs <= 15 * 1000) score -= 12;
      else if (ageMs <= 60 * 1000) score -= 5;
    }
    return score;
  }

  function filterEligibleSlots(routeKey, slots) {
    return (slots || [])
      .map((slot, index) => ({
        slot,
        index,
        eligible: isEligible(slot.id, routeKey),
        score: slotHealthScore(slot.id, routeKey),
      }))
      .filter((entry) => entry.eligible)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.slot);
  }

  function cooldownDuration(error, fallbackMs) {
    const providerDelay = Number(error?.retryAfterMs);
    if (Number.isFinite(providerDelay) && providerDelay >= 0) {
      return Math.max(1000, Math.min(providerDelay, 10 * 60 * 1000));
    }
    return fallbackMs;
  }

  async function markSuccess(credentialSlotId, routeKey) {
    const now = clock();
    const state = get(credentialSlotId, routeKey);
    state.updatedAt = Math.max(Number(state.updatedAt) || 0, now.getTime());
    state.state = ROUTE_QUOTA_STATES.READY;
    state.quotaDay = pacificDayKey(now);
    state.attemptsToday += 1;
    state.successesToday += 1;
    state.cooldownUntil = null;
    state.lastErrorCode = null;
    state.lastHttpStatus = 200;
    state.lastSuccessAt = now;
    await persist(state);
    return state;
  }

  async function markFailure(credentialSlotId, routeKey, error) {
    const now = clock();
    const state = get(credentialSlotId, routeKey);
    state.updatedAt = Math.max(Number(state.updatedAt) || 0, now.getTime());
    state.quotaDay = pacificDayKey(now);
    state.attemptsToday += 1;
    state.lastErrorCode = error?.code || AI_ERROR_CODES.UNKNOWN;
    state.lastHttpStatus = error?.status ?? null;
    state.lastFailureAt = now;

    const evidence = error?.providerEvidence || null;
    const observed = evidence?.quotaLimitValue == null
      ? extractObservedQuotaLimit(error?.details)
      : Number(evidence.quotaLimitValue);
    if (observed != null && Number.isFinite(observed)) {
      state.observedQuotaLimit = observed;
      state.observedQuotaDimension = evidence?.quotaDimension || (
        error?.code === AI_ERROR_CODES.RATE_LIMIT_RPD ? 'RPD' :
        error?.code === AI_ERROR_CODES.RATE_LIMIT_RPM ? 'RPM' :
        error?.code === AI_ERROR_CODES.RATE_LIMIT_TPM ? 'TPM' : 'UNKNOWN'
      );
    }

    switch (error?.code) {
      case AI_ERROR_CODES.RATE_LIMIT_RPD:
        state.state = ROUTE_QUOTA_STATES.EXHAUSTED_RPD;
        state.cooldownUntil = null;
        break;
      case AI_ERROR_CODES.RATE_LIMIT_RPM:
        state.state = ROUTE_QUOTA_STATES.COOLDOWN_RPM;
        state.cooldownUntil = new Date(now.getTime() + cooldownDuration(error, rpmCooldownMs));
        break;
      case AI_ERROR_CODES.RATE_LIMIT_TPM:
        state.state = ROUTE_QUOTA_STATES.COOLDOWN_TPM;
        state.cooldownUntil = new Date(now.getTime() + cooldownDuration(error, tpmCooldownMs));
        break;
      case AI_ERROR_CODES.RATE_LIMIT_UNKNOWN:
        state.state = ROUTE_QUOTA_STATES.COOLDOWN_RPM;
        state.cooldownUntil = new Date(now.getTime() + cooldownDuration(error, unknownRateLimitCooldownMs));
        break;
      case AI_ERROR_CODES.AUTH:
        state.state = ROUTE_QUOTA_STATES.KEY_INVALID;
        state.cooldownUntil = null;
        break;
      case AI_ERROR_CODES.MODEL_NOT_FOUND:
        state.state = ROUTE_QUOTA_STATES.MODEL_UNAVAILABLE;
        state.cooldownUntil = null;
        break;
      default:
        if (state.state === ROUTE_QUOTA_STATES.COOLDOWN_RPM || state.state === ROUTE_QUOTA_STATES.COOLDOWN_TPM) {
          normalize(state, now);
        }
        break;
    }

    await persist(state);
    return state;
  }

  async function disable(credentialSlotId, routeKey) {
    const now = clock();
    const state = get(credentialSlotId, routeKey);
    state.updatedAt = Math.max(Number(state.updatedAt) || 0, now.getTime());
    state.state = ROUTE_QUOTA_STATES.DISABLED;
    state.cooldownUntil = null;
    await persist(state);
    return state;
  }

  async function enable(credentialSlotId, routeKey) {
    const now = clock();
    const state = get(credentialSlotId, routeKey);
    state.updatedAt = Math.max(Number(state.updatedAt) || 0, now.getTime());
    state.state = ROUTE_QUOTA_STATES.READY;
    state.cooldownUntil = null;
    state.lastErrorCode = null;
    state.lastHttpStatus = null;
    await persist(state);
    return state;
  }

  function snapshot() {
    const rows = [];
    for (const state of cache.values()) {
      normalize(state);
      rows.push(Object.freeze({
        credentialSlotId: state.credentialSlotId,
        routeKey: state.routeKey,
        state: state.state,
        quotaDay: state.quotaDay,
        attemptsToday: state.attemptsToday,
        successesToday: state.successesToday,
        observedQuotaLimit: state.observedQuotaLimit,
        observedQuotaDimension: state.observedQuotaDimension,
        cooldownUntil: state.cooldownUntil,
        lastErrorCode: state.lastErrorCode,
        lastHttpStatus: state.lastHttpStatus,
        lastSuccessAt: state.lastSuccessAt,
        lastFailureAt: state.lastFailureAt,
        updatedAt: state.updatedAt ? new Date(state.updatedAt) : null,
      }));
    }
    return Object.freeze(rows);
  }

  return Object.freeze({
    hydrate,
    refresh,
    get,
    isEligible,
    filterEligibleSlots,
    slotHealthScore,
    markSuccess,
    markFailure,
    disable,
    enable,
    snapshot,
  });
}

module.exports = {
  PACIFIC_TIME_ZONE,
  ROUTE_QUOTA_STATES,
  pacificDayKey,
  extractObservedQuotaLimit,
  timestampMs,
  createQuotaManager,
};
