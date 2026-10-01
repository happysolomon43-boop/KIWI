'use strict';

const { AI_PROVIDERS, assertProviderId } = require('./providers');

const DEFAULT_MAX_PROVIDER_CREDENTIALS = 15;

function indexedEnvName(baseName, index) {
  return index === 1 ? baseName : `${baseName}_${index}`;
}

function buildCredentialSlots(env, {
  provider,
  envBaseName,
  idPrefix,
  secretField,
  maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS,
} = {}) {
  const normalizedProvider = assertProviderId(provider);
  const slots = [];
  for (let index = 1; index <= Math.max(1, Number(maxKeys) || DEFAULT_MAX_PROVIDER_CREDENTIALS); index++) {
    const envName = indexedEnvName(envBaseName, index);
    const raw = env?.[envName];
    if (!raw || !String(raw).trim()) continue;
    slots.push({
      id: `${idPrefix}-${String(index).padStart(2, '0')}`,
      index,
      provider: normalizedProvider,
      envName,
      [secretField]: String(raw).trim(),
      enabled: true,
      disabledReason: null,
      disabledAt: null,
    });
  }
  return slots;
}

function createRotatingPool(slots = [], { clock = () => Date.now() } = {}) {
  const state = slots.map((slot) => ({ ...slot }));
  const cursors = new Map();

  function enabled(excluded = []) {
    const deny = new Set(excluded);
    return state.filter((slot) => slot.enabled !== false && !deny.has(slot.id));
  }

  function order(routeKey, { excludeSlotIds = [], advance = true } = {}) {
    const available = enabled(excludeSlotIds);
    if (!available.length) return [];
    const key = String(routeKey || '__default__');
    const start = (cursors.get(key) || 0) % available.length;
    const ordered = available.map((_, offset) => available[(start + offset) % available.length]);
    if (advance) cursors.set(key, (start + 1) % available.length);
    return ordered;
  }

  function disable(slotId, reason = 'disabled') {
    const slot = state.find((entry) => entry.id === slotId);
    if (!slot) return false;
    slot.enabled = false;
    slot.disabledReason = reason;
    slot.disabledAt = new Date(Number(clock()) || Date.now()).toISOString();
    return true;
  }

  function enable(slotId) {
    const slot = state.find((entry) => entry.id === slotId);
    if (!slot) return false;
    slot.enabled = true;
    slot.disabledReason = null;
    slot.disabledAt = null;
    return true;
  }

  function get(slotId) {
    return state.find((entry) => entry.id === slotId) || null;
  }

  function snapshot() {
    return state.map(({ apiKey, apiToken, credential, ...safe }) => ({ ...safe }));
  }

  return Object.freeze({
    count: () => state.length,
    enabledCount: () => enabled().length,
    ordered: (routeKey, options = {}) => order(routeKey, { ...options, advance: true }),
    peek: (routeKey, options = {}) => order(routeKey, { ...options, advance: false }),
    disable,
    enable,
    get,
    snapshot,
  });
}

function createCredentialRegistry({
  env = process.env,
  maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS,
  clock,
} = {}) {
  const pools = new Map([
    [AI_PROVIDERS.GOOGLE, createRotatingPool(buildCredentialSlots(env, {
      provider: AI_PROVIDERS.GOOGLE,
      envBaseName: 'GEMINI_API_KEY',
      idPrefix: 'google-key',
      secretField: 'apiKey',
      maxKeys,
    }), { clock })],
    [AI_PROVIDERS.GROQ, createRotatingPool(buildCredentialSlots(env, {
      provider: AI_PROVIDERS.GROQ,
      envBaseName: 'GROQ_API_KEY',
      idPrefix: 'groq-key',
      secretField: 'apiKey',
      maxKeys,
    }), { clock })],
    [AI_PROVIDERS.CLOUDFLARE, createRotatingPool(buildCredentialSlots(env, {
      provider: AI_PROVIDERS.CLOUDFLARE,
      envBaseName: 'CLOUDFLARE_WORKERS_AI_API_TOKEN',
      idPrefix: 'cloudflare-token',
      secretField: 'apiToken',
      maxKeys,
    }), { clock })],
  ]);

  function requirePool(provider) {
    const normalized = assertProviderId(provider);
    const pool = pools.get(normalized);
    if (!pool) throw new Error(`No credential pool configured for ${normalized}`);
    return pool;
  }

  function ordered(provider, routeKey, options = {}) {
    const normalized = assertProviderId(provider);
    const result = requirePool(normalized).ordered(routeKey, options);
    // Groq keys generally share org/project rate limits. Rotate one credential
    // per provider attempt instead of sweeping the key set after a 429.
    return normalized === AI_PROVIDERS.GROQ ? result.slice(0, 1) : result;
  }

  function peek(provider, routeKey, options = {}) {
    const normalized = assertProviderId(provider);
    const result = requirePool(normalized).peek(routeKey, options);
    return normalized === AI_PROVIDERS.GROQ ? result.slice(0, 1) : result;
  }

  function snapshot(provider = null) {
    if (provider) return requirePool(provider).snapshot();
    return [...pools.values()].flatMap((pool) => pool.snapshot());
  }

  function get(slotId) {
    for (const pool of pools.values()) {
      const slot = pool.get(slotId);
      if (slot) return slot;
    }
    return null;
  }

  function disable(provider, slotId, reason) {
    return requirePool(provider).disable(slotId, reason);
  }

  function enable(provider, slotId) {
    return requirePool(provider).enable(slotId);
  }

  return Object.freeze({
    ordered,
    peek,
    snapshot,
    get,
    disable,
    enable,
    count: () => [...pools.values()].reduce((sum, pool) => sum + pool.count(), 0),
    enabledCount: () => [...pools.values()].reduce((sum, pool) => sum + pool.enabledCount(), 0),
    enabledCountFor: (provider) => requirePool(provider).enabledCount(),
  });
}

module.exports = {
  DEFAULT_MAX_PROVIDER_CREDENTIALS,
  indexedEnvName,
  buildCredentialSlots,
  createRotatingPool,
  createCredentialRegistry,
};
