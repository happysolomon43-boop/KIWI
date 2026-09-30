'use strict';

const {
  AI_PROVIDERS,
  GROQ_MODEL_IDS,
  createQualificationModelCatalog,
  createGroqCredentialPool,
  createProviderRegistry,
  createGroqProviderAdapter,
  createGroqIsolatedExecutor,
} = require('../services/ai');

const GROQ_SMOKE_MARKER = 'KIWI_GROQ_OK';

function safeFailure(error) {
  return Object.freeze({
    ok: false,
    provider: error?.provider || AI_PROVIDERS.GROQ,
    code: error?.code || 'UNKNOWN',
    status: error?.status || null,
    scope: error?.scope || null,
    retryable: Boolean(error?.retryable),
    message: String(error?.message || 'Groq smoke failed').slice(0, 300),
  });
}

async function runGroqSmoke({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  modelId = GROQ_MODEL_IDS.GPT_OSS_20B,
} = {}) {
  const credentialPool = createGroqCredentialPool({ env });
  if (credentialPool.enabledCount() === 0) {
    const error = new Error('No enabled Groq credential is configured for isolated smoke execution');
    error.code = 'CONFIG';
    error.provider = AI_PROVIDERS.GROQ;
    throw error;
  }

  const catalog = createQualificationModelCatalog();
  const adapter = createGroqProviderAdapter({ fetchImpl });
  const providerRegistry = createProviderRegistry([adapter]);
  const executor = createGroqIsolatedExecutor({
    providerRegistry,
    groqCredentialPool: credentialPool,
    catalog,
    logger,
  });

  const result = await executor.execute({
    provider: AI_PROVIDERS.GROQ,
    modelId,
    taskId: 'AIM_D02_REAL_GROQ_SMOKE',
    content: [
      'Return a JSON object only.',
      'Set ok to true and marker to exactly KIWI_GROQ_OK.',
      'Do not add any other properties.',
    ].join(' '),
    generation: {
      reasoning: { requested: 'LOW', resolved: 'LOW' },
      maxOutputTokens: 128,
      structuredOutput: {
        mimeType: 'application/json',
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            marker: { type: 'string' },
          },
          required: ['ok', 'marker'],
          additionalProperties: false,
        },
      },
    },
    metadata: {
      structuredOutputName: 'kiwi_groq_smoke',
    },
    timeoutMs: 20000,
  });

  if (
    result?.structuredData?.ok !== true ||
    result?.structuredData?.marker !== GROQ_SMOKE_MARKER
  ) {
    const error = new Error('Groq smoke response failed semantic verification');
    error.code = 'INVALID_OUTPUT';
    error.provider = AI_PROVIDERS.GROQ;
    throw error;
  }

  const safeResult = Object.freeze({
    ok: true,
    provider: result.provider,
    model: result.providerModel || result.requestedModel || modelId,
    credentialSlot: result.credentialSlot || null,
    latencyMs: result.latencyMs,
    finishReason: result.finishReason,
    usage: result.usage,
    marker: result.structuredData.marker,
  });

  logger?.log?.('[KIWI AIM-D02] Groq isolated smoke succeeded', safeResult);
  return safeResult;
}

if (require.main === module) {
  runGroqSmoke()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error) => {
      console.error('[KIWI AIM-D02] Groq isolated smoke failed', safeFailure(error));
      process.exitCode = 1;
    });
}

module.exports = {
  GROQ_SMOKE_MARKER,
  safeFailure,
  runGroqSmoke,
};
