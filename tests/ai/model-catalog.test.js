'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  MODEL_IDS,
  isProductionRoutableModel,
  createModelCatalog,
} = require('../../services/ai/model-catalog');

test('active stable Gemini families contain only current production entries', () => {
  const catalog = createModelCatalog();
  assert.deepEqual(catalog.list({
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
  }).map((model) => model.id), [
    MODEL_IDS.GEMINI_3_8_FLASH,
    MODEL_IDS.GEMINI_3_5_FLASH,
  ]);
  assert.deepEqual(catalog.list({
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH_LITE,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
  }).map((model) => model.id), [
    MODEL_IDS.GEMINI_3_5_FLASH_LITE,
    MODEL_IDS.GEMINI_3_1_FLASH_LITE,
  ]);
});

test('reasoning support is catalogued per current model rather than inferred from family names', () => {
  const catalog = createModelCatalog();
  assert.deepEqual(catalog.get(MODEL_IDS.GEMINI_3_8_FLASH, AI_PROVIDERS.GOOGLE).supportedReasoning, ['LOW', 'MEDIUM', 'HIGH']);
  assert.ok(catalog.get(MODEL_IDS.GEMINI_3_5_FLASH, AI_PROVIDERS.GOOGLE).supportedReasoning.includes('MINIMAL'));
  assert.ok(catalog.get(MODEL_IDS.GEMINI_3_5_FLASH_LITE, AI_PROVIDERS.GOOGLE).supportedReasoning.includes('MINIMAL'));
});

test('future discovery entries require explicit provider identity and are non-routable until approved for production', () => {
  const catalog = createModelCatalog();
  assert.throws(() => catalog.upsert({ id: 'gemini-3.9-flash' }), /provider and id/);

  const discovered = catalog.upsert({
    provider: AI_PROVIDERS.GOOGLE,
    id: 'gemini-3.9-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.DISCOVERED,
    productionEligible: false,
    rank: 3009000,
    supportedReasoning: ['LOW', 'MEDIUM', 'HIGH'],
    capabilities: ['INFERENCE', 'REASONING'],
    inputModalities: ['TEXT'],
    outputModalities: ['TEXT'],
  });
  assert.equal(isProductionRoutableModel(discovered), false);

  const approvedButNotEligible = catalog.setStatus(discovered.routeKey, MODEL_STATUS.APPROVED);
  assert.equal(isProductionRoutableModel(approvedButNotEligible), false);

  const eligible = catalog.upsert({ ...approvedButNotEligible, productionEligible: true });
  assert.equal(isProductionRoutableModel(eligible), true);
  assert.equal(catalog.latestApproved(MODEL_FAMILIES.FLASH, { provider: AI_PROVIDERS.GOOGLE }).id, 'gemini-3.9-flash');
});
