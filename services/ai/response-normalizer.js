'use strict';

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
  const candidate = raw?.candidates?.[0] || null;
  const parts = candidate?.content?.parts || [];
  const finishReason = candidate?.finishReason || 'UNKNOWN';
  const promptBlockReason = raw?.promptFeedback?.blockReason || null;
  const usage = raw?.usageMetadata || {};

  const blocked = Boolean(
    promptBlockReason ||
    SAFETY_FINISH_REASONS.has(String(finishReason).toUpperCase())
  );

  return Object.freeze({
    text: visibleTextFromParts(parts),
    finishReason,
    blocked,
    blockReason: promptBlockReason || (blocked ? finishReason : null),
    providerModel: raw?.modelVersion || modelId || null,
    requestedModel: modelId || null,
    projectSlot: slotId || null,
    latencyMs,
    fallbackDepth,
    generationGroupId,
    usage: Object.freeze({
      inputTokens: Number(usage.promptTokenCount) || 0,
      outputTokens: Number(usage.candidatesTokenCount) || 0,
      thoughtTokens: Number(usage.thoughtsTokenCount) || 0,
      totalTokens: Number(usage.totalTokenCount) || 0,
      cachedContentTokens: Number(usage.cachedContentTokenCount) || 0,
    }),
  });
}

module.exports = {
  SAFETY_FINISH_REASONS,
  visibleTextFromParts,
  normalizeGeminiResponse,
};
