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
} = require('../../services/ai/execution-contracts');
const { createProviderRegistry } = require('../../services/ai/provider-registry');
const {
  createGoogleProviderAdapter,
  legacyInvocationToExecutionRequest,
  serializeGoogleExecutionRequest,
} = require('../../services/ai/google-provider-adapter');
const {
  createModelCatalog,
} = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');
const {
  createProjectPool,
  createGroqCredentialPool,
  createCloudflareCredentialPool,
} = require('../../services/ai/project-pool');
const {
  QUOTA_SCOPES,
  CREDENTIAL_FAILURE_ACTIONS,
  getProviderQuotaPolicy,
  credentialFailureAction,
  quotaScopeFromError,
} = require('../../services/ai/quota-policy');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');


test('provider identity is explicit and legacy Gemini aliases normalize to GOOGLE', () => {
  assert.equal(normalizeProviderId('google'), AI_PROVIDERS.GOOGLE);
  assert.equal(normalizeProviderId('gemini'), AI_PROVIDERS.GOOGLE);
  assert.equal(normalizeProviderId('groq'), AI_PROVIDERS.GROQ);
  assert.equal(
    providerModelKey(AI_PROVIDERS.GOOGLE, 'model-x'),
    'GOOGLE::model-x'
  );
});


test('every seeded model has an explicit provider and catalog can filter by provider', () => {
  const catalog = createModelCatalog();
  const all = catalog.list();

  assert.ok(all.length > 0);
  assert.ok(all.every((model) => model.provider === AI_PROVIDERS.GOOGLE));
  assert.equal(
    catalog.list({ provider: AI_PROVIDERS.GROQ }).length,
    0
  );
});


test('router exposes provider-neutral route identity and reasoning metadata without changing model order', () => {
  const router = createModelRouter();
  const candidates = router.resolveCandidates('MAIN_CBT');

  assert.equal(candidates[0].modelId, 'gemini-3.8-flash');
  assert.equal(candidates[0].provider, AI_PROVIDERS.GOOGLE);
  assert.equal(candidates[0].routeKey, 'GOOGLE::gemini-3.8-flash');
  assert.deepEqual(candidates[0].reasoning, {
    requested: 'HIGH',
    resolved: 'HIGH',
  });
});


test('neutral execution contract represents ordinary text without Google request shapes', () => {
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId: 'synthetic-model',
    taskId: 'SYNTHETIC_TASK',
    content: 'hello',
    generation: {
      maxOutputTokens: 100,
      reasoning: { requested: 'MEDIUM', resolved: 'HIGH' },
    },
  });

  assert.equal(request.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(request.model.key, 'GOOGLE::synthetic-model');
  assert.deepEqual(request.content, {
    kind: AI_CONTENT_KINDS.TEXT,
    text: 'hello',
  });
  assert.equal(request.generation.reasoning.requested, 'MEDIUM');
  assert.equal(request.generation.reasoning.resolved, 'HIGH');
  assert.equal('contents' in request, false);
  assert.equal('thinkingConfig' in request.generation, false);
});


test('legacy provider-native content is quarantined explicitly instead of being mislabelled neutral', () => {
  const content = [{ parts: [{ text: 'legacy' }] }];
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId: 'synthetic-model',
    content,
  });

  assert.equal(request.content.kind, AI_CONTENT_KINDS.LEGACY_PROVIDER_CONTENT);
  assert.equal(request.content.provider, AI_PROVIDERS.GOOGLE);
  assert.deepEqual(request.content.value, content);
});


test('Gemini compatibility invocation enters neutral request before Google serialization', () => {
  const request = legacyInvocationToExecutionRequest({
    modelId: 'synthetic-model',
    content: 'hello',
    generationConfig: {
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: 'high' },
    },
  });

  assert.equal(request.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(request.content.kind, AI_CONTENT_KINDS.TEXT);
  assert.equal(request.generation.reasoning.resolved, 'HIGH');
  assert.equal('thinkingConfig' in request.generation, false);

  const serialized = serializeGoogleExecutionRequest(request);
  assert.deepEqual(serialized.contents, [{ parts: [{ text: 'hello' }] }]);
  assert.equal(serialized.generationConfig.temperature, 0.2);
  assert.deepEqual(serialized.generationConfig.thinkingConfig, {
    thinkingLevel: 'high',
  });
  assert.equal('reasoning' in serialized.generationConfig, false);
});


test('Google adapter executes neutral request through raw HTTP transport', async () => {
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
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      maxOutputTokens: 200,
    },
  });

  await adapter.generate({
    credential: { apiKey: 'secret-key' },
    request,
    timeoutMs: 1234,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, 'secret-key');
  assert.equal(calls[0].modelId, 'synthetic-model');
  assert.equal(calls[0].timeoutMs, 1234);
  assert.deepEqual(calls[0].body.contents, [{ parts: [{ text: 'hello' }] }]);
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'high');
});


test('provider registry rejects incomplete adapters and resolves registered providers explicitly', () => {
  const registry = createProviderRegistry();
  assert.throws(() => registry.register({ provider: AI_PROVIDERS.GROQ }), /generate/);

  const adapter = Object.freeze({
    provider: AI_PROVIDERS.GROQ,
    async generate() { return null; },
  });
  registry.register(adapter);

  assert.equal(registry.require(AI_PROVIDERS.GROQ), adapter);
  assert.deepEqual(registry.list(), [AI_PROVIDERS.GROQ]);
});


test('credential pools expose provider identity and health metadata without exposing secrets', () => {
  const google = createProjectPool({ env: { GEMINI_API_KEY: 'g-secret' } });
  const groq = createGroqCredentialPool({ env: { GROQ_API_KEY: 'q-secret' } });
  const cloudflare = createCloudflareCredentialPool({
    env: { CLOUDFLARE_WORKERS_AI_API_TOKEN: 'c-secret' },
  });

  assert.equal(google.snapshot()[0].provider, AI_PROVIDERS.GOOGLE);
  assert.equal(groq.snapshot()[0].provider, AI_PROVIDERS.GROQ);
  assert.equal(cloudflare.snapshot()[0].provider, AI_PROVIDERS.CLOUDFLARE);

  google.disable('gemini-project-01', 'AUTH');
  const disabled = google.snapshot()[0];
  assert.equal(disabled.state, 'DISABLED');
  assert.equal(disabled.disabledReason, 'AUTH');
  assert.ok(disabled.disabledAt);

  const serialized = JSON.stringify({
    google: google.snapshot(),
    groq: groq.snapshot(),
    cloudflare: cloudflare.snapshot(),
  });
  assert.doesNotMatch(serialized, /g-secret|q-secret|c-secret/);
});


test('quota policy makes existing Google scope explicit without inventing other-provider quota semantics', () => {
  const googlePolicy = getProviderQuotaPolicy(AI_PROVIDERS.GOOGLE);
  const groqPolicy = getProviderQuotaPolicy(AI_PROVIDERS.GROQ);

  assert.deepEqual(googlePolicy.accountedScopes, [
    QUOTA_SCOPES.PROJECT_MODEL,
    QUOTA_SCOPES.PROJECT,
  ]);
  assert.deepEqual(groqPolicy.accountedScopes, []);
});


test('credential/auth failure and quota scope are classified separately', () => {
  const auth = new AIError('bad credential', {
    code: AI_ERROR_CODES.AUTH,
    scope: 'SLOT',
  });
  const daily = new AIError('daily quota', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPD,
    scope: 'MODEL_SLOT',
  });

  assert.equal(
    credentialFailureAction(auth),
    CREDENTIAL_FAILURE_ACTIONS.DISABLE
  );
  assert.equal(
    credentialFailureAction(daily),
    CREDENTIAL_FAILURE_ACTIONS.KEEP
  );
  assert.equal(
    quotaScopeFromError(daily),
    QUOTA_SCOPES.PROJECT_MODEL
  );
});
