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
const { createModelRouter } = require('../../services/ai/model-router');
const { createProjectPool } = require('../../services/ai/project-pool');
const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { createModelLifecycle } = require('../../services/ai/model-lifecycle');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function promoted39() {
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

test('semantic model rank handles 3.10 correctly', () => {
  assert.ok(modelVersionRank('gemini-3.10-flash') > modelVersionRank('gemini-3.9-flash'));
  assert.ok(modelVersionRank('gemini-4.0-flash') > modelVersionRank('gemini-3.10-flash'));
});

test('VVIP emergency pin overrides newest-model starting point without removing fallbacks', () => {
  const catalog = createModelCatalog();
  catalog.upsert(promoted39());

  const router = createModelRouter({
    catalog,
    pins: { VVIP: 'gemini-3.8-flash' },
  });

  assert.deepEqual(
    router.resolveCandidates('MAIN_CBT').map((entry) => entry.modelId),
    ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']
  );
});

test('auto-promoted BAD_REQUEST rolls back and falls through to previous approved model', async () => {
  const catalog = createModelCatalog();
  catalog.upsert(promoted39());

  const lifecycle = createModelLifecycle({
    catalog,
    store: { async upsertCatalogModel() {} },
    logger: { warn() {} },
  });

  const pool = createProjectPool({
    env: {},
    slots: [
      { id: 'p1', index: 1, envName: 'K1', apiKey: 'key-1' },
      { id: 'p2', index: 2, envName: 'K2', apiKey: 'key-2' },
    ],
  });

  const calls = [];
  const ai = createAIOrchestrator({
    catalog,
    router: createModelRouter({ catalog }),
    projectPool: pool,
    modelLifecycle: lifecycle,
    logger: { warn() {} },
    transport: {
      async generate(args) {
        calls.push(args.modelId);
        if (args.modelId === 'gemini-3.9-flash') {
          throw new AIError('new model incompatibility', {
            code: AI_ERROR_CODES.BAD_REQUEST,
            status: 400,
            retryable: false,
          });
        }

        return {
          raw: {
            candidates: [{
              finishReason: 'STOP',
              content: { parts: [{ text: 'fallback-ok' }] },
            }],
          },
          latencyMs: 1,
          httpStatus: 200,
        };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'exam' });

  assert.deepEqual(calls, ['gemini-3.9-flash', 'gemini-3.8-flash']);
  assert.equal(result.requestedModel, 'gemini-3.8-flash');
  assert.equal(catalog.get('gemini-3.9-flash').status, MODEL_STATUS.SUSPENDED);
});
