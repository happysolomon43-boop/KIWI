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
const { AI_ERROR_CODES, AIError } = require('../../services/ai/errors');

function autoModel() {
  return {
    id: 'gemini-3.9-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.9-flash'),
    supportedThinking: ['LOW', 'MEDIUM', 'HIGH'],
    capabilities: ['generateContent', 'thinking', 'vision', 'structuredOutput', 'longOutput'],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    metadata: { autoPromoted: true },
  };
}

test('persisted promoted models hydrate back into the runtime catalog', async () => {
  const catalog = createModelCatalog();
  const lifecycle = createModelLifecycle({
    catalog,
    store: {
      async loadCatalogModels() {
        return [{
          model_id: 'gemini-3.9-flash',
          family: 'FLASH',
          channel: 'STABLE',
          status: 'APPROVED',
          rank: modelVersionRank('gemini-3.9-flash'),
          supported_thinking: ['LOW', 'MEDIUM', 'HIGH'],
          capabilities: ['generateContent', 'thinking', 'vision', 'structuredOutput', 'longOutput'],
          input_token_limit: 1048576,
          output_token_limit: 65536,
          metadata: { autoPromoted: true },
        }];
      },
      async upsertCatalogModel() {},
    },
    logger: { warn() {} },
  });

  const count = await lifecycle.hydratePersistedCatalog();
  assert.equal(count, 1);
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.APPROVED);
  assert.equal(catalog.get('gemini-3.9-flash').metadata.autoPromoted, true);
});

test('quota failures do not trip the model circuit breaker', async () => {
  const catalog = createModelCatalog();
  catalog.upsert(autoModel());
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
  });

  for (let i = 0; i < 10; i++) {
    const result = await lifecycle.recordFailure('gemini-3.9-flash', new AIError('quota', {
      code: AI_ERROR_CODES.RATE_LIMIT_RPD,
      status: 429,
      retryable: true,
    }));
    assert.equal(result.suspended, false);
  }

  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.APPROVED);
});

test('repeated provider failures automatically roll back an auto-promoted model', async () => {
  const catalog = createModelCatalog();
  catalog.upsert(autoModel());
  const persisted = [];
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel(model) { persisted.push(model); } },
    logger: { warn() {} },
    failureThreshold: 3,
  });

  for (let i = 0; i < 2; i++) {
    const result = await lifecycle.recordFailure('gemini-3.9-flash', new AIError('timeout', {
      code: AI_ERROR_CODES.TIMEOUT,
      retryable: true,
    }));
    assert.equal(result.suspended, false);
  }

  const final = await lifecycle.recordFailure('gemini-3.9-flash', new AIError('timeout', {
    code: AI_ERROR_CODES.TIMEOUT,
    retryable: true,
  }));

  assert.equal(final.suspended, true);
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.SUSPENDED);
  assert.ok(persisted.some((model) => model.status === MODEL_STATUS.SUSPENDED));
});

test('BAD_REQUEST immediately rolls back an auto-promoted model', async () => {
  const catalog = createModelCatalog();
  catalog.upsert(autoModel());
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
  });

  const result = await lifecycle.recordFailure('gemini-3.9-flash', new AIError('invalid', {
    code: AI_ERROR_CODES.BAD_REQUEST,
    status: 400,
  }));

  assert.equal(result.suspended, true);
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.SUSPENDED);
});

test('task validation failures can roll back a newly promoted model', async () => {
  const catalog = createModelCatalog();
  catalog.upsert(autoModel());
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
    failureThreshold: 3,
  });

  assert.equal(
    (await lifecycle.reportValidationFailure('gemini-3.9-flash', 'invalid CBT format')).suspended,
    false
  );
  assert.equal(
    (await lifecycle.reportValidationFailure('gemini-3.9-flash', 'invalid CBT format')).suspended,
    true
  );
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.SUSPENDED);
});


test('manual suspension can be resumed to its previous lifecycle state', async () => {
  const catalog = createModelCatalog();
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
  });

  await lifecycle.suspend('gemini-3.8-flash', 'manual AI_MODEL_DENYLIST');
  assert.equal(catalog.get('gemini-3.8-flash').status, MODEL_STATUS.SUSPENDED);

  await lifecycle.resume('gemini-3.8-flash', 'removed from AI_MODEL_DENYLIST');
  assert.equal(catalog.get('gemini-3.8-flash').status, MODEL_STATUS.APPROVED);
});


test('automatic suspension can transition back to DISCOVERED for requalification', async () => {
  const catalog = createModelCatalog();
  catalog.upsert(autoModel());
  const persisted = [];
  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel(model) { persisted.push(model); } },
    logger: { warn() {} },
  });

  await lifecycle.suspend('gemini-3.9-flash', 'automatic rollback after TIMEOUT');
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.SUSPENDED);

  await lifecycle.retryQualification(
    'gemini-3.9-flash',
    'stable model still advertised after cooldown'
  );

  const model = catalog.get('gemini-3.9-flash');
  assert.equal(model.status, MODEL_STATUS.DISCOVERED);
  assert.equal(model.suspendedAt, null);
  assert.equal(model.metadata.suspendedReason, undefined);
  assert.ok(model.metadata.requalificationRequestedAt);
  assert.ok(persisted.some((entry) => entry.status === MODEL_STATUS.DISCOVERED));
});
