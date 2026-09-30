'use strict';

const AI_PROVIDERS = Object.freeze({
  GOOGLE: 'GOOGLE',
  GROQ: 'GROQ',
  CLOUDFLARE: 'CLOUDFLARE',
  KROKI: 'KROKI',
});

const LEGACY_PROVIDER_ALIASES = Object.freeze({
  GEMINI: AI_PROVIDERS.GOOGLE,
  GOOGLE_GEMINI: AI_PROVIDERS.GOOGLE,
});

function normalizeProviderId(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(AI_PROVIDERS, normalized)) {
    return AI_PROVIDERS[normalized];
  }
  return LEGACY_PROVIDER_ALIASES[normalized] || null;
}

function assertProviderId(value) {
  const provider = normalizeProviderId(value);
  if (!provider) {
    throw new Error(`Unsupported AI provider: ${value}`);
  }
  return provider;
}

function providerModelKey(provider, modelId) {
  const normalizedProvider = assertProviderId(provider);
  const normalizedModelId = String(modelId || '').trim();
  if (!normalizedModelId) throw new Error('Provider model key requires modelId');
  return `${normalizedProvider}::${normalizedModelId}`;
}

function createProviderModelRef({ provider, modelId }) {
  const normalizedProvider = assertProviderId(provider);
  const normalizedModelId = String(modelId || '').trim();
  if (!normalizedModelId) throw new Error('Provider model reference requires modelId');

  return Object.freeze({
    provider: normalizedProvider,
    modelId: normalizedModelId,
    key: providerModelKey(normalizedProvider, normalizedModelId),
  });
}

module.exports = {
  AI_PROVIDERS,
  LEGACY_PROVIDER_ALIASES,
  normalizeProviderId,
  assertProviderId,
  providerModelKey,
  createProviderModelRef,
};
