'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTeachingRuntimePlatform } = require('../../../teaching/runtime');

test('D28 runtime retries a structured T2 result only through the central aiRun boundary', async () => {
  let aiCalls = 0;
  const queries = [];
  const runtime = createTeachingRuntimePlatform({
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
    randomUUID: (() => {
      let n = 0;
      return () => `d28-runtime-${++n}`;
    })(),
    aiRun: async () => ({ ok: ++aiCalls >= 2, modelId: 'central-model', provider: 'central-provider', routeKey: 'central-route', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }),
    env: { TEACHING_D28_AI_VALIDATION_ATTEMPTS: '2' },
  });

  const result = await runtime.aiBoundary.execute({
    taskId: 'teaching.test.structured',
    responsibilityKey: 'teaching.test.structured',
    capabilityId: 'teaching.test.structured',
    intelligenceClass: 'DIRECT_AI',
    authorityLevel: 'T2',
    authoritativeOwner: 'TEST_OWNER',
    schemaValidator: async (value) => value?.ok === true,
    domainValidator: async () => true,
  });

  assert.equal(aiCalls, 2);
  assert.equal(result.accepted, true);
  assert.equal(result.modelMetadata.validationRetryCount, 1);
  assert.equal(result.modelMetadata.totalTokens, 15);
  assert(queries.some(({ sql }) => sql.includes('ai_execution_audit')));
});
