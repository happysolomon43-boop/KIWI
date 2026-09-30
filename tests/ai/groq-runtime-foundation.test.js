'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const {
  createExecutionRequest,
  createExecutionResponse,
} = require('../../services/ai/execution-contracts');
const {
  createModelCatalog,
  MODEL_STATUS,
  GROQ_MODEL_IDS,
} = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');
const { createGroqCredentialPool } = require('../../services/ai/project-pool');
const { createProviderRegistry } = require('../../services/ai/provider-registry');
const {
  createGroqProviderAdapter,
  serializeGroqExecutionRequest,
  mapGroqReasoningEffort,
} = require('../../services/ai/groq-provider-adapter');
const {
  createGroqHttpTransport,
  DEFAULT_GROQ_CHAT_COMPLETIONS_ENDPOINT,
} = require('../../services/ai/groq-http-transport');
const {
  normalizeGroqResponse,
} = require('../../services/ai/groq-response-normalizer');
const {
  GROQ_ERROR_CODES,
  classifyGroqHttpError,
  extractGroqEvidence,
} = require('../../services/ai/groq-error-classifier');
const {
  createGroqIsolatedExecutor,
} = require('../../services/ai/isolated-provider-executor');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function headers(values = {}) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    get(name) {
      return normalized[String(name).toLowerCase()] ?? null;
    },
  };
}

function response(status, body, headerValues = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(headerValues),
    async text() {
      return body == null ? '' : JSON.stringify(body);
    },
  };
}

function groqRaw({
  model = GROQ_MODEL_IDS.GPT_OSS_20B,
  content = 'hello',
  finishReason = 'stop',
} = {}) {
  return {
    id: 'chatcmpl_test',
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 2 },
      completion_tokens_details: { reasoning_tokens: 3 },
    },
    system_fingerprint: 'fp_test',
    service_tier: 'on_demand',
  };
}

test('AIM-D02 registers GPT-OSS 120B and 20B as isolated qualifying Groq models', () => {
  const catalog = createModelCatalog();
  const groq = catalog.list({ provider: AI_PROVIDERS.GROQ });
  assert.equal(groq.length, 2);

  for (const modelId of [GROQ_MODEL_IDS.GPT_OSS_120B, GROQ_MODEL_IDS.GPT_OSS_20B]) {
    const model = catalog.get(modelId);
    assert.equal(model.provider, AI_PROVIDERS.GROQ);
    assert.equal(model.status, MODEL_STATUS.QUALIFYING);
    assert.equal(model.family, null);
    assert.equal(model.productionEligible, false);
    assert.equal(model.qualityTier, null);
    assert.deepEqual(model.supportedThinking, ['LOW', 'MEDIUM', 'HIGH']);
    assert.equal(model.inputTokenLimit, 131072);
    assert.equal(model.outputTokenLimit, 65536);
    assert.ok(model.capabilities.includes('structuredOutput'));
    assert.ok(model.capabilities.includes('jsonSchema'));
    assert.deepEqual(model.inputModalities, ['TEXT']);
    assert.deepEqual(model.outputModalities, ['TEXT']);
  }
});

test('existing production router remains Gemini-only after Groq catalog registration', () => {
  const candidates = createModelRouter().resolveCandidates('MAIN_CBT');
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => candidate.provider === AI_PROVIDERS.GOOGLE));
  assert.ok(candidates.every((candidate) => !String(candidate.modelId).includes('gpt-oss')));
});

test('Groq request serialization maps neutral text and HIGH reasoning without provider leakage upstream', () => {
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: GROQ_MODEL_IDS.GPT_OSS_120B,
    content: 'Solve the problem.',
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      maxOutputTokens: 2048,
      temperature: 0.3,
      topP: 0.9,
      seed: 42,
      stopSequences: ['END'],
    },
  });

  const body = serializeGroqExecutionRequest(request);
  assert.equal(body.model, GROQ_MODEL_IDS.GPT_OSS_120B);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Solve the problem.' }]);
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.reasoning_format, 'hidden');
  assert.equal(body.max_completion_tokens, 2048);
  assert.equal(body.temperature, 0.3);
  assert.equal(body.top_p, 0.9);
  assert.equal(body.seed, 42);
  assert.deepEqual(body.stop, ['END']);
  assert.equal('contents' in body, false);
  assert.equal('thinkingConfig' in body, false);
});

test('Groq structured output uses strict JSON Schema and hidden reasoning', () => {
  const schema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  };
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: GROQ_MODEL_IDS.GPT_OSS_20B,
    content: 'Return JSON.',
    generation: {
      reasoning: { requested: 'MEDIUM', resolved: 'MEDIUM' },
      structuredOutput: { mimeType: 'application/json', schema },
    },
    metadata: { structuredOutputName: 'kiwi-test' },
  });

  const body = serializeGroqExecutionRequest(request);
  assert.equal(body.reasoning_effort, 'medium');
  assert.equal(body.reasoning_format, 'hidden');
  assert.deepEqual(body.response_format, {
    type: 'json_schema',
    json_schema: {
      name: 'kiwi-test',
      strict: true,
      schema,
    },
  });
});

test('GPT-OSS reasoning mapping rejects unsupported MINIMAL rather than silently downgrading', () => {
  assert.equal(mapGroqReasoningEffort({ resolved: 'LOW' }), 'low');
  assert.equal(mapGroqReasoningEffort({ resolved: 'MEDIUM' }), 'medium');
  assert.equal(mapGroqReasoningEffort({ resolved: 'HIGH' }), 'high');
  assert.throws(
    () => mapGroqReasoningEffort({ resolved: 'MINIMAL' }),
    /cannot satisfy reasoning level MINIMAL/
  );
});

test('Groq response normalization captures text, finish reason, usage and provider metadata', () => {
  const normalized = normalizeGroqResponse(groqRaw({
    model: GROQ_MODEL_IDS.GPT_OSS_120B,
    content: 'done',
  }), {
    modelId: GROQ_MODEL_IDS.GPT_OSS_120B,
    slotId: 'groq-key-02',
    latencyMs: 12,
    rateLimit: { requestId: 'req_123', remainingTokens: '7990' },
  });

  assert.equal(normalized.provider, AI_PROVIDERS.GROQ);
  assert.equal(normalized.text, 'done');
  assert.equal(normalized.finishReason, 'STOP');
  assert.equal(normalized.credentialSlot, 'groq-key-02');
  assert.equal(normalized.latencyMs, 12);
  assert.equal(normalized.usage.inputTokens, 10);
  assert.equal(normalized.usage.outputTokens, 5);
  assert.equal(normalized.usage.thoughtTokens, 3);
  assert.equal(normalized.usage.cachedContentTokens, 2);
  assert.equal(normalized.providerMetadata.systemFingerprint, 'fp_test');
  assert.equal(normalized.providerMetadata.rateLimit.remainingTokens, '7990');
});

test('Groq structured-output normalization returns parsed structuredData', () => {
  const normalized = normalizeGroqResponse(groqRaw({
    content: JSON.stringify({ ok: true, score: 7 }),
  }), {
    modelId: GROQ_MODEL_IDS.GPT_OSS_20B,
    structuredOutputRequested: true,
  });

  assert.deepEqual(normalized.structuredData, { ok: true, score: 7 });
  assert.equal(normalized.text, '{"ok":true,"score":7}');
});

test('malformed Groq structured output becomes normalized INVALID_OUTPUT', () => {
  assert.throws(
    () => normalizeGroqResponse(groqRaw({ content: '{not-json' }), {
      modelId: GROQ_MODEL_IDS.GPT_OSS_20B,
      structuredOutputRequested: true,
    }),
    (error) => error instanceof AIError &&
      error.code === GROQ_ERROR_CODES.INVALID_OUTPUT &&
      error.provider === AI_PROVIDERS.GROQ
  );
});

test('Groq safety/refusal semantics remain explicit', () => {
  const raw = groqRaw({ content: '' });
  raw.choices[0].message.refusal = 'Request refused';
  raw.choices[0].finish_reason = 'content_filter';

  const normalized = normalizeGroqResponse(raw, {
    modelId: GROQ_MODEL_IDS.GPT_OSS_20B,
  });
  assert.equal(normalized.blocked, true);
  assert.equal(normalized.blockReason, 'Request refused');
  assert.equal(normalized.finishReason, 'CONTENT_FILTER');
});

test('Groq classifier distinguishes request, auth, permission, model and provider failures', () => {
  assert.equal(classifyGroqHttpError({ status: 400, body: { error: { message: 'bad' } } }).code, AI_ERROR_CODES.BAD_REQUEST);
  assert.equal(classifyGroqHttpError({ status: 401, body: { error: { message: 'bad key' } } }).code, AI_ERROR_CODES.AUTH);
  assert.equal(classifyGroqHttpError({ status: 401, body: { error: { message: 'bad key' } } }).scope, 'SLOT');
  assert.equal(classifyGroqHttpError({ status: 403, body: { error: { message: 'blocked model' } } }).code, GROQ_ERROR_CODES.PERMISSION);
  assert.equal(classifyGroqHttpError({ status: 404, body: { error: { message: 'missing model' } } }).code, AI_ERROR_CODES.MODEL_NOT_FOUND);
  assert.equal(classifyGroqHttpError({ status: 498, body: { error: { message: 'capacity' } } }).code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
  assert.equal(classifyGroqHttpError({ status: 499, body: { error: { message: 'cancelled' } } }).code, GROQ_ERROR_CODES.CANCELLED);
  assert.equal(classifyGroqHttpError({ status: 500, body: { error: { message: 'server' } } }).code, AI_ERROR_CODES.TRANSIENT);
  assert.equal(classifyGroqHttpError({ status: 503, body: { error: { message: 'overload' } } }).code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
});

test('Groq 429 classifier distinguishes RPM, TPM and RPD without treating the credential as bad', () => {
  const rpm = classifyGroqHttpError({
    status: 429,
    body: { error: { message: 'Rate limit reached on requests per minute (RPM)' } },
    headers: headers({ 'retry-after': '2' }),
  });
  const tpm = classifyGroqHttpError({
    status: 429,
    body: { error: { message: 'Rate limit reached on tokens per minute (TPM)' } },
  });
  const rpd = classifyGroqHttpError({
    status: 429,
    body: { error: { message: 'Rate limit reached on requests per day (RPD)' } },
  });

  assert.equal(rpm.code, AI_ERROR_CODES.RATE_LIMIT_RPM);
  assert.equal(tpm.code, AI_ERROR_CODES.RATE_LIMIT_TPM);
  assert.equal(rpd.code, AI_ERROR_CODES.RATE_LIMIT_RPD);
  assert.equal(rpm.scope, 'PROVIDER_MODEL');
  assert.equal(rpm.retryAfterMs, 2000);
});

test('Groq rate-limit evidence captures only safe operational headers', () => {
  const evidence = extractGroqEvidence(
    { error: { message: 'tokens per minute TPM', type: 'rate_limit_error' } },
    headers({
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': '999',
      'x-ratelimit-limit-tokens': '8000',
      'x-ratelimit-remaining-tokens': '7000',
      'x-request-id': 'req_safe',
    })
  );
  assert.equal(evidence.limitRequests, 1000);
  assert.equal(evidence.remainingTokens, 7000);
  assert.equal(evidence.requestId, 'req_safe');
  assert.doesNotMatch(JSON.stringify(evidence), /authorization|bearer|api[_-]?key/i);
});

test('Groq HTTP transport authenticates server-side and never embeds credential in body/result', async () => {
  const calls = [];
  const transport = createGroqHttpTransport({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, groqRaw(), {
        'x-ratelimit-remaining-tokens': '7990',
      });
    },
    clock: (() => {
      let now = 100;
      return () => (now += 5);
    })(),
  });

  const result = await transport.generate({
    apiKey: 'gsk_super_secret_test',
    body: { model: GROQ_MODEL_IDS.GPT_OSS_20B, messages: [] },
    timeoutMs: 1000,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DEFAULT_GROQ_CHAT_COMPLETIONS_ENDPOINT);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gsk_super_secret_test');
  assert.doesNotMatch(calls[0].init.body, /gsk_super_secret_test/);
  assert.doesNotMatch(JSON.stringify(result), /gsk_super_secret_test/);
});

test('Groq HTTP transport normalizes network failure without leaking the credential', async () => {
  const transport = createGroqHttpTransport({
    fetchImpl: async () => {
      throw new Error('socket reset');
    },
  });

  await assert.rejects(
    () => transport.generate({
      apiKey: 'gsk_do_not_leak',
      body: { model: GROQ_MODEL_IDS.GPT_OSS_20B, messages: [] },
      timeoutMs: 1000,
    }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.NETWORK);
      assert.equal(error.provider, AI_PROVIDERS.GROQ);
      assert.doesNotMatch(JSON.stringify({
        message: error.message,
        code: error.code,
        details: error.details,
      }), /gsk_do_not_leak/);
      return true;
    }
  );
});

test('Groq HTTP transport honors caller cancellation', async () => {
  const transport = createGroqHttpTransport({
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  const controller = new AbortController();
  const pending = transport.generate({
    apiKey: 'secret',
    body: { model: GROQ_MODEL_IDS.GPT_OSS_20B, messages: [] },
    timeoutMs: 5000,
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(
    () => pending,
    (error) => error.code === GROQ_ERROR_CODES.CANCELLED && error.status === 499
  );
});

test('Groq provider adapter executes and normalizes a neutral structured request', async () => {
  const adapter = createGroqProviderAdapter({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.reasoning_effort, 'high');
      assert.equal(body.reasoning_format, 'hidden');
      assert.equal(body.response_format.type, 'json_schema');
      return response(200, groqRaw({
        model: GROQ_MODEL_IDS.GPT_OSS_120B,
        content: '{"ok":true}',
      }));
    },
  });
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: GROQ_MODEL_IDS.GPT_OSS_120B,
    content: 'Return ok.',
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      structuredOutput: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    },
  });

  const result = await adapter.generate({
    credential: { id: 'groq-key-01', apiKey: 'secret' },
    request,
  });
  assert.equal(result.normalized.provider, AI_PROVIDERS.GROQ);
  assert.deepEqual(result.normalized.structuredData, { ok: true });
  assert.equal(result.normalized.credentialSlot, 'groq-key-01');
});

test('isolated Groq executor rotates only an invalid credential and succeeds on the next slot', async () => {
  const pool = createGroqCredentialPool({
    env: {
      GROQ_API_KEY: 'bad-key',
      GROQ_API_KEY_2: 'good-key',
    },
  });
  const calls = [];
  const adapter = {
    provider: AI_PROVIDERS.GROQ,
    async generate({ credential, request }) {
      calls.push(credential.id);
      if (credential.id === 'groq-key-01') {
        throw new AIError('invalid credential', {
          code: AI_ERROR_CODES.AUTH,
          status: 401,
          retryable: false,
          scope: 'SLOT',
          provider: AI_PROVIDERS.GROQ,
        });
      }
      return {
        normalized: createExecutionResponse({
          provider: AI_PROVIDERS.GROQ,
          requestedModel: request.model.modelId,
          text: 'ok',
          credentialSlot: credential.id,
        }),
      };
    },
  };
  const registry = createProviderRegistry([adapter]);
  const executor = createGroqIsolatedExecutor({
    providerRegistry: registry,
    groqCredentialPool: pool,
    catalog: createModelCatalog(),
    logger: { warn() {} },
  });

  const result = await executor.execute({
    provider: AI_PROVIDERS.GROQ,
    modelId: GROQ_MODEL_IDS.GPT_OSS_20B,
    content: 'hello',
    generation: { reasoning: { requested: 'HIGH', resolved: 'HIGH' } },
  });

  assert.deepEqual(calls, ['groq-key-01', 'groq-key-02']);
  assert.equal(result.text, 'ok');
  assert.equal(result.credentialSlot, 'groq-key-02');
  assert.equal(pool.snapshot()[0].enabled, false);
  assert.equal(pool.snapshot()[0].disabledReason, AI_ERROR_CODES.AUTH);
  assert.doesNotMatch(JSON.stringify(pool.snapshot()), /bad-key|good-key/);
});

test('isolated Groq executor does not burn through keys on shared 429 pressure', async () => {
  const pool = createGroqCredentialPool({
    env: {
      GROQ_API_KEY: 'key-one',
      GROQ_API_KEY_2: 'key-two',
    },
  });
  let calls = 0;
  const registry = createProviderRegistry([{
    provider: AI_PROVIDERS.GROQ,
    async generate() {
      calls += 1;
      throw new AIError('shared rate limit', {
        code: AI_ERROR_CODES.RATE_LIMIT_TPM,
        status: 429,
        retryable: true,
        scope: 'PROVIDER_MODEL',
        provider: AI_PROVIDERS.GROQ,
      });
    },
  }]);
  const executor = createGroqIsolatedExecutor({
    providerRegistry: registry,
    groqCredentialPool: pool,
    catalog: createModelCatalog(),
    logger: { warn() {} },
  });

  await assert.rejects(
    () => executor.execute({
      provider: AI_PROVIDERS.GROQ,
      modelId: GROQ_MODEL_IDS.GPT_OSS_20B,
      content: 'hello',
    }),
    (error) => error.code === AI_ERROR_CODES.RATE_LIMIT_TPM
  );
  assert.equal(calls, 1);
  assert.ok(pool.snapshot().every((slot) => slot.enabled));
});
