'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectSlots,
  createProjectPool,
} = require('../../services/ai/project-pool');

test('buildProjectSlots discovers GEMINI_API_KEY through GEMINI_API_KEY_15', () => {
  const slots = buildProjectSlots({
    GEMINI_API_KEY: 'key-a',
    GEMINI_API_KEY_2: 'key-b',
    GEMINI_API_KEY_4: 'key-d',
  });

  assert.deepEqual(slots.map((slot) => slot.id), [
    'gemini-project-01',
    'gemini-project-02',
    'gemini-project-04',
  ]);
});

test('round-robin cursors are independent per model', () => {
  const pool = createProjectPool({
    slots: [
      { id: 'p1', index: 1, envName: 'K1', apiKey: 'a' },
      { id: 'p2', index: 2, envName: 'K2', apiKey: 'b' },
      { id: 'p3', index: 3, envName: 'K3', apiKey: 'c' },
    ],
  });

  assert.deepEqual(pool.orderedSlots('gemini-3.8-flash').map((s) => s.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(pool.orderedSlots('gemini-3.8-flash').map((s) => s.id), ['p2', 'p3', 'p1']);

  // A different model starts from its own first cursor.
  assert.deepEqual(pool.orderedSlots('gemini-3.7-flash').map((s) => s.id), ['p1', 'p2', 'p3']);
});

test('disabled slots are excluded from routing', () => {
  const pool = createProjectPool({
    slots: [
      { id: 'p1', index: 1, envName: 'K1', apiKey: 'a' },
      { id: 'p2', index: 2, envName: 'K2', apiKey: 'b' },
    ],
  });

  assert.equal(pool.disable('p1', 'AUTH'), true);
  assert.deepEqual(pool.orderedSlots('m').map((s) => s.id), ['p2']);
  assert.equal(pool.enabledCount(), 1);
});

test('public pool snapshot never exposes API key values', () => {
  const pool = createProjectPool({
    slots: [
      { id: 'p1', index: 1, envName: 'GEMINI_API_KEY', apiKey: 'super-secret' },
    ],
  });

  const snapshot = pool.snapshot();
  assert.equal(snapshot[0].id, 'p1');
  assert.equal('apiKey' in snapshot[0], false);
  assert.doesNotMatch(JSON.stringify(snapshot), /super-secret/);
});
