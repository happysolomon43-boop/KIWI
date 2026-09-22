'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAIRuntime, parseIntervalMs } = require('../../services/ai/runtime');
const { modelVersionRank } = require('../../services/ai/model-catalog');

test('discovery interval is bounded to a safe range', () => {
  assert.equal(parseIntervalMs(undefined), 15 * 60 * 1000);
  assert.equal(parseIntervalMs(1000), 5 * 60 * 1000);
  assert.equal(parseIntervalMs(24 * 60 * 60 * 1000), 6 * 60 * 60 * 1000);
});

test('runtime hydrates a previously auto-promoted model before routing', async () => {
  const queries = [];
  const persisted39 = {
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
    approved_at: new Date().toISOString(),
  };

  async function query(sql) {
    queries.push(sql);
    if (/FROM ai_model_catalog/i.test(sql) && /SELECT/i.test(sql)) {
      return { rows: [persisted39] };
    }
    if (/FROM ai_project_model_state/i.test(sql) && /SELECT/i.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  }

  let intervalScheduled = false;
  const runtime = createAIRuntime({
    query,
    randomUUID: () => '00000000-0000-0000-0000-000000000001',
    env: {
      GEMINI_API_KEY: 'key-a',
      AI_AUTO_DISCOVERY: 'true',
      AI_AUTO_PROMOTE: 'true',
    },
    fetchImpl: async () => {
      throw new Error('network should not run during this test');
    },
    logger: { log() {}, warn() {} },
    timers: {
      setImmediate: null,
      setInterval() {
        intervalScheduled = true;
        return { unref() {} };
      },
      clearInterval() {},
    },
  });

  const state = await runtime.initialize();

  assert.equal(state.hydratedCatalogModels, 1);
  assert.equal(intervalScheduled, true);
  assert.equal(
    runtime.orchestrator.plan('MAIN_CBT').plannedPrimaryModel,
    'gemini-3.9-flash'
  );
  assert.ok(queries.some((sql) => /INSERT INTO ai_model_catalog/i.test(sql)));
});
