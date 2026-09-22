'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  createModelCatalog,
  modelVersionRank,
} = require('../../services/ai/model-catalog');
const { createModelLifecycle } = require('../../services/ai/model-lifecycle');
const { createModelQualifier } = require('../../services/ai/model-qualifier');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function candidateModel(id = 'gemini-3.9-flash') {
  return {
    id,
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.DISCOVERED,
    rank: modelVersionRank(id),
    supportedThinking: [],
    capabilities: ['generateContent'],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    metadata: { thinkingAdvertised: true },
  };
}

function projectPool() {
  const slots = [
    { id: 'p1', index: 1, envName: 'K1', apiKey: 'k1', enabled: true },
    { id: 'p2', index: 2, envName: 'K2', apiKey: 'k2', enabled: true },
  ];
  return {
    snapshot() { return slots.map(({ apiKey, ...rest }) => rest); },
    get(id) { return slots.find((slot) => slot.id === id) || null; },
    disable(id) {
      const slot = slots.find((item) => item.id === id);
      if (slot) slot.enabled = false;
    },
  };
}

function okRaw(text = 'OK') {
  return {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text }] },
    }],
  };
}

test('qualification approves low/medium/high when MINIMAL is unsupported', async () => {
  const catalog = createModelCatalog();
  const model = candidateModel();
  catalog.upsert(model);

  const qualificationRows = [];
  const store = {
    async upsertCatalogModel() {},
    async recordModelQualification(row) { qualificationRows.push(row); return qualificationRows.length; },
  };
  const lifecycle = createModelLifecycle({ catalog, store, logger: { warn() {} } });

  const levels = [];
  const qualifier = createModelQualifier({
    transport: {
      async generate(args) {
        const level = args.generationConfig.thinkingConfig.thinkingLevel;
        levels.push(level);
        if (level === 'high') return { raw: okRaw('{"ok":true}'), latencyMs: 1 };
        if (level === 'minimal') {
          throw new AIError('unsupported level', {
            code: AI_ERROR_CODES.BAD_REQUEST,
            status: 400,
            retryable: false,
          });
        }
        if (level === 'low' || level === 'medium') return { raw: okRaw('OK'), latencyMs: 1 };
        throw new Error('unexpected level');
      },
    },
    projectPool: projectPool(),
    quotaManager: {
      isEligible() { return true; },
      async markSuccess() {},
      async markFailure() {},
    },
    lifecycle,
    store,
    logger: { log() {}, warn() {} },
    env: {},
  });

  const result = await qualifier.qualify(model);

  assert.equal(result.status, 'PASSED');
  assert.deepEqual(levels, ['high', 'minimal', 'low', 'medium']);
  assert.deepEqual(
    catalog.get(model.id).supportedThinking,
    ['LOW', 'MEDIUM', 'HIGH']
  );
  assert.ok(catalog.get(model.id).capabilities.includes('vision'));
  assert.ok(catalog.get(model.id).capabilities.includes('structuredOutput'));
  assert.ok(catalog.get(model.id).capabilities.includes('longOutput'));
  assert.equal(catalog.get(model.id).metadata.autoPromoted, true);
  assert.ok(qualificationRows.some((row) => row.status === 'PASSED'));
});

test('qualification preserves MINIMAL when the new model supports it', async () => {
  const catalog = createModelCatalog();
  const model = candidateModel('gemini-4.0-flash');
  catalog.upsert(model);
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {}, async recordModelQualification() {} },
    logger: { warn() {} },
  });

  const levels = [];
  const qualifier = createModelQualifier({
    transport: {
      async generate(args) {
        const level = args.generationConfig.thinkingConfig.thinkingLevel;
        levels.push(level);
        return {
          raw: okRaw(level === 'high' ? '{"ok":true}' : 'OK'),
          latencyMs: 1,
        };
      },
    },
    projectPool: projectPool(),
    quotaManager: {
      isEligible() { return true; },
      async markSuccess() {},
      async markFailure() {},
    },
    lifecycle,
    store: { async recordModelQualification() {} },
    logger: { log() {}, warn() {} },
    env: {},
  });

  const result = await qualifier.qualify(model);
  assert.equal(result.status, 'PASSED');
  assert.deepEqual(levels, ['high', 'minimal', 'medium']);
  assert.deepEqual(
    catalog.get(model.id).supportedThinking,
    ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']
  );
});

test('transient qualification failures stay DISCOVERED for a later retry', async () => {
  const catalog = createModelCatalog();
  const model = candidateModel();
  catalog.upsert(model);
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
  });

  const qualifier = createModelQualifier({
    transport: {
      async generate() {
        throw new AIError('quota', {
          code: AI_ERROR_CODES.RATE_LIMIT_RPD,
          status: 429,
          retryable: true,
        });
      },
    },
    projectPool: projectPool(),
    quotaManager: {
      isEligible() { return true; },
      async markFailure() {},
    },
    lifecycle,
    store: { async recordModelQualification() {} },
    logger: { log() {}, warn() {} },
    env: {},
  });

  const result = await qualifier.qualify(model);
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.equal(catalog.get(model.id).status, MODEL_STATUS.DISCOVERED);
});


test('qualification tries another independent project when one project returns model-not-found', async () => {
  const catalog = createModelCatalog();
  const model = candidateModel('gemini-3.9-flash');
  catalog.upsert(model);
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
  });

  const calls = [];
  const qualifier = createModelQualifier({
    transport: {
      async generate(args) {
        calls.push({ apiKey: args.apiKey, level: args.generationConfig.thinkingConfig.thinkingLevel });
        if (args.apiKey === 'k2') {
          throw new AIError('not visible in this project yet', {
            code: AI_ERROR_CODES.MODEL_NOT_FOUND,
            status: 404,
            retryable: true,
            scope: 'MODEL_SLOT',
          });
        }
        const level = args.generationConfig.thinkingConfig.thinkingLevel;
        return {
          raw: okRaw(level === 'high' ? '{"ok":true}' : 'OK'),
          latencyMs: 1,
        };
      },
    },
    projectPool: projectPool(),
    quotaManager: {
      isEligible() { return true; },
      async markSuccess() {},
      async markFailure() {},
    },
    lifecycle,
    store: { async recordModelQualification() {} },
    logger: { log() {}, warn() {} },
    env: {},
  });

  const result = await qualifier.qualify(model);

  assert.equal(result.status, 'PASSED');
  assert.ok(calls.some((call) => call.apiKey === 'k2'));
  assert.ok(calls.some((call) => call.apiKey === 'k1'));
  assert.equal(catalog.get(model.id).status, MODEL_STATUS.APPROVED);
});

test('model-not-found across all qualification projects stays inconclusive for later rollout retry', async () => {
  const catalog = createModelCatalog();
  const model = candidateModel('gemini-3.9-flash');
  catalog.upsert(model);
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
  });

  const qualifier = createModelQualifier({
    transport: {
      async generate() {
        throw new AIError('not rolled out', {
          code: AI_ERROR_CODES.MODEL_NOT_FOUND,
          status: 404,
          retryable: true,
          scope: 'MODEL_SLOT',
        });
      },
    },
    projectPool: projectPool(),
    quotaManager: {
      isEligible() { return true; },
      async markFailure() {},
    },
    lifecycle,
    store: { async recordModelQualification() {} },
    logger: { log() {}, warn() {} },
    env: {},
  });

  const result = await qualifier.qualify(model);
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.equal(catalog.get(model.id).status, MODEL_STATUS.DISCOVERED);
});
