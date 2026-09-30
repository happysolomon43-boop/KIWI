'use strict';

const { AI_PROVIDERS } = require('./providers');
const { GROQ_MODEL_IDS } = require('./model-catalog');

const DEFAULT_MAX_PROVIDER_CREDENTIALS = 15;

const CREDENTIAL_STATES = Object.freeze({
  READY: 'READY',
  DISABLED: 'DISABLED',
});

function indexedEnvName(baseName, index) {
  return index === 1 ? baseName : `${baseName}_${index}`;
}

function buildProviderCredentialSlots(env = process.env, {
  envBaseName,
  idPrefix,
  secretField = 'credential',
  provider = null,
  maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS,
} = {}) {
  if (!envBaseName || !idPrefix) {
    throw new Error('Provider credential slots require envBaseName and idPrefix');
  }
  if (!secretField) {
    throw new Error('Provider credential slots require secretField');
  }

  const slots = [];
  const safeMaxKeys = Math.max(1, Number(maxKeys) || DEFAULT_MAX_PROVIDER_CREDENTIALS);

  for (let index = 1; index <= safeMaxKeys; index++) {
    const envName = indexedEnvName(baseNameOrThrow(envBaseName), index);
    const raw = env?.[envName];
    if (!raw || !String(raw).trim()) continue;

    slots.push({
      id: `${idPrefix}-${String(index).padStart(2, '0')}`,
      index,
      provider,
      envName,
      [secretField]: String(raw).trim(),
      enabled: true,
      disabledReason: null,
      disabledAt: null,
      lastEnabledAt: null,
    });
  }

  return slots;
}

function baseNameOrThrow(value) {
  if (!value) throw new Error('Provider credential environment base name is required');
  return value;
}

function createRotatingCredentialPool({
  slots: suppliedSlots = [],
  clock = () => Date.now(),
} = {}) {
  const slots = suppliedSlots.map((slot) => ({
    ...slot,
    enabled: slot.enabled !== false,
    disabledReason: slot.disabledReason || null,
    disabledAt: slot.disabledAt || null,
    lastEnabledAt: slot.lastEnabledAt || null,
  }));

  const cursors = new Map();

  function nowIso() {
    const raw = clock();
    const value = raw instanceof Date ? raw.getTime() : Number(raw);
    return new Date(Number.isFinite(value) ? value : Date.now()).toISOString();
  }

  function enabledSlots(excludeSlotIds = []) {
    const excluded = new Set(excludeSlotIds);
    return slots.filter((slot) => slot.enabled && !excluded.has(slot.id));
  }

  function orderForRoute(routeKey, { excludeSlotIds = [], advance = false } = {}) {
    const available = enabledSlots(excludeSlotIds);
    if (available.length === 0) return [];

    const cursorKey = String(routeKey || '__default__');
    const start = cursors.get(cursorKey) || 0;
    const normalizedStart = start % available.length;
    const ordered = [];

    for (let offset = 0; offset < available.length; offset++) {
      ordered.push(available[(normalizedStart + offset) % available.length]);
    }

    if (advance) cursors.set(cursorKey, (normalizedStart + 1) % available.length);
    return ordered;
  }

  function orderedSlots(routeKey, options = {}) {
    return orderForRoute(routeKey, { ...options, advance: true });
  }

  function peekOrderedSlots(routeKey, options = {}) {
    return orderForRoute(routeKey, { ...options, advance: false });
  }

  function disable(slotId, reason = 'disabled') {
    const slot = slots.find((item) => item.id === slotId);
    if (!slot) return false;
    slot.enabled = false;
    slot.disabledReason = reason;
    slot.disabledAt = nowIso();
    return true;
  }

  function enable(slotId) {
    const slot = slots.find((item) => item.id === slotId);
    if (!slot) return false;
    slot.enabled = true;
    slot.disabledReason = null;
    slot.disabledAt = null;
    slot.lastEnabledAt = nowIso();
    return true;
  }

  function get(slotId) {
    return slots.find((item) => item.id === slotId) || null;
  }

  function snapshot() {
    return slots.map((slot) => ({
      id: slot.id,
      index: slot.index,
      provider: slot.provider || null,
      envName: slot.envName,
      enabled: slot.enabled,
      state: slot.enabled ? CREDENTIAL_STATES.READY : CREDENTIAL_STATES.DISABLED,
      disabledReason: slot.disabledReason,
      disabledAt: slot.disabledAt || null,
      lastEnabledAt: slot.lastEnabledAt || null,
    }));
  }

  return Object.freeze({
    count: () => slots.length,
    enabledCount: () => slots.filter((slot) => slot.enabled).length,
    orderedSlots,
    peekOrderedSlots,
    disable,
    enable,
    get,
    snapshot,
  });
}

function buildProjectSlots(env = process.env, maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS) {
  return buildProviderCredentialSlots(env, {
    envBaseName: 'GEMINI_API_KEY',
    idPrefix: 'gemini-project',
    secretField: 'apiKey',
    provider: AI_PROVIDERS.GOOGLE,
    maxKeys,
  });
}

function buildGroqCredentialSlots(env = process.env, maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS) {
  return buildProviderCredentialSlots(env, {
    envBaseName: 'GROQ_API_KEY',
    idPrefix: 'groq-key',
    secretField: 'apiKey',
    provider: AI_PROVIDERS.GROQ,
    maxKeys,
  });
}

function createGroqCredentialPool({
  env = process.env,
  maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS,
  slots: suppliedSlots = null,
  clock,
} = {}) {
  return createRotatingCredentialPool({
    slots: suppliedSlots || buildGroqCredentialSlots(env, maxKeys),
    clock,
  });
}

const GROQ_MODEL_ID_SET = new Set(Object.values(GROQ_MODEL_IDS));

function providerForRoute(routeKey) {
  const text = String(routeKey || '');
  const modelId = text.includes('::') ? text.split('::').pop() : text;
  return GROQ_MODEL_ID_SET.has(modelId) ? AI_PROVIDERS.GROQ : AI_PROVIDERS.GOOGLE;
}

function createProjectPool({
  env = process.env,
  maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS,
  slots: suppliedSlots = null,
  clock,
} = {}) {
  const googlePool = createRotatingCredentialPool({
    slots: suppliedSlots || buildProjectSlots(env, maxKeys),
    clock,
  });
  const groqPool = createGroqCredentialPool({ env, maxKeys, clock });

  function poolForRoute(routeKey) {
    return providerForRoute(routeKey) === AI_PROVIDERS.GROQ
      ? groqPool
      : googlePool;
  }

  function poolForSlot(slotId) {
    if (groqPool.get(slotId)) return groqPool;
    if (googlePool.get(slotId)) return googlePool;
    return null;
  }

  function productionSlots(routeKey, options = {}, advance = false) {
    const provider = providerForRoute(routeKey);
    const pool = poolForRoute(routeKey);
    const ordered = advance
      ? pool.orderedSlots(routeKey, options)
      : pool.peekOrderedSlots(routeKey, options);

    if (provider !== AI_PROVIDERS.GROQ) return ordered;

    // Groq credentials commonly share organization/project rate limits. One
    // provider attempt must therefore never sweep every configured key after a
    // 429. Expose one rotating credential per model attempt; auth failures still
    // disable that credential centrally, and subsequent model/request attempts
    // naturally move to another enabled credential.
    return ordered.slice(0, 1);
  }

  return Object.freeze({
    count: () => googlePool.count() + groqPool.count(),
    enabledCount: () => googlePool.enabledCount() + groqPool.enabledCount(),
    orderedSlots: (routeKey, options = {}) => productionSlots(routeKey, options, true),
    peekOrderedSlots: (routeKey, options = {}) => productionSlots(routeKey, options, false),
    disable: (slotId, reason) => poolForSlot(slotId)?.disable(slotId, reason) || false,
    enable: (slotId) => poolForSlot(slotId)?.enable(slotId) || false,
    get: (slotId) => poolForSlot(slotId)?.get(slotId) || null,
    snapshot: () => [...googlePool.snapshot(), ...groqPool.snapshot()],
    providerSnapshot: (provider) => (
      provider === AI_PROVIDERS.GROQ ? groqPool.snapshot() : googlePool.snapshot()
    ),
  });
}

function buildCloudflareCredentialSlots(env = process.env, maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS) {
  return buildProviderCredentialSlots(env, {
    envBaseName: 'CLOUDFLARE_WORKERS_AI_API_TOKEN',
    idPrefix: 'cloudflare-token',
    secretField: 'apiToken',
    provider: AI_PROVIDERS.CLOUDFLARE,
    maxKeys,
  });
}

function createCloudflareCredentialPool({
  env = process.env,
  maxKeys = DEFAULT_MAX_PROVIDER_CREDENTIALS,
  slots: suppliedSlots = null,
  clock,
} = {}) {
  return createRotatingCredentialPool({
    slots: suppliedSlots || buildCloudflareCredentialSlots(env, maxKeys),
    clock,
  });
}

module.exports = {
  DEFAULT_MAX_PROVIDER_CREDENTIALS,
  CREDENTIAL_STATES,
  indexedEnvName,
  buildProviderCredentialSlots,
  createRotatingCredentialPool,
  buildProjectSlots,
  createProjectPool,
  buildGroqCredentialSlots,
  createGroqCredentialPool,
  providerForRoute,
  buildCloudflareCredentialSlots,
  createCloudflareCredentialPool,
};
