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

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1','true','yes','enabled'].includes(normalized)) return true;
  if (['0','false','no','disabled'].includes(normalized)) return false;
  return fallback;
}

function createTeachingConfig(env = process.env) {
  return Object.freeze({
    environment: optionalString(env.NODE_ENV) || 'development',
    ai: Object.freeze({
      routingOwner: 'kiwi-ai-orchestrator',
      providerSetting: optionalString(env.TEACHING_AI_PROVIDER),
      modelSetting: optionalString(env.TEACHING_AI_MODEL),
      timeoutMs: parsePositiveInteger(env.TEACHING_AI_TIMEOUT_MS, 45_000, { min: 1_000, max: 300_000 }),
      tokenBudget: parsePositiveInteger(env.TEACHING_AI_TOKEN_BUDGET, 8_192, { min: 256, max: 1_000_000 }),
    }),
    integrations: Object.freeze({
      d27: Object.freeze({
        ksWriteEnabled: parseBoolean(env.TEACHING_D27_KS_WRITE_ENABLED, false),
        masteryWriteEnabled: parseBoolean(env.TEACHING_D27_MASTERY_WRITE_ENABLED, false),
        studyPromotionEnabled: parseBoolean(env.TEACHING_D27_STUDY_PROMOTION_ENABLED, false),
      }),
    }),
  });
}

module.exports = { createTeachingConfig, parsePositiveInteger, parseBoolean };
