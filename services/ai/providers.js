'use strict';

const AI_PROVIDERS = Object.freeze({
  GOOGLE: 'GOOGLE',
  GROQ: 'GROQ',
  CLOUDFLARE: 'CLOUDFLARE',
  KROKI: 'KROKI',
});

function normalizeProviderId(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(AI_PROVIDERS, normalized)
    ? AI_PROVIDERS[normalized]
    : null;
}

function assertProviderId(value) {
  const provider = normalizeProviderId(value);
  if (!provider) throw new Error(`Unsupported AI provider: ${value}`);
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
  normalizeProviderId,
  assertProviderId,
  providerModelKey,
  createProviderModelRef,
};
