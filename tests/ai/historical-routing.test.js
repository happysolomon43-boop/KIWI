'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AI_CAPABILITIES, AI_INPUT_MODALITIES, AI_OUTPUT_MODALITIES } = require('../../services/ai/capabilities');
const { HISTORICAL_MODELS } = require('../../services/ai/model-history');
const { MODEL_FAMILIES, MODEL_CHANNELS, MODEL_STATUS, DEFAULT_MODEL_CATALOG, createModelCatalog } = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');

test('audit-only historical IDs are absent from the active seed catalog and default routing', () => {
  const historical = new Set(HISTORICAL_MODELS.map((entry) => `${entry.provider}::${entry.modelId}`));
  const catalog = createModelCatalog();
  for (const model of catalog.list()) assert.equal(historical.has(model.routeKey), false, model.routeKey);
  for (const taskId of ['MAIN_CBT', 'FLASHCARD_GENERATION', 'CARD_EXPLANATION']) {
    for (const candidate of createModelRouter({ catalog }).resolveCandidates(taskId)) {
      assert.equal(historical.has(candidate.routeKey), false, `${taskId}:${candidate.routeKey}`);
    }
  }
});

test('a retired historical model cannot re-enter latest-family routing even with a higher rank', () => {
  const retired = {
    provider: AI_PROVIDERS.GOOGLE,
    id: 'gemini-3.7-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.RETIRED,
    rank: 999999999,
    productionEligible: true,
    supportedReasoning: ['LOW', 'MEDIUM', 'HIGH'],
    capabilities: [AI_CAPABILITIES.INFERENCE, AI_CAPABILITIES.REASONING, AI_CAPABILITIES.STRUCTURED_OUTPUT, AI_CAPABILITIES.LONG_OUTPUT],
    inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE],
    outputModalities: [AI_OUTPUT_MODALITIES.TEXT],
  };
  const catalog = createModelCatalog([...DEFAULT_MODEL_CATALOG, retired]);
  const routes = createModelRouter({ catalog }).resolveCandidates('MAIN_CBT');
  assert.equal(routes.some((candidate) => candidate.modelId === retired.id), false);
});
