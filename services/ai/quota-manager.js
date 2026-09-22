'use strict';

const { AI_ERROR_CODES } = require('./errors');

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

const PROJECT_MODEL_STATES = Object.freeze({
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

function createQuotaManager({
  store = null,
  clock = () => new Date(),
  rpmCooldownMs = 65000,
  tpmCooldownMs = 65000,
  unknownRateLimitCooldownMs = 65000,
} = {}) {
  const cache = new Map();

  function key(projectSlot, modelId) {
    return `${projectSlot}::${modelId}`;
  }

  function baseState(projectSlot, modelId, now = clock()) {
    return {
      projectSlot,
      modelId,
      state: PROJECT_MODEL_STATES.READY,
      quotaDay: pacificDayKey(now),
      attemptsToday: 0,
      successesToday: 0,
      observedQuotaLimit: null,
      cooldownUntil: null,
      lastErrorCode: null,
      lastHttpStatus: null,
      lastSuccessAt: null,
      lastFailureAt: null,
    };
  }

  function fromRow(row) {
    return {
      projectSlot: row.project_slot,
      modelId: row.model_id,
      state: row.state || PROJECT_MODEL_STATES.READY,
      quotaDay: row.quota_day ? String(row.quota_day).slice(0, 10) : null,
      attemptsToday: Number(row.attempts_today) || 0,
      successesToday: Number(row.successes_today) || 0,
      observedQuotaLimit: row.observed_quota_limit == null ? null : Number(row.observed_quota_limit),
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until) : null,
      lastErrorCode: row.last_error_code || null,
      lastHttpStatus: row.last_http_status == null ? null : Number(row.last_http_status),
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
      lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null,
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

      if (
        state.state === PROJECT_MODEL_STATES.EXHAUSTED_RPD ||
        state.state === PROJECT_MODEL_STATES.COOLDOWN_RPM ||
        state.state === PROJECT_MODEL_STATES.COOLDOWN_TPM
      ) {
        state.state = PROJECT_MODEL_STATES.READY;
        state.cooldownUntil = null;
        state.lastErrorCode = null;
        state.lastHttpStatus = null;
      }
      changed = true;
    }

    if (
      (state.state === PROJECT_MODEL_STATES.COOLDOWN_RPM ||
       state.state === PROJECT_MODEL_STATES.COOLDOWN_TPM) &&
      state.cooldownUntil &&
      new Date(state.cooldownUntil).getTime() <= now.getTime()
    ) {
      state.state = PROJECT_MODEL_STATES.READY;
      state.cooldownUntil = null;
      changed = true;
    }

    return changed;
  }

  async function persist(state) {
    if (!store?.upsertProjectModelState) return;
    await store.upsertProjectModelState(state);
  }

  async function hydrate() {
    if (!store?.loadProjectModelStates) return 0;
    const rows = await store.loadProjectModelStates();
    let count = 0;
    for (const row of rows || []) {
      const state = fromRow(row);
      let changed = normalize(state);
      const now = clock();

      // Older KIWI builds recorded unclassified 429 responses while leaving
      // the route READY. Repair those rows during hydration so a deploy does
      // not immediately replay the same rate-limited project/model pair.
      if (
        state.state === PROJECT_MODEL_STATES.READY &&
        state.lastErrorCode === AI_ERROR_CODES.RATE_LIMIT_UNKNOWN &&
        state.lastHttpStatus === 429 &&
        state.lastFailureAt
      ) {
        const cooldownUntil = new Date(
          new Date(state.lastFailureAt).getTime() + unknownRateLimitCooldownMs
        );
        if (cooldownUntil.getTime() > now.getTime()) {
          state.state = PROJECT_MODEL_STATES.COOLDOWN_RPM;
          state.cooldownUntil = cooldownUntil;
          changed = true;
        }
      }

      cache.set(key(state.projectSlot, state.modelId), state);
      count++;
      if (changed) await persist(state);
    }
    return count;
  }

  function get(projectSlot, modelId) {
    const cacheKey = key(projectSlot, modelId);
    let state = cache.get(cacheKey);
    if (!state) {
      state = baseState(projectSlot, modelId);
      cache.set(cacheKey, state);
    }
    normalize(state);
    return state;
  }

  function isEligible(projectSlot, modelId) {
    const state = get(projectSlot, modelId);
    return state.state === PROJECT_MODEL_STATES.READY;
  }

  function slotHealthScore(projectSlot, modelId, now = clock()) {
    const state = get(projectSlot, modelId);
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

  function filterEligibleSlots(modelId, slots) {
    return (slots || [])
      .map((slot, index) => ({
        slot,
        index,
        eligible: isEligible(slot.id, modelId),
        score: slotHealthScore(slot.id, modelId),
      }))
      .filter((entry) => entry.eligible)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.slot);
  }

  function cooldownDuration(error, fallbackMs) {
    const providerDelay = Number(error?.retryAfterMs);
    if (Number.isFinite(providerDelay) && providerDelay >= 0) {
      // Respect provider RetryInfo/Retry-After while bounding pathological
      // values so a malformed response cannot quarantine a route indefinitely.
      return Math.max(1000, Math.min(providerDelay, 10 * 60 * 1000));
    }
    return fallbackMs;
  }

  async function markSuccess(projectSlot, modelId) {
    const now = clock();
    const state = get(projectSlot, modelId);
    state.state = PROJECT_MODEL_STATES.READY;
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

  async function markFailure(projectSlot, modelId, error) {
    const now = clock();
    const state = get(projectSlot, modelId);
    state.quotaDay = pacificDayKey(now);
    state.attemptsToday += 1;
    state.lastErrorCode = error?.code || AI_ERROR_CODES.UNKNOWN;
    state.lastHttpStatus = error?.status ?? null;
    state.lastFailureAt = now;

    const observed = extractObservedQuotaLimit(error?.details);
    if (observed != null) state.observedQuotaLimit = observed;

    switch (error?.code) {
      case AI_ERROR_CODES.RATE_LIMIT_RPD:
        state.state = PROJECT_MODEL_STATES.EXHAUSTED_RPD;
        state.cooldownUntil = null;
        break;
      case AI_ERROR_CODES.RATE_LIMIT_RPM:
        state.state = PROJECT_MODEL_STATES.COOLDOWN_RPM;
        state.cooldownUntil = new Date(
          now.getTime() + cooldownDuration(error, rpmCooldownMs)
        );
        break;
      case AI_ERROR_CODES.RATE_LIMIT_TPM:
        state.state = PROJECT_MODEL_STATES.COOLDOWN_TPM;
        state.cooldownUntil = new Date(
          now.getTime() + cooldownDuration(error, tpmCooldownMs)
        );
        break;
      case AI_ERROR_CODES.RATE_LIMIT_UNKNOWN:
        // Unknown 429s must never remain READY. Treat them conservatively as
        // a short request-rate cooldown unless the provider supplies a more
        // precise RetryInfo/Retry-After delay.
        state.state = PROJECT_MODEL_STATES.COOLDOWN_RPM;
        state.cooldownUntil = new Date(
          now.getTime() + cooldownDuration(error, unknownRateLimitCooldownMs)
        );
        break;
      case AI_ERROR_CODES.AUTH:
        state.state = PROJECT_MODEL_STATES.KEY_INVALID;
        state.cooldownUntil = null;
        break;
      case AI_ERROR_CODES.MODEL_NOT_FOUND:
        state.state = PROJECT_MODEL_STATES.MODEL_UNAVAILABLE;
        state.cooldownUntil = null;
        break;
      default:
        // Transient/network/request failures do not poison persistent quota state.
        if (
          state.state === PROJECT_MODEL_STATES.COOLDOWN_RPM ||
          state.state === PROJECT_MODEL_STATES.COOLDOWN_TPM
        ) {
          normalize(state, now);
        }
        break;
    }

    await persist(state);
    return state;
  }

  async function disable(projectSlot, modelId) {
    const state = get(projectSlot, modelId);
    state.state = PROJECT_MODEL_STATES.DISABLED;
    state.cooldownUntil = null;
    await persist(state);
    return state;
  }

  async function enable(projectSlot, modelId) {
    const state = get(projectSlot, modelId);
    state.state = PROJECT_MODEL_STATES.READY;
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
      rows.push({
        projectSlot: state.projectSlot,
        modelId: state.modelId,
        state: state.state,
        quotaDay: state.quotaDay,
        attemptsToday: state.attemptsToday,
        successesToday: state.successesToday,
        observedQuotaLimit: state.observedQuotaLimit,
        cooldownUntil: state.cooldownUntil,
        lastErrorCode: state.lastErrorCode,
        lastHttpStatus: state.lastHttpStatus,
      });
    }
    return rows;
  }

  return Object.freeze({
    hydrate,
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
  PROJECT_MODEL_STATES,
  pacificDayKey,
  extractObservedQuotaLimit,
  createQuotaManager,
};
