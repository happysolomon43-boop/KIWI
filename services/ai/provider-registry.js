'use strict';

const { assertProviderId } = require('./providers');

function assertProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('AI provider adapter must be an object');
  }

  const provider = assertProviderId(adapter.provider);
  if (typeof adapter.generate !== 'function') {
    throw new Error(`AI provider adapter ${provider} requires generate()`);
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

  function requireAdapter(provider) {
    const normalizedProvider = assertProviderId(provider);
    const adapter = adapters.get(normalizedProvider);
    if (!adapter) throw new Error(`No AI provider adapter registered for ${normalizedProvider}`);
    return adapter;
  }

  function list() {
    return Object.freeze([...adapters.keys()]);
  }

  for (const adapter of initialAdapters || []) register(adapter);

  return Object.freeze({
    register,
    unregister,
    get,
    require: requireAdapter,
    list,
  });
}

module.exports = {
  assertProviderAdapter,
  createProviderRegistry,
};
