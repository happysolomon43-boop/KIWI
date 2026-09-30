'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MARKERS,
  syntheticGroqOutageFetch,
  runD03RoutingSmoke,
} = require('../../scripts/smoke-d03-routing');

test('D03 operational smoke module loads without executing provider traffic', () => {
  assert.equal(typeof runD03RoutingSmoke, 'function');
  assert.equal(MARKERS.PREMIUM, 'KIWI_D03_120B_OK');
  assert.equal(MARKERS.BACKGROUND, 'KIWI_D03_20B_OK');
  assert.equal(MARKERS.FALLBACK, 'KIWI_D03_GEMINI_FALLBACK_OK');
});

test('D03 synthetic outage intercepts only Groq and leaves fallback provider fetch intact', async () => {
  const forwarded = [];
  const realFetch = async (url) => {
    forwarded.push(String(url));
    return new Response('google-ok', { status: 200 });
  };
  const wrapped = syntheticGroqOutageFetch(realFetch);

  const groq = await wrapped('https://api.groq.com/openai/v1/chat/completions', {});
  assert.equal(groq.status, 503);
  assert.equal(forwarded.length, 0);

  const google = await wrapped('https://generativelanguage.googleapis.com/v1beta/models/test', {});
  assert.equal(google.status, 200);
  assert.deepEqual(forwarded, [
    'https://generativelanguage.googleapis.com/v1beta/models/test',
  ]);
});
