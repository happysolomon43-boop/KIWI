'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../../public/kiwi-api-client.js'),
  'utf8'
);

function response(body = { ok: true }, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function loadClient({ fetchImpl, setTimeoutImpl, clearTimeoutImpl = () => {} } = {}) {
  const storage = new Map();
  const window = {
    KIWI_RUNTIME_CONFIG: { apiBaseUrl: 'https://api.example.test' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout: setTimeoutImpl || (() => 1),
    clearTimeout: clearTimeoutImpl,
  };

  const context = vm.createContext({
    window,
    fetch: fetchImpl || (async () => response()),
    AbortController,
    console,
  });
  vm.runInContext(CLIENT_SOURCE, context, { filename: 'public/kiwi-api-client.js' });
  return window.KIWI_API_CLIENT;
}

test('Course Plan request timeout covers the MAIN_CBT operation envelope without changing normal API timeout', async () => {
  const delays = [];
  const client = loadClient({
    setTimeoutImpl: (_callback, delay) => {
      delays.push(delay);
      return delays.length;
    },
  });

  await client.kiwiApiRequest('/teaching/courses/course-1/course-plan', {
    method: 'POST',
    body: {},
  });
  assert.equal(delays.at(-1), 210_000);

  await client.kiwiApiRequest('/teaching/courses/course-1/plan-review');
  assert.equal(delays.at(-1), 30_000);
});

test('explicit timeout overrides the Course Plan long-running endpoint policy', async () => {
  const delays = [];
  const client = loadClient({
    setTimeoutImpl: (_callback, delay) => {
      delays.push(delay);
      return delays.length;
    },
  });

  await client.kiwiApiRequest('/teaching/courses/course-1/course-plan', {
    method: 'POST',
    body: {},
    timeoutMs: 45_000,
  });

  assert.equal(delays.at(-1), 45_000);
});

test('client timeout is reported as a stable KIWI error instead of a raw AbortSignal exception', async () => {
  let scheduled = null;
  const client = loadClient({
    setTimeoutImpl: (callback, delay) => {
      scheduled = { callback, delay };
      return 1;
    },
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason || new Error('signal is aborted without reason'));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(signal.reason || new Error('signal is aborted without reason'));
      }, { once: true });
    }),
  });

  const pending = client.kiwiApiRequest('/teaching/courses/course-1/plan-review');
  assert.equal(scheduled.delay, 30_000);
  scheduled.callback();

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'KIWI_API_TIMEOUT');
    assert.equal(error.status, 408);
    assert.doesNotMatch(error.message, /aborted|abortsignal|without reason/i);
    return true;
  });
});

test('external cancellation is reported as a stable KIWI cancellation error', async () => {
  const external = new AbortController();
  const client = loadClient({
    setTimeoutImpl: () => 1,
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason || new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
    }),
  });

  const pending = client.kiwiApiRequest('/teaching/courses/course-1/plan-review', {
    signal: external.signal,
  });
  external.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'KIWI_API_CANCELLED');
    assert.doesNotMatch(error.message, /without reason/i);
    return true;
  });
});
