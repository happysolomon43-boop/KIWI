'use strict';

const { AIError, AI_ERROR_CODES } = require('./errors');

const REASONING_LEVELS = Object.freeze({
  MINIMAL: 'MINIMAL',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

const REASONING_ORDER = Object.freeze([
  REASONING_LEVELS.MINIMAL,
  REASONING_LEVELS.LOW,
  REASONING_LEVELS.MEDIUM,
  REASONING_LEVELS.HIGH,
]);

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

function resolveReasoning(model, requestedReasoning) {
  if (!requestedReasoning) return null;
  const requested = normalizeReasoning(requestedReasoning);
  const supported = new Set((model?.supportedReasoning || model?.supportedThinking || []).map((value) => String(value).toUpperCase()));
  const start = REASONING_ORDER.indexOf(requested);
  for (let index = start; index < REASONING_ORDER.length; index++) {
    const candidate = REASONING_ORDER[index];
    if (supported.has(candidate)) {
      return Object.freeze({ requested, resolved: candidate });
    }
  }
  return null;
}

module.exports = {
  REASONING_LEVELS,
  REASONING_ORDER,
  normalizeReasoning,
  resolveReasoning,
};
