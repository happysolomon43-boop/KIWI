'use strict';

const TERMINAL_PUBLICATION_CODES = new Set([
  'BAD_REQUEST',
  'TEACHING_AI_OUTPUT_TRUNCATED',
  'TEACHING_D07_CURRICULUM_AUDIT_REJECTED',
  'TEACHING_ACADEMIC_INPUT_INVALID',
  'TEACHING_TPF02_SOURCE_INPUT_INVALID',
  'TEACHING_TPF02_DIRECT_PROMPT_MISMATCH',
]);

function parseBounded(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.floor(numeric), max));
}

function canonicalTimestamp(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError('Teaching outbox row contains an invalid Date timestamp.');
    return value.toISOString();
  }
  return String(value);
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
    occurredAt: canonicalTimestamp(row.occurred_at),
    effectiveAt: canonicalTimestamp(row.effective_at),
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload || {},
    auditRefs: row.audit_refs || [],
    provenanceRefs: row.provenance_refs || [],
  });
}

function isTerminalPublicationFailure(error) {
  const code = String(error?.code || '').trim();
  // A completed model-validation decision is not an infrastructure outage.
  // Bounded model retries and TPF-specific repair happen inside the owning
  // workflow; replaying the entire outbox job only repeats expensive work.
  if (error?.retryable === false) return true;
  if (error?.validationFailure?.kind === 'VALIDATION_REJECTION') return true;
  return TERMINAL_PUBLICATION_CODES.has(code) || code.startsWith('TEACHING_TPF02_');
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

  function startClaimHeartbeat(event) {
    if (typeof store.renewClaim !== 'function' || typeof timers.setInterval !== 'function') {
      return Object.freeze({ async stop() {} });
    }
    const heartbeatMs = Math.max(1_000, Math.floor(effectiveLeaseMs / 3));
    let heartbeatInterval = null;
    let inFlight = null;
    let heartbeatError = null;
    let stopped = false;

    function renew() {
      if (stopped || inFlight) return;
      inFlight = Promise.resolve(store.renewClaim(event, {
        now: clock(),
        leaseMs: effectiveLeaseMs,
      }))
        .catch((error) => { heartbeatError = error; })
        .finally(() => { inFlight = null; });
    }

    heartbeatInterval = timers.setInterval(renew, heartbeatMs);
    heartbeatInterval?.unref?.();
    return Object.freeze({
      async stop() {
        stopped = true;
        if (heartbeatInterval != null) timers.clearInterval?.(heartbeatInterval);
        if (inFlight) await inFlight;
        if (heartbeatError) throw heartbeatError;
      },
    });
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
        const heartbeat = startClaimHeartbeat(event);
        try {
          let publicationError = null;
          try {
            await publish(toCanonicalEvent(event));
          } catch (error) {
            publicationError = error;
          }
          await heartbeat.stop();
          if (publicationError) throw publicationError;
          await store.markPublished(event);
          publishedCount += 1;
          outcomes.push('PUBLISHED');
        } catch (error) {
          // Once a claim token is stale this worker no longer owns the event.
          // Do not overwrite the newer worker's retry/publication decision.
          if (error?.code === 'TEACHING_D05_STALE_OUTBOX_CLAIM') {
            logger?.warn?.('[KIWI Teaching] outbox worker lost claim ownership during publication', {
              eventId: event.event_id,
              code: error.code,
            });
            outcomes.push('STALE_CLAIM');
            continue;
          }
          const terminal = isTerminalPublicationFailure(error);
          if (terminal || Number(event.attempt_count) >= effectiveMaxAttempts) {
            await store.markCancelled(event, {
              errorCode: error?.code || 'TEACHING_EVENT_PUBLICATION_FAILED',
            });
            logger?.error?.('[KIWI Teaching] outbox publication recorded terminal failure', {
              eventId: event.event_id,
              terminal,
              code: error?.code || null,
              message: error?.message || String(error),
            });
            outcomes.push('CANCELLED');
          } else {
            await store.retry(event, {
              errorCode: error?.code || 'TEACHING_EVENT_PUBLICATION_FAILED',
              retryAt: new Date(now.getTime() + retryDelay(event.attempt_count)),
            });
            outcomes.push('RETRY_WAIT');
          }
        } finally {
          // If publish itself failed before heartbeat.stop(), make sure the
          // interval cannot leak into later events in this worker tick.
          await heartbeat.stop().catch(() => {});
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

module.exports = { createDurableTeachingOutboxRuntime, toCanonicalEvent, canonicalTimestamp, isTerminalPublicationFailure, TERMINAL_PUBLICATION_CODES };
