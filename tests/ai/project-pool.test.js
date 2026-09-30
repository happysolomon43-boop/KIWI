'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectSlots,
  createProjectPool,
  buildGroqCredentialSlots,
  createGroqCredentialPool,
  buildCloudflareCredentialSlots,
  createCloudflareCredentialPool,
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

test('Groq credentials support numbered rotation slots without exposing values', () => {
  const slots = buildGroqCredentialSlots({
    GROQ_API_KEY: 'groq-a',
    GROQ_API_KEY_2: 'groq-b',
    GROQ_API_KEY_15: 'groq-o',
  });

  assert.deepEqual(slots.map((slot) => slot.id), [
    'groq-key-01',
    'groq-key-02',
    'groq-key-15',
  ]);
  assert.equal(slots[0].apiKey, 'groq-a');

  const pool = createGroqCredentialPool({ slots });
  assert.deepEqual(pool.orderedSlots('openai/gpt-oss-120b').map((slot) => slot.id), [
    'groq-key-01',
    'groq-key-02',
    'groq-key-15',
  ]);
  assert.deepEqual(pool.orderedSlots('openai/gpt-oss-120b').map((slot) => slot.id), [
    'groq-key-02',
    'groq-key-15',
    'groq-key-01',
  ]);
  assert.doesNotMatch(JSON.stringify(pool.snapshot()), /groq-a|groq-b|groq-o/);
});

test('Cloudflare credentials support numbered token rotation slots without exposing values', () => {
  const slots = buildCloudflareCredentialSlots({
    CLOUDFLARE_WORKERS_AI_API_TOKEN: 'cf-a',
    CLOUDFLARE_WORKERS_AI_API_TOKEN_2: 'cf-b',
    CLOUDFLARE_WORKERS_AI_API_TOKEN_4: 'cf-d',
  });

  assert.deepEqual(slots.map((slot) => slot.id), [
    'cloudflare-token-01',
    'cloudflare-token-02',
    'cloudflare-token-04',
  ]);
  assert.equal(slots[0].apiToken, 'cf-a');

  const pool = createCloudflareCredentialPool({ slots });
  assert.deepEqual(pool.orderedSlots('flux-2-klein-4b').map((slot) => slot.id), [
    'cloudflare-token-01',
    'cloudflare-token-02',
    'cloudflare-token-04',
  ]);
  assert.equal(pool.disable('cloudflare-token-01', 'AUTH'), true);
  assert.deepEqual(pool.orderedSlots('flux-2-klein-4b').map((slot) => slot.id), [
    'cloudflare-token-04',
    'cloudflare-token-02',
  ]);
  assert.doesNotMatch(JSON.stringify(pool.snapshot()), /cf-a|cf-b|cf-d/);
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
  assert.equal('apiToken' in snapshot[0], false);
  assert.equal('credential' in snapshot[0], false);
  assert.doesNotMatch(JSON.stringify(snapshot), /super-secret/);
});
