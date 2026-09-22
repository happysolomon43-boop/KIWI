'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  visibleTextFromParts,
  normalizeGeminiResponse,
} = require('../../services/ai/response-normalizer');

test('visibleTextFromParts concatenates all non-thought text parts', () => {
  const text = visibleTextFromParts([
    { text: 'internal', thought: true },
    { text: 'Hello ' },
    { text: 'world' },
  ]);

  assert.equal(text, 'Hello world');
});

test('normalizer preserves model, slot, finish reason, latency and usage metadata', () => {
  const result = normalizeGeminiResponse({
    modelVersion: 'gemini-3.8-flash-001',
    candidates: [{
      finishReason: 'STOP',
      content: {
        parts: [
          { text: 'reasoning', thought: true },
          { text: 'final' },
        ],
      },
    }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 25,
      thoughtsTokenCount: 40,
      totalTokenCount: 165,
      cachedContentTokenCount: 5,
    },
  }, {
    modelId: 'gemini-3.8-flash',
    slotId: 'p2',
    latencyMs: 1234,
    fallbackDepth: 1,
    generationGroupId: 'g1',
  });

  assert.equal(result.text, 'final');
  assert.equal(result.providerModel, 'gemini-3.8-flash-001');
  assert.equal(result.requestedModel, 'gemini-3.8-flash');
  assert.equal(result.projectSlot, 'p2');
  assert.equal(result.finishReason, 'STOP');
  assert.equal(result.latencyMs, 1234);
  assert.equal(result.fallbackDepth, 1);
  assert.equal(result.generationGroupId, 'g1');
  assert.deepEqual(result.usage, {
    inputTokens: 100,
    outputTokens: 25,
    thoughtTokens: 40,
    totalTokens: 165,
    cachedContentTokens: 5,
  });
});

test('normalizer identifies safety-blocked responses without exposing thought text', () => {
  const result = normalizeGeminiResponse({
    promptFeedback: { blockReason: 'SAFETY' },
    candidates: [],
  }, {
    modelId: 'gemini-3.8-flash',
  });

  assert.equal(result.blocked, true);
  assert.equal(result.blockReason, 'SAFETY');
  assert.equal(result.text, '');
});
