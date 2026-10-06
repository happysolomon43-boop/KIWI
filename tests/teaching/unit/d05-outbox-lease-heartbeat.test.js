'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPostgresTeachingOutboxStore } = require('../../../teaching/runtime/postgres-outbox-store');
const { createDurableTeachingOutboxRuntime } = require('../../../teaching/runtime/durable-outbox-runtime');
const { TEACHING_EVENTS } = require('../../../teaching/events/names');

function claimedRow() {
  return {
    event_id: 'outbox-long-1',
    schema_version: 1,
    event_type: TEACHING_EVENTS.COURSE_ACTIVATED,
    event_category: 'committed_domain_event',
    trigger_type: 'committed_domain_event',
    source: 'teaching.course',
    origin: 'teaching.course',
    actor_id: 'student-1',
    aggregate_type: 'teaching_course',
    aggregate_id: 'course-1',
    aggregate_version: 2,
    occurred_at: '2026-10-06T10:00:00.000Z',
    effective_at: null,
    correlation_id: 'corr-long-1',
    causation_id: null,
    idempotency_key: 'outbox-long-1:key',
    payload: {},
    audit_refs: [],
    provenance_refs: [],
    attempt_count: 1,
    claim_token: 'claim-long-1',
  };
}

test('D05 outbox store renews only the currently owned claim token', async () => {
  const calls = [];
  const row = claimedRow();
  const store = createPostgresTeachingOutboxStore({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ ...row, claim_expires_at: '2026-10-06T10:00:09.000Z' }] };
    },
    randomUUID: () => 'unused',
  });
  const now = new Date('2026-10-06T10:00:00.000Z');
  const renewed = await store.renewClaim(row, { now, leaseMs: 9_000 });
  assert.equal(renewed.event_id, row.event_id);
  assert.match(calls[0].sql, /status='CLAIMED' and claim_token=\$2/);
  assert.match(calls[0].sql, /claim_expires_at=\$3\+\(\$4::bigint\*interval '1 millisecond'\)/);
  assert.deepEqual(calls[0].params, [row.event_id, row.claim_token, now, 9_000]);
});

test('D05 outbox heartbeat keeps a long publication claim alive until publish completes', async () => {
  const row = claimedRow();
  let heartbeat = null;
  let heartbeatMs = null;
  let renewals = 0;
  let published = 0;
  let resolvePublication;
  const publication = new Promise((resolve) => { resolvePublication = resolve; });

  const runtime = createDurableTeachingOutboxRuntime({
    store: {
      async releaseExpiredClaims() { return 0; },
      async claimPending() { return [row]; },
      async renewClaim(event, options) {
        assert.equal(event.claim_token, row.claim_token);
        assert.equal(options.leaseMs, 9_000);
        renewals += 1;
        return event;
      },
      async markPublished(event) {
        assert.equal(event.claim_token, row.claim_token);
        published += 1;
        return event;
      },
      async retry() { throw new Error('successful publication must not retry'); },
      async markCancelled() { throw new Error('successful publication must not cancel'); },
    },
    publish: async () => publication,
    workerId: 'test-long-outbox-worker',
    leaseMs: 9_000,
    clock: () => new Date('2026-10-06T10:00:00.000Z'),
    logger: { warn() {}, error() {} },
    timers: {
      setInterval(fn, ms) {
        heartbeat = fn;
        heartbeatMs = ms;
        return { unref() {} };
      },
      clearInterval() {},
    },
  });

  const tickPromise = runtime.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(heartbeatMs, 3_000);
  assert.equal(typeof heartbeat, 'function');

  heartbeat();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewals, 1);
  assert.equal(published, 0);

  resolvePublication();
  const result = await tickPromise;
  assert.deepEqual(result.outcomes, ['PUBLISHED']);
  assert.equal(published, 1);
});
