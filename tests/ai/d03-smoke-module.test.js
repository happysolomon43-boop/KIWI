'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const smokePath = path.join(__dirname, '..', '..', 'scripts', 'smoke-d03-routing.js');

test('D03 compatibility smoke validates neutral routing without provider traffic', () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs = [];
  globalThis.fetch = async () => {
    throw new Error('neutral routing smoke must not execute provider traffic');
  };
  console.log = (...args) => logs.push(args);

  try {
    delete require.cache[require.resolve(smokePath)];
    assert.doesNotThrow(() => require(smokePath));
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    delete require.cache[require.resolve(smokePath)];
  }

  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[KIWI AI] neutral routing smoke passed');
  assert.ok(Array.isArray(logs[0][1]));
  assert.ok(logs[0][1].length > 0);
  assert.ok(logs[0][1].every((routeKey) => /^[A-Z_]+::.+/.test(routeKey)));
});

test('D03 smoke source cannot reintroduce provider-specific outage or routing logic', () => {
  const source = fs.readFileSync(smokePath, 'utf8');

  assert.match(source, /createModelRouter/);
  assert.match(source, /resolveCandidates\(['"]MAIN_CBT['"]\)/);
  assert.match(source, /candidate\.routeKey/);
  assert.doesNotMatch(source, /syntheticGroqOutageFetch|runD03RoutingSmoke|MARKERS/);
  assert.doesNotMatch(source, /api\.groq\.com|generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(source, /GROQ_MODEL_IDS|AI_TEXT_PROVIDER_MODE/);
});
