'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  createModelCatalog,
} = require('../../services/ai/model-catalog');

test('stable Flash catalog is ordered newest to oldest', () => {
  const catalog = createModelCatalog();
  const ids = catalog.list({
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
  }).map((model) => model.id);

  assert.deepEqual(ids, [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ]);
});

test('stable Flash-Lite catalog is ordered newest to oldest', () => {
  const catalog = createModelCatalog();
  const ids = catalog.list({
    family: MODEL_FAMILIES.FLASH_LITE,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
  }).map((model) => model.id);

  assert.deepEqual(ids, [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ]);
});

test('3.8 and 3.7 reject MINIMAL while 3.6 and Flash-Lite support it', () => {
  const catalog = createModelCatalog();

  assert.deepEqual(catalog.get('gemini-3.8-flash').supportedThinking, ['LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(catalog.get('gemini-3.7-flash').supportedThinking, ['LOW', 'MEDIUM', 'HIGH']);
  assert.ok(catalog.get('gemini-3.6-flash').supportedThinking.includes('MINIMAL'));
  assert.ok(catalog.get('gemini-3.5-flash-lite').supportedThinking.includes('MINIMAL'));
});

test('catalog supports future discovery updates without mutating seed constants', () => {
  const catalog = createModelCatalog();
  catalog.upsert({
    id: 'gemini-3.9-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.DISCOVERED,
    rank: 390,
    supportedThinking: ['LOW', 'MEDIUM', 'HIGH'],
    capabilities: ['generateContent', 'thinking'],
  });

  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.DISCOVERED);
  catalog.setStatus('gemini-3.9-flash', MODEL_STATUS.APPROVED);
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.APPROVED);
});
