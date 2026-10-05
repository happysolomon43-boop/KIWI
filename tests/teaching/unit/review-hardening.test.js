'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeAcademicInput } = require('../../../teaching/prompt-runtime/academic-input');
const { createInMemoryIdempotencyStore, createIdempotentHandler } = require('../../../teaching/events/idempotency');
const { createPostgresTeachingOutboxStore } = require('../../../teaching/runtime/postgres-outbox-store');
const { validateTeachingEvent } = require('../../../teaching/events/contracts');

test('academic input accepts exact UTF-8 byte boundary and rejects overflow', () => {
  const input = { text: 'a'.repeat(65525) };
  assert.equal(Buffer.byteLength(serializeAcademicInput(input)), 65536);
  assert.throws(() => serializeAcademicInput({ text: input.text + 'a' }), { code: 'TEACHING_ACADEMIC_INPUT_INVALID' });
  assert.throws(() => serializeAcademicInput({ text: 'é'.repeat(32768) }), { code: 'TEACHING_ACADEMIC_INPUT_INVALID' });
  assert.deepEqual(JSON.parse(serializeAcademicInput({ text: 'a\n"', list: [null, true, 2] })), { text: 'a\n"', list: [null, true, 2] });
});

test('academic input reports the actual violated limit instead of calling every failure oversized', () => {
  const reason = (input) => { try { serializeAcademicInput(input); } catch (error) { return error.reason; } };
  let deep = {}; for (let i = 0; i < 17; i++) deep = { child: deep };
  assert.equal(reason({ text: 'a'.repeat(65526) }), 'BYTE_LIMIT_EXCEEDED');
  assert.equal(reason(deep), 'DEPTH_LIMIT_EXCEEDED');
  assert.equal(reason({ values: Array(4097).fill(0) }), 'ENTRY_LIMIT_EXCEEDED');
  assert.equal(reason({ value: undefined }), 'UNSUPPORTED_VALUE');
});

test('academic input rejects unsafe shapes without invoking getters or toJSON', () => {
  const cycle = {}; cycle.self = cycle;
  let deep = {}; for (let i = 0; i < 17; i++) deep = { child: deep };
  const getter = {}; Object.defineProperty(getter, 'value', { enumerable: true, get() { throw new Error('must not execute'); } });
  for (const input of [cycle, deep, getter, { toJSON() { throw new Error('must not execute'); } }, { n: NaN }, { n: 1n }, { n: undefined }, { date: new Date() }, { a: Array(2) }, { a: Array(4097).fill(0) }]) {
    assert.throws(() => serializeAcademicInput(input), { code: 'TEACHING_ACADEMIC_INPUT_INVALID' });
  }
  const shared = { x: 1 };
  assert.equal(serializeAcademicInput({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
});

test('shared store coalesces simultaneous duplicates across handler instances', async () => {
  const store = createInMemoryIdempotencyStore();
  let calls = 0;
  const handler = async () => { calls++; await new Promise(resolve => setImmediate(resolve)); return 42; };
  const a = createIdempotentHandler({ store, handler });
  const b = createIdempotentHandler({ store, handler });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b)('same', {})));
  assert.equal(calls, 1);
  assert.equal(results.filter(r => !r.replay).length, 1);
  assert.ok(results.every(r => r.result === 42));
});

test('failed idempotent work can be retried and unrelated keys run independently', async () => {
  const store = createInMemoryIdempotencyStore();
  let calls = 0;
  const handler = createIdempotentHandler({ store, handler: async () => { if (++calls === 1) throw new Error('retry'); return calls; } });
  await assert.rejects(handler('one'), /retry/);
  assert.equal((await handler('one')).replay, false);
  assert.equal((await handler('one')).replay, true);
  assert.equal((await handler('two')).replay, false);
  assert.throws(() => createIdempotentHandler({ store: { get() {}, put() {} }, handler() {} }), /atomic/);
});

const event = { eventId: 'e1', eventType: 'teaching.course.activated', triggerType: 'committed_domain_event', source: 'course', aggregateType: 'course', aggregateId: 'c1', aggregateVersion: 1, occurredAt: '2026-09-26T18:00:00Z', idempotencyKey: 'k1', payload: { a: 1, b: 2 }, auditRefs: ['a'], provenanceRefs: ['p'] };
function fixture() {
  const row = Object.fromEntries(Object.entries(validateTeachingEvent(event)).map(([key, value]) => [key.replace(/[A-Z]/g, x => '_' + x.toLowerCase()), value]));
  row.occurred_at = new Date(row.occurred_at);
  row.aggregate_version = '1';
  row.payload = { b: 2, a: 1 };
  const store = createPostgresTeachingOutboxStore({ randomUUID: () => 'uuid', query: async sql => ({ rows: sql.startsWith('select') ? [row] : [] }) });
  return { row, store };
}

test('outbox replay accepts JSONB key order and PostgreSQL timestamp/bigint representations', async () => {
  const { store } = fixture();
  assert.equal((await store.append(event)).inserted, false);
});

for (const [column, value] of Object.entries({ event_id: 'other', schema_version: 2, event_type: 'other', event_category: 'other', trigger_type: 'other', source: 'other', origin: 'other', actor_id: 'other', aggregate_type: 'other', aggregate_id: 'other', aggregate_version: 2, occurred_at: new Date('2025-01-01'), effective_at: new Date('2025-01-01'), correlation_id: 'other', causation_id: 'other', idempotency_key: 'other', payload: { changed: true }, audit_refs: [], provenance_refs: [] })) {
  test(`outbox rejects replay with changed ${column}`, async () => {
    const { row, store } = fixture(); row[column] = value;
    await assert.rejects(store.append(event), { code: 'TEACHING_D05_EVENT_IDEMPOTENCY_CONFLICT' });
  });
}
