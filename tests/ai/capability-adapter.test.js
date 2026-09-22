'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createModelCatalog } = require('../../services/ai/model-catalog');
const {
  resolveThinkingLevel,
  buildGeminiThinkingConfig,
} = require('../../services/ai/capability-adapter');

test('MINIMAL safely upgrades to LOW on Gemini 3.8 Flash', () => {
  const catalog = createModelCatalog();
  const model = catalog.get('gemini-3.8-flash');

  assert.equal(resolveThinkingLevel(model, 'MINIMAL'), 'LOW');
  assert.deepEqual(
    buildGeminiThinkingConfig(model, 'MINIMAL').generationConfig,
    { thinkingConfig: { thinkingLevel: 'low' } }
  );
});

test('HIGH remains HIGH on Gemini 3.8 Flash', () => {
  const catalog = createModelCatalog();
  const model = catalog.get('gemini-3.8-flash');

  assert.equal(resolveThinkingLevel(model, 'HIGH'), 'HIGH');
});

test('Flash-Lite preserves MINIMAL exactly', () => {
  const catalog = createModelCatalog();
  const model = catalog.get('gemini-3.5-flash-lite');

  assert.equal(resolveThinkingLevel(model, 'MINIMAL'), 'MINIMAL');
});

test('adapter never downgrades requested reasoning', () => {
  const synthetic = {
    id: 'synthetic',
    supportedThinking: ['MINIMAL', 'LOW'],
  };

  assert.equal(resolveThinkingLevel(synthetic, 'MEDIUM'), null);
  assert.equal(resolveThinkingLevel(synthetic, 'HIGH'), null);
});
