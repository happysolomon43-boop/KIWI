'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_PROVIDERS,
  normalizeProviderId,
  providerModelKey,
} = require('../../services/ai/providers');
const {
  AI_CONTENT_KINDS,
  createExecutionRequest,
  createTextContentPart,
  createImageContentPart,
  createMultimodalContent,
} = require('../../services/ai/execution-contracts');
const { createProviderRegistry } = require('../../services/ai/provider-registry');
const {
  createModelCatalog,
  MODEL_IDS,
} = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');
const { createCredentialRegistry } = require('../../services/ai/credential-registry');
const { createGoogleProviderAdapter, serializeGoogleExecutionRequest } = require('../../services/ai/google-provider-adapter');
const {
  QUOTA_SCOPES,
  CREDENTIAL_FAILURE_ACTIONS,
  getProviderQuotaPolicy,
  credentialFailureAction,
  quotaScopeFromError,
} = require('../../services/ai/quota-policy');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7lT8AAAAASUVORK5CYII=';

test('provider identity is explicit and composite route identity is stable', () => {
  assert.equal(normalizeProviderId('google'), AI_PROVIDERS.GOOGLE);
  assert.equal(normalizeProviderId('groq'), AI_PROVIDERS.GROQ);
  assert.equal(normalizeProviderId('cloudflare'), AI_PROVIDERS.CLOUDFLARE);
  assert.equal(providerModelKey(AI_PROVIDERS.GOOGLE, 'model-x'), 'GOOGLE::model-x');
});

test('seeded catalog contains explicit multi-provider identities and capability models', () => {
  const catalog = createModelCatalog();
  const all = catalog.list();

  assert.ok(all.length > 0);
  assert.ok(all.every((model) => model.provider && model.routeKey === providerModelKey(model.provider, model.id)));
  assert.ok(catalog.list({ provider: AI_PROVIDERS.GOOGLE }).length > 0);
  assert.ok(catalog.list({ provider: AI_PROVIDERS.GROQ }).length > 0);
  assert.ok(catalog.list({ provider: AI_PROVIDERS.CLOUDFLARE }).length > 0);
  assert.ok(catalog.list({ provider: AI_PROVIDERS.KROKI }).length > 0);
});

test('ordinary inference follows the global neutral route', () => {
  const router = createModelRouter();
  const candidates = router.resolveCandidates('MAIN_CBT', { content: 'hello' });

  assert.deepEqual(candidates.map((candidate) => candidate.modelId), [
    MODEL_IDS.GEMINI_3_5_FLASH_LITE,
    MODEL_IDS.GEMINI_3_1_FLASH_LITE,
    MODEL_IDS.QWEN_3_8_27B,
    MODEL_IDS.GEMINI_3_8_FLASH,
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.provider), [
    AI_PROVIDERS.GOOGLE,
    AI_PROVIDERS.GOOGLE,
    AI_PROVIDERS.GROQ,
    AI_PROVIDERS.GOOGLE,
  ]);
  assert.equal(candidates[0].reasoning.requested, 'HIGH');
  assert.equal(candidates[0].reasoning.resolved, 'HIGH');
});

test('flashcard generation is the single model-order exception', () => {
  const router = createModelRouter();
  const candidates = router.resolveCandidates('FLASHCARD_GENERATION', { content: 'notes' });

  assert.deepEqual(candidates.map((candidate) => candidate.modelId), [
    MODEL_IDS.GEMINI_3_8_FLASH,
    MODEL_IDS.GEMINI_3_5_FLASH_LITE,
    MODEL_IDS.GEMINI_3_1_FLASH_LITE,
    MODEL_IDS.QWEN_3_8_27B,
    MODEL_IDS.GEMINI_3_5_FLASH,
  ]);
});

test('image-bearing inference uses the same router and removes text-only Qwen automatically', () => {
  const router = createModelRouter();
  const content = createMultimodalContent([
    createTextContentPart('Describe this image.'),
    createImageContentPart({ mimeType: 'image/png', data: TINY_PNG_BASE64 }),
  ]);
  const candidates = router.resolveCandidates('IMPORT_IMAGE_EXTRACTION', { content });

  assert.equal(content.kind, AI_CONTENT_KINDS.MULTIMODAL);
  assert.ok(candidates.length > 0);
  assert.equal(candidates.some((candidate) => candidate.modelId === MODEL_IDS.QWEN_3_8_27B), false);
  assert.ok(candidates.every((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE));
});

test('neutral execution contract contains no provider-native request fields', () => {
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId: 'synthetic-model',
    taskId: 'SYNTHETIC_TASK',
    content: 'hello',
    generation: {
      maxOutputTokens: 100,
      reasoning: { requested: 'MEDIUM', resolved: 'HIGH' },
      structuredOutput: { mimeType: 'application/json' },
    },
  });

  assert.equal(request.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(request.model.key, 'GOOGLE::synthetic-model');
  assert.equal(request.content.kind, AI_CONTENT_KINDS.TEXT);
  assert.equal('contents' in request, false);
  assert.equal('thinkingConfig' in request.generation, false);
  assert.equal('reasoning_effort' in request.generation, false);
  assert.equal('responseMimeType' in request.generation, false);
});

test('Google adapter alone translates neutral reasoning and structured output to Google payload', () => {
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId: 'synthetic-model',
    content: 'hello',
    generation: {
      maxOutputTokens: 200,
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      structuredOutput: {
        mimeType: 'application/json',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    },
  });

  const serialized = serializeGoogleExecutionRequest(request);
  assert.deepEqual(serialized.contents, [{ parts: [{ text: 'hello' }] }]);
  assert.equal(serialized.generationConfig.thinkingConfig.thinkingLevel, 'high');
  assert.equal(serialized.generationConfig.responseMimeType, 'application/json');
  assert.equal('reasoning' in serialized.generationConfig, false);
  assert.equal('structuredOutput' in serialized.generationConfig, false);
});

test('Google adapter executes a neutral request through its provider transport', async () => {
  const calls = [];
  const adapter = createGoogleProviderAdapter({
    httpTransport: {
      async generate(args) {
        calls.push(args);
        return { raw: { candidates: [] }, latencyMs: 1, httpStatus: 200 };
      },
      async listModels() { return []; },
    },
  });
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId: 'synthetic-model',
    content: 'hello',
    generation: { reasoning: { requested: 'HIGH', resolved: 'HIGH' } },
  });

  await adapter.generate({ credential: { apiKey: 'secret-key' }, request, timeoutMs: 1234 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, 'secret-key');
  assert.equal(calls[0].modelId, 'synthetic-model');
  assert.equal(calls[0].timeoutMs, 1234);
});

test('provider registry resolves adapters explicitly and never infers them from model names', () => {
  const registry = createProviderRegistry();
  assert.throws(() => registry.register({ provider: AI_PROVIDERS.GROQ }), /supported capability operation/);

  const adapter = Object.freeze({ provider: AI_PROVIDERS.GROQ, async generate() { return null; } });
  registry.register(adapter);

  assert.equal(registry.require(AI_PROVIDERS.GROQ, 'generate'), adapter);
  assert.deepEqual(registry.list(), [{ provider: AI_PROVIDERS.GROQ, operations: ['generate'] }]);
});

test('credential registry isolates providers and never exposes secrets in snapshots', () => {
  const registry = createCredentialRegistry({
    env: {
      GEMINI_API_KEY: 'g-secret',
      GROQ_API_KEY: 'q-secret',
      CLOUDFLARE_WORKERS_AI_API_TOKEN: 'c-secret',
    },
  });

  assert.equal(registry.snapshot(AI_PROVIDERS.GOOGLE)[0].provider, AI_PROVIDERS.GOOGLE);
  assert.equal(registry.snapshot(AI_PROVIDERS.GROQ)[0].provider, AI_PROVIDERS.GROQ);
  assert.equal(registry.snapshot(AI_PROVIDERS.CLOUDFLARE)[0].provider, AI_PROVIDERS.CLOUDFLARE);
  assert.doesNotMatch(JSON.stringify(registry.snapshot()), /g-secret|q-secret|c-secret/);
});

test('Groq credential ordering returns one key per attempt so a 429 cannot sweep the pool', () => {
  const registry = createCredentialRegistry({
    env: { GROQ_API_KEY: 'one', GROQ_API_KEY_2: 'two', GROQ_API_KEY_3: 'three' },
  });
  const first = registry.ordered(AI_PROVIDERS.GROQ, 'GROQ::route');
  const second = registry.ordered(AI_PROVIDERS.GROQ, 'GROQ::route');
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].id, second[0].id);
});

test('quota policy separates credential/auth failures from provider quota state', () => {
  const googlePolicy = getProviderQuotaPolicy(AI_PROVIDERS.GOOGLE);
  assert.deepEqual(googlePolicy.accountedScopes, [QUOTA_SCOPES.PROJECT_MODEL, QUOTA_SCOPES.PROJECT]);

  const auth = new AIError('bad credential', { code: AI_ERROR_CODES.AUTH, scope: 'SLOT' });
  const daily = new AIError('daily quota', { code: AI_ERROR_CODES.RATE_LIMIT_RPD, scope: 'MODEL_SLOT' });
  assert.equal(credentialFailureAction(auth), CREDENTIAL_FAILURE_ACTIONS.DISABLE);
  assert.equal(credentialFailureAction(daily), CREDENTIAL_FAILURE_ACTIONS.KEEP);
  assert.equal(quotaScopeFromError(daily), QUOTA_SCOPES.PROJECT_MODEL);
});
