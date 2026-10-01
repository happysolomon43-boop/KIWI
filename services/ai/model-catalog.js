'use strict';

const { AI_PROVIDERS, assertProviderId, providerModelKey } = require('./providers');

const MODEL_FAMILIES = Object.freeze({
  FLASH: 'FLASH',
  FLASH_LITE: 'FLASH_LITE',
});

const MODEL_CHANNELS = Object.freeze({
  STABLE: 'STABLE',
  PREVIEW: 'PREVIEW',
  EXPERIMENTAL: 'EXPERIMENTAL',
});

const MODEL_STATUS = Object.freeze({
  APPROVED: 'APPROVED',
  DISCOVERED: 'DISCOVERED',
  QUALIFYING: 'QUALIFYING',
  SUSPENDED: 'SUSPENDED',
  RETIRED: 'RETIRED',
  DENIED: 'DENIED',
});

const MODEL_QUALITY_TIERS = Object.freeze({
  STANDARD: 'STANDARD',
  PREMIUM: 'PREMIUM',
  HIGH_STAKES: 'HIGH_STAKES',
});

const MODEL_IDS = Object.freeze({
  GEMINI_3_8_FLASH: 'gemini-3.8-flash',
  GEMINI_3_5_FLASH: 'gemini-3.5-flash',
  GEMINI_3_5_FLASH_LITE: 'gemini-3.5-flash-lite',
  GEMINI_3_1_FLASH_LITE: 'gemini-3.1-flash-lite',
  QWEN_3_8_27B: 'qwen/qwen3.8-27b',
  ORPHEUS_ENGLISH: 'canopylabs/orpheus-v1-english',
  ORPHEUS_ARABIC_SAUDI: 'canopylabs/orpheus-arabic-saudi',
});

const MODEL_INPUT_MODALITIES = Object.freeze({
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
});

const MODEL_OUTPUT_MODALITIES = Object.freeze({
  TEXT: 'TEXT',
  AUDIO: 'AUDIO',
});

function modelVersionRank(modelId) {
  const match = String(modelId || '').match(/^gemini-(\d+)\.(\d+)(?:\.(\d+))?-(?:flash|flash-lite)$/i);
  if (!match) return 0;
  return ((Number(match[1]) || 0) * 1000000) +
    ((Number(match[2]) || 0) * 1000) +
    (Number(match[3]) || 0);
}

const GOOGLE_INFERENCE_CAPABILITIES = Object.freeze([
  'generateContent',
  'thinking',
  'longOutput',
  'structuredOutput',
]);

const QWEN_INFERENCE_CAPABILITIES = Object.freeze([
  'generateContent',
  'thinking',
  'longOutput',
  'structuredOutput',
  'jsonSchema',
]);

function googleModel({ id, family, qualityTier, supportedThinking }) {
  return Object.freeze({
    id,
    provider: AI_PROVIDERS.GOOGLE,
    family,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank(id),
    qualityTier,
    productionEligible: true,
    supportedThinking: Object.freeze([...supportedThinking]),
    capabilities: GOOGLE_INFERENCE_CAPABILITIES,
    inputModalities: Object.freeze([MODEL_INPUT_MODALITIES.TEXT, MODEL_INPUT_MODALITIES.IMAGE]),
    outputModalities: Object.freeze([MODEL_OUTPUT_MODALITIES.TEXT]),
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    metadata: Object.freeze({ provider: AI_PROVIDERS.GOOGLE }),
  });
}

const DEFAULT_MODEL_CATALOG = Object.freeze([
  googleModel({
    id: MODEL_IDS.GEMINI_3_5_FLASH_LITE,
    family: MODEL_FAMILIES.FLASH_LITE,
    qualityTier: MODEL_QUALITY_TIERS.STANDARD,
    supportedThinking: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  }),
  googleModel({
    id: MODEL_IDS.GEMINI_3_1_FLASH_LITE,
    family: MODEL_FAMILIES.FLASH_LITE,
    qualityTier: MODEL_QUALITY_TIERS.STANDARD,
    supportedThinking: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  }),
  Object.freeze({
    id: MODEL_IDS.QWEN_3_8_27B,
    provider: AI_PROVIDERS.GROQ,
    family: null,
    channel: MODEL_CHANNELS.PREVIEW,
    status: MODEL_STATUS.APPROVED,
    rank: 1,
    qualityTier: MODEL_QUALITY_TIERS.PREMIUM,
    productionEligible: true,
    supportedThinking: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    capabilities: QWEN_INFERENCE_CAPABILITIES,
    // Qwen is deliberately TEXT-only in active routing. Image-bearing requests
    // therefore remain on Gemini through ordinary capability filtering; there
    // is no separate vision route or provider policy.
    inputModalities: Object.freeze([MODEL_INPUT_MODALITIES.TEXT]),
    outputModalities: Object.freeze([MODEL_OUTPUT_MODALITIES.TEXT]),
    inputTokenLimit: 131072,
    outputTokenLimit: 16384,
    metadata: Object.freeze({ provider: AI_PROVIDERS.GROQ }),
  }),
  googleModel({
    id: MODEL_IDS.GEMINI_3_8_FLASH,
    family: MODEL_FAMILIES.FLASH,
    qualityTier: MODEL_QUALITY_TIERS.HIGH_STAKES,
    supportedThinking: ['LOW', 'MEDIUM', 'HIGH'],
  }),
  googleModel({
    id: MODEL_IDS.GEMINI_3_5_FLASH,
    family: MODEL_FAMILIES.FLASH,
    qualityTier: MODEL_QUALITY_TIERS.PREMIUM,
    supportedThinking: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
  }),
]);

function cloneModel(model) {
  if (!model) return null;
  return {
    ...model,
    supportedThinking: [...(model.supportedThinking || [])],
    capabilities: [...(model.capabilities || [])],
    inputModalities: [...(model.inputModalities || [MODEL_INPUT_MODALITIES.TEXT])],
    outputModalities: [...(model.outputModalities || [MODEL_OUTPUT_MODALITIES.TEXT])],
    structuredOutputModes: model.structuredOutputModes ? [...model.structuredOutputModes] : undefined,
    metadata: { ...(model.metadata || {}) },
  };
}

function normalizeModel(model) {
  if (!model?.id) throw new Error('AI model catalog entry requires id');
  const provider = assertProviderId(model.provider || model.metadata?.provider || AI_PROVIDERS.GOOGLE);
  return cloneModel({
    ...model,
    provider,
    metadata: { ...(model.metadata || {}), provider },
  });
}

function createModelCatalog(seedModels = DEFAULT_MODEL_CATALOG) {
  const models = new Map();
  const idIndex = new Map();

  function store(model) {
    const normalized = normalizeModel(model);
    const key = providerModelKey(normalized.provider, normalized.id);
    models.set(key, normalized);
    if (!idIndex.has(normalized.id)) idIndex.set(normalized.id, new Set());
    idIndex.get(normalized.id).add(key);
    return normalized;
  }

  for (const model of seedModels) store(model);

  function get(modelOrRef, provider = null) {
    if (modelOrRef && typeof modelOrRef === 'object') {
      const key = providerModelKey(modelOrRef.provider, modelOrRef.modelId || modelOrRef.id);
      return cloneModel(models.get(key));
    }
    const id = String(modelOrRef || '').trim();
    if (!id) return null;
    if (provider) return cloneModel(models.get(providerModelKey(provider, id)));
    if (id.includes('::') && models.has(id)) return cloneModel(models.get(id));
    const keys = [...(idIndex.get(id) || [])];
    if (keys.length !== 1) return null;
    return cloneModel(models.get(keys[0]));
  }

  function list({
    provider = null,
    family = null,
    channel = null,
    status = null,
    requiredCapabilities = [],
    requiredInputModalities = [],
    productionEligible = null,
  } = {}) {
    const normalizedProvider = provider ? assertProviderId(provider) : null;
    return [...models.values()]
      .filter((model) => !normalizedProvider || model.provider === normalizedProvider)
      .filter((model) => !family || model.family === family)
      .filter((model) => !channel || model.channel === channel)
      .filter((model) => !status || model.status === status)
      .filter((model) => productionEligible == null || Boolean(model.productionEligible) === Boolean(productionEligible))
      .filter((model) => requiredCapabilities.every((capability) => model.capabilities.includes(capability)))
      .filter((model) => requiredInputModalities.every((modality) => model.inputModalities.includes(modality)))
      .sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id))
      .map(cloneModel);
  }

  function latestApproved(family, { excludeIds = [] } = {}) {
    const excluded = new Set(excludeIds);
    return list({
      family,
      channel: MODEL_CHANNELS.STABLE,
      status: MODEL_STATUS.APPROVED,
      productionEligible: true,
    }).find((model) => !excluded.has(model.id)) || null;
  }

  function upsert(model) {
    if (!model?.id) throw new Error('AI model catalog entry requires id');
    const provider = assertProviderId(model.provider || model.metadata?.provider || AI_PROVIDERS.GOOGLE);
    const prior = get(model.id, provider) || {};
    store({ ...prior, ...model, provider });
    return get(model.id, provider);
  }

  function setStatus(modelOrRef, status, provider = null) {
    const current = get(modelOrRef, provider);
    if (!current) return null;
    return upsert({ ...current, status });
  }

  return Object.freeze({ get, list, latestApproved, upsert, setStatus });
}

function modelMeetsCapabilities(model, capabilities = [], inputModalities = []) {
  return Boolean(model) &&
    capabilities.every((capability) => model.capabilities?.includes(capability)) &&
    inputModalities.every((modality) => model.inputModalities?.includes(modality));
}

// Compatibility names retained only for non-routing consumers while they are
// migrated. They point at the neutral identifiers and do not define routing.
const GOOGLE_MODEL_IDS = Object.freeze({
  GEMINI_3_8_FLASH: MODEL_IDS.GEMINI_3_8_FLASH,
});
const GROQ_MODEL_IDS = Object.freeze({
  QWEN_3_8_27B: MODEL_IDS.QWEN_3_8_27B,
});
const GROQ_SPEECH_MODEL_IDS = Object.freeze({
  ORPHEUS_ENGLISH: MODEL_IDS.ORPHEUS_ENGLISH,
  ORPHEUS_ARABIC_SAUDI: MODEL_IDS.ORPHEUS_ARABIC_SAUDI,
});

module.exports = {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  MODEL_QUALITY_TIERS,
  MODEL_IDS,
  MODEL_INPUT_MODALITIES,
  MODEL_OUTPUT_MODALITIES,
  GOOGLE_INFERENCE_CAPABILITIES,
  QWEN_INFERENCE_CAPABILITIES,
  DEFAULT_MODEL_CATALOG,
  GOOGLE_MODEL_IDS,
  GROQ_MODEL_IDS,
  GROQ_SPEECH_MODEL_IDS,
  modelVersionRank,
  modelMeetsCapabilities,
  createModelCatalog,
};
