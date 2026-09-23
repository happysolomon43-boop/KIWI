'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { createProjectPool } = require('../../services/ai/project-pool');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function pool() {
  return createProjectPool({
    slots: [
      { id: 'p1', index: 1, envName: 'K1', apiKey: 'key-1' },
      { id: 'p2', index: 2, envName: 'K2', apiKey: 'key-2' },
    ],
  });
}

function successRaw(text = 'ok') {
  return {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text }] },
    }],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      thoughtsTokenCount: 2,
      totalTokenCount: 17,
    },
  };
}

const quietLogger = { warn() {} };

test('VVIP main CBT starts on newest Flash with HIGH thinking', async () => {
  const calls = [];
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate(args) {
        calls.push(args);
        return { raw: successRaw('exam'), latencyMs: 50, httpStatus: 200 };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', {
    content: 'generate exam',
    generationConfig: { maxOutputTokens: 24000 },
  });

  assert.equal(result.text, 'exam');
  assert.equal(result.requestedModel, 'gemini-3.8-flash');
  assert.equal(result.projectSlot, 'p1');
  assert.equal(result.requestedReasoning, 'HIGH');
  assert.equal(result.resolvedReasoning, 'HIGH');
  assert.equal(calls[0].generationConfig.thinkingConfig.thinkingLevel, 'high');
  assert.equal(calls[0].generationConfig.maxOutputTokens, 24000);
});

test('exhausting a model across project slots falls to next model and restarts its own pool', async () => {
  const calls = [];
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, apiKey: args.apiKey });
        if (args.modelId === 'gemini-3.8-flash') {
          throw new AIError('daily exhausted', {
            code: AI_ERROR_CODES.RATE_LIMIT_RPD,
            status: 429,
            retryable: true,
            scope: 'MODEL_SLOT',
          });
        }
        return { raw: successRaw('fallback'), latencyMs: 20, httpStatus: 200 };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'exam' });

  assert.deepEqual(calls, [
    { modelId: 'gemini-3.8-flash', apiKey: 'key-1' },
    { modelId: 'gemini-3.8-flash', apiKey: 'key-2' },
    { modelId: 'gemini-3.7-flash', apiKey: 'key-1' },
  ]);
  assert.equal(result.requestedModel, 'gemini-3.7-flash');
  assert.equal(result.projectSlot, 'p1');
  assert.equal(result.fallbackDepth, 1);
  assert.equal(result.attempts, 3);
});

test('model-not-found skips remaining keys for that model', async () => {
  const calls = [];
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, apiKey: args.apiKey });
        if (args.modelId === 'gemini-3.8-flash') {
          throw new AIError('gone', {
            code: AI_ERROR_CODES.MODEL_NOT_FOUND,
            status: 404,
            retryable: false,
            scope: 'MODEL',
          });
        }
        return { raw: successRaw('next-model'), latencyMs: 10, httpStatus: 200 };
      },
    },
  });

  await ai.run('MAIN_CBT', { content: 'exam' });

  assert.deepEqual(calls, [
    { modelId: 'gemini-3.8-flash', apiKey: 'key-1' },
    { modelId: 'gemini-3.7-flash', apiKey: 'key-1' },
  ]);
});

test('bad request fails immediately instead of burning the key pool', async () => {
  let count = 0;
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate() {
        count++;
        throw new AIError('invalid config', {
          code: AI_ERROR_CODES.BAD_REQUEST,
          status: 400,
          retryable: false,
          scope: 'REQUEST',
        });
      },
    },
  });

  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'exam' }),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );
  assert.equal(count, 1);
});

test('feature code cannot inject provider-specific thinking config', async () => {
  let called = false;
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate() {
        called = true;
        return { raw: successRaw(), latencyMs: 1, httpStatus: 200 };
      },
    },
  });

  await assert.rejects(
    ai.run('CARD_EXPLANATION', {
      content: 'explain',
      generationConfig: {
        thinkingConfig: { thinkingLevel: 'high' },
      },
    }),
    (error) => error.code === AI_ERROR_CODES.CONFIG
  );

  assert.equal(called, false);
});

test('safety blocks are not retried on another model or key', async () => {
  let count = 0;
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate() {
        count++;
        return {
          raw: {
            promptFeedback: { blockReason: 'SAFETY' },
            candidates: [],
          },
          latencyMs: 1,
          httpStatus: 200,
        };
      },
    },
  });

  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'exam' }),
    (error) => error.code === AI_ERROR_CODES.SAFETY
  );

  assert.equal(count, 1);
});

test('planning is secret-free and supports generation affinity', () => {
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: { async generate() { throw new Error('not used'); } },
  });

  const plan = ai.plan('MAIN_CBT', {
    preferredModelId: 'gemini-3.7-flash',
  });
  const serialized = JSON.stringify(plan);

  assert.deepEqual(plan.candidates.map((entry) => entry.modelId), [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ]);
  assert.doesNotMatch(serialized, /key-1|key-2/);
});


test('generation-group affinity keeps completion passes at the fallback model ceiling', async () => {
  const calls = [];
  let mainRequest = true;
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, apiKey: args.apiKey });
        if (mainRequest && args.modelId === 'gemini-3.8-flash') {
          throw new AIError('daily exhausted', {
            code: AI_ERROR_CODES.RATE_LIMIT_RPD,
            status: 429,
            retryable: true,
            scope: 'MODEL_SLOT',
          });
        }
        return { raw: successRaw(mainRequest ? 'main' : 'completion'), latencyMs: 10, httpStatus: 200 };
      },
    },
  });

  const main = await ai.run(
    'MAIN_CBT',
    { content: 'exam' },
    { generationGroupId: 'exam-123' }
  );
  assert.equal(main.requestedModel, 'gemini-3.7-flash');

  mainRequest = false;
  calls.length = 0;

  const completion = await ai.run(
    'CBT_COMPLETION',
    { content: 'repair' },
    { generationGroupId: 'exam-123' }
  );

  assert.equal(completion.requestedModel, 'gemini-3.7-flash');
  assert.equal(calls[0].modelId, 'gemini-3.7-flash');
  assert.ok(calls.every((call) => call.modelId !== 'gemini-3.8-flash'));
});


test('parallel workflow successes cannot upgrade affinity after a fallback', async () => {
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate(args) {
        return { raw: successRaw(args.modelId), latencyMs: 1, httpStatus: 200 };
      },
    },
  });

  const task = ai.router.getTask('MAIN_CBT');
  // Simulate two split-generation branches finishing out of order:
  // one branch falls back to 3.7, then a slower 3.8 branch succeeds.
  ai.generationAffinity.set('ASSESSMENT_GENERATION::exam-parallel', {
    modelId: 'gemini-3.7-flash',
    updatedAt: Date.now(),
  });

  const result = await ai.run(
    'CBT_COMPLETION',
    { content: 'repair' },
    { generationGroupId: 'exam-parallel' }
  );

  assert.equal(task.affinityGroup, 'ASSESSMENT_GENERATION');
  assert.equal(result.requestedModel, 'gemini-3.7-flash');
  assert.equal(
    ai.generationAffinity.get('ASSESSMENT_GENERATION::exam-parallel').modelId,
    'gemini-3.7-flash'
  );
});


test('single provider overload probes another project before degrading the model', async () => {
  const calls = [];
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, apiKey: args.apiKey });
        if (args.modelId === 'gemini-3.8-flash' && args.apiKey === 'key-1') {
          throw new AIError('provider overloaded', {
            code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
            status: 503,
            retryable: true,
            scope: 'PROVIDER_MODEL',
          });
        }
        return { raw: successRaw('healthy sibling project'), latencyMs: 10, httpStatus: 200 };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'exam' });

  assert.equal(result.requestedModel, 'gemini-3.8-flash');
  assert.equal(result.projectSlot, 'p2');
  assert.deepEqual(calls, [
    { modelId: 'gemini-3.8-flash', apiKey: 'key-1' },
    { modelId: 'gemini-3.8-flash', apiKey: 'key-2' },
  ]);
  assert.equal(ai.transientModelHealth.cooldownUntil('gemini-3.8-flash'), null);
});

test('independent provider overloads open a short model circuit and recover automatically', async () => {
  const calls = [];
  let now = Date.parse('2026-09-22T18:44:00Z');
  let overload38 = true;
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    clock: () => now,
    env: {
      AI_MODEL_TRANSIENT_FAILURE_SLOTS: '2',
      AI_MODEL_TRANSIENT_COOLDOWN_MS: '20000',
    },
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, apiKey: args.apiKey });
        if (overload38 && args.modelId === 'gemini-3.8-flash') {
          throw new AIError('provider overloaded', {
            code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
            status: 503,
            retryable: true,
            scope: 'PROVIDER_MODEL',
          });
        }
        return { raw: successRaw('fallback-fast'), latencyMs: 10, httpStatus: 200 };
      },
    },
  });

  const first = await ai.run('MAIN_CBT', { content: 'exam' });
  assert.equal(first.requestedModel, 'gemini-3.7-flash');
  assert.deepEqual(calls.slice(0, 3), [
    { modelId: 'gemini-3.8-flash', apiKey: 'key-1' },
    { modelId: 'gemini-3.8-flash', apiKey: 'key-2' },
    { modelId: 'gemini-3.7-flash', apiKey: 'key-1' },
  ]);
  assert.ok(ai.transientModelHealth.cooldownUntil('gemini-3.8-flash'));

  calls.length = 0;
  const second = await ai.run('MAIN_CBT', { content: 'exam 2' });
  assert.equal(second.requestedModel, 'gemini-3.7-flash');
  assert.ok(calls.every((call) => call.modelId !== 'gemini-3.8-flash'));

  now += 20001;
  overload38 = false;
  calls.length = 0;
  const third = await ai.run('MAIN_CBT', { content: 'exam 3' });
  assert.equal(third.requestedModel, 'gemini-3.8-flash');
  assert.equal(calls[0].modelId, 'gemini-3.8-flash');
});

test('open transient circuits report provider overload instead of false capacity exhaustion', async () => {
  let providerCalls = 0;
  const ai = createAIOrchestrator({
    projectPool: pool(),
    logger: quietLogger,
    transport: {
      async generate() {
        providerCalls += 1;
        return { raw: successRaw('not expected'), latencyMs: 1, httpStatus: 200 };
      },
    },
  });

  const overload = new AIError('provider overloaded', {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    status: 503,
    retryable: true,
    scope: 'PROVIDER_MODEL',
  });
  for (const modelId of [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ]) {
    ai.transientModelHealth.recordFailure(modelId, 'p1', overload);
    ai.transientModelHealth.recordFailure(modelId, 'p2', overload);
  }

  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'exam' }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
      assert.equal(error.retryable, true);
      assert.equal(error.details.hasPersistentCapacity, true);
      assert.equal(error.details.attempts.length, 0);
      return true;
    }
  );

  assert.equal(providerCalls, 0);
});

test('capacity exhausted is reserved for genuinely unroutable project-model capacity', async () => {
  let providerCalls = 0;
  const ai = createAIOrchestrator({
    projectPool: pool(),
    quotaManager: {
      filterEligibleSlots() { return []; },
      async markSuccess() {},
      async markFailure() {},
    },
    logger: quietLogger,
    transport: {
      async generate() {
        providerCalls += 1;
        return { raw: successRaw('not expected'), latencyMs: 1, httpStatus: 200 };
      },
    },
  });

  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'exam' }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.CAPACITY_EXHAUSTED);
      assert.equal(error.details.hasPersistentCapacity, false);
      assert.equal(error.details.attempts.length, 0);
      return true;
    }
  );

  assert.equal(providerCalls, 0);
});

test('VVIP quota rotation is bounded across a large project pool', async () => {
  const manySlots = createProjectPool({
    slots: Array.from({ length: 15 }, (_, index) => ({
      id: `p${index + 1}`,
      index: index + 1,
      envName: `K${index + 1}`,
      apiKey: `key-${index + 1}`,
    })),
  });

  let calls = 0;
  const ai = createAIOrchestrator({
    projectPool: manySlots,
    logger: quietLogger,
    transport: {
      async generate() {
        calls += 1;
        throw new AIError('rate limited', {
          code: AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
          status: 429,
          retryable: true,
          scope: 'MODEL_SLOT',
        });
      },
    },
  });

  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'exam' }),
    (error) => {
      assert.equal(error.details.maxAttempts, 32);
      assert.equal(error.details.maxQuotaAttemptsPerModel, 15);
      assert.equal(error.details.attempts.length, 32);
      return true;
    }
  );

  assert.equal(calls, 32);
});

test('quota failures rotate beyond two project keys before degrading the model', async () => {
  const threeSlots = createProjectPool({
    slots: [
      { id: 'p1', index: 1, envName: 'K1', apiKey: 'key-1' },
      { id: 'p2', index: 2, envName: 'K2', apiKey: 'key-2' },
      { id: 'p3', index: 3, envName: 'K3', apiKey: 'key-3' },
    ],
  });
  const calls = [];
  const ai = createAIOrchestrator({
    projectPool: threeSlots,
    logger: quietLogger,
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, apiKey: args.apiKey });
        if (args.apiKey !== 'key-3') {
          throw new AIError('project quota exhausted', {
            code: AI_ERROR_CODES.RATE_LIMIT_RPD,
            status: 429,
            retryable: true,
            scope: 'MODEL_SLOT',
          });
        }
        return { raw: successRaw('healthy third project'), latencyMs: 5, httpStatus: 200 };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'exam' });
  assert.equal(result.requestedModel, 'gemini-3.8-flash');
  assert.deepEqual(calls, [
    { modelId: 'gemini-3.8-flash', apiKey: 'key-1' },
    { modelId: 'gemini-3.8-flash', apiKey: 'key-2' },
    { modelId: 'gemini-3.8-flash', apiKey: 'key-3' },
  ]);
});

test('provider overload uses a bounded sibling-slot probe before model fallback', async () => {
  const threeSlots = createProjectPool({
    slots: [
      { id: 'p1', index: 1, envName: 'K1', apiKey: 'key-1' },
      { id: 'p2', index: 2, envName: 'K2', apiKey: 'key-2' },
      { id: 'p3', index: 3, envName: 'K3', apiKey: 'key-3' },
    ],
  });
  const calls = [];
  const ai = createAIOrchestrator({
    projectPool: threeSlots,
    logger: quietLogger,
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, apiKey: args.apiKey });
        if (args.modelId === 'gemini-3.8-flash') {
          throw new AIError('provider overloaded', {
            code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
            status: 503,
            retryable: true,
            scope: 'PROVIDER_MODEL',
          });
        }
        return { raw: successRaw('fallback model'), latencyMs: 5, httpStatus: 200 };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'exam' });
  assert.equal(result.requestedModel, 'gemini-3.7-flash');
  assert.equal(calls.filter((call) => call.modelId === 'gemini-3.8-flash').length, 2);
  assert.deepEqual(calls.slice(0, 3), [
    { modelId: 'gemini-3.8-flash', apiKey: 'key-1' },
    { modelId: 'gemini-3.8-flash', apiKey: 'key-2' },
    { modelId: 'gemini-3.7-flash', apiKey: 'key-1' },
  ]);
});

