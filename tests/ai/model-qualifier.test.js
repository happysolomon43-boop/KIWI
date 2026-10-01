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
const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AI_CAPABILITIES, AI_INPUT_MODALITIES, AI_OUTPUT_MODALITIES } = require('../../services/ai/capabilities');
const { createProviderRegistry } = require('../../services/ai/provider-registry');
const { createCredentialRegistry } = require('../../services/ai/credential-registry');
const { createModelLifecycle } = require('../../services/ai/model-lifecycle');
const { createModelQualifier } = require('../../services/ai/model-qualifier');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function candidateModel(id = 'gemini-3.9-flash') {
  return {
    id,
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.DISCOVERED,
    productionEligible: false,
    rank: modelVersionRank(id),
    supportedReasoning: [],
    capabilities: [AI_CAPABILITIES.INFERENCE],
    inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE],
    outputModalities: [AI_OUTPUT_MODALITIES.TEXT],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    metadata: { thinkingAdvertised: true },
  };
}

function qualificationRuntime(generate) {
  return {
    providerRegistry: createProviderRegistry([{
      provider: AI_PROVIDERS.GOOGLE,
      generate,
    }]),
    credentialRegistry: createCredentialRegistry({
      env: { GEMINI_API_KEY: 'k1', GEMINI_API_KEY_2: 'k2' },
    }),
  };
}

function reasoningLevel(request) {
  return String(request?.generation?.reasoning?.resolved || '').toUpperCase();
}

function okResult(text = 'OK') {
  return { normalized: { text }, latencyMs: 1 };
}

test('qualification approves LOW/MEDIUM/HIGH when MINIMAL is unsupported', async () => {
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
  const runtime = qualificationRuntime(async ({ request }) => {
    const level = reasoningLevel(request);
    levels.push(level);
    if (level === 'HIGH') return okResult('{"ok":true}');
    if (level === 'MINIMAL') {
      throw new AIError('unsupported level', {
        code: AI_ERROR_CODES.BAD_REQUEST,
        status: 400,
        retryable: false,
      });
    }
    if (level === 'LOW') return okResult('OK');
    throw new Error(`unexpected level ${level}`);
  });

  const qualifier = createModelQualifier({
    ...runtime,
    lifecycle,
    store,
    logger: { log() {}, warn() {} },
    env: {},
  });

  const result = await qualifier.qualify(model);
  const qualified = catalog.get(model.id, AI_PROVIDERS.GOOGLE);
  assert.equal(result.status, 'PASSED');
  assert.deepEqual(levels, ['HIGH', 'MINIMAL', 'LOW']);
  assert.deepEqual(qualified.supportedReasoning, ['LOW', 'MEDIUM', 'HIGH']);
  assert.ok(qualified.capabilities.includes(AI_CAPABILITIES.REASONING));
  assert.ok(qualified.capabilities.includes(AI_CAPABILITIES.STRUCTURED_OUTPUT));
  assert.ok(qualified.capabilities.includes(AI_CAPABILITIES.LONG_OUTPUT));
  assert.equal(qualified.productionEligible, false, 'qualification alone must not make a discovered model routable');
  assert.ok(qualificationRows.some((row) => row.status === 'PASSED'));
});

test('qualification preserves MINIMAL when the model supports it', async () => {
  const catalog = createModelCatalog();
  const model = candidateModel('gemini-4.0-flash');
  catalog.upsert(model);
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {}, async recordModelQualification() {} },
    logger: { warn() {} },
  });
  const levels = [];
  const runtime = qualificationRuntime(async ({ request }) => {
    const level = reasoningLevel(request);
    levels.push(level);
    return okResult(level === 'HIGH' ? '{"ok":true}' : 'OK');
  });

  const qualifier = createModelQualifier({
    ...runtime,
    lifecycle,
    store: { async recordModelQualification() {} },
    logger: { log() {}, warn() {} },
    env: {},
  });
  const result = await qualifier.qualify(model);
  assert.equal(result.status, 'PASSED');
  assert.deepEqual(levels, ['HIGH', 'MINIMAL']);
  assert.deepEqual(
    catalog.get(model.id, AI_PROVIDERS.GOOGLE).supportedReasoning,
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
  const runtime = qualificationRuntime(async () => {
    throw new AIError('quota', {
      code: AI_ERROR_CODES.RATE_LIMIT_RPD,
      status: 429,
      retryable: true,
    });
  });
  const qualifier = createModelQualifier({
    ...runtime,
    lifecycle,
    store: { async recordModelQualification() {} },
    logger: { log() {}, warn() {} },
    env: {},
  });

  const result = await qualifier.qualify(model);
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.equal(catalog.get(model.id, AI_PROVIDERS.GOOGLE).status, MODEL_STATUS.DISCOVERED);
});

test('model qualification uses low-priority central AI traffic admission', async () => {
  const catalog = createModelCatalog();
  const model = candidateModel('gemini-4.0-flash');
  catalog.upsert(model);
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
  });
  const admissions = [];
  let releases = 0;
  let successes = 0;
  const trafficController = {
    async acquire(request) {
      admissions.push(request);
      return { release() { releases += 1; } };
    },
    noteSuccess() { successes += 1; },
    noteFailure() {},
  };
  const runtime = qualificationRuntime(async ({ request }) =>
    okResult(reasoningLevel(request) === 'HIGH' ? '{"ok":true}' : 'OK')
  );
  const qualifier = createModelQualifier({
    ...runtime,
    trafficController,
    lifecycle,
    store: { async recordModelQualification() {} },
    logger: { log() {}, warn() {} },
    env: {},
  });

  const result = await qualifier.qualify(model);
  assert.equal(result.status, 'PASSED');
  assert.ok(admissions.length >= 2);
  assert.ok(admissions.every((entry) => entry.taskId === 'MODEL_QUALIFICATION'));
  assert.ok(admissions.every((entry) => entry.taskClass === 'IP'));
  assert.equal(releases, admissions.length);
  assert.equal(successes, admissions.length);
});
