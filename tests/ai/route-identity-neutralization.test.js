'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS, providerModelKey } = require('../../services/ai/providers');
const { createModelCatalog, MODEL_STATUS } = require('../../services/ai/model-catalog');
const { createModelLifecycle, rowToModel } = require('../../services/ai/model-lifecycle');
const { createTelemetry } = require('../../services/ai/telemetry');

function createStoreProbe() {
  const writes = {
    catalog: [],
    requests: [],
    attempts: [],
    finishes: [],
  };
  return {
    writes,
    store: {
      async upsertCatalogModel(model) { writes.catalog.push(model); },
      async createRequest(record) { writes.requests.push(record); return 'request-1'; },
      async recordAttempt(record) { writes.attempts.push(record); },
      async finishRequest(id, record) { writes.finishes.push({ id, record }); },
      async incrementDailyRollup() {},
    },
  };
}

test('model lifecycle persistence stores composite route identity without changing schema names', async () => {
  const catalog = createModelCatalog();
  const { writes, store } = createStoreProbe();
  const lifecycle = createModelLifecycle({ catalog, store, logger: null });
  const routeKey = providerModelKey(AI_PROVIDERS.GROQ, 'qwen/qwen3.8-27b');

  await lifecycle.suspend(routeKey, 'test suspension');

  assert.equal(writes.catalog.length, 1);
  assert.equal(writes.catalog[0].id, routeKey);
  assert.equal(writes.catalog[0].metadata.provider, AI_PROVIDERS.GROQ);
  assert.equal(writes.catalog[0].metadata.modelId, 'qwen/qwen3.8-27b');
  assert.equal(writes.catalog[0].metadata.routeKey, routeKey);
});

test('persisted composite route keys hydrate back into provider plus model identity', () => {
  const row = rowToModel({
    model_id: 'GROQ::qwen/qwen3.8-27b',
    family: null,
    channel: 'PREVIEW',
    status: MODEL_STATUS.APPROVED,
    rank: 1,
    supported_thinking: ['HIGH'],
    capabilities: ['INFERENCE'],
    input_token_limit: 100,
    output_token_limit: 100,
    metadata: {
      provider: AI_PROVIDERS.GROQ,
      modelId: 'qwen/qwen3.8-27b',
      routeKey: 'GROQ::qwen/qwen3.8-27b',
    },
  });

  assert.equal(row.provider, AI_PROVIDERS.GROQ);
  assert.equal(row.id, 'qwen/qwen3.8-27b');
  assert.equal(row.routeKey, 'GROQ::qwen/qwen3.8-27b');
});

test('telemetry exposes neutral route and credential identity while translating only at storage boundary', async () => {
  const { writes, store } = createStoreProbe();
  const telemetry = createTelemetry({ store, logger: null });
  const route = {
    provider: AI_PROVIDERS.GOOGLE,
    modelId: 'gemini-3.5-flash-lite',
    routeKey: 'GOOGLE::gemini-3.5-flash-lite',
  };

  const requestId = await telemetry.beginRequest({
    taskId: 'MAIN_CBT',
    taskClass: 'VVIP',
    mode: 'LIVE',
    requestedReasoning: 'HIGH',
    plannedRoutes: [route],
    plannedPrimaryRoute: route,
  });
  await telemetry.recordAttempt({
    requestId,
    attemptNumber: 1,
    ...route,
    credentialSlotId: 'google-key-01',
    requestedReasoning: 'HIGH',
    resolvedReasoning: 'HIGH',
    fallbackDepth: 0,
    outcome: 'SUCCESS',
  });
  await telemetry.finishRequest(requestId, {
    taskId: 'MAIN_CBT',
    taskClass: 'VVIP',
    mode: 'LIVE',
    selectedRoute: route,
    selectedCredentialSlotId: 'google-key-01',
    outcome: 'SUCCESS',
  });

  assert.deepEqual(writes.requests[0].plannedModels, [route.routeKey]);
  assert.equal(writes.requests[0].plannedPrimaryModel, route.routeKey);
  assert.equal(writes.requests[0].legacyModel, null);
  assert.equal(writes.attempts[0].modelId, route.routeKey);
  assert.equal(writes.attempts[0].projectSlot, 'google-key-01');
  assert.equal(writes.finishes[0].record.selectedModel, route.routeKey);
  assert.equal(writes.finishes[0].record.selectedProjectSlot, 'google-key-01');

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.attemptsByRoute[route.routeKey], 1);
  assert.equal(snapshot.attemptsByProvider.GOOGLE, 1);
  assert.equal(snapshot.attemptsByModel['gemini-3.5-flash-lite'], 1);
});
