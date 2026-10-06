'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDurableTeachingOutboxRuntime } = require('../../../teaching/runtime/durable-outbox-runtime');
const { createPostgresTeachingOutboxStore } = require('../../../teaching/runtime/postgres-outbox-store');

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('long-running outbox publication renews its claim before the original lease can expire', async () => {
  const intervals = [];
  let renewals = 0;
  let published = 0;
  let releasePublish;
  const publishGate = new Promise((resolve) => { releasePublish = resolve; });
  const event = {
    event_id: 'event-1',
    claim_token: 'claim-1',
    attempt_count: 1,
    schema_version: 1,
    event_type: 'teaching.curriculum.audit_requested',
    event_category: 'operational_recovery_event',
    trigger_type: 'background_analysis',
    source: 'teaching.d07',
    origin: 'teaching.course_setup',
    actor_id: 'student-1',
    aggregate_type: 'teaching_course',
    aggregate_id: 'course-1',
    aggregate_version: 2,
    occurred_at: '2026-10-06T10:00:00.000Z',
    correlation_id: 'event-1',
    idempotency_key: 'event-1',
    payload: {},
    audit_refs: [],
    provenance_refs: [],
  };
  const store = {
    async releaseExpiredClaims() { return 0; },
    async claimPending() { return [event]; },
    async renewClaim() { renewals += 1; return event; },
    async markPublished() { published += 1; return { ...event, status: 'PUBLISHED' }; },
    async retry() { throw new Error('retry not expected'); },
    async markCancelled() { throw new Error('cancel not expected'); },
  };
  const timers = {
    setInterval(fn, ms) {
      const handle = { fn, ms, unref() {} };
      intervals.push(handle);
      return handle;
    },
    clearInterval() {},
  };
  const runtime = createDurableTeachingOutboxRuntime({
    store,
    publish: async () => publishGate,
    workerId: 'worker-1',
    leaseMs: 30_000,
    timers,
    logger: { warn() {}, error() {} },
    clock: () => new Date('2026-10-06T10:00:00.000Z'),
  });

  const tick = runtime.tick();
  await nextTurn();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 10_000);

  intervals[0].fn();
  await nextTurn();
  assert.equal(renewals, 1);
  assert.equal(published, 0);

  releasePublish();
  const outcome = await tick;
  assert.equal(published, 1);
  assert.deepEqual(outcome.outcomes, ['PUBLISHED']);
});

test('Postgres outbox claim renewal is fenced by event id and claim token', async () => {
  let sqlSeen = '';
  let paramsSeen = null;
  const store = createPostgresTeachingOutboxStore({
    randomUUID: () => 'uuid-1',
    async query(sql, params) {
      sqlSeen = sql;
      paramsSeen = params;
      return { rows: [{ event_id: 'event-1', claim_token: 'claim-1', status: 'CLAIMED' }] };
    },
  });
  const now = new Date('2026-10-06T10:00:10.000Z');

  const row = await store.renewClaim(
    { event_id: 'event-1', claim_token: 'claim-1' },
    { now, leaseMs: 30_000 }
  );

  assert.equal(row.status, 'CLAIMED');
  assert.match(sqlSeen, /where event_id=\$1 and status='CLAIMED' and claim_token=\$2/);
  assert.match(sqlSeen, /claim_expires_at=\$3\+\(\$4::bigint\*interval '1 millisecond'\)/);
  assert.deepEqual(paramsSeen, ['event-1', 'claim-1', now, 30_000]);
});
