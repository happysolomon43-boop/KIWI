'use strict';

const { AIError, AI_ERROR_CODES } = require('./errors');

const REASONING_ORDER = Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);

function normalizeReasoning(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!REASONING_ORDER.includes(normalized)) {
    throw new AIError(`Unsupported KIWI reasoning level: ${value}`, {
      code: AI_ERROR_CODES.CONFIG,
      retryable: false,
      scope: 'REQUEST',
    });
  }
  return normalized;
}

/**
 * KIWI reasoning levels are minimum intent, not exact provider strings.
 * We never silently downgrade below the requested level. If the exact level is
 * unsupported, use the next stronger level. This is what lets MINIMAL safely
 * become LOW on Gemini 3.8/3.7 while HIGH remains HIGH-only.
 */
function resolveThinkingLevel(model, requestedReasoning) {
  const requested = normalizeReasoning(requestedReasoning);
  const supported = new Set((model?.supportedThinking || []).map((v) => String(v).toUpperCase()));
  const start = REASONING_ORDER.indexOf(requested);

  for (let i = start; i < REASONING_ORDER.length; i++) {
    const candidate = REASONING_ORDER[i];
    if (supported.has(candidate)) return candidate;
  }

  return null;
}

function modelSupportsCapabilities(model, requiredCapabilities = []) {
  const supported = new Set(model?.capabilities || []);
  return requiredCapabilities.every((capability) => supported.has(capability));
}

function buildGeminiThinkingConfig(model, requestedReasoning) {
  const resolved = resolveThinkingLevel(model, requestedReasoning);
  if (!resolved) {
    throw new AIError(
      `Model ${model?.id || 'unknown'} cannot satisfy reasoning level ${requestedReasoning}`,
      {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'MODEL',
      }
    );
  }

  return Object.freeze({
    requested: normalizeReasoning(requestedReasoning),
    resolved,
    generationConfig: Object.freeze({
      thinkingConfig: Object.freeze({
        thinkingLevel: resolved.toLowerCase(),
      }),
    }),
  });
}

module.exports = {
  REASONING_ORDER,
  normalizeReasoning,
  resolveThinkingLevel,
  modelSupportsCapabilities,
  buildGeminiThinkingConfig,
};
