'use strict';

const { AI_PROVIDERS } = require('./providers');
const { createExecutionResponse } = require('./execution-contracts');
const { AIError } = require('./errors');
const { GROQ_ERROR_CODES } = require('./groq-error-classifier');

const GROQ_SAFETY_FINISH_REASONS = new Set([
  'CONTENT_FILTER',
  'SAFETY',
  'REFUSAL',
]);

function visibleGroqText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && typeof part === 'object')
    .map((part) => {
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .join('');
}

function normalizeGroqFinishReason(value) {
  switch (String(value || '').toLowerCase()) {
    case 'stop':
      return 'STOP';
    case 'length':
      return 'MAX_TOKENS';
    case 'tool_calls':
      return 'TOOL_CALLS';
    case 'content_filter':
      return 'CONTENT_FILTER';
    case 'function_call':
      return 'FUNCTION_CALL';
    default:
      return String(value || 'UNKNOWN').toUpperCase();
  }
}

function _structuredData(text, required) {
  if (!required) return null;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new AIError('Groq structured output was not valid JSON', {
      code: GROQ_ERROR_CODES.INVALID_OUTPUT,
      retryable: true,
      scope: 'ATTEMPT',
      provider: AI_PROVIDERS.GROQ,
      cause,
    });
  }
}

function normalizeGroqResponse(raw, {
  modelId,
  slotId,
  latencyMs = null,
  fallbackDepth = 0,
  generationGroupId = null,
  structuredOutputRequested = false,
  rateLimit = null,
} = {}) {
  const choice = raw?.choices?.[0] || null;
  const message = choice?.message || {};
  const text = visibleGroqText(message.content);
  const finishReason = normalizeGroqFinishReason(choice?.finish_reason);
  const refusal = message?.refusal || null;
  const blocked = Boolean(
    refusal || GROQ_SAFETY_FINISH_REASONS.has(finishReason)
  );
  const usage = raw?.usage || {};
  const thoughtTokens =
    Number(usage?.completion_tokens_details?.reasoning_tokens) ||
    Number(usage?.output_tokens_details?.reasoning_tokens) ||
    0;
  const cachedContentTokens =
    Number(usage?.prompt_tokens_details?.cached_tokens) ||
    Number(usage?.input_tokens_details?.cached_tokens) ||
    0;

  return createExecutionResponse({
    provider: AI_PROVIDERS.GROQ,
    requestedModel: modelId || 'unknown-groq-model',
    providerModel: raw?.model || modelId || null,
    text,
    structuredData: _structuredData(text, structuredOutputRequested && !blocked),
    finishReason,
    blocked,
    blockReason: refusal || (blocked ? finishReason : null),
    credentialSlot: slotId || null,
    latencyMs,
    fallbackDepth,
    generationGroupId,
    usage: {
      inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens) || 0,
      outputTokens: Number(usage.completion_tokens ?? usage.output_tokens) || 0,
      thoughtTokens,
      totalTokens: Number(usage.total_tokens) || 0,
      cachedContentTokens,
    },
    providerMetadata: {
      requestId: raw?.id || rateLimit?.requestId || null,
      systemFingerprint: raw?.system_fingerprint || null,
      serviceTier: raw?.service_tier || null,
      rateLimit: rateLimit ? { ...rateLimit } : null,
    },
  });
}

module.exports = {
  GROQ_SAFETY_FINISH_REASONS,
  visibleGroqText,
  normalizeGroqFinishReason,
  normalizeGroqResponse,
};
