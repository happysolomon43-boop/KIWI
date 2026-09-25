'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { createProjectPool } = require('../../services/ai/project-pool');
const { createOperationBudget } = require('../../services/ai/operation-budget');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function pool(count = 2) {
  return createProjectPool({
    slots: Array.from({ length: count }, (_, index) => ({
      id: `p${index + 1}`,
      index: index + 1,
      envName: `K${index + 1}`,
      apiKey: `key-${index + 1}`,
    })),
  });
}

function successRaw(text = 'ok') {
  return {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text }] },
    }],
    usageMetadata: {
      promptTokenCount: 3,
      candidatesTokenCount: 2,
      totalTokenCount: 5,
    },
  };
}

const quietLogger = { warn() {}, log() {} };

test('route contention is retryable ORCHESTRATOR_BUSY, never CAPACITY_EXHAUSTED', async () => {
  let providerCalls = 0;
  const routeScheduler = {
    orderSlots(_modelId, slots) { return slots; },
    async acquire() {
      return {
        available: false,
        reason: 'DISTRIBUTED_ROUTE_BUSY',
        pacingWaitMs: 0,
      };
    },
    async recordSuccess() {},
    async recordFailure() {},
    snapshot() { return {}; },
  };

  const ai = createAIOrchestrator({
    projectPool: pool(2),
    routeScheduler,
    logger: quietLogger,
    transport: {
      async generate() {
        providerCalls += 1;
        return { raw: successRaw(), latencyMs: 1, httpStatus: 200 };
      },
    },
  });

  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'route contention' }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.ORCHESTRATOR_BUSY);
      assert.equal(error.retryable, true);
      assert.equal(error.scope, 'ORCHESTRATOR');
      assert.equal(error.details.hadEligibleRoute, true);
      assert.equal(error.details.blockedOnlyByRouteContention, true);
      assert.equal(error.details.attempts.length, 0);
      return true;
    }
  );

  assert.equal(providerCalls, 0);
});

test('shared operation budget prevents a second provider wave for the same generation group', async () => {
  let providerCalls = 0;
  const operationBudget = createOperationBudget({
    env: {
      AI_VVIP_OPERATION_MAX_PROVIDER_ATTEMPTS: '1',
      AI_VVIP_OPERATION_MAX_AVAILABILITY_FAILURES: '10',
      AI_VVIP_OPERATION_MAX_SHORT_RATE_FAILURES: '10',
      AI_VVIP_OPERATION_MAX_PROVIDER_OVERLOAD_FAILURES: '10',
    },
  });

  const ai = createAIOrchestrator({
    projectPool: pool(2),
    operationBudget,
    logger: quietLogger,
    transport: {
      async generate() {
        providerCalls += 1;
        return {
          raw: successRaw('first'),
          latencyMs: 1,
          httpStatus: 200,
        };
      },
    },
  });

  const first = await ai.run(
    'MAIN_CBT',
    { content: 'first' },
    { generationGroupId: 'shared-operation' }
  );
  assert.equal(first.text, 'first');

  await assert.rejects(
    ai.run(
      'CBT_COMPLETION',
      { content: 'second' },
      { generationGroupId: 'shared-operation' }
    ),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.OPERATION_BUDGET_EXHAUSTED);
      assert.equal(error.retryable, false);
      assert.equal(error.scope, 'OPERATION');
      assert.equal(error.details.retryAuthority, 'ORCHESTRATOR');
      return true;
    }
  );

  assert.equal(providerCalls, 1);
});

test('failed-attempt telemetry carries sanitized provider evidence and route state', async () => {
  const attempts = [];
  const telemetry = {
    async beginRequest() {
      return '11111111-1111-4111-8111-111111111111';
    },
    async recordAttempt(record) {
      attempts.push(record);
    },
    async finishRequest() {},
  };
  let calls = 0;

  const ai = createAIOrchestrator({
    projectPool: pool(2),
    telemetry,
    logger: quietLogger,
    transport: {
      async generate() {
        calls += 1;
        if (calls === 1) {
          throw new AIError('rpm', {
            code: AI_ERROR_CODES.RATE_LIMIT_RPM,
            status: 429,
            retryable: true,
            scope: 'MODEL_SLOT',
            retryAfterMs: 1000,
            providerEvidence: {
              providerStatus: 'RESOURCE_EXHAUSTED',
              quotaDimension: 'RPM',
              quotaMetric: 'generate_requests',
              quotaLimitName: 'GenerateRequestsPerMinutePerProjectPerModel',
              quotaLimitValue: 20,
              classificationSource: 'STRUCTURED_QUOTA',
            },
          });
        }
        return { raw: successRaw('recovered'), latencyMs: 1, httpStatus: 200 };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'telemetry' });
  assert.equal(result.text, 'recovered');

  const failed = attempts.find((attempt) => attempt.outcome === 'FAILED');
  assert.ok(failed);
  assert.equal(failed.quotaDimension, 'RPM');
  assert.equal(failed.quotaLimitValue, 20);
  assert.equal(failed.classificationSource, 'STRUCTURED_QUOTA');
  assert.equal(failed.routeStateBefore, 'READY');
  assert.ok(failed.operationId);
  assert.equal(failed.operationAttemptNumber, 1);
  assert.doesNotMatch(JSON.stringify(failed), /key-1|prompt|study notes/i);
});
