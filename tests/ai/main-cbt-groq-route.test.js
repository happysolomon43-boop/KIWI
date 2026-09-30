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

test('Main CBT stays Google-only unless its dedicated provider switch is explicitly enabled', () => {
  const router = routerFor();
  const requirement = router.describeRequirement('MAIN_CBT');
  const candidates = router.resolveCandidates('MAIN_CBT');

  assert.equal(requirement.providerMode, 'GOOGLE_ONLY');
  assert.equal(requirement.requiredQualityTier, 'HIGH_STAKES');
  assert.equal(requirement.routeOverride, null);
  assert.ok(candidates.every((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE));
});

test('explicit Main CBT activation routes GPT-OSS 120B first with HIGH reasoning and Gemini fallback', () => {
  const router = routerFor({
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GROQ_FIRST',
  });
  const requirement = router.describeRequirement('MAIN_CBT');
  const candidates = router.resolveCandidates('MAIN_CBT');

  assert.equal(requirement.assessmentProtected, true);
  assert.equal(requirement.providerMode, 'GROQ_FIRST');
  assert.equal(requirement.requiredQualityTier, 'PREMIUM');
  assert.deepEqual(requirement.allowedGroqModelIds, [GROQ_MODEL_IDS.GPT_OSS_120B]);
  assert.equal(requirement.routeOverride.scope, 'MAIN_CBT');
  assert.equal(requirement.routeOverride.modelId, MAIN_CBT_GROQ_MODEL_ID);

  assert.equal(candidates[0].provider, AI_PROVIDERS.GROQ);
  assert.equal(candidates[0].modelId, GROQ_MODEL_IDS.GPT_OSS_120B);
  assert.equal(candidates[0].requestedReasoning, 'HIGH');
  assert.equal(candidates[0].resolvedReasoning, 'HIGH');
  assert.equal(candidates.some((candidate) => candidate.modelId === GROQ_MODEL_IDS.GPT_OSS_20B), false);
  assert.ok(candidates.slice(1).some((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE));
  assert.equal(candidates.slice(1).find((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE)?.modelId, 'gemini-3.8-flash');
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
    assert.ok(candidates.every((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE), taskId);
  }
});

test('Main CBT GOOGLE_ONLY rollback restores the exact legacy Google chain', () => {
  const router = routerFor({
    [MAIN_CBT_PROVIDER_MODE_ENV]: 'GOOGLE_ONLY',
  });

  assert.deepEqual(
    router.resolveCandidates('MAIN_CBT').map((candidate) => candidate.modelId),
    [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
    ]
  );
});

test('Main CBT centrally falls from GPT-OSS 120B to Gemini when Groq is unavailable', async () => {
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
      if (modelId === GROQ_MODEL_IDS.GPT_OSS_120B) {
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
  assert.equal(attempted[0], GROQ_MODEL_IDS.GPT_OSS_120B);
  assert.ok(attempted.slice(1).some((modelId) => modelId.startsWith('gemini-')));
});
