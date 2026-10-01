'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  createModelCatalog,
} = require('../../services/ai/model-catalog');
const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AI_CAPABILITIES, AI_INPUT_MODALITIES, AI_OUTPUT_MODALITIES } = require('../../services/ai/capabilities');
const { createProviderRegistry } = require('../../services/ai/provider-registry');
const { createCredentialRegistry } = require('../../services/ai/credential-registry');
const {
  normalizeModelId,
  classifyStableFlash,
  createModelDiscoveryManager,
} = require('../../services/ai/model-discovery');
const { createModelLifecycle } = require('../../services/ai/model-lifecycle');
const { createModelRouter } = require('../../services/ai/model-router');

function providerRuntime(listModels) {
  return {
    providerRegistry: createProviderRegistry([{
      provider: AI_PROVIDERS.GOOGLE,
      async generate() { throw new Error('generate not expected in discovery fixture'); },
      listModels,
    }]),
    credentialRegistry: createCredentialRegistry({ env: { GEMINI_API_KEY: 'k1' } }),
  };
}

function discoveredModel() {
  return {
    id: 'gemini-3.9-flash',
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.DISCOVERED,
    productionEligible: false,
    rank: 3009000,
    supportedReasoning: [],
    capabilities: [AI_CAPABILITIES.INFERENCE],
    inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE],
    outputModalities: [AI_OUTPUT_MODALITIES.TEXT],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    metadata: { thinkingAdvertised: true },
  };
}

test('models.list classification accepts only exact stable Flash/Flash-Lite IDs', () => {
  assert.equal(normalizeModelId({ name: 'models/gemini-3.9-flash' }), 'gemini-3.9-flash');
  const flash = classifyStableFlash({
    name: 'models/gemini-3.9-flash',
    baseModelId: 'gemini-3.9-flash',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinking: true,
    supportedGenerationMethods: ['generateContent', 'countTokens'],
  });
  assert.equal(flash.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(flash.family, MODEL_FAMILIES.FLASH);
  assert.equal(flash.channel, MODEL_CHANNELS.STABLE);
  assert.equal(flash.productionEligible, false);

  const lite = classifyStableFlash({
    baseModelId: 'gemini-3.9-flash-lite',
    supportedGenerationMethods: ['generateContent'],
  });
  assert.equal(lite.family, MODEL_FAMILIES.FLASH_LITE);

  for (const id of ['gemini-3.9-flash-preview', 'gemini-flash-latest', 'gemini-3.9-live', 'gemini-3.9-flash-image', 'gemini-3.9-pro']) {
    assert.equal(classifyStableFlash({
      baseModelId: id,
      supportedGenerationMethods: ['generateContent'],
    }), null, id);
  }
});

test('a qualified newer stable Flash becomes production eligible without replacing the neutral default-route order', async () => {
  const catalog = createModelCatalog();
  const persisted = [];
  const store = {
    async upsertCatalogModel(model) { persisted.push(model); },
    async loadCatalogModels() { return []; },
  };
  const lifecycle = createModelLifecycle({ catalog, store, logger: { warn() {} } });
  const qualified = [];
  const qualifier = {
    async qualify(model) {
      qualified.push(model.id);
      const approved = await lifecycle.approve(model.id, {
        provider: AI_PROVIDERS.GOOGLE,
        supportedReasoning: ['LOW', 'MEDIUM', 'HIGH'],
        capabilities: [AI_CAPABILITIES.INFERENCE, AI_CAPABILITIES.REASONING, AI_CAPABILITIES.STRUCTURED_OUTPUT, AI_CAPABILITIES.LONG_OUTPUT],
        qualification: { version: 3 },
      });
      return { status: 'PASSED', model: approved };
    },
  };
  const runtime = providerRuntime(async () => [{
    baseModelId: 'gemini-3.9-flash',
    version: '3.9',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinking: true,
    supportedGenerationMethods: ['generateContent'],
  }]);
  const discovery = createModelDiscoveryManager({
    ...runtime,
    catalog,
    lifecycle,
    qualifier,
    logger: { log() {}, warn() {} },
    env: {},
    sampleSize: 1,
  });

  const summary = await discovery.discoverOnce();
  const promoted = catalog.get('gemini-3.9-flash', AI_PROVIDERS.GOOGLE);
  assert.deepEqual(summary.promoted, ['gemini-3.9-flash']);
  assert.deepEqual(qualified, ['gemini-3.9-flash']);
  assert.equal(promoted.status, MODEL_STATUS.APPROVED);
  assert.equal(promoted.productionEligible, true);
  const routes = createModelRouter({ catalog }).resolveCandidates('MAIN_CBT');
  assert.equal(routes[0].modelId, 'gemini-3.5-flash-lite');
  assert.ok(routes.some((candidate) => candidate.routeKey === 'GOOGLE::gemini-3.9-flash'));
  assert.ok(persisted.some((model) => model.id === 'GOOGLE::gemini-3.9-flash'));
});

test('DISCOVERED models are retried after an inconclusive qualification', async () => {
  const catalog = createModelCatalog();
  catalog.upsert(discoveredModel());
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {}, async loadCatalogModels() { return []; } },
    logger: { warn() {} },
  });
  let calls = 0;
  const runtime = providerRuntime(async () => [{
    baseModelId: 'gemini-3.9-flash',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinking: true,
    supportedGenerationMethods: ['generateContent'],
  }]);
  const discovery = createModelDiscoveryManager({
    ...runtime,
    catalog,
    lifecycle,
    qualifier: { async qualify() { calls += 1; return { status: 'INCONCLUSIVE' }; } },
    logger: { log() {}, warn() {} },
    env: {},
    sampleSize: 1,
  });
  await discovery.discoverOnce();
  assert.equal(calls, 1);
});

test('auto promotion can be disabled while discovery remains active', async () => {
  const catalog = createModelCatalog();
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {}, async loadCatalogModels() { return []; } },
    logger: { warn() {} },
  });
  let qualified = false;
  const runtime = providerRuntime(async () => [{
    baseModelId: 'gemini-3.9-flash',
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinking: true,
    supportedGenerationMethods: ['generateContent'],
  }]);
  const discovery = createModelDiscoveryManager({
    ...runtime,
    catalog,
    lifecycle,
    qualifier: { async qualify() { qualified = true; return { status: 'PASSED' }; } },
    logger: { log() {}, warn() {} },
    env: { AI_AUTO_PROMOTE: 'false' },
    sampleSize: 1,
  });
  const summary = await discovery.discoverOnce();
  assert.equal(qualified, false);
  assert.equal(catalog.get('gemini-3.9-flash', AI_PROVIDERS.GOOGLE).status, MODEL_STATUS.DISCOVERED);
  assert.ok(summary.skipped.some((item) => item.reason === 'auto promotion disabled'));
});

test('model discovery uses low-priority central AI traffic admission', async () => {
  const catalog = createModelCatalog();
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {}, async loadCatalogModels() { return []; } },
    logger: { warn() {} },
  });
  const admissions = [];
  let releases = 0;
  let successes = 0;
  const trafficController = {
    async acquire(request) { admissions.push(request); return { release() { releases += 1; } }; },
    noteSuccess() { successes += 1; },
    noteFailure() {},
  };
  const runtime = providerRuntime(async () => []);
  const discovery = createModelDiscoveryManager({
    ...runtime,
    catalog,
    lifecycle,
    qualifier: { async qualify() { throw new Error('not expected'); } },
    trafficController,
    logger: { log() {}, warn() {} },
    env: {},
    sampleSize: 1,
  });
  const summary = await discovery.discoverOnce();
  assert.equal(summary.providerModels, 0);
  assert.equal(admissions.length, 1);
  assert.equal(admissions[0].taskId, 'MODEL_DISCOVERY');
  assert.equal(admissions[0].taskClass, 'IP');
  assert.equal(releases, 1);
  assert.equal(successes, 1);
});
