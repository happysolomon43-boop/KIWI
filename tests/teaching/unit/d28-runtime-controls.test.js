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
    aiRun: async () => ({
      ok: ++aiCalls >= 2,
      modelId: 'central-model',
      provider: 'central-provider',
      routeKey: 'central-route',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }),
    env: { TEACHING_D28_AI_VALIDATION_ATTEMPTS: '2' },
  });

  const result = await runtime.aiBoundary.execute({
    taskId: 'teaching.test.structured',
    responsibilityKey: 'teaching.test.structured',
    capabilityId: 'teaching.test.structured',
    intelligenceClass: 'DIRECT-AI',
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


test('D28 does not repeat deterministic domain rejection and preserves repair metadata', async () => {
  let aiCalls = 0;
  const runtime = createTeachingRuntimePlatform({
    query: async () => ({ rows: [] }),
    randomUUID: (() => {
      let n = 0;
      return () => `d28-domain-${++n}`;
    })(),
    aiRun: async () => {
      aiCalls += 1;
      return {
        structured: { classification: 'candidate' },
        modelId: 'central-model',
        provider: 'central-provider',
        routeKey: 'central-route',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
    env: { TEACHING_D28_AI_VALIDATION_ATTEMPTS: '3' },
  });

  const result = await runtime.aiBoundary.execute({
    taskId: 'teaching.test.domain-rejection',
    responsibilityKey: 'teaching.test.domain-rejection',
    capabilityId: 'teaching.test.domain-rejection',
    intelligenceClass: 'DIRECT-AI',
    authorityLevel: 'T2',
    authoritativeOwner: 'TEST_OWNER',
    schemaValidator: async (value) => ({ ok: true, value }),
    domainValidator: async () => ({ ok: false, reason: 'TEST_DOMAIN_REJECTION' }),
  });

  assert.equal(aiCalls, 1);
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, 'TEST_DOMAIN_REJECTION');
  assert.equal(result.validationStage, 'domain');
  assert.equal(result.validationFailure.kind, 'VALIDATION_REJECTION');
  assert.equal(result.validationFailure.retryable, false);
  assert.equal(result.validationFailure.repairable, 'TARGETED_REPAIR');
  assert.equal(result.modelMetadata.validationRetryCount, 0);
});
