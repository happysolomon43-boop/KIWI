'use strict';

const {
  normalizeGoogleContents,
  readResponseBody,
} = require('./google-http-transport');
const { createGoogleProviderAdapter } = require('./google-provider-adapter');
const { createGroqProviderAdapter } = require('./groq-provider-adapter');
const { createExecutionRequest } = require('./execution-contracts');
const { AI_PROVIDERS } = require('./providers');
const { GROQ_MODEL_IDS } = require('./model-catalog');
const { AIError, AI_ERROR_CODES } = require('./errors');

const GROQ_MODEL_ID_SET = new Set(Object.values(GROQ_MODEL_IDS));

function providerForModelId(modelId) {
  return GROQ_MODEL_ID_SET.has(String(modelId || ''))
    ? AI_PROVIDERS.GROQ
    : AI_PROVIDERS.GOOGLE;
}

function neutralGenerationFromCompatibilityConfig(generationConfig = {}) {
  const {
    reasoning = null,
    responseMimeType = undefined,
    responseSchema = undefined,
    maxOutputTokens = undefined,
    maxCompletionTokens = undefined,
    stopSequences = undefined,
    ...rest
  } = generationConfig || {};

  const structuredOutput = responseMimeType != null || responseSchema != null
    ? {
        mimeType: responseMimeType || 'application/json',
        schema: responseSchema ?? null,
      }
    : null;

  return {
    ...rest,
    ...(reasoning ? { reasoning } : {}),
    ...(structuredOutput ? { structuredOutput } : {}),
    ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
    ...(maxCompletionTokens != null ? { maxCompletionTokens } : {}),
    ...(stopSequences != null ? { stopSequences } : {}),
  };
}

// Historical export name retained so bootstrap code and existing tests do not
// gain a second provider entry point. D03 turns this compatibility facade into
// the single central text transport dispatcher used by the AI Orchestrator.
function createGeminiTransport(options = {}) {
  const google = createGoogleProviderAdapter(options);
  const groq = createGroqProviderAdapter(options);

  async function generate({
    apiKey,
    modelId,
    content,
    generationConfig = {},
    timeoutMs = 30000,
    taskId = null,
  } = {}) {
    const provider = providerForModelId(modelId);
    if (provider === AI_PROVIDERS.GOOGLE) {
      return google.legacyTransport.generate({
        apiKey,
        modelId,
        content,
        generationConfig,
        timeoutMs,
        taskId,
      });
    }

    if (typeof content !== 'string' && content != null) {
      // D04 owns the neutral multimodal contract. Treat legacy provider-native
      // content as ineligible for this text route so the central orchestrator
      // can continue to its qualified Google fallback rather than corrupting it.
      throw new AIError('Groq text route cannot execute legacy provider-native content', {
        code: AI_ERROR_CODES.TRANSIENT,
        retryable: true,
        scope: 'MODEL',
        provider: AI_PROVIDERS.GROQ,
        details: { capabilityMismatch: 'TEXT_CONTENT_REQUIRED' },
      });
    }

    const request = createExecutionRequest({
      provider: AI_PROVIDERS.GROQ,
      modelId,
      taskId,
      content: content ?? '',
      generation: neutralGenerationFromCompatibilityConfig(generationConfig),
      metadata: {
        compatibilitySource: 'CENTRAL_TEXT_TRANSPORT_D03',
      },
    });
    const result = await groq.generate({
      credential: { apiKey },
      request,
      timeoutMs,
    });

    return Object.freeze({
      raw: Object.freeze({ __kiwiExecutionResponse: result.normalized }),
      latencyMs: result.latencyMs,
      rateLimit: result.rateLimit || null,
    });
  }

  async function listModels(args = {}) {
    // Automatic discovery remains Google's stable-model discovery in D03.
    // Provider discovery itself is a later operational concern.
    return google.listModels(args);
  }

  return Object.freeze({ generate, listModels });
}

module.exports = {
  normalizeContents: normalizeGoogleContents,
  readResponseBody,
  providerForModelId,
  neutralGenerationFromCompatibilityConfig,
  createGeminiTransport,
};
