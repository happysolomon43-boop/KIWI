'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AI_CONTENT_KINDS } = require('./execution-contracts');
const { AIError, AI_ERROR_CODES } = require('./errors');
const { createGroqHttpTransport } = require('./groq-http-transport');
const { normalizeGroqResponse } = require('./groq-response-normalizer');

const GROQ_SUPPORTED_REASONING = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
const GPT_OSS_MODEL_PREFIX = 'openai/gpt-oss-';
const NEAR_ATTEMPT_DEADLINE_RATIO = 0.9;
const NEAR_ATTEMPT_DEADLINE_REMAINING_MS = 1500;

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

function isGptOssModel(modelId) {
  return String(modelId || '').startsWith(GPT_OSS_MODEL_PREFIX);
}

function mapGroqReasoningEffort(reasoning) {
  if (!reasoning) return null;
  const resolved = String(reasoning.resolved || reasoning.requested || '')
    .trim()
    .toUpperCase();
  if (!resolved) return null;
  if (!GROQ_SUPPORTED_REASONING.includes(resolved)) {
    throw new AIError(`Groq model cannot satisfy reasoning level ${resolved}`, {
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

function _safeValueLength(value) {
  if (typeof value === 'string') return value.length;
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, part) => {
    if (typeof part === 'string') return total + part.length;
    if (part && typeof part === 'object') {
      if (typeof part.text === 'string') return total + part.text.length;
      if (typeof part.content === 'string') return total + part.content.length;
    }
    return total;
  }, 0);
}

function buildGroqAttemptDiagnostic({
  raw,
  normalized,
  modelId,
  latencyMs,
  timeoutMs,
} = {}) {
  const allocationMs = Number(timeoutMs);
  const elapsedMs = Number(latencyMs);
  const hasAllocation = Number.isFinite(allocationMs) && allocationMs > 0;
  const hasElapsed = Number.isFinite(elapsedMs) && elapsedMs >= 0;
  const remainingBudgetMs = hasAllocation && hasElapsed
    ? Math.max(0, Math.round(allocationMs - elapsedMs))
    : null;
  const budgetUtilizationRatio = hasAllocation && hasElapsed
    ? elapsedMs / allocationMs
    : null;
  const message = raw?.choices?.[0]?.message || {};
  const reasoningCharacters = _safeValueLength(message.reasoning);
  const contentCharacters = String(normalized?.text || '').length;
  const nearAttemptDeadline = Boolean(
    budgetUtilizationRatio != null &&
    (
      budgetUtilizationRatio >= NEAR_ATTEMPT_DEADLINE_RATIO ||
      remainingBudgetMs <= NEAR_ATTEMPT_DEADLINE_REMAINING_MS
    )
  );

  return Object.freeze({
    provider: AI_PROVIDERS.GROQ,
    modelId: modelId || raw?.model || null,
    providerModel: raw?.model || modelId || null,
    requestId: raw?.id || null,
    providerFinishReason: raw?.choices?.[0]?.finish_reason || null,
    normalizedFinishReason: normalized?.finishReason || null,
    latencyMs: hasElapsed ? Math.round(elapsedMs) : null,
    attemptTimeoutMs: hasAllocation ? Math.round(allocationMs) : null,
    remainingBudgetMs,
    budgetUtilizationPct: budgetUtilizationRatio == null
      ? null
      : Math.round(budgetUtilizationRatio * 1000) / 10,
    nearAttemptDeadline,
    transportTimedOut: false,
    contentCharacters,
    reasoningPresent: reasoningCharacters > 0,
    reasoningCharacters,
    inputTokens: Number(normalized?.usage?.inputTokens) || 0,
    outputTokens: Number(normalized?.usage?.outputTokens) || 0,
    thoughtTokens: Number(normalized?.usage?.thoughtTokens) || 0,
    totalTokens: Number(normalized?.usage?.totalTokens) || 0,
  });
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
    if (isGptOssModel(request.model.modelId)) {
      // GPT-OSS reasoning is controlled with reasoning_effort and
      // include_reasoning. Groq explicitly documents reasoning_format as
      // unsupported for GPT-OSS. KIWI does not need chain-of-thought text, so
      // keep reasoning private while preserving the requested effort level.
      body.include_reasoning = false;
    } else {
      // Qwen-family reasoning models use reasoning_format. Keep hidden
      // reasoning private while preserving the requested effort level.
      body.reasoning_format = 'hidden';
    }
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
  logger = console,
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
    const diagnostic = buildGroqAttemptDiagnostic({
      raw: transportResult.raw,
      normalized,
      modelId: request.model.modelId,
      latencyMs: transportResult.latencyMs,
      timeoutMs,
    });

    // Preserve a safe forensic record for the exact failure mode without ever
    // logging prompt text, answer text, hidden reasoning, or credentials.
    if (!normalized.text && !normalized.blocked && typeof logger?.warn === 'function') {
      logger.warn('[KIWI AI] Groq empty-response diagnostic', diagnostic);
    } else if (diagnostic.nearAttemptDeadline && typeof logger?.info === 'function') {
      logger.info('[KIWI AI] Groq near-attempt-deadline diagnostic', diagnostic);
    }

    return Object.freeze({
      ...transportResult,
      normalized,
      diagnostic,
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
  isGptOssModel,
  mapGroqReasoningEffort,
  buildGroqAttemptDiagnostic,
  serializeGroqExecutionRequest,
  createGroqProviderAdapter,
};
