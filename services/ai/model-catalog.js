'use strict';

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

// Verified against the official Google Gemini model pages on 2026-09-22.
// Discovery and automatic promotion are added in a later phase; Phase 2 keeps
// a small, explicit production-safe seed catalog.
const DEFAULT_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: 'gemini-3.8-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.8-flash'),
    supportedThinking: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.7-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.7-flash'),
    supportedThinking: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.6-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.6-flash'),
    supportedThinking: Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.5-flash',
    family: MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.5-flash'),
    supportedThinking: Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.5-flash-lite',
    family: MODEL_FAMILIES.FLASH_LITE,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.5-flash-lite'),
    supportedThinking: Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
  Object.freeze({
    id: 'gemini-3.1-flash-lite',
    family: MODEL_FAMILIES.FLASH_LITE,
    channel: MODEL_CHANNELS.STABLE,
    status: MODEL_STATUS.APPROVED,
    rank: modelVersionRank('gemini-3.1-flash-lite'),
    supportedThinking: Object.freeze(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']),
    capabilities: COMMON_TEXT_CAPABILITIES,
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  }),
]);

function _cloneModel(model) {
  return {
    ...model,
    supportedThinking: [...(model.supportedThinking || [])],
    capabilities: [...(model.capabilities || [])],
  };
}

function createModelCatalog(seedModels = DEFAULT_MODEL_CATALOG) {
  const models = new Map();
  for (const model of seedModels) {
    if (!model?.id) throw new Error('AI model catalog entry requires id');
    models.set(model.id, _cloneModel(model));
  }

  function get(modelId) {
    const model = models.get(modelId);
    return model ? _cloneModel(model) : null;
  }

  function list({
    family = null,
    channel = null,
    status = null,
    requiredCapabilities = [],
  } = {}) {
    return [...models.values()]
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
    models.set(model.id, _cloneModel({ ...prior, ...model }));
    return get(model.id);
  }

  function setStatus(modelId, status) {
    const current = models.get(modelId);
    if (!current) return null;
    current.status = status;
    return get(modelId);
  }

  return Object.freeze({
    get,
    list,
    upsert,
    setStatus,
  });
}

module.exports = {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  modelVersionRank,
  COMMON_TEXT_CAPABILITIES,
  DEFAULT_MODEL_CATALOG,
  createModelCatalog,
};
