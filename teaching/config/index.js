'use strict';

function parsePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function optionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function createTeachingConfig(env = process.env) {
  return Object.freeze({
    environment: optionalString(env.NODE_ENV) || 'development',
    ai: Object.freeze({
      routingOwner: 'kiwi-ai-orchestrator',
      // Provider/model settings remain opaque central-orchestrator configuration.
      // They are not Teaching feature-availability toggles.
      providerSetting: optionalString(env.TEACHING_AI_PROVIDER),
      modelSetting: optionalString(env.TEACHING_AI_MODEL),
      timeoutMs: parsePositiveInteger(env.TEACHING_AI_TIMEOUT_MS, 45_000, { min: 1_000, max: 300_000 }),
      tokenBudget: parsePositiveInteger(env.TEACHING_AI_TOKEN_BUDGET, 8_192, { min: 256, max: 1_000_000 }),
    }),
  });
}

module.exports = {
  createTeachingConfig,
  parsePositiveInteger,
};
