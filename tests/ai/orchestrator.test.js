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
