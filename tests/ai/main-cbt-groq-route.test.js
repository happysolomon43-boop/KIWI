'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createModelCatalog,
  GROQ_MODEL_IDS,
} = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');
const { createProjectPool } = require('../../services/ai/project-pool');
const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');
const { AI_TASKS } = require('../../services/ai/task-registry');
const {
  MAIN_CBT_PROVIDER_MODE_ENV,
  MAIN_CBT_GROQ_MODEL_ID,
  MAIN_CBT_GROQ_REASONING,
  MAIN_CBT_GROQ_MAX_COMPLETION_TOKENS,
  MAIN_CBT_GROQ_ATTEMPT_TIMEOUT_MS,
  MAIN_CBT_GROQ_OPERATION_TIMEOUT_MS,
} = require('../../services/ai/routing-policy');

function routerFor(env = {}) {
  return createModelRouter({
    catalog: createModelCatalog(),
    env: {
      AI_TEXT_PROVIDER_MODE: 'GROQ_FIRST',
      ...env,
    },
  });
}

function googleSuccess(modelId, text = 'ok') {
  return {
    latencyMs: 1,
    raw: {
      modelVersion: modelId,
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [{ text }] },
      }],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    },
  };
}

function groqSuccess(modelId, text = 'ok') {
  return {
    latencyMs: 1,
    raw: {
      __kiwiExecutionResponse: {
        provider: AI_PROVIDERS.GROQ,
        requestedModel: modelId,
        providerModel: modelId,
        text,
        structuredData: null,
        finishReason: 'STOP',
        blocked: false,
        blockReason: null,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          thoughtTokens: 1,
          totalTokens: 3,
        },
        latencyMs: 1,
        credentialSlot: 'groq-key-01',
        fallbackDepth: 0,
        generationGroupId: null,
        providerMetadata: {},
      },
    },
  };
}

test('Main CBT stays Google-only unless its dedicated provider switch is explicitly enabled', () => {
  const router = routerFor();
  const requirement = router.describeRequirement('MAIN_CBT');
  const candidates = router.resolveCandidates('MAIN_CBT');

  assert.equal(requirement.providerMode, 'GOOGLE_ONLY');
  assert.equal(requirement.requiredQualityTier, 'HIGH_STAKES');
  assert.equal(requirement.routeOverride, null);
  assert.equal(requirement.providerReasoning.GOOGLE, 'HIGH');
  assert.equal(requirement.providerReasoning.GROQ, 'HIGH');
  assert.ok(candidates.every((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE));
  assert.ok(candidates.every((candidate) => candidate.requestedReasoning === 'HIGH'));
});

test('explicit Main CBT activation routes only Qwen 3.8 at HIGH reasoning with the full controlled budget', () => {
  const router = routerFor({
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GROQ_FIRST',
  });
  const requirement = router.describeRequirement('MAIN_CBT');
  const candidates = router.resolveCandidates('MAIN_CBT');

  assert.equal(AI_TASKS.MAIN_CBT.reasoning, 'HIGH');
  assert.equal(requirement.assessmentProtected, true);
  assert.equal(requirement.providerMode, 'GROQ_FIRST');
  assert.equal(requirement.requiredQualityTier, 'PREMIUM');
  assert.deepEqual(requirement.allowedGroqModelIds, [GROQ_MODEL_IDS.QWEN_3_8_27B]);
  assert.equal(requirement.providerReasoning.GROQ, MAIN_CBT_GROQ_REASONING);
  assert.equal(requirement.providerReasoning.GROQ, 'HIGH');
  assert.equal(requirement.providerReasoning.GOOGLE, 'HIGH');
  assert.equal(requirement.routeOverride.scope, 'MAIN_CBT');
  assert.equal(requirement.routeOverride.modelId, MAIN_CBT_GROQ_MODEL_ID);
  assert.equal(requirement.routeOverride.reasoning, 'HIGH');
  assert.equal(requirement.routeOverride.maxCompletionTokens, MAIN_CBT_GROQ_MAX_COMPLETION_TOKENS);
  assert.equal(requirement.routeOverride.attemptTimeoutMs, MAIN_CBT_GROQ_ATTEMPT_TIMEOUT_MS);
  assert.equal(requirement.routeOverride.operationTimeoutMs, MAIN_CBT_GROQ_OPERATION_TIMEOUT_MS);

  assert.equal(candidates[0].provider, AI_PROVIDERS.GROQ);
  assert.equal(candidates[0].modelId, GROQ_MODEL_IDS.QWEN_3_8_27B);
  assert.equal(candidates[0].requestedReasoning, 'HIGH');
  assert.equal(candidates[0].resolvedReasoning, 'HIGH');
  assert.equal(candidates[0].routeGenerationConfig.maxCompletionTokens, 16384);
  assert.equal(candidates[0].routeAttemptTimeoutMs, 75000);
  assert.equal(candidates[0].routeOperationTimeoutMs, 180000);
  assert.equal(candidates.some((candidate) => candidate.modelId === GROQ_MODEL_IDS.GPT_OSS_120B), false);
  assert.equal(candidates.some((candidate) => candidate.modelId === GROQ_MODEL_IDS.GPT_OSS_20B), false);

  const googleFallback = candidates.slice(1).find(
    (candidate) => candidate.provider === AI_PROVIDERS.GOOGLE
  );
  assert.ok(googleFallback);
  assert.equal(googleFallback.modelId, 'gemini-3.8-flash');
  assert.equal(googleFallback.requestedReasoning, 'HIGH');
  assert.equal(googleFallback.resolvedReasoning, 'HIGH');
  assert.deepEqual(googleFallback.routeGenerationConfig, {});
  assert.equal(googleFallback.routeAttemptTimeoutMs, null);
  assert.equal(googleFallback.routeOperationTimeoutMs, null);
});

test('Qwen 3.8 controlled preview cannot leak into ordinary Groq text routes', () => {
  const router = routerFor({
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GROQ_FIRST',
  });
  const ordinary = router.resolveCandidates('QUICK_QUESTIONS');

  assert.equal(
    ordinary.some((candidate) => candidate.modelId === GROQ_MODEL_IDS.QWEN_3_8_27B),
    false
  );
  assert.equal(ordinary[0].modelId, GROQ_MODEL_IDS.GPT_OSS_120B);
});

test('Main CBT activation does not migrate Reckoning, CBT completion or question audit', () => {
  const router = routerFor({
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GROQ_FIRST',
  });

  for (const taskId of ['RECKONING_CBT', 'CBT_COMPLETION', 'CBT_QUESTION_AUDIT']) {
    const requirement = router.describeRequirement(taskId);
    const candidates = router.resolveCandidates(taskId);
    assert.equal(requirement.providerMode, 'GOOGLE_ONLY', taskId);
    assert.equal(requirement.requiredQualityTier, 'HIGH_STAKES', taskId);
    assert.equal(requirement.routeOverride, null, taskId);
    assert.equal(requirement.providerReasoning.GOOGLE, 'HIGH', taskId);
    assert.ok(candidates.every((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE), taskId);
  }
});

test('Main CBT GOOGLE_ONLY rollback restores the exact legacy Google chain and HIGH reasoning', () => {
  const router = routerFor({
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GOOGLE_ONLY',
  });
  const candidates = router.resolveCandidates('MAIN_CBT');

  assert.deepEqual(
    candidates.map((candidate) => candidate.modelId),
    [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
    ]
  );
  assert.ok(candidates.every((candidate) => candidate.requestedReasoning === 'HIGH'));
});

test('Main CBT sends Qwen the full token budget and extended attempt timeout through the central orchestrator', async () => {
  const env = {
    AI_TEXT_PROVIDER_MODE: 'GROQ_FIRST',
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GROQ_FIRST',
    GEMINI_API_KEY: 'google-secret',
    GROQ_API_KEY: 'groq-secret',
  };
  const catalog = createModelCatalog();
  const router = createModelRouter({ catalog, env });
  const projectPool = createProjectPool({ env });
  const attempts = [];

  const transport = {
    async generate(args) {
      attempts.push(args);
      if (args.modelId === GROQ_MODEL_IDS.QWEN_3_8_27B) {
        return groqSuccess(args.modelId, 'qwen-budget-ok');
      }
      return googleSuccess(args.modelId, 'unexpected-fallback');
    },
    async listModels() { return []; },
  };

  const orchestrator = createAIOrchestrator({
    registry: AI_TASKS,
    catalog,
    router,
    projectPool,
    transport,
    env,
  });

  const result = await orchestrator.run('MAIN_CBT', {
    prompt: 'generate controlled exam sample',
    generationConfig: { maxCompletionTokens: 1024 },
  });

  assert.equal(result.text, 'qwen-budget-ok');
  assert.equal(result.provider, AI_PROVIDERS.GROQ);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].modelId, GROQ_MODEL_IDS.QWEN_3_8_27B);
  assert.equal(attempts[0].generationConfig.reasoning.requested, 'HIGH');
  assert.equal(attempts[0].generationConfig.reasoning.resolved, 'HIGH');
  assert.equal(attempts[0].generationConfig.maxCompletionTokens, 16384);
  assert.equal(attempts[0].timeoutMs, 75000);
});

test('Main CBT centrally falls from Qwen 3.8 to Gemini when Groq is unavailable', async () => {
  const env = {
    AI_TEXT_PROVIDER_MODE: 'GROQ_FIRST',
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GROQ_FIRST',
    GEMINI_API_KEY: 'google-secret',
    GROQ_API_KEY: 'groq-secret',
  };
  const catalog = createModelCatalog();
  const router = createModelRouter({ catalog, env });
  const projectPool = createProjectPool({ env });
  const attempted = [];

  const transport = {
    async generate({ modelId }) {
      attempted.push(modelId);
      if (modelId === GROQ_MODEL_IDS.QWEN_3_8_27B) {
        throw new AIError('synthetic Groq outage', {
          code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
          status: 503,
          retryable: true,
          scope: 'PROVIDER_MODEL',
          provider: AI_PROVIDERS.GROQ,
        });
      }
      return googleSuccess(modelId, 'main-cbt-fallback-ok');
    },
    async listModels() { return []; },
  };

  const orchestrator = createAIOrchestrator({
    registry: AI_TASKS,
    catalog,
    router,
    projectPool,
    transport,
    env,
  });

  const result = await orchestrator.run('MAIN_CBT', { prompt: 'generate controlled exam sample' });
  assert.equal(result.text, 'main-cbt-fallback-ok');
  assert.equal(result.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(attempted[0], GROQ_MODEL_IDS.QWEN_3_8_27B);
  assert.ok(attempted.slice(1).some((modelId) => modelId.startsWith('gemini-')));
});
