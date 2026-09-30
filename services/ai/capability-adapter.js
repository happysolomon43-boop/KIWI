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
 * unsupported, use the next stronger level.
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

function buildReasoningDirective(model, requestedReasoning) {
  const requested = normalizeReasoning(requestedReasoning);
  const resolved = resolveThinkingLevel(model, requested);
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
    requested,
    resolved,
  });
}

function modelSupportsCapabilities(model, requiredCapabilities = []) {
  const supported = new Set(model?.capabilities || []);
  return requiredCapabilities.every((capability) => supported.has(capability));
}

/**
 * Compatibility serializer for the current Gemini route. New provider logic
 * must consume buildReasoningDirective() and serialize provider-specific
 * controls inside that provider's adapter. This function remains only so D01
 * can preserve every existing Gemini route while the router is migrated in
 * later deliveries.
 */
function buildGeminiThinkingConfig(model, requestedReasoning) {
  const directive = buildReasoningDirective(model, requestedReasoning);

  return Object.freeze({
    requested: directive.requested,
    resolved: directive.resolved,
    generationConfig: Object.freeze({
      thinkingConfig: Object.freeze({
        thinkingLevel: directive.resolved.toLowerCase(),
      }),
    }),
  });
}

module.exports = {
  REASONING_ORDER,
  normalizeReasoning,
  resolveThinkingLevel,
  buildReasoningDirective,
  modelSupportsCapabilities,
  buildGeminiThinkingConfig,
};
