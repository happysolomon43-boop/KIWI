'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGeminiTransport,
  normalizeContents,
} = require('../../services/ai/gemini-transport');
const { AI_ERROR_CODES } = require('../../services/ai/errors');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type'
          ? 'application/json'
          : null;
      },
    },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

test('normalizeContents accepts strings and prebuilt Gemini contents', () => {
  assert.deepEqual(normalizeContents('hello'), [
    { parts: [{ text: 'hello' }] },
  ]);

  const prebuilt = {
    contents: [{
      parts: [
        { text: 'look' },
        { inlineData: { mimeType: 'image/jpeg', data: 'abc' } },
      ],
    }],
  };

  assert.deepEqual(normalizeContents(prebuilt), prebuilt.contents);
});

test('transport sends one generateContent request with caller model and centralized generation config', async () => {
  const calls = [];
  const transport = createGeminiTransport({
    endpointBase: 'https://example.test/v1beta',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      });
    },
  });

  const result = await transport.generate({
    apiKey: 'secret-key',
    modelId: 'gemini-3.8-flash',
    content: 'hello',
    generationConfig: {
      maxOutputTokens: 100,
      thinkingConfig: { thinkingLevel: 'high' },
    },
    timeoutMs: 1000,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /gemini-3\.8-flash:generateContent/);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.contents, [{ parts: [{ text: 'hello' }] }]);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'high');
  assert.equal(result.raw.candidates[0].content.parts[0].text, 'ok');
});

test('transport converts provider HTTP errors into typed AI errors', async () => {
  const transport = createGeminiTransport({
    fetchImpl: async () => jsonResponse(429, {
      error: {
        message: 'Daily quota exceeded',
        details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
      },
    }),
  });

  await assert.rejects(
    transport.generate({
      apiKey: 'secret-key',
      modelId: 'gemini-3.8-flash',
      content: 'hello',
      timeoutMs: 1000,
    }),
    (error) => error.code === AI_ERROR_CODES.RATE_LIMIT_RPD
  );
});

test('transport converts aborted requests into timeout errors', async () => {
  const transport = createGeminiTransport({
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });

  await assert.rejects(
    transport.generate({
      apiKey: 'secret-key',
      modelId: 'gemini-3.8-flash',
      content: 'hello',
      timeoutMs: 5,
    }),
    (error) => error.code === AI_ERROR_CODES.TIMEOUT
  );
});
