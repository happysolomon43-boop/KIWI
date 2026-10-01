'use strict';

const { AI_PROVIDERS, assertProviderId } = require('./providers');

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

const MODEL_QUALITY_RANK = Object.freeze({
  [MODEL_QUALITY_TIERS.STANDARD]: 1,
  [MODEL_QUALITY_TIERS.PREMIUM]: 2,
  [MODEL_QUALITY_TIERS.HIGH_STAKES]: 3,
});

function modelVersionRank(modelId) {
  const match = String(modelId || '').match(/^gemini-(\d+)\.(\d+)(?:\.(\d+))?-(?:flash|flash-lite)$/i);
  if (!match) return 0;
  const major = Number(match[1]) || 0;
  const minor = Number(match[2]) || 0;
  const patch = Number(match[3]) || 0;
  return (major * 1000000) + (minor * 1000) + patch;
}

const COMMON_TEXT_CAPABILITIES = Object.freeze([
  'generateContent',
  'thinking',
  'longOutput',
  'vision',
  'structuredOutput',
]);

const GROQ_TEXT_CAPABILITIES = Object.freeze([
  'generateContent',
  'thinking',
  'longOutput',
  'structuredOutput',
  'jsonSchema',
]);

const GOOGLE_MODEL_IDS = Object.freeze({
  GEMINI_3_8_FLASH: 'gemini-3.8-flash',
});

const GROQ_MODEL_IDS = Object.freeze({
  GPT_OSS_120B: 'openai/gpt-oss-120b',
  GPT_OSS_20B: 'openai/gpt-oss-20b',
  QWEN_3_8_27B: 'qwen/qwen3.8-27b',
});

const GROQ_SPEECH_MODEL_IDS = Object.freeze({
  ORPHEUS_ENGLISH: 'canopylabs/orpheus-v1-english',
  ORPHEUS_ARABIC_SAUDI: 'canopylabs/orpheus-arabic-saudi',
});

const GENERAL_EMERGENCY_FALLBACK_MODEL_ID = 'gemini-3.5-flash-lite';

const DEFAULT_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: GOOGLE_MODEL_IDS.GEMINI_3_8_FLASH,
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank(GOOGLE_MODEL_IDS.GEMINI_3_8_FLASH),
    qualityTier: MODEL_QUALITY_TIERS.HIGH_STAKES,
    productionEligible: true,
    supportedThinking: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.7-flash',
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.7-flash'),
    qualityTier: MODEL_QUALITY_TIERS.HIGH_STAKES,
    productionEligible: true,
    supportedThinking: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.6-flash',
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.6-flash'),
    qualityTier: MODEL_QUALITY_TIERS.PREMIUM,
    productionEligible: true,
    supportedThinking: Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.5-flash',
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.5-flash'),
    qualityTier: MODEL_QUALITY_TIERS.PREMIUM,
    productionEligible: true,
    supportedThinking: Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.5-flash-lite',
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH_LITE,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.5-flash-lite'),
    qualityTier: MODEL_QUALITY_TIERS.STANDARD,
    productionEligible: true,
    supportedThinking: Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.1-flash-lite',
    provider: AI_PROVIDERS.GOOGLE,
    family: MODEL_FAMILIES.FLASH_LITE,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.1-flash-lite'),
    qualityTier: MODEL_QUALITY_TIERS.STANDARD,
    productionEligible: true,
    supportedThinking: Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
]);

// Models in this catalog are known to the production runtime. A model can still
// be productionEligible:false when it is intentionally limited to an explicit
// route override (for example a controlled preview qualification experiment).
const GROQ_PRODUCTION_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: GROQ_MODEL_IDS.GPT_OSS_120B,
    provider: AI_PROVIDERS.GROQ,
    family: null,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    // Rank is an affinity ordering hint, not the provider's parameter count.
    // Keep the Groq-first premium primary above the current Google fallback
    // ranks so a successful cross-provider fallback can become the workflow's
    // lower affinity ceiling instead of bouncing back to Groq on the next pass.
    rank: 5000000,
    qualityTier: MODEL_QUALITY_TIERS.PREMIUM,
    productionEligible: true,
    supportedThinking: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    capabilities: GROQ_TEXT_CAPABILITIES,
    inputModalities: Object.freeze(['TEXT']),
    outputModalities: Object.freeze(['TEXT']),
    inputTokenLimit: 131072,
    outputTokenLimit: 65536,
    structuredOutputModes: Object.freeze(['JSON_OBJECT', 'JSON_SCHEMA_STRICT']),
    reasoningControl: 'reasoning_effort',
    metadata: Object.freeze({
      providerReleaseStatus: 'ACTIVE',
      productionLane: 'AIM_D03_TEXT',
    }),
  }),
  Object.freeze({
    id: GROQ_MODEL_IDS.GPT_OSS_20B,
    provider: AI_PROVIDERS.GROQ,
    family: null,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: 4900000,
    qualityTier: MODEL_QUALITY_TIERS.STANDARD,
    productionEligible: true,
    supportedThinking: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    capabilities: GROQ_TEXT_CAPABILITIES,
    inputModalities: Object.freeze(['TEXT']),
    outputModalities: Object.freeze(['TEXT']),
    inputTokenLimit: 131072,
    outputTokenLimit: 65536,
    structuredOutputModes: Object.freeze(['JSON_OBJECT', 'JSON_SCHEMA_STRICT']),
    reasoningControl: 'reasoning_effort',
    metadata: Object.freeze({
      providerReleaseStatus: 'ACTIVE',
      productionLane: 'AIM_D03_TEXT',
    }),
  }),
  Object.freeze({
    id: GROQ_MODEL_IDS.QWEN_3_8_27B,
    provider: AI_PROVIDERS.GROQ,
    family: null,
    channel: MODEL_CHANNELS.PREVIEW,
    status: MODEL_STATUS.APPROVED,
    // Controlled preview only. The explicit Main CBT route override may admit
    // this model; ordinary Groq routing must continue to ignore it.
    rank: 5100000,
    qualityTier: MODEL_QUALITY_TIERS.PREMIUM,
    productionEligible: false,
    supportedThinking: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    // AIM-D04 owns neutral multimodal execution while this production catalog
    // remains the single source of provider model identity.
    capabilities: GROQ_TEXT_CAPABILITIES,
    inputModalities: Object.freeze(['TEXT', 'IMAGE']),
    outputModalities: Object.freeze(['TEXT']),
    inputTokenLimit: 131072,
    outputTokenLimit: 16384,
    structuredOutputModes: Object.freeze(['JSON_OBJECT', 'JSON_SCHEMA_STRICT']),
    reasoningControl: 'reasoning_effort',
    metadata: Object.freeze({
      providerReleaseStatus: 'PREVIEW',
      productionLane: 'MAIN_CBT_CONTROLLED_TEST',
      controlledRouteOnly: true,
      visionRuntimeQualified: false,
    }),
  }),
]);

// D02's qualification catalog is a frozen historical contract for the two
// GPT-OSS models. Route-scoped preview experiments such as Qwen 3.8 must not
// silently expand that catalog or inherit D02 qualification semantics.
const GROQ_QUALIFICATION_MODEL_CATALOG = Object.freeze(
  GROQ_PRODUCTION_MODEL_CATALOG
    .filter((model) => model.metadata?.controlledRouteOnly !== true)
    .map((model) => Object.freeze({
      ...model,
      status: MODEL_STATUS.QUALIFYING,
      productionEligible: false,
      qualityTier: null,
      metadata: Object.freeze({
        ...(model.metadata || {}),
        qualificationLane: 'AIM_D02_ISOLATED',
      }),
    }))
);

function _cloneModel(model) {
  return {
    ...model,
    provider: model.provider || AI_PROVIDERS.GOOGLE,
    supportedThinking: [...(model.supportedThinking || [])],
    capabilities: [...(model.capabilities || [])],
    inputModalities: model.inputModalities ? [...model.inputModalities] : undefined,
    outputModalities: model.outputModalities ? [...model.outputModalities] : undefined,
    structuredOutputModes: model.structuredOutputModes
      ? [...model.structuredOutputModes]
      : undefined,
    metadata: model.metadata ? { ...model.metadata } : undefined,
  };
}

function _normalizeModel(model) {
  if (!model?.id) throw new Error('AI model catalog entry requires id');
  const provider = assertProviderId(model.provider || AI_PROVIDERS.GOOGLE);
  return _cloneModel({ ...model, provider });
}

function createModelCatalog(seedModels = DEFAULT_MODEL_CATALOG) {
  const models = new Map();
  for (const model of seedModels) {
    const normalized = _normalizeModel(model);
    models.set(normalized.id, normalized);
  }

  function get(modelId) {
    const model = models.get(modelId);
    return model ? _cloneModel(model) : null;
  }

  function list({
    provider = null,
    family = null,
    channel = null,
    status = null,
    requiredCapabilities = [],
  } = {}) {
    const normalizedProvider = provider ? assertProviderId(provider) : null;
    return [...models.values()]
      .filter((model) => !normalizedProvider || model.provider === normalizedProvider)
      .filter((model) => !family || model.family === family)
      .filter((model) => !channel || model.channel === channel)
      .filter((model) => !status || model.status === status)
      .filter((model) => requiredCapabilities.every(
        (capability) => model.capabilities.includes(capability)
      ))
      .sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id))
      .map(_cloneModel);
  }

  function upsert(model) {
    if (!model?.id) throw new Error('AI model catalog entry requires id');
    const prior = models.get(model.id) || {};
    const normalized = _normalizeModel({
      ...prior,
      ...model,
      provider: model.provider || prior.provider || AI_PROVIDERS.GOOGLE,
    });
    models.set(normalized.id, normalized);
    return get(normalized.id);
  }

  function setStatus(modelId, status) {
    const current = models.get(modelId);
    if (!current) return null;
    current.status = status;
    return get(modelId);
  }

  return Object.freeze({ get, list, upsert, setStatus });
}

function createQualificationModelCatalog() {
  return createModelCatalog([
    ...DEFAULT_MODEL_CATALOG,
    ...GROQ_QUALIFICATION_MODEL_CATALOG,
  ]);
}

function qualityRank(tier) {
  return MODEL_QUALITY_RANK[tier] || 0;
}

function modelMeetsQuality(model, minimumTier) {
  if (!minimumTier) return true;
  return qualityRank(model?.qualityTier) >= qualityRank(minimumTier);
}

function groqProductionModel(modelId) {
  return GROQ_PRODUCTION_MODEL_CATALOG.find((model) => model.id === modelId) || null;
}

module.exports = {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  MODEL_QUALITY_TIERS,
  MODEL_QUALITY_RANK,
  modelVersionRank,
  qualityRank,
  modelMeetsQuality,
  COMMON_TEXT_CAPABILITIES,
  GROQ_TEXT_CAPABILITIES,
  GOOGLE_MODEL_IDS,
  GROQ_MODEL_IDS,
  GROQ_SPEECH_MODEL_IDS,
  GENERAL_EMERGENCY_FALLBACK_MODEL_ID,
  DEFAULT_MODEL_CATALOG,
  GROQ_PRODUCTION_MODEL_CATALOG,
  GROQ_QUALIFICATION_MODEL_CATALOG,
  groqProductionModel,
  createModelCatalog,
  createQualificationModelCatalog,
};
