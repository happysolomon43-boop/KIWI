'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AI_CONTENT_KINDS } = require('./execution-contracts');
const { AIError, AI_ERROR_CODES } = require('./errors');
const { createGroqHttpTransport } = require('./groq-http-transport');
const { normalizeGroqResponse } = require('./groq-response-normalizer');

const GROQ_SUPPORTED_REASONING = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);

const GROQ_QUOTA_POLICY = Object.freeze({
  provider: AI_PROVIDERS.GROQ,
  // Groq rate limits can be shared at project/organization level. A 429 is not
  // evidence that one API key is defective, so credential rotation is reserved
  // for authentication failure rather than shared throttling.
  credentialScopedAuth: true,
  rotateOnAuthenticationFailure: true,
  rotateOnRateLimit: false,
  rotateOnPermissionFailure: false,
  rateLimitScope: 'PROVIDER_MODEL',
});

function mapGroqReasoningEffort(reasoning) {
  if (!reasoning) return null;
  const resolved = String(reasoning.resolved || reasoning.requested || '')
    .trim()
    .toUpperCase();
  if (!resolved) return null;
  if (!GROQ_SUPPORTED_REASONING.includes(resolved)) {
    throw new AIError(`Groq GPT-OSS cannot satisfy reasoning level ${resolved}`, {
      code: AI_ERROR_CODES.BAD_REQUEST,
      retryable: false,
      scope: 'REQUEST',
      provider: AI_PROVIDERS.GROQ,
    });
  }
  return resolved.toLowerCase();
}

function _schemaName(value) {
  const normalized = String(value || 'kiwi_response')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 64);
  return normalized || 'kiwi_response';
}

function _textContent(request) {
  if (request.content?.kind === AI_CONTENT_KINDS.TEXT) {
    return request.content.text;
  }

  throw new AIError(
    `Groq text adapter does not support content kind ${request.content?.kind || 'UNKNOWN'}`,
    {
      code: AI_ERROR_CODES.BAD_REQUEST,
      retryable: false,
      scope: 'REQUEST',
      provider: AI_PROVIDERS.GROQ,
    }
  );
}

function serializeGroqExecutionRequest(request) {
  if (!request || request.provider !== AI_PROVIDERS.GROQ) {
    throw new Error('Groq provider adapter requires a GROQ execution request');
  }

  const generation = request.generation || {};
  const {
    reasoning = null,
    structuredOutput = null,
    temperature = undefined,
    topP = undefined,
    maxOutputTokens = undefined,
    maxCompletionTokens = undefined,
    stopSequences = undefined,
    seed = undefined,
  } = generation;

  const body = {
    model: request.model.modelId,
    messages: [{
      role: 'user',
      content: _textContent(request),
    }],
    stream: false,
  };

  if (temperature !== undefined) body.temperature = Number(temperature);
  if (topP !== undefined) body.top_p = Number(topP);
  if (seed !== undefined) body.seed = Number(seed);

  const maxTokens = maxCompletionTokens ?? maxOutputTokens;
  if (maxTokens !== undefined) {
    const parsed = Number(maxTokens);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new AIError('Groq max output tokens must be a positive number', {
        code: AI_ERROR_CODES.BAD_REQUEST,
        retryable: false,
        scope: 'REQUEST',
        provider: AI_PROVIDERS.GROQ,
      });
    }
    body.max_completion_tokens = Math.floor(parsed);
  }

  if (stopSequences !== undefined) {
    body.stop = Array.isArray(stopSequences)
      ? [...stopSequences]
      : stopSequences;
  }

  const reasoningEffort = mapGroqReasoningEffort(reasoning);
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
    // KIWI requires result/provenance, not hidden chain-of-thought. Groq's
    // hidden mode preserves that boundary while still enabling GPT-OSS reasoning.
    body.reasoning_format = 'hidden';
  }

  if (structuredOutput) {
    if (structuredOutput.schema != null) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: _schemaName(request.metadata?.structuredOutputName),
          strict: true,
          schema: structuredOutput.schema,
        },
      };
    } else {
      body.response_format = { type: 'json_object' };
    }
  }

  return Object.freeze(body);
}

function createGroqProviderAdapter({
  fetchImpl = globalThis.fetch,
  endpoint,
  httpTransport = null,
} = {}) {
  const transport = httpTransport || createGroqHttpTransport({
    fetchImpl,
    endpoint,
  });

  async function generate({
    credential,
    request,
    timeoutMs = 30000,
    signal = null,
    fallbackDepth = 0,
    generationGroupId = null,
  } = {}) {
    if (!request) throw new Error('Groq provider adapter requires request');
    if (request.provider !== AI_PROVIDERS.GROQ) {
      throw new Error('Groq provider adapter cannot execute another provider request');
    }

    const apiKey = typeof credential === 'string'
      ? credential
      : credential?.apiKey;
    if (!apiKey) throw new Error('Groq provider adapter requires credential apiKey');

    const body = serializeGroqExecutionRequest(request);
    const transportResult = await transport.generate({
      apiKey,
      body,
      timeoutMs,
      signal,
    });
    const normalized = normalizeGroqResponse(transportResult.raw, {
      modelId: request.model.modelId,
      slotId: typeof credential === 'object' ? credential.id : null,
      latencyMs: transportResult.latencyMs,
      fallbackDepth,
      generationGroupId,
      structuredOutputRequested: Boolean(request.generation?.structuredOutput),
      rateLimit: transportResult.rateLimit,
    });

    return Object.freeze({
      ...transportResult,
      normalized,
    });
  }

  return Object.freeze({
    provider: AI_PROVIDERS.GROQ,
    quotaPolicy: GROQ_QUOTA_POLICY,
    generate,
    serialize: serializeGroqExecutionRequest,
    normalize: normalizeGroqResponse,
  });
}

module.exports = {
  GROQ_SUPPORTED_REASONING,
  GROQ_QUOTA_POLICY,
  mapGroqReasoningEffort,
  serializeGroqExecutionRequest,
  createGroqProviderAdapter,
};
