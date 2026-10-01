'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createModelCatalog } = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');
const { createProjectPool } = require('../../services/ai/project-pool');
const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');
const { AI_TASKS } = require('../../services/ai/task-registry');
const {
  MAIN_CBT_PROVIDER_MODE_ENV,
  MAIN_CBT_MODEL_OVERRIDE_ENV,
  MAIN_CBT_GEMINI_LITE_MODEL_ID,
  MAIN_CBT_GEMINI_LITE_REASONING,
  MAIN_CBT_GEMINI_LITE_MAX_COMPLETION_TOKENS,
  MAIN_CBT_GEMINI_LITE_ATTEMPT_TIMEOUT_MS,
  MAIN_CBT_GEMINI_LITE_OPERATION_TIMEOUT_MS,
} = require('../../services/ai/routing-policy');

function envForLite(extra = {}) {
  return {
    AI_TEXT_PROVIDER_MODE: 'GROQ_FIRST',
    // Deliberately leave the old Groq experiment switch enabled here. The
    // scoped Gemini override must win so stale deployment config cannot put
    // Qwen back in front of the requested test model.
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GROQ_FIRST',
    [MAIN_CBT_MODEL_OVERRIDE_ENV]: MAIN_CBT_GEMINI_LITE_MODEL_ID,
    ...extra,
  };
}

function routerFor(extra = {}) {
  const env = envForLite(extra);
  return createModelRouter({
    catalog: createModelCatalog(),
    env,
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

test('Main CBT Gemini 3.5 Lite override wins over stale Groq activation and preserves HIGH reasoning', () => {
  const router = routerFor();
  const requirement = router.describeRequirement('MAIN_CBT');
  const candidates = router.resolveCandidates('MAIN_CBT');

  assert.equal(AI_TASKS.MAIN_CBT.reasoning, 'HIGH');
  assert.equal(requirement.assessmentProtected, true);
  assert.equal(requirement.providerMode, 'GOOGLE_ONLY');
  assert.equal(requirement.requiredQualityTier, 'HIGH_STAKES');
  assert.equal(requirement.allowedGroqModelIds, null);
  assert.deepEqual(requirement.allowedGoogleModelIds, [MAIN_CBT_GEMINI_LITE_MODEL_ID]);
  assert.equal(requirement.providerReasoning.GOOGLE, 'HIGH');
  assert.equal(requirement.routeOverride.scope, 'MAIN_CBT');
  assert.equal(requirement.routeOverride.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(requirement.routeOverride.modelId, MAIN_CBT_GEMINI_LITE_MODEL_ID);
  assert.equal(requirement.routeOverride.reasoning, MAIN_CBT_GEMINI_LITE_REASONING);
  assert.equal(requirement.routeOverride.maxCompletionTokens, MAIN_CBT_GEMINI_LITE_MAX_COMPLETION_TOKENS);
  assert.equal(requirement.routeOverride.attemptTimeoutMs, MAIN_CBT_GEMINI_LITE_ATTEMPT_TIMEOUT_MS);
  assert.equal(requirement.routeOverride.operationTimeoutMs, MAIN_CBT_GEMINI_LITE_OPERATION_TIMEOUT_MS);

  assert.deepEqual(
    candidates.map((candidate) => candidate.modelId),
    [
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
    ]
  );
  assert.equal(candidates[0].provider, AI_PROVIDERS.GOOGLE);
  assert.equal(candidates[0].requestedReasoning, 'HIGH');
  assert.equal(candidates[0].resolvedReasoning, 'HIGH');
  assert.equal(candidates[0].routeGenerationConfig.maxOutputTokens, 16384);
  assert.equal(candidates[0].routeGenerationConfig.maxCompletionTokens, undefined);
  assert.equal(candidates[0].routeAttemptTimeoutMs, 75000);
  assert.equal(candidates[0].routeOperationTimeoutMs, 180000);
});

test('Main CBT Gemini Lite override does not migrate Reckoning, completion, or audit routes', () => {
  const router = routerFor();

  for (const taskId of ['RECKONING_CBT', 'CBT_COMPLETION', 'CBT_QUESTION_AUDIT']) {
    const requirement = router.describeRequirement(taskId);
    const candidates = router.resolveCandidates(taskId);
    assert.equal(requirement.providerMode, 'GOOGLE_ONLY', taskId);
    assert.equal(requirement.routeOverride, null, taskId);
    assert.equal(requirement.allowedGoogleModelIds, null, taskId);
    assert.equal(candidates[0].modelId, 'gemini-3.8-flash', taskId);
  }
});

test('Main CBT sends Gemini 3.5 Lite HIGH reasoning and the controlled test budget through the orchestrator', async () => {
  const env = envForLite({
    GEMINI_API_KEY: 'google-secret',
    GROQ_API_KEY: 'groq-secret',
  });
  const catalog = createModelCatalog();
  const router = createModelRouter({ catalog, env });
  const projectPool = createProjectPool({ env });
  const attempts = [];

  const transport = {
    async generate(args) {
      attempts.push(args);
      return googleSuccess(args.modelId, 'gemini-lite-main-cbt-ok');
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
    generationConfig: { maxOutputTokens: 1024 },
  });

  assert.equal(result.text, 'gemini-lite-main-cbt-ok');
  assert.equal(result.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].modelId, MAIN_CBT_GEMINI_LITE_MODEL_ID);
  assert.equal(attempts[0].generationConfig.maxOutputTokens, 16384);
  assert.equal(attempts[0].generationConfig.maxCompletionTokens, undefined);
  assert.equal(attempts[0].timeoutMs, 75000);
  assert.ok(attempts[0].generationConfig.thinkingConfig);
});

test('Main CBT falls from Gemini 3.5 Lite to the accepted stronger Gemini chain on availability failure', async () => {
  const env = envForLite({
    GEMINI_API_KEY: 'google-secret',
  });
  const catalog = createModelCatalog();
  const router = createModelRouter({ catalog, env });
  const projectPool = createProjectPool({ env });
  const attempted = [];

  const transport = {
    async generate({ modelId }) {
      attempted.push(modelId);
      if (modelId === MAIN_CBT_GEMINI_LITE_MODEL_ID) {
        throw new AIError('synthetic Lite outage', {
          code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
          status: 503,
          retryable: true,
          scope: 'PROVIDER_MODEL',
          provider: AI_PROVIDERS.GOOGLE,
        });
      }
      return googleSuccess(modelId, 'gemini-fallback-ok');
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
  });

  assert.equal(result.text, 'gemini-fallback-ok');
  assert.equal(result.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(attempted[0], MAIN_CBT_GEMINI_LITE_MODEL_ID);
  assert.equal(attempted[1], 'gemini-3.8-flash');
});
