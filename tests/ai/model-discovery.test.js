'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  createModelCatalog,
} = require('../../services/ai/model-catalog');
const {
  normalizeModelId,
  classifyStableFlash,
  createModelDiscoveryManager,
} = require('../../services/ai/model-discovery');
const { createModelLifecycle } = require('../../services/ai/model-lifecycle');
const { createModelRouter } = require('../../services/ai/model-router');

test('models.list classification accepts only exact stable Flash/Flash-Lite IDs', () => {
  assert.equal(
    normalizeModelId({ name: 'models/gemini-3.9-flash' }),
    'gemini-3.9-flash'
  );

  const flash = classifyStableFlash({
    name: 'models/gemini-3.9-flash',
    baseModelId: 'gemini-3.9-flash',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinking: true,
    supportedGenerationMethods: ['generateContent', 'countTokens'],
  });

  assert.equal(flash.id, 'gemini-3.9-flash');
  assert.equal(flash.family, MODEL_FAMILIES.FLASH);
  assert.equal(flash.channel, MODEL_CHANNELS.STABLE);

  const lite = classifyStableFlash({
    name: 'models/gemini-3.9-flash-lite',
    baseModelId: 'gemini-3.9-flash-lite',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinking: true,
    supportedGenerationMethods: ['generateContent'],
  });
  assert.equal(lite.family, MODEL_FAMILIES.FLASH_LITE);

  for (const id of [
    'gemini-3.9-flash-preview',
    'gemini-flash-latest',
    'gemini-3.9-live',
    'gemini-3.9-flash-image',
    'gemini-3.9-pro',
  ]) {
    assert.equal(classifyStableFlash({
      name: `models/${id}`,
      baseModelId: id,
      thinking: true,
      supportedGenerationMethods: ['generateContent'],
    }), null, id);
  }
});

test('newer stable Flash is qualified, approved, and immediately becomes VVIP primary', async () => {
  const catalog = createModelCatalog();
  const persisted = [];
  const store = {
    async upsertCatalogModel(model) { persisted.push(model); },
    async loadCatalogModels() { return []; },
  };
  const lifecycle = createModelLifecycle({
    catalog,
    store,
    logger: { warn() {} },
  });

  const projectPool = {
    orderedSlots() { return [{ id: 'p1', index: 1, apiKey: 'k1', enabled: true }]; },
    snapshot() { return [{ id: 'p1', index: 1, envName: 'K1', enabled: true }]; },
    disable() {},
  };

  const qualified = [];
  const qualifier = {
    async qualify(model) {
      qualified.push(model.id);
      await lifecycle.approve(model.id, {
        supportedThinking: ['LOW', 'MEDIUM', 'HIGH'],
        capabilities: ['generateContent', 'thinking', 'vision', 'structuredOutput', 'longOutput'],
        qualification: { version: 1 },
      });
      return { status: 'PASSED' };
    },
  };

  const discovery = createModelDiscoveryManager({
    transport: {
      async listModels() {
        return [{
          name: 'models/gemini-3.9-flash',
          baseModelId: 'gemini-3.9-flash',
          version: '3.9',
          displayName: 'Gemini 3.9 Flash',
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
          thinking: true,
          supportedGenerationMethods: ['generateContent'],
        }];
      },
    },
    projectPool,
    catalog,
    lifecycle,
    qualifier,
    logger: { log() {}, warn() {} },
    env: {},
    sampleSize: 1,
  });

  const summary = await discovery.discoverOnce();
  assert.deepEqual(summary.promoted, ['gemini-3.9-flash']);
  assert.deepEqual(qualified, ['gemini-3.9-flash']);
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.APPROVED);

  const router = createModelRouter({ catalog });
  assert.equal(
    router.resolveCandidates('MAIN_CBT')[0].modelId,
    'gemini-3.9-flash'
  );
  assert.ok(persisted.some((model) => model.id === 'gemini-3.9-flash'));
});

test('DISCOVERED models are retried on later cycles after an inconclusive qualification', async () => {
  const catalog = createModelCatalog();
  catalog.upsert({
    id: 'gemini-3.9-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.DISCOVERED,
    rank: 3009000,
    supportedThinking: [],
    capabilities: ['generateContent'],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    metadata: { thinkingAdvertised: true },
  });

  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {}, async loadCatalogModels() { return []; } },
    logger: { warn() {} },
  });

  let calls = 0;
  const discovery = createModelDiscoveryManager({
    transport: {
      async listModels() {
        return [{
          baseModelId: 'gemini-3.9-flash',
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
          thinking: true,
          supportedGenerationMethods: ['generateContent'],
        }];
      },
    },
    projectPool: {
      orderedSlots() { return [{ id: 'p1', index: 1, apiKey: 'k1', enabled: true }]; },
      snapshot() { return [{ id: 'p1', index: 1, envName: 'K1', enabled: true }]; },
      disable() {},
    },
    catalog,
    lifecycle,
    qualifier: {
      async qualify() {
        calls++;
        return { status: 'INCONCLUSIVE' };
      },
    },
    logger: { log() {}, warn() {} },
    env: {},
    sampleSize: 1,
  });

  await discovery.discoverOnce();
  assert.equal(calls, 1);
});

test('auto promotion can be disabled while discovery stays active', async () => {
  const catalog = createModelCatalog();
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {}, async loadCatalogModels() { return []; } },
    logger: { warn() {} },
  });

  let qualified = false;
  const discovery = createModelDiscoveryManager({
    transport: {
      async listModels() {
        return [{
          baseModelId: 'gemini-3.9-flash',
          inputTokenLimit: 1048576,
          outputTokenLimit: 65536,
          thinking: true,
          supportedGenerationMethods: ['generateContent'],
        }];
      },
    },
    projectPool: {
      orderedSlots() { return [{ id: 'p1', index: 1, apiKey: 'k1', enabled: true }]; },
      snapshot() { return [{ id: 'p1', index: 1, envName: 'K1', enabled: true }]; },
      disable() {},
    },
    catalog,
    lifecycle,
    qualifier: { async qualify() { qualified = true; return { status: 'PASSED' }; } },
    logger: { log() {}, warn() {} },
    env: { AI_AUTO_PROMOTE: 'false' },
    sampleSize: 1,
  });

  const summary = await discovery.discoverOnce();
  assert.equal(qualified, false);
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.DISCOVERED);
  assert.ok(summary.skipped.some((item) => item.reason === 'auto promotion disabled'));
});
