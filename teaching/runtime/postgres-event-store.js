'use strict';

const { validateTeachingEvent } = require('../events/contracts');
const {
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  RECONCILIATION_DISPOSITIONS,
} = require('./constants');

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`Teaching event store requires ${name}().`);
  }
  return value;
}

function normalizeLimit(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function createPostgresTeachingEventStore({ query, randomUUID } = {}) {
  requireFunction(query, 'query');
  requireFunction(randomUUID, 'randomUUID');

  async function assertReady() {
    const { rows } = await query(
      `SELECT
         to_regclass('teaching_runtime.due_events') AS due_events,
         to_regclass('teaching_runtime.event_attempts') AS event_attempts`
    );
    const row = rows?.[0] || {};
    if (!row.due_events || !row.event_attempts) {
      const error = new Error('Teaching D02 durable-event schema is not installed.');
      error.code = 'TEACHING_RUNTIME_SCHEMA_MISSING';
      throw error;
    }
    return true;
  }

  async function enqueueUsing(queryFn, input) {
    if (typeof queryFn !== 'function') {
      throw new TypeError('Durable due-event enqueue requires a transaction-scoped query function.');
    }
    const event = validateTeachingEvent(input);
    if (!event.dueAt) {
      throw new TypeError('Durable due events require dueAt.');
    }
    if (event.eventCategory !== EVENT_CATEGORIES.SCHEDULED_DUE_EVENT) {
      throw new TypeError('Durable due-event runtime accepts scheduled_due_event events only.');
    }
    if (!event.idempotencyKey) {
      throw new TypeError('Durable due events require an idempotencyKey.');
    }

    const values = [
      event.eventId,
      event.schemaVersion,
      event.eventType,
      event.eventCategory,
      event.triggerType,
      event.source,
      event.origin,
      event.actorId,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      event.occurredAt,
      event.effectiveAt,
      event.dueAt,
      event.correlationId,
      event.causationId,
      event.idempotencyKey,
      JSON.stringify(event.payload),
      JSON.stringify(event.auditRefs),
      JSON.stringify(event.provenanceRefs),
    ];

    const inserted = await queryFn(
      `INSERT INTO teaching_runtime.due_events (
         event_id, schema_version, event_type, event_category, trigger_type,
         source, origin, actor_id, aggregate_type, aggregate_id, aggregate_version,
         occurred_at, effective_at, due_at, correlation_id, causation_id,
         idempotency_key, payload, audit_refs, provenance_refs
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         $18::jsonb,$19::jsonb,$20::jsonb
       )
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      values
    );

    if (inserted?.rows?.[0]) {
      return Object.freeze({ inserted: true, event: inserted.rows[0] });
    }

    const existing = await queryFn(
      `SELECT * FROM teaching_runtime.due_events WHERE idempotency_key = $1 LIMIT 1`,
      [event.idempotencyKey]
    );
    const row = existing?.rows?.[0];
    if (!row) {
      throw new Error('Durable event insert conflicted but the existing event could not be loaded.');
    }

    const sameIdentity =
      row.event_id === event.eventId &&
      row.event_type === event.eventType &&
      row.aggregate_type === event.aggregateType &&
      row.aggregate_id === event.aggregateId &&
      new Date(row.due_at).toISOString() === new Date(event.dueAt).toISOString();

    if (!sameIdentity) {
      const error = new Error('Idempotency key is already bound to a different Teaching event.');
      error.code = 'TEACHING_IDEMPOTENCY_CONFLICT';
      throw error;
    }

    return Object.freeze({ inserted: false, event: row });
  }


  async function enqueue(input) {
    return enqueueUsing(query, input);
  }

  async function releaseExpiredClaims(now = new Date()) {
    const { rowCount = 0 } = await query(
      `UPDATE teaching_runtime.due_events
          SET status = 'RETRY_WAIT',
              claim_token = NULL,
              claimed_by = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              next_attempt_at = $1,
              last_error_code = 'CLAIM_LEASE_EXPIRED',
              last_error_message = 'Prior worker claim expired before completion.',
              updated_at = now()
        WHERE status = 'CLAIMED'
          AND claim_expires_at IS NOT NULL
          AND claim_expires_at <= $1`,
      [now]
    );
    return Number(rowCount) || 0;
  }

  async function claimDue({
    workerId,
    now = new Date(),
    limit = 20,
    leaseMs = 30_000,
  } = {}) {
    if (typeof workerId !== 'string' || !workerId.trim()) {
      throw new TypeError('workerId is required to claim Teaching events.');
    }
    const safeLimit = normalizeLimit(limit);
    const safeLeaseMs = Math.max(5_000, Math.min(Number(leaseMs) || 30_000, 5 * 60_000));
    const batchToken = randomUUID();

    const { rows = [] } = await query(
      `WITH candidates AS (
         SELECT event_id
           FROM teaching_runtime.due_events
          WHERE status IN ('PENDING', 'RETRY_WAIT')
            AND due_at <= $1
            AND next_attempt_at <= $1
          ORDER BY due_at ASC, created_at ASC, event_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       )
       UPDATE teaching_runtime.due_events e
          SET status = 'CLAIMED',
              attempt_count = e.attempt_count + 1,
              claimed_by = $3,
              claimed_at = $1,
              claim_expires_at = $1 + ($4::bigint * interval '1 millisecond'),
              claim_token = $5 || ':' || e.event_id || ':' || (e.attempt_count + 1)::text,
              updated_at = now()
         FROM candidates c
        WHERE e.event_id = c.event_id
       RETURNING e.*`,
      [now, safeLimit, workerId.trim(), safeLeaseMs, batchToken]
    );

    return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  }

  async function beginAttempt(event) {
    const { rows } = await query(
      `INSERT INTO teaching_runtime.event_attempts (
         event_id, attempt_number, worker_id, claim_token, started_at
       ) VALUES ($1,$2,$3,$4,now())
       RETURNING attempt_id`,
      [event.event_id, event.attempt_count, event.claimed_by, event.claim_token]
    );
    return rows?.[0]?.attempt_id || null;
  }

  async function finishAttempt(attemptId, {
    outcome,
    errorCode = null,
    safeMetadata = {},
  } = {}) {
    if (attemptId == null) return false;
    await query(
      `UPDATE teaching_runtime.event_attempts
          SET outcome = $2,
              error_code = $3,
              safe_metadata = $4::jsonb,
              completed_at = now()
        WHERE attempt_id = $1`,
      [attemptId, outcome, errorCode, JSON.stringify(safeMetadata || {})]
    );
    return true;
  }

  function terminalStatusFor(disposition) {
    if (disposition === RECONCILIATION_DISPOSITIONS.ACTIONABLE) {
      return EVENT_STATUSES.COMPLETED;
    }
    if (disposition === RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED) {
      return EVENT_STATUSES.NOOP;
    }
    if (disposition === RECONCILIATION_DISPOSITIONS.SUPERSEDED) {
      return EVENT_STATUSES.SUPERSEDED;
    }
    if (disposition === RECONCILIATION_DISPOSITIONS.FAIRNESS_RECOVERY_REQUIRED) {
      return EVENT_STATUSES.FAIRNESS_RECOVERY_REQUIRED;
    }
    throw new TypeError(`Unsupported terminal event disposition: ${disposition}`);
  }

  async function completeClaim(event, {
    disposition,
    recoveryReason = null,
    safeMetadata = {},
  } = {}) {
    const status = terminalStatusFor(disposition);
    const { rows } = await query(
      `UPDATE teaching_runtime.due_events
          SET status = $3,
              resolution = $4,
              recovery_reason = $5,
              processed_at = now(),
              claim_expires_at = NULL,
              updated_at = now()
        WHERE event_id = $1
          AND status = 'CLAIMED'
          AND claim_token = $2
       RETURNING *`,
      [event.event_id, event.claim_token, status, disposition, recoveryReason]
    );

    if (!rows?.[0]) {
      const error = new Error('Teaching event claim is stale or no longer owned by this worker.');
      error.code = 'TEACHING_STALE_EVENT_CLAIM';
      error.safeMetadata = safeMetadata;
      throw error;
    }

    return rows[0];
  }

  async function retryClaim(event, {
    errorCode = 'TEACHING_EVENT_HANDLER_FAILED',
    errorMessage = 'Teaching due-event execution failed safely.',
    retryAt,
  } = {}) {
    const when = retryAt instanceof Date ? retryAt : new Date(retryAt || Date.now() + 5_000);
    const { rows } = await query(
      `UPDATE teaching_runtime.due_events
          SET status = 'RETRY_WAIT',
              next_attempt_at = $3,
              last_error_code = $4,
              last_error_message = $5,
              claim_token = NULL,
              claimed_by = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              updated_at = now()
        WHERE event_id = $1
          AND status = 'CLAIMED'
          AND claim_token = $2
       RETURNING *`,
      [event.event_id, event.claim_token, when, errorCode, String(errorMessage).slice(0, 2000)]
    );
    if (!rows?.[0]) {
      const error = new Error('Teaching event claim is stale while scheduling retry.');
      error.code = 'TEACHING_STALE_EVENT_CLAIM';
      throw error;
    }
    return rows[0];
  }

  async function requireFairnessRecovery(event, reason) {
    return completeClaim(event, {
      disposition: RECONCILIATION_DISPOSITIONS.FAIRNESS_RECOVERY_REQUIRED,
      recoveryReason: String(reason || 'KIWI_RUNTIME_FAILURE').slice(0, 1000),
    });
  }

  async function getById(eventId) {
    const { rows } = await query(
      `SELECT * FROM teaching_runtime.due_events WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );
    return rows?.[0] || null;
  }

  return Object.freeze({
    assertReady,
    enqueueUsing,
    enqueue,
    releaseExpiredClaims,
    claimDue,
    beginAttempt,
    finishAttempt,
    completeClaim,
    retryClaim,
    requireFairnessRecovery,
    getById,
  });
}

module.exports = {
  createPostgresTeachingEventStore,
};
