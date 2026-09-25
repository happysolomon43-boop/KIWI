'use strict';

const { AI_CLASSES } = require('./task-registry');
const { AI_ERROR_CODES } = require('./errors');

const SHORT_RATE_LIMIT_CODES = new Set([
  AI_ERROR_CODES.RATE_LIMIT_RPM,
  AI_ERROR_CODES.RATE_LIMIT_TPM,
  AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
]);

const AVAILABILITY_FAILURE_CODES = new Set([
  AI_ERROR_CODES.RATE_LIMIT_RPM,
  AI_ERROR_CODES.RATE_LIMIT_TPM,
  AI_ERROR_CODES.RATE_LIMIT_RPD,
  AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
  AI_ERROR_CODES.PROVIDER_OVERLOADED,
  AI_ERROR_CODES.TRANSIENT,
  AI_ERROR_CODES.TIMEOUT,
  AI_ERROR_CODES.NETWORK,
  AI_ERROR_CODES.EMPTY_RESPONSE,
  AI_ERROR_CODES.CAPACITY_EXHAUSTED,
  AI_ERROR_CODES.ORCHESTRATOR_BUSY,
  AI_ERROR_CODES.QUEUE_TIMEOUT,
]);

const DEFAULT_OPERATION_LIMITS = Object.freeze({
  [AI_CLASSES.VVIP]: Object.freeze({
    // Reckoning can legitimately prepare up to 30 questions and each item may
    // use up to 3 content-validation attempts after successful provider calls.
    // Keep that quality envelope intact; availability failures are bounded by
    // the much tighter counters below.
    maxProviderAttempts: 96,
    maxAvailabilityFailures: 24,
    maxShortRateLimitFailures: 12,
    maxProviderOverloadFailures: 12,
  }),
  [AI_CLASSES.VIP]: Object.freeze({
    maxProviderAttempts: 32,
    maxAvailabilityFailures: 14,
    maxShortRateLimitFailures: 8,
    maxProviderOverloadFailures: 8,
  }),
  [AI_CLASSES.IP]: Object.freeze({
    maxProviderAttempts: 16,
    maxAvailabilityFailures: 8,
    maxShortRateLimitFailures: 4,
    maxProviderOverloadFailures: 4,
  }),
});

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function createOperationBudget({
  store = null,
  env = process.env,
  clock = () => Date.now(),
} = {}) {
  const local = new Map();
  const ttlMs = boundedNumber(
    env.AI_OPERATION_BUDGET_TTL_MS,
    30 * 60 * 1000,
    60 * 1000,
    6 * 60 * 60 * 1000
  );

  function nowMs() {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function limitsFor(taskClass) {
    const base = DEFAULT_OPERATION_LIMITS[taskClass] || DEFAULT_OPERATION_LIMITS[AI_CLASSES.VIP];
    const prefix =
      taskClass === AI_CLASSES.VVIP ? 'VVIP' :
      taskClass === AI_CLASSES.IP ? 'IP' :
      'VIP';

    return Object.freeze({
      maxProviderAttempts: boundedNumber(
        env[`AI_${prefix}_OPERATION_MAX_PROVIDER_ATTEMPTS`],
        base.maxProviderAttempts,
        1,
        500
      ),
      maxAvailabilityFailures: boundedNumber(
        env[`AI_${prefix}_OPERATION_MAX_AVAILABILITY_FAILURES`],
        base.maxAvailabilityFailures,
        1,
        250
      ),
      maxShortRateLimitFailures: boundedNumber(
        env[`AI_${prefix}_OPERATION_MAX_SHORT_RATE_FAILURES`],
        base.maxShortRateLimitFailures,
        1,
        100
      ),
      maxProviderOverloadFailures: boundedNumber(
        env[`AI_${prefix}_OPERATION_MAX_PROVIDER_OVERLOAD_FAILURES`],
        base.maxProviderOverloadFailures,
        1,
        100
      ),
    });
  }

  function ensureLocal(operationId, taskClass) {
    const now = nowMs();
    let state = local.get(operationId);
    if (!state || state.expiresAt <= now) {
      state = {
        operationId,
        taskClass,
        providerAttempts: 0,
        successes: 0,
        availabilityFailures: 0,
        shortRateLimitFailures: 0,
        providerOverloadFailures: 0,
        expiresAt: now + ttlMs,
      };
      local.set(operationId, state);
    }
    return state;
  }

  function withinLimits(state, limits) {
    return (
      state.providerAttempts < limits.maxProviderAttempts &&
      state.availabilityFailures < limits.maxAvailabilityFailures &&
      state.shortRateLimitFailures < limits.maxShortRateLimitFailures &&
      state.providerOverloadFailures < limits.maxProviderOverloadFailures
    );
  }

  async function claim({ operationId, taskClass }) {
    if (!operationId) {
      throw new Error('Operation budget requires operationId');
    }

    const limits = limitsFor(taskClass);

    if (store?.claimOperationAttempt) {
      const row = await store.claimOperationAttempt({
        operationId,
        taskClass,
        ...limits,
        ttlMs,
      });

      if (!row) {
        return Object.freeze({
          allowed: false,
          operationId,
          taskClass,
          limits,
          state: null,
        });
      }

      return Object.freeze({
        allowed: true,
        operationId,
        taskClass,
        limits,
        attemptNumber: Number(row.provider_attempts) || 1,
        state: Object.freeze({
          providerAttempts: Number(row.provider_attempts) || 0,
          successes: Number(row.successes) || 0,
          availabilityFailures: Number(row.availability_failures) || 0,
          shortRateLimitFailures: Number(row.short_rate_limit_failures) || 0,
          providerOverloadFailures: Number(row.provider_overload_failures) || 0,
        }),
      });
    }

    const state = ensureLocal(operationId, taskClass);
    if (!withinLimits(state, limits)) {
      return Object.freeze({
        allowed: false,
        operationId,
        taskClass,
        limits,
        state: Object.freeze({ ...state }),
      });
    }

    state.providerAttempts += 1;
    state.expiresAt = Math.max(state.expiresAt, nowMs() + ttlMs);

    return Object.freeze({
      allowed: true,
      operationId,
      taskClass,
      limits,
      attemptNumber: state.providerAttempts,
      state: Object.freeze({ ...state }),
    });
  }

  async function recordOutcome(operationId, error = null) {
    if (!operationId) return null;

    const success = !error;
    const availabilityFailure = Boolean(
      error && AVAILABILITY_FAILURE_CODES.has(error.code)
    );
    const shortRateLimitFailure = Boolean(
      error && SHORT_RATE_LIMIT_CODES.has(error.code)
    );
    const providerOverloadFailure = Boolean(
      error && (
        error.code === AI_ERROR_CODES.PROVIDER_OVERLOADED ||
        error.code === AI_ERROR_CODES.TRANSIENT
      )
    );

    if (store?.recordOperationAttemptOutcome) {
      return store.recordOperationAttemptOutcome({
        operationId,
        success,
        availabilityFailure,
        shortRateLimitFailure,
        providerOverloadFailure,
      });
    }

    const state = local.get(operationId);
    if (!state) return null;

    if (success) state.successes += 1;
    if (availabilityFailure) state.availabilityFailures += 1;
    if (shortRateLimitFailure) state.shortRateLimitFailures += 1;
    if (providerOverloadFailure) state.providerOverloadFailures += 1;
    return Object.freeze({ ...state });
  }

  function snapshot() {
    const now = nowMs();
    const rows = [];
    for (const [operationId, state] of local.entries()) {
      if (state.expiresAt <= now) {
        local.delete(operationId);
        continue;
      }
      rows.push(Object.freeze({ ...state }));
    }

    return Object.freeze({
      ttlMs,
      localOperations: Object.freeze(rows),
      defaults: DEFAULT_OPERATION_LIMITS,
    });
  }

  return Object.freeze({
    limitsFor,
    claim,
    recordOutcome,
    snapshot,
  });
}

module.exports = {
  SHORT_RATE_LIMIT_CODES,
  AVAILABILITY_FAILURE_CODES,
  DEFAULT_OPERATION_LIMITS,
  createOperationBudget,
};
