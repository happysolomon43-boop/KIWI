'use strict';

const { assertProviderId } = require('./providers');

const PROVIDER_OPERATIONS = Object.freeze([
  'generate',
  'synthesizeSpeech',
  'generateImage',
  'renderDiagram',
]);

function adapterOperations(adapter) {
  return PROVIDER_OPERATIONS.filter((operation) => typeof adapter?.[operation] === 'function');
}

function assertProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('AI provider adapter must be an object');
  }

  const provider = assertProviderId(adapter.provider);
  if (!adapterOperations(adapter).length) {
    throw new Error(`AI provider adapter ${provider} exposes no supported capability operation`);
  }
  return provider;
}

function createProviderRegistry(initialAdapters = []) {
  const adapters = new Map();

  function register(adapter) {
    const provider = assertProviderAdapter(adapter);
    adapters.set(provider, adapter);
    return adapter;
  }

  function unregister(provider) {
    return adapters.delete(assertProviderId(provider));
  }

  function get(provider) {
    return adapters.get(assertProviderId(provider)) || null;
  }

  function requireAdapter(provider, operation = null) {
    const normalizedProvider = assertProviderId(provider);
    const adapter = adapters.get(normalizedProvider);
    if (!adapter) throw new Error(`No AI provider adapter registered for ${normalizedProvider}`);
    if (operation && typeof adapter[operation] !== 'function') {
      throw new Error(`AI provider ${normalizedProvider} does not implement ${operation}()`);
    }
    return adapter;
  }

  function supports(provider, operation) {
    const adapter = get(provider);
    return Boolean(adapter && PROVIDER_OPERATIONS.includes(operation) && typeof adapter[operation] === 'function');
  }

  function list() {
    return Object.freeze([...adapters.entries()].map(([provider, adapter]) => Object.freeze({
      provider,
      operations: Object.freeze(adapterOperations(adapter)),
    })));
  }

  for (const adapter of initialAdapters || []) register(adapter);

  return Object.freeze({
    register,
    unregister,
    get,
    require: requireAdapter,
    supports,
    list,
  });
}

module.exports = {
  PROVIDER_OPERATIONS,
  adapterOperations,
  assertProviderAdapter,
  createProviderRegistry,
};
