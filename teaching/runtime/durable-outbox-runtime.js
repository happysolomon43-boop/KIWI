'use strict';

function parseBounded(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.floor(numeric), max));
}

function toCanonicalEvent(row) {
  return Object.freeze({
    eventId: row.event_id,
    schemaVersion: row.schema_version,
    eventType: row.event_type,
    eventCategory: row.event_category,
    triggerType: row.trigger_type,
    source: row.source,
    origin: row.origin,
    actorId: row.actor_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    occurredAt: row.occurred_at,
    effectiveAt: row.effective_at,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload || {},
    auditRefs: row.audit_refs || [],
    provenanceRefs: row.provenance_refs || [],
  });
}

function createDurableTeachingOutboxRuntime({
  store,
  publish,
  workerId,
  logger = console,
  clock = () => new Date(),
  timers = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval },
  pollMs = 5_000,
  leaseMs = 30_000,
  batchSize = 20,
  maxAttempts = 8,
  retryBaseMs = 5_000,
} = {}) {
  if (!store || typeof store.claimPending !== 'function') throw new TypeError('Teaching outbox runtime requires a store.');
  if (typeof publish !== 'function') throw new TypeError('Teaching outbox runtime requires publish().');
  if (!String(workerId || '').trim()) throw new TypeError('Teaching outbox runtime requires workerId.');
  const effectivePollMs = parseBounded(pollMs, 5_000, 1_000, 60_000);
  const effectiveLeaseMs = parseBounded(leaseMs, 30_000, 5_000, 300_000);
  const effectiveBatchSize = parseBounded(batchSize, 20, 1, 100);
  const effectiveMaxAttempts = parseBounded(maxAttempts, 8, 1, 20);
  const effectiveRetryBaseMs = parseBounded(retryBaseMs, 5_000, 1_000, 300_000);

  let interval = null;
  let running = false;
  let lastTickAt = null;
  let lastError = null;
  let publishedCount = 0;

  function retryDelay(attemptCount) {
    const exponent = Math.max(0, Math.min(Number(attemptCount) - 1, 6));
    return Math.min(effectiveRetryBaseMs * (2 ** exponent), 15 * 60_000);
  }

  async function tick() {
    if (running) return Object.freeze({ skipped: true, reason: 'tick_in_progress' });
    running = true;
    const now = clock();
    lastTickAt = now.toISOString();
    try {
      await store.releaseExpiredClaims(now);
      const claimed = await store.claimPending({ workerId, now, limit: effectiveBatchSize, leaseMs: effectiveLeaseMs });
      const outcomes = [];
      for (const event of claimed) {
        try {
          await publish(toCanonicalEvent(event));
          await store.markPublished(event);
          publishedCount += 1;
          outcomes.push('PUBLISHED');
        } catch (error) {
          if (Number(event.attempt_count) >= effectiveMaxAttempts) {
            await store.retry(event, {
              errorCode: error?.code || 'TEACHING_EVENT_PUBLICATION_FAILED',
              retryAt: new Date(now.getTime() + 15 * 60_000),
            });
            logger?.error?.('[KIWI Teaching] outbox publication exhausted current retry budget; retained durably', {
              eventId: event.event_id,
              code: error?.code || null,
            });
            outcomes.push('RETAINED_FOR_RECOVERY');
          } else {
            await store.retry(event, {
              errorCode: error?.code || 'TEACHING_EVENT_PUBLICATION_FAILED',
              retryAt: new Date(now.getTime() + retryDelay(event.attempt_count)),
            });
            outcomes.push('RETRY_WAIT');
          }
        }
      }
      lastError = null;
      return Object.freeze({ skipped: false, claimed: claimed.length, outcomes: Object.freeze(outcomes) });
    } catch (error) {
      lastError = { code: error?.code || null, message: error?.message || String(error) };
      logger?.error?.('[KIWI Teaching] event-outbox tick failed', lastError);
      return Object.freeze({ skipped: false, claimed: 0, error: lastError });
    } finally {
      running = false;
    }
  }

  function start() {
    if (interval || typeof timers.setInterval !== 'function') return false;
    interval = timers.setInterval(() => { tick().catch(() => {}); }, effectivePollMs);
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
      publishedCount,
    });
  }

  return Object.freeze({ tick, start, stop, status });
}

module.exports = { createDurableTeachingOutboxRuntime, toCanonicalEvent };
