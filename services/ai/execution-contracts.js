'use strict';

const { createProviderModelRef } = require('./providers');

const AI_CONTENT_KINDS = Object.freeze({
  TEXT: 'TEXT',
  LEGACY_PROVIDER_CONTENT: 'LEGACY_PROVIDER_CONTENT',
});

function _cloneJsonCompatible(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) {}
  }
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

function normalizeExecutionContent(content, { legacyProvider = null } = {}) {
  if (typeof content === 'string' || content == null) {
    return Object.freeze({
      kind: AI_CONTENT_KINDS.TEXT,
      text: String(content ?? ''),
    });
  }

  // D01 only standardizes the ordinary text lane. Existing provider-native
  // multimodal payloads remain explicitly quarantined as legacy content until
  // AIM-D04 introduces KIWI's canonical multimodal contract. Keeping that lane
  // explicit prevents us from pretending provider-native shapes are neutral.
  return Object.freeze({
    kind: AI_CONTENT_KINDS.LEGACY_PROVIDER_CONTENT,
    provider: legacyProvider || null,
    value: _cloneJsonCompatible(content),
  });
}

function normalizeReasoningDirective(value = null) {
  if (!value) return null;
  const requested = String(value.requested || value.level || '').trim().toUpperCase() || null;
  const resolved = String(value.resolved || value.level || '').trim().toUpperCase() || null;
  if (!requested && !resolved) return null;
  return Object.freeze({ requested, resolved });
}

function normalizeStructuredOutputDirective(value = null) {
  if (!value || typeof value !== 'object') return null;
  const mimeType = String(value.mimeType || 'application/json').trim();
  const schema = value.schema == null ? null : _cloneJsonCompatible(value.schema);
  if (!mimeType && schema == null) return null;
  return Object.freeze({
    mimeType: mimeType || 'application/json',
    schema,
  });
}

function normalizeGenerationOptions(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const reasoning = normalizeReasoningDirective(source.reasoning || null);
  const structuredOutput = normalizeStructuredOutputDirective(source.structuredOutput || null);
  const normalized = {};

  for (const [key, value] of Object.entries(source)) {
    if (
      key === 'reasoning' ||
      key === 'structuredOutput' ||
      value === undefined
    ) continue;
    normalized[key] = _cloneJsonCompatible(value);
  }

  if (reasoning) normalized.reasoning = reasoning;
  if (structuredOutput) normalized.structuredOutput = structuredOutput;
  return Object.freeze(normalized);
}

function createExecutionRequest({
  provider,
  modelId,
  taskId = null,
  content = '',
  generation = {},
  metadata = {},
  legacyProviderContent = null,
} = {}) {
  const model = createProviderModelRef({ provider, modelId });
  const normalizedContent = content?.kind
    ? Object.freeze({ ...content })
    : normalizeExecutionContent(content, {
        legacyProvider: legacyProviderContent || model.provider,
      });

  return Object.freeze({
    contractVersion: 1,
    provider: model.provider,
    model,
    taskId: taskId || null,
    content: normalizedContent,
    generation: normalizeGenerationOptions(generation),
    metadata: Object.freeze({ ...(metadata || {}) }),
  });
}

function createExecutionResponse({
  provider,
  requestedModel,
  providerModel = null,
  text = '',
  structuredData = null,
  finishReason = 'UNKNOWN',
  blocked = false,
  blockReason = null,
  usage = {},
  latencyMs = null,
  credentialSlot = null,
  fallbackDepth = 0,
  generationGroupId = null,
  providerMetadata = null,
} = {}) {
  const model = createProviderModelRef({ provider, modelId: requestedModel });
  const normalizedStructuredData = structuredData == null
    ? null
    : _cloneJsonCompatible(structuredData);
  const normalizedProviderMetadata = providerMetadata == null
    ? null
    : _cloneJsonCompatible(providerMetadata);

  return Object.freeze({
    contractVersion: 1,
    provider: model.provider,
    text: String(text ?? ''),
    structuredData: normalizedStructuredData == null
      ? null
      : Object.freeze(normalizedStructuredData),
    finishReason: finishReason || 'UNKNOWN',
    blocked: Boolean(blocked),
    blockReason: blockReason || null,
    providerModel: providerModel || requestedModel || null,
    requestedModel: requestedModel || null,
    model,
    projectSlot: credentialSlot || null,
    credentialSlot: credentialSlot || null,
    latencyMs,
    fallbackDepth: Number(fallbackDepth) || 0,
    generationGroupId: generationGroupId || null,
    providerMetadata: normalizedProviderMetadata == null
      ? null
      : Object.freeze(normalizedProviderMetadata),
    usage: Object.freeze({
      inputTokens: Number(usage.inputTokens) || 0,
      outputTokens: Number(usage.outputTokens) || 0,
      thoughtTokens: Number(usage.thoughtTokens) || 0,
      totalTokens: Number(usage.totalTokens) || 0,
      cachedContentTokens: Number(usage.cachedContentTokens) || 0,
    }),
  });
}

module.exports = {
  AI_CONTENT_KINDS,
  normalizeExecutionContent,
  normalizeReasoningDirective,
  normalizeStructuredOutputDirective,
  normalizeGenerationOptions,
  createExecutionRequest,
  createExecutionResponse,
};
