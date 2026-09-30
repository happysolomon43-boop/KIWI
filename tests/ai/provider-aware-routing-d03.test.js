'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createModelCatalog, GROQ_MODEL_IDS } = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');
const { createProjectPool } = require('../../services/ai/project-pool');
const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function groqFirstRouter() {
  const catalog = createModelCatalog();
  const router = createModelRouter({
    catalog,
    env: { AI_TEXT_PROVIDER_MODE: 'GROQ_FIRST' },
  });
  return { catalog, router };
}

test('D03 routes premium ordinary text to GPT-OSS 120B before Gemini', () => {
  const { router } = groqFirstRouter();
  const candidates = router.resolveCandidates('QUICK_QUESTIONS');

  assert.equal(candidates[0].provider, AI_PROVIDERS.GROQ);
  assert.equal(candidates[0].modelId, GROQ_MODEL_IDS.GPT_OSS_120B);
  assert.equal(candidates[0].qualityFloor, 'PREMIUM');
  assert.ok(candidates.some((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE));
  assert.equal(candidates.some((candidate) => candidate.modelId === GROQ_MODEL_IDS.GPT_OSS_20B), false);
});

test('D03 routes low-risk/background text to GPT-OSS 20B then 120B before Google', () => {
  const { router } = groqFirstRouter();
  for (const taskId of ['MORNING_BRIEF', 'STUDY_TASK_GENERATION', 'CARD_EXPLANATION']) {
    const candidates = router.resolveCandidates(taskId);
    assert.equal(candidates[0].modelId, GROQ_MODEL_IDS.GPT_OSS_20B, taskId);
    assert.equal(candidates[1].modelId, GROQ_MODEL_IDS.GPT_OSS_120B, taskId);
    assert.ok(candidates.slice(2).some((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE), taskId);
  }
});

test('D03 translates MINIMAL to Groq LOW explicitly and never lowers HIGH', () => {
  const { router } = groqFirstRouter();
  const minimal = router.resolveCandidates('CARD_EXPLANATION')[0];
  assert.equal(minimal.requestedReasoning, 'MINIMAL');
  assert.equal(minimal.resolvedReasoning, 'LOW');
  assert.deepEqual(minimal.thinkingGenerationConfig.reasoning, {
    requested: 'MINIMAL',
    resolved: 'LOW',
  });

  const high = router.resolveCandidates('FLASHCARD_GENERATION')[0];
  assert.equal(high.modelId, GROQ_MODEL_IDS.GPT_OSS_120B);
  assert.equal(high.requestedReasoning, 'HIGH');
  assert.equal(high.resolvedReasoning, 'HIGH');
});

test('D03 protects CBT and Reckoning from unqualified Groq migration', () => {
  const { router } = groqFirstRouter();
  for (const taskId of [
    'MAIN_CBT',
    'RECKONING_CBT',
    'CBT_COMPLETION',
    'CBT_QUESTION_AUDIT',
  ]) {
    const requirement = router.describeRequirement(taskId);
    const candidates = router.resolveCandidates(taskId);
    assert.equal(requirement.assessmentProtected, true, taskId);
    assert.equal(requirement.providerMode, 'GOOGLE_ONLY', taskId);
    assert.ok(candidates.every((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE), taskId);
  }
});

test('D03 leaves legacy multimodal extraction on Google until D04', () => {
  const { router } = groqFirstRouter();
  const requirement = router.describeRequirement('IMPORT_IMAGE_EXTRACTION');
  const candidates = router.resolveCandidates('IMPORT_IMAGE_EXTRACTION');
  assert.equal(requirement.multimodalProtected, true);
  assert.equal(requirement.providerMode, 'GOOGLE_ONLY');
  assert.ok(candidates.every((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE));
});

test('D03 GOOGLE_ONLY rollback reproduces the accepted pre-D03 CBT route', () => {
  const router = createModelRouter({
    catalog: createModelCatalog(),
    env: { AI_TEXT_PROVIDER_MODE: 'GOOGLE_ONLY' },
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

test('D03 central credential pool selects credentials by candidate provider without exposing secrets', () => {
  const pool = createProjectPool({
    env: {
      GEMINI_API_KEY: 'google-secret',
      GROQ_API_KEY: 'groq-secret',
    },
  });

  assert.equal(pool.peekOrderedSlots('gemini-3.8-flash')[0].id, 'gemini-project-01');
  assert.equal(pool.peekOrderedSlots(GROQ_MODEL_IDS.GPT_OSS_120B)[0].id, 'groq-key-01');
  assert.doesNotMatch(JSON.stringify(pool.snapshot()), /google-secret|groq-secret/);
});

test('D03 central orchestrator falls from Groq to Gemini without feature-owned retry logic', async () => {
  const env = {
    AI_TEXT_PROVIDER_MODE: 'GROQ_FIRST',
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
      return {
        latencyMs: 1,
        raw: {
          modelVersion: modelId,
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: 'fallback-ok' }] },
          }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      };
    },
    async listModels() { return []; },
  };

  const orchestrator = createAIOrchestrator({
    registry: require('../../services/ai/task-registry').AI_TASKS,
    catalog,
    router,
    projectPool,
    transport,
    env,
  });

  const result = await orchestrator.run('QUICK_QUESTIONS', { prompt: 'test' });
  assert.equal(result.text, 'fallback-ok');
  assert.equal(result.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(attempted[0], GROQ_MODEL_IDS.GPT_OSS_120B);
  assert.ok(attempted.some((modelId) => modelId.startsWith('gemini-')));
});
