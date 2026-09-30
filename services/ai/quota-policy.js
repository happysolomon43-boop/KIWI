'use strict';

const { AI_PROVIDERS, assertProviderId } = require('./providers');
const { AI_ERROR_CODES } = require('./errors');

const QUOTA_SCOPES = Object.freeze({
  CREDENTIAL: 'CREDENTIAL',
  PROJECT: 'PROJECT',
  PROJECT_MODEL: 'PROJECT_MODEL',
  MODEL: 'MODEL',
  PROVIDER: 'PROVIDER',
  ACCOUNT: 'ACCOUNT',
  DAILY_ALLOCATION: 'DAILY_ALLOCATION',
  UNKNOWN: 'UNKNOWN',
});

const CREDENTIAL_FAILURE_ACTIONS = Object.freeze({
  KEEP: 'KEEP',
  DISABLE: 'DISABLE',
  UNKNOWN: 'UNKNOWN',
});

const GOOGLE_QUOTA_POLICY = Object.freeze({
  provider: AI_PROVIDERS.GOOGLE,
  // This describes KIWI's existing persisted Gemini accounting model. D01 does
  // not change its semantics; it makes the scope explicit so later providers
  // can declare different quota ownership without copying Gemini assumptions.
  accountedScopes: Object.freeze([
    QUOTA_SCOPES.PROJECT_MODEL,
    QUOTA_SCOPES.PROJECT,
  ]),
  shortWindowCodes: Object.freeze([
    AI_ERROR_CODES.RATE_LIMIT_RPM,
    AI_ERROR_CODES.RATE_LIMIT_TPM,
    AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
  ]),
  dailyCodes: Object.freeze([
    AI_ERROR_CODES.RATE_LIMIT_RPD,
  ]),
});

const PROVIDER_QUOTA_POLICIES = Object.freeze({
  [AI_PROVIDERS.GOOGLE]: GOOGLE_QUOTA_POLICY,
});

function getProviderQuotaPolicy(provider) {
  const normalizedProvider = assertProviderId(provider);
  return PROVIDER_QUOTA_POLICIES[normalizedProvider] || Object.freeze({
    provider: normalizedProvider,
    accountedScopes: Object.freeze([]),
    shortWindowCodes: Object.freeze([]),
    dailyCodes: Object.freeze([]),
  });
}

function credentialFailureAction(error) {
  if (!error) return CREDENTIAL_FAILURE_ACTIONS.UNKNOWN;
  if (error.code === AI_ERROR_CODES.AUTH || error.scope === 'SLOT') {
    return CREDENTIAL_FAILURE_ACTIONS.DISABLE;
  }
  return CREDENTIAL_FAILURE_ACTIONS.KEEP;
}

function quotaScopeFromError(error) {
  if (!error) return QUOTA_SCOPES.UNKNOWN;

  if (error.code === AI_ERROR_CODES.RATE_LIMIT_RPD) {
    return error.scope === 'MODEL_SLOT'
      ? QUOTA_SCOPES.PROJECT_MODEL
      : QUOTA_SCOPES.DAILY_ALLOCATION;
  }

  if (
    error.code === AI_ERROR_CODES.RATE_LIMIT_RPM ||
    error.code === AI_ERROR_CODES.RATE_LIMIT_TPM ||
    error.code === AI_ERROR_CODES.RATE_LIMIT_UNKNOWN
  ) {
    return error.scope === 'MODEL_SLOT'
      ? QUOTA_SCOPES.PROJECT_MODEL
      : QUOTA_SCOPES.UNKNOWN;
  }

  return QUOTA_SCOPES.UNKNOWN;
}

module.exports = {
  QUOTA_SCOPES,
  CREDENTIAL_FAILURE_ACTIONS,
  GOOGLE_QUOTA_POLICY,
  PROVIDER_QUOTA_POLICIES,
  getProviderQuotaPolicy,
  credentialFailureAction,
  quotaScopeFromError,
};
