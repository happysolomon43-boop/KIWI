'use strict';

const { AI_PROVIDERS } = require('./providers');
const { createExecutionResponse } = require('./execution-contracts');

const SAFETY_FINISH_REASONS = new Set([
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
]);

function visibleTextFromParts(parts = []) {
  return parts
    .filter((part) => part && !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function normalizeGeminiResponse(raw, {
  modelId,
  slotId,
  latencyMs = null,
  fallbackDepth = 0,
  generationGroupId = null,
} = {}) {
  // D03 keeps the public normalizer name for compatibility, but the central
  // transport may already have produced the provider-neutral response. Rebind
  // only orchestrator-owned execution metadata (slot/fallback/affinity); never
  // expose credential material.
  if (raw?.__kiwiExecutionResponse) {
    const response = raw.__kiwiExecutionResponse;
    return createExecutionResponse({
      provider: response.provider,
      requestedModel: response.requestedModel || modelId,
      providerModel: response.providerModel || response.requestedModel || modelId,
      text: response.text,
      structuredData: response.structuredData,
      finishReason: response.finishReason,
      blocked: response.blocked,
      blockReason: response.blockReason,
      usage: response.usage,
      latencyMs: latencyMs ?? response.latencyMs,
      credentialSlot: slotId || response.credentialSlot || null,
      fallbackDepth,
      generationGroupId: generationGroupId || response.generationGroupId || null,
      providerMetadata: response.providerMetadata,
    });
  }

  const candidate = raw?.candidates?.[0] || null;
  const parts = candidate?.content?.parts || [];
  const finishReason = candidate?.finishReason || 'UNKNOWN';
  const promptBlockReason = raw?.promptFeedback?.blockReason || null;
  const usage = raw?.usageMetadata || {};

  const blocked = Boolean(
    promptBlockReason ||
    SAFETY_FINISH_REASONS.has(String(finishReason).toUpperCase())
  );

  return createExecutionResponse({
    provider: AI_PROVIDERS.GOOGLE,
    requestedModel: modelId || 'unknown-google-model',
    providerModel: raw?.modelVersion || modelId || null,
    text: visibleTextFromParts(parts),
    finishReason,
    blocked,
    blockReason: promptBlockReason || (blocked ? finishReason : null),
    credentialSlot: slotId || null,
    latencyMs,
    fallbackDepth,
    generationGroupId,
    usage: {
      inputTokens: Number(usage.promptTokenCount) || 0,
      outputTokens: Number(usage.candidatesTokenCount) || 0,
      thoughtTokens: Number(usage.thoughtsTokenCount) || 0,
      totalTokens: Number(usage.totalTokenCount) || 0,
      cachedContentTokens: Number(usage.cachedContentTokenCount) || 0,
    },
  });
}

module.exports = {
  SAFETY_FINISH_REASONS,
  visibleTextFromParts,
  normalizeGeminiResponse,
};
