'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AI_ERROR_CODES } = require('../../services/ai/errors');
const { createGroqHttpTransport } = require('../../services/ai/groq-http-transport');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); },
  };
}

test('Groq transport timeout is normalized to provider-aware TIMEOUT', async () => {
  const transport = createGroqHttpTransport({
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted by timeout');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });

  await assert.rejects(
    () => transport.generate({
      apiKey: 'secret-not-logged',
      body: { model: 'openai/gpt-oss-20b', messages: [] },
      timeoutMs: 5,
    }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.TIMEOUT);
      assert.equal(error.provider, AI_PROVIDERS.GROQ);
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /secret-not-logged/);
      return true;
    }
  );
});

test('Groq transport normalizes provider 5xx responses before they leave the adapter boundary', async () => {
  const transport = createGroqHttpTransport({
    fetchImpl: async () => response(503, {
      error: { message: 'Service temporarily unavailable' },
    }),
  });

  await assert.rejects(
    () => transport.generate({
      apiKey: 'secret-not-logged',
      body: { model: 'openai/gpt-oss-20b', messages: [] },
      timeoutMs: 1000,
    }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
      assert.equal(error.provider, AI_PROVIDERS.GROQ);
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      return true;
    }
  );
});
