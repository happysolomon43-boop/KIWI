'use strict';

const FEATURE_FLAG_KEYS = Object.freeze({
  teaching: 'TEACHING_ENABLED',
  highStakesMarking: 'TEACHING_HIGH_STAKES_MARKING_ENABLED',
  impromptuTests: 'TEACHING_IMPROMPTU_TESTS_ENABLED',
  resits: 'TEACHING_RESITS_ENABLED',
  externalIntegrations: 'TEACHING_EXTERNAL_INTEGRATIONS_ENABLED',
});

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseAllowlist(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function createFeatureFlags(env = process.env) {
  const developmentUserIds = parseAllowlist(env.TEACHING_DEV_USER_IDS);

  const flags = Object.freeze({
    teaching: parseBoolean(env[FEATURE_FLAG_KEYS.teaching], false),
    highStakesMarking: parseBoolean(env[FEATURE_FLAG_KEYS.highStakesMarking], false),
    impromptuTests: parseBoolean(env[FEATURE_FLAG_KEYS.impromptuTests], false),
    resits: parseBoolean(env[FEATURE_FLAG_KEYS.resits], false),
    externalIntegrations: parseBoolean(env[FEATURE_FLAG_KEYS.externalIntegrations], false),
  });

  function teachingAvailableFor(user) {
    const userId = user && user.id != null ? String(user.id) : '';
    return flags.teaching || (userId !== '' && developmentUserIds.has(userId));
  }

  return Object.freeze({
    flags,
    developmentUserIds,
    teachingAvailableFor,
  });
}

module.exports = {
  FEATURE_FLAG_KEYS,
  parseBoolean,
  parseAllowlist,
  createFeatureFlags,
};
