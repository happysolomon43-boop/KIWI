'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAIRuntime } = require('../../services/ai/runtime');
const { AI_PROVIDERS } = require('../../services/ai/providers');
const { GROQ_MODEL_IDS } = require('../../services/ai/model-catalog');

function response(status, body, headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) { return normalized[String(name).toLowerCase()] ?? null; },
    },
    async text() { return JSON.stringify(body); },
  };
}

test('createAIRuntime owns isolated Groq execution without changing ai.run production routing', async () => {
  const calls = [];
  const runtime = createAIRuntime({
    query: async () => ({ rows: [], rowCount: 0 }),
    randomUUID: () => 'runtime-test-id',
    env: {
      GEMINI_API_KEY: 'google-test-key',
      GROQ_API_KEY: 'groq-test-key',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const request = JSON.parse(init.body);
      assert.equal(request.model, GROQ_MODEL_IDS.GPT_OSS_20B);
      assert.equal(request.reasoning_effort, 'high');
      return response(200, {
        id: 'chatcmpl_runtime_test',
        model: GROQ_MODEL_IDS.GPT_OSS_20B,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '{"ok":true}' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 4,
          total_tokens: 13,
        },
      }, {
        'x-request-id': 'req_runtime_safe',
      });
    },
    logger: { log() {}, warn() {}, error() {} },
    timers: {
      setImmediate() {},
      setInterval() { return { unref() {} }; },
      clearInterval() {},
    },
  });

  assert.equal(typeof runtime.orchestrator.run, 'function');
  assert.equal(typeof runtime.orchestrator.runIsolatedProvider, 'function');
  assert.deepEqual(runtime.providerRegistry.list(), [AI_PROVIDERS.GROQ]);

  const result = await runtime.orchestrator.runIsolatedProvider({
    provider: AI_PROVIDERS.GROQ,
    modelId: GROQ_MODEL_IDS.GPT_OSS_20B,
    content: 'Return JSON.',
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      structuredOutput: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.provider, AI_PROVIDERS.GROQ);
  assert.equal(result.credentialSlot, 'groq-key-01');
  assert.deepEqual(result.structuredData, { ok: true });

  const productionPlan = runtime.orchestrator.plan('MAIN_CBT');
  assert.ok(productionPlan.candidates.length > 0);
  assert.ok(productionPlan.candidates.every(
    (candidate) => candidate.provider === AI_PROVIDERS.GOOGLE
  ));

  const status = runtime.status();
  assert.deepEqual(status.providerFoundation.registeredProviders, [AI_PROVIDERS.GROQ]);
  assert.equal(status.providerFoundation.groqCredentialSlots.total, 1);
  assert.equal(status.providerFoundation.groqCredentialSlots.enabled, 1);
  assert.ok(status.providerFoundation.groqQualificationModels.every(
    (model) => model.productionEligible === false
  ));
  assert.doesNotMatch(JSON.stringify(status), /google-test-key|groq-test-key/);
});
