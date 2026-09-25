'use strict';

const { TEACHING_EVENT_NAMES } = require('../events/names');
const {
  RECONCILIATION_DISPOSITIONS,
} = require('./constants');
const {
  normalizeReconciliation,
  requireReconciler,
} = require('./reconciliation');

function parseBounded(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.floor(numeric), max));
}

function createDurableTeachingEventRuntime({
  store,
  workerId,
  logger = console,
  clock = () => new Date(),
  timers = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  },
  pollMs = 5_000,
  leaseMs = 30_000,
  batchSize = 20,
  maxAttempts = 5,
  retryBaseMs = 5_000,
} = {}) {
  if (!store || typeof store.claimDue !== 'function') {
    throw new TypeError('Durable Teaching runtime requires a persistent event store.');
  }
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new TypeError('Durable Teaching runtime requires a workerId.');
  }

  const handlers = new Map();
  const effectivePollMs = parseBounded(pollMs, 5_000, 1_000, 60_000);
  const effectiveLeaseMs = parseBounded(leaseMs, 30_000, 5_000, 5 * 60_000);
  const effectiveBatchSize = parseBounded(batchSize, 20, 1, 100);
  const effectiveMaxAttempts = parseBounded(maxAttempts, 5, 1, 20);
  const effectiveRetryBaseMs = parseBounded(retryBaseMs, 5_000, 1_000, 5 * 60_000);

  let interval = null;
  let running = false;
  let lastTickAt = null;
  let lastError = null;
  let processedCount = 0;

  function register(eventType, { reconcile, handle } = {}) {
    if (!TEACHING_EVENT_NAMES.includes(eventType)) {
      throw new TypeError(`Cannot register unknown Teaching event type: ${eventType}`);
    }
    requireReconciler(reconcile);
    if (typeof handle !== 'function') {
      throw new TypeError('Durable academic event registration requires an owning-domain handler.');
    }
    handlers.set(eventType, Object.freeze({ reconcile, handle }));
    return true;
  }

  function retryDelay(attemptCount) {
    const exponent = Math.max(0, Math.min(Number(attemptCount) - 1, 6));
    return Math.min(effectiveRetryBaseMs * (2 ** exponent), 15 * 60_000);
  }

  async function safelyFinishAttempt(attemptId, details) {
    try {
      await store.finishAttempt(attemptId, details);
    } catch (error) {
      logger?.warn?.('[KIWI Teaching] event-attempt telemetry write failed', {
        error: error?.message || String(error),
      });
    }
  }

  async function processClaimed(event) {
    const attemptId = await store.beginAttempt(event).catch(() => null);
    const registration = handlers.get(event.event_type);

    if (!registration) {
      const error = new Error(
        `No authoritative-domain handler is registered for ${event.event_type}; event remains fail-closed.`
      );
      error.code = 'TEACHING_DUE_EVENT_HANDLER_MISSING';

      if (Number(event.attempt_count) >= effectiveMaxAttempts) {
        await store.requireFairnessRecovery(event, error.code);
        await safelyFinishAttempt(attemptId, {
          outcome: 'FAIRNESS_RECOVERY',
          errorCode: error.code,
        });
        return 'FAIRNESS_RECOVERY_REQUIRED';
      }

      await store.retryClaim(event, {
        errorCode: error.code,
        errorMessage: error.message,
        retryAt: new Date(clock().getTime() + retryDelay(event.attempt_count)),
      });
      await safelyFinishAttempt(attemptId, { outcome: 'RETRY', errorCode: error.code });
      return 'RETRY_WAIT';
    }

    try {
      const reconciliation = normalizeReconciliation(await registration.reconcile(event));

      if (reconciliation.disposition !== RECONCILIATION_DISPOSITIONS.ACTIONABLE) {
        await store.completeClaim(event, {
          disposition: reconciliation.disposition,
          recoveryReason: reconciliation.reason,
          safeMetadata: reconciliation.metadata,
        });
        await safelyFinishAttempt(attemptId, {
          outcome: reconciliation.disposition,
          safeMetadata: reconciliation.metadata,
        });
        processedCount += 1;
        return reconciliation.disposition;
      }

      const result = await registration.handle(event, reconciliation);
      await store.completeClaim(event, {
        disposition: RECONCILIATION_DISPOSITIONS.ACTIONABLE,
        safeMetadata: result?.safeMetadata || {},
      });
      await safelyFinishAttempt(attemptId, {
        outcome: 'ACTIONED',
        safeMetadata: result?.safeMetadata || {},
      });
      processedCount += 1;
      return 'ACTIONED';
    } catch (error) {
      const code = error?.code || 'TEACHING_DUE_EVENT_EXECUTION_FAILED';

      if (Number(event.attempt_count) >= effectiveMaxAttempts) {
        await store.requireFairnessRecovery(event, code);
        await safelyFinishAttempt(attemptId, {
          outcome: 'FAIRNESS_RECOVERY',
          errorCode: code,
        });
        logger?.error?.('[KIWI Teaching] due event entered fairness recovery', {
          eventId: event.event_id,
          eventType: event.event_type,
          code,
        });
        return 'FAIRNESS_RECOVERY_REQUIRED';
      }

      await store.retryClaim(event, {
        errorCode: code,
        errorMessage: error?.message || String(error),
        retryAt: new Date(clock().getTime() + retryDelay(event.attempt_count)),
      });
      await safelyFinishAttempt(attemptId, { outcome: 'RETRY', errorCode: code });
      logger?.warn?.('[KIWI Teaching] due event failed safely and will retry', {
        eventId: event.event_id,
        eventType: event.event_type,
        code,
      });
      return 'RETRY_WAIT';
    }
  }

  async function tick() {
    if (running) return Object.freeze({ skipped: true, reason: 'tick_in_progress' });
    running = true;
    const now = clock();
    lastTickAt = now.toISOString();

    try {
      await store.releaseExpiredClaims(now);
      const events = await store.claimDue({
        workerId,
        now,
        limit: effectiveBatchSize,
        leaseMs: effectiveLeaseMs,
      });

      const outcomes = [];
      for (const event of events) {
        outcomes.push(await processClaimed(event));
      }
      lastError = null;
      return Object.freeze({
        skipped: false,
        claimed: events.length,
        outcomes: Object.freeze(outcomes),
      });
    } catch (error) {
      lastError = {
        code: error?.code || null,
        message: error?.message || String(error),
      };
      logger?.error?.('[KIWI Teaching] durable-event tick failed', lastError);
      return Object.freeze({ skipped: false, claimed: 0, error: lastError });
    } finally {
      running = false;
    }
  }

  function start() {
    if (interval || typeof timers.setInterval !== 'function') return false;
    interval = timers.setInterval(() => {
      tick().catch(() => {});
    }, effectivePollMs);
    interval?.unref?.();
    return true;
  }

  function stop() {
    if (!interval) return false;
    timers.clearInterval?.(interval);
    interval = null;
    return true;
  }

  function status() {
    return Object.freeze({
      workerId,
      active: Boolean(interval),
      tickRunning: running,
      pollMs: effectivePollMs,
      leaseMs: effectiveLeaseMs,
      batchSize: effectiveBatchSize,
      maxAttempts: effectiveMaxAttempts,
      lastTickAt,
      lastError,
      processedCount,
      registeredEventTypes: Object.freeze([...handlers.keys()].sort()),
    });
  }

  return Object.freeze({
    register,
    tick,
    start,
    stop,
    status,
  });
}

module.exports = {
  createDurableTeachingEventRuntime,
};
