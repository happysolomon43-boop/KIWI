'use strict';

const { AI_PROVIDERS, assertProviderId, providerModelKey } = require('./providers');
const {
  AI_CAPABILITIES,
  AI_INPUT_MODALITIES,
  AI_OUTPUT_MODALITIES,
  modelSatisfies,
} = require('./capabilities');

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

const MODEL_IDS = Object.freeze({
  GEMINI_3_8_FLASH: 'gemini-3.8-flash',
  GEMINI_3_5_FLASH: 'gemini-3.5-flash',
  GEMINI_3_5_FLASH_LITE: 'gemini-3.5-flash-lite',
  GEMINI_3_1_FLASH_LITE: 'gemini-3.1-flash-lite',
  QWEN_3_8_27B: 'qwen/qwen3.8-27b',
  ORPHEUS_ENGLISH: 'canopylabs/orpheus-v1-english',
  ORPHEUS_ARABIC_SAUDI: 'canopylabs/orpheus-arabic-saudi',
  FLUX_2_DEV: '@cf/black-forest-labs/flux-2-dev',
  KROKI: 'kroki',
});

function modelVersionRank(modelId) {
  const match = String(modelId || '').match(/^gemini-(\d+)\.(\d+)(?:\.(\d+))?-(?:flash|flash-lite)$/i);
  if (!match) return 0;
  return ((Number(match[1]) || 0) * 1000000) +
    ((Number(match[2]) || 0) * 1000) +
    (Number(match[3]) || 0);
}

const STANDARD_INFERENCE_CAPABILITIES = Object.freeze([
  AI_CAPABILITIES.INFERENCE,
  AI_CAPABILITIES.REASONING,
  AI_CAPABILITIES.STRUCTURED_OUTPUT,
  AI_CAPABILITIES.LONG_OUTPUT,
]);

function inferenceModel({
  provider,
  id,
  family = null,
  channel = MODEL_CHANNELS.STABLE,
  rank = null,
  supportedReasoning = [],
  inputModalities = [AI_INPUT_MODALITIES.TEXT],
  inputTokenLimit = null,
  outputTokenLimit = null,
  metadata = {},
} = {}) {
  const normalizedProvider = assertProviderId(provider);
  return Object.freeze({
    id,
    provider: normalizedProvider,
    routeKey: providerModelKey(normalizedProvider, id),
    family,
    channel,
    status: MODEL_STATUS.APPROVED,
    rank: rank == null ? modelVersionRank(id) : Number(rank) || 0,
    productionEligible: true,
    supportedReasoning: Object.freeze([...supportedReasoning]),
    capabilities: STANDARD_INFERENCE_CAPABILITIES,
    inputModalities: Object.freeze([...inputModalities]),
    outputModalities: Object.freeze([AI_OUTPUT_MODALITIES.TEXT]),
    inputTokenLimit,
    outputTokenLimit,
    metadata: Object.freeze({ ...metadata }),
  });
}

function capabilityModel({
  provider,
  id,
  capability,
  inputModalities = [AI_INPUT_MODALITIES.TEXT],
  outputModalities = [],
  rank = 1,
  channel = MODEL_CHANNELS.STABLE,
  metadata = {},
} = {}) {
  const normalizedProvider = assertProviderId(provider);
  return Object.freeze({
    id,
    provider: normalizedProvider,
    routeKey: providerModelKey(normalizedProvider, id),
    family: null,
    channel,
    status: MODEL_STATUS.APPROVED,
    rank: Number(rank) || 1,
    productionEligible: true,
    supportedReasoning: Object.freeze([]),
    capabilities: Object.freeze([capability]),
    inputModalities: Object.freeze([...inputModalities]),
    outputModalities: Object.freeze([...outputModalities]),
    inputTokenLimit: null,
    outputTokenLimit: null,
    metadata: Object.freeze({ ...metadata }),
  });
}

const DEFAULT_MODEL_CATALOG = Object.freeze([
  inferenceModel({ provider: AI_PROVIDERS.GOOGLE, id: MODEL_IDS.GEMINI_3_5_FLASH_LITE, family: MODEL_FAMILIES.FLASH_LITE, supportedReasoning: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'], inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE], inputTokenLimit: 1048576, outputTokenLimit: 65536 }),
  inferenceModel({ provider: AI_PROVIDERS.GOOGLE, id: MODEL_IDS.GEMINI_3_1_FLASH_LITE, family: MODEL_FAMILIES.FLASH_LITE, supportedReasoning: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'], inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE], inputTokenLimit: 1048576, outputTokenLimit: 65536 }),
  inferenceModel({ provider: AI_PROVIDERS.GROQ, id: MODEL_IDS.QWEN_3_8_27B, channel: MODEL_CHANNELS.PREVIEW, rank: 1, supportedReasoning: ['LOW', 'MEDIUM', 'HIGH'], inputModalities: [AI_INPUT_MODALITIES.TEXT], inputTokenLimit: 131072, outputTokenLimit: 16384 }),
  inferenceModel({ provider: AI_PROVIDERS.GOOGLE, id: MODEL_IDS.GEMINI_3_8_FLASH, family: MODEL_FAMILIES.FLASH, supportedReasoning: ['LOW', 'MEDIUM', 'HIGH'], inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE], inputTokenLimit: 1048576, outputTokenLimit: 65536 }),
  inferenceModel({ provider: AI_PROVIDERS.GOOGLE, id: MODEL_IDS.GEMINI_3_5_FLASH, family: MODEL_FAMILIES.FLASH, supportedReasoning: ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'], inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE], inputTokenLimit: 1048576, outputTokenLimit: 65536 }),
  capabilityModel({ provider: AI_PROVIDERS.GROQ, id: MODEL_IDS.ORPHEUS_ENGLISH, capability: AI_CAPABILITIES.SPEECH_SYNTHESIS, outputModalities: [AI_OUTPUT_MODALITIES.AUDIO], metadata: { language: 'en', responseFormat: 'wav' } }),
  capabilityModel({ provider: AI_PROVIDERS.GROQ, id: MODEL_IDS.ORPHEUS_ARABIC_SAUDI, capability: AI_CAPABILITIES.SPEECH_SYNTHESIS, outputModalities: [AI_OUTPUT_MODALITIES.AUDIO], metadata: { language: 'ar-SA', responseFormat: 'wav' } }),
  capabilityModel({ provider: AI_PROVIDERS.CLOUDFLARE, id: MODEL_IDS.FLUX_2_DEV, capability: AI_CAPABILITIES.IMAGE_GENERATION, outputModalities: [AI_OUTPUT_MODALITIES.IMAGE], metadata: { generation: 'FLUX_2', variant: 'DEV', defaultSteps: 33, maxSteps: 50, illustrativeOnly: true } }),
  capabilityModel({ provider: AI_PROVIDERS.KROKI, id: MODEL_IDS.KROKI, capability: AI_CAPABILITIES.DIAGRAM_RENDER, outputModalities: [AI_OUTPUT_MODALITIES.SVG], metadata: { deterministic: true, responseFormat: 'svg' } }),
]);

function isProductionRoutableModel(model) {
  return Boolean(model && model.status === MODEL_STATUS.APPROVED && model.productionEligible === true);
}

function cloneModel(model) {
  if (!model) return null;
  return { ...model, supportedReasoning: [...(model.supportedReasoning || [])], capabilities: [...(model.capabilities || [])], inputModalities: [...(model.inputModalities || [])], outputModalities: [...(model.outputModalities || [])], metadata: { ...(model.metadata || {}) } };
}

function normalizeModel(model) {
  if (!model?.id) throw new Error('AI model catalog entry requires id');
  const provider = assertProviderId(model.provider);
  return cloneModel({ ...model, provider, routeKey: providerModelKey(provider, model.id) });
}

function createModelCatalog(seedModels = DEFAULT_MODEL_CATALOG) {
  const models = new Map();
  function store(model) { const normalized = normalizeModel(model); models.set(normalized.routeKey, normalized); return normalized; }
  for (const model of seedModels || []) store(model);
  function get(ref, provider = null) {
    if (!ref) return null;
    if (typeof ref === 'object') { const key = ref.routeKey || providerModelKey(ref.provider, ref.modelId || ref.id); return cloneModel(models.get(key)); }
    const value = String(ref).trim();
    if (!value) return null;
    if (value.includes('::')) return cloneModel(models.get(value));
    if (provider) return cloneModel(models.get(providerModelKey(provider, value)));
    const matches = [...models.values()].filter((model) => model.id === value);
    return matches.length === 1 ? cloneModel(matches[0]) : null;
  }
  function list({ provider = null, family = null, channel = null, status = null, productionEligible = null, requiredCapabilities = [], requiredInputModalities = [], requiredOutputModalities = [] } = {}) {
    const normalizedProvider = provider ? assertProviderId(provider) : null;
    return [...models.values()]
      .filter((model) => !normalizedProvider || model.provider === normalizedProvider)
      .filter((model) => !family || model.family === family)
      .filter((model) => !channel || model.channel === channel)
      .filter((model) => !status || model.status === status)
      .filter((model) => productionEligible == null || Boolean(model.productionEligible) === Boolean(productionEligible))
      .filter((model) => modelSatisfies({ model, capabilities: requiredCapabilities, inputModalities: requiredInputModalities, outputModalities: requiredOutputModalities }))
      .sort((a, b) => b.rank - a.rank || a.routeKey.localeCompare(b.routeKey))
      .map(cloneModel);
  }
  function latestApproved(family, { provider = null, excludeIds = [] } = {}) {
    const excluded = new Set(excludeIds);
    return list({ provider, family, channel: MODEL_CHANNELS.STABLE }).find((model) => isProductionRoutableModel(model) && !excluded.has(model.id)) || null;
  }
  function firstApprovedCapability(capability, { provider = null } = {}) {
    return list({ provider, requiredCapabilities: [capability] }).find(isProductionRoutableModel) || null;
  }
  function upsert(model) {
    if (!model?.id || !model?.provider) throw new Error('AI model catalog entry requires provider and id');
    const prior = get(model.id, model.provider) || {};
    return cloneModel(store({ ...prior, ...model }));
  }
  function setStatus(ref, status, provider = null) { const current = get(ref, provider); if (!current) return null; return upsert({ ...current, status }); }
  return Object.freeze({ get, list, latestApproved, firstApprovedCapability, upsert, setStatus });
}

module.exports = { MODEL_FAMILIES, MODEL_CHANNELS, MODEL_STATUS, MODEL_IDS, STANDARD_INFERENCE_CAPABILITIES, DEFAULT_MODEL_CATALOG, modelVersionRank, isProductionRoutableModel, inferenceModel, capabilityModel, createModelCatalog };
