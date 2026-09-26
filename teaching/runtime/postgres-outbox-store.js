'use strict';

const { validateTeachingEvent } = require('../events/contracts');
const { EVENT_CATEGORIES } = require('./constants');

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`Teaching outbox store requires ${name}().`);
  return value;
}
function normalizeLimit(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function createPostgresTeachingOutboxStore({ query, randomUUID } = {}) {
  requireFunction(query, 'query');
  requireFunction(randomUUID, 'randomUUID');

  async function assertReady() {
    const { rows } = await query("select to_regclass('teaching_runtime.event_outbox') as event_outbox");
    if (!rows?.[0]?.event_outbox) {
      const error = new Error('Teaching D05 event outbox is not installed.');
      error.code = 'TEACHING_D05_OUTBOX_SCHEMA_MISSING';
      throw error;
    }
    return true;
  }

  async function appendUsing(queryFn, input) {
    if (typeof queryFn !== 'function') throw new TypeError('Teaching outbox append requires a transaction-scoped query function.');
    const event = validateTeachingEvent(input);
    if (event.eventCategory === EVENT_CATEGORIES.SCHEDULED_DUE_EVENT) {
      const error = new Error('Scheduled due events belong in teaching_runtime.due_events, not the publication outbox.');
      error.code = 'TEACHING_D05_SCHEDULED_EVENT_WRONG_STORE';
      throw error;
    }
    if (!event.idempotencyKey) throw new TypeError('Transactional Teaching event publication requires idempotencyKey.');

    const { rows } = await queryFn(
      `insert into teaching_runtime.event_outbox (
         event_id,schema_version,event_type,event_category,trigger_type,source,origin,actor_id,
         aggregate_type,aggregate_id,aggregate_version,occurred_at,effective_at,correlation_id,
         causation_id,idempotency_key,payload,audit_refs,provenance_refs
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb)
       on conflict (idempotency_key) do nothing
       returning *`,
      [
        event.eventId,event.schemaVersion,event.eventType,event.eventCategory,event.triggerType,
        event.source,event.origin,event.actorId,event.aggregateType,event.aggregateId,event.aggregateVersion,
        event.occurredAt,event.effectiveAt,event.correlationId,event.causationId,event.idempotencyKey,
        JSON.stringify(event.payload),JSON.stringify(event.auditRefs),JSON.stringify(event.provenanceRefs),
      ]
    );
    if (rows?.[0]) return Object.freeze({ inserted: true, event: rows[0] });
    const existing = await queryFn(
      'select * from teaching_runtime.event_outbox where idempotency_key=$1 limit 1',
      [event.idempotencyKey]
    );
    const row = existing.rows?.[0];
    if (!row || row.event_type !== event.eventType || row.aggregate_id !== event.aggregateId) {
      const error = new Error('Teaching outbox idempotency key is bound to a different event.');
      error.code = 'TEACHING_D05_EVENT_IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return Object.freeze({ inserted: false, event: row });
  }

  async function append(input) { return appendUsing(query, input); }

  async function releaseExpiredClaims(now = new Date()) {
    const { rowCount = 0 } = await query(
      `update teaching_runtime.event_outbox
          set status='PENDING',claim_token=null,claimed_by=null,claimed_at=null,claim_expires_at=null,
              last_error_code='CLAIM_LEASE_EXPIRED',updated_at=now()
        where status='CLAIMED' and claim_expires_at is not null and claim_expires_at <= $1`,
      [now]
    );
    return Number(rowCount) || 0;
  }

  async function claimPending({ workerId, now = new Date(), limit = 20, leaseMs = 30_000 } = {}) {
    if (!String(workerId || '').trim()) throw new TypeError('workerId is required.');
    const safeLimit = normalizeLimit(limit);
    const safeLeaseMs = Math.max(5_000, Math.min(Number(leaseMs) || 30_000, 300_000));
    const batchToken = randomUUID();
    const { rows = [] } = await query(
      `with candidates as (
         select event_id from teaching_runtime.event_outbox
          where status in ('PENDING','RETRY_WAIT') and next_attempt_at <= $1
          order by created_at asc,event_id asc
          for update skip locked limit $2
       )
       update teaching_runtime.event_outbox o
          set status='CLAIMED',attempt_count=o.attempt_count+1,claimed_by=$3,claimed_at=$1,
              claim_expires_at=$1+($4::bigint*interval '1 millisecond'),
              claim_token=$5||':'||o.event_id||':'||(o.attempt_count+1)::text,updated_at=now()
         from candidates c where o.event_id=c.event_id returning o.*`,
      [now,safeLimit,String(workerId).trim(),safeLeaseMs,batchToken]
    );
    return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  }

  async function markPublished(event) {
    const { rows } = await query(
      `update teaching_runtime.event_outbox
          set status='PUBLISHED',published_at=now(),claim_expires_at=null,updated_at=now()
        where event_id=$1 and status='CLAIMED' and claim_token=$2 returning *`,
      [event.event_id,event.claim_token]
    );
    if (!rows?.[0]) {
      const error = new Error('Teaching outbox claim is stale or no longer owned by this worker.');
      error.code = 'TEACHING_D05_STALE_OUTBOX_CLAIM';
      throw error;
    }
    return rows[0];
  }

  async function retry(event, { errorCode, retryAt } = {}) {
    const when = retryAt instanceof Date ? retryAt : new Date(retryAt || Date.now() + 5_000);
    const { rows } = await query(
      `update teaching_runtime.event_outbox
          set status='RETRY_WAIT',next_attempt_at=$3,last_error_code=$4,claim_token=null,
              claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now()
        where event_id=$1 and status='CLAIMED' and claim_token=$2 returning *`,
      [event.event_id,event.claim_token,when,String(errorCode || 'TEACHING_EVENT_PUBLICATION_FAILED')]
    );
    if (!rows?.[0]) {
      const error = new Error('Teaching outbox claim is stale while scheduling retry.');
      error.code = 'TEACHING_D05_STALE_OUTBOX_CLAIM';
      throw error;
    }
    return rows[0];
  }

  return Object.freeze({ assertReady, appendUsing, append, releaseExpiredClaims, claimPending, markPublished, retry });
}

module.exports = { createPostgresTeachingOutboxStore };
