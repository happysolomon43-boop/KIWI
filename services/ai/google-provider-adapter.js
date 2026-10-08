'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AI_CONTENT_KINDS, AI_CONTENT_PART_KINDS } = require('./execution-contracts');
const { createGoogleHttpTransport, normalizeGoogleContents } = require('./google-http-transport');
const { normalizeGeminiResponse } = require('./response-normalizer');
const { GOOGLE_QUOTA_POLICY } = require('./quota-policy');

function serializeGoogleContent(content) {
  if (content?.kind === AI_CONTENT_KINDS.TEXT) {
    return normalizeGoogleContents(content.text);
  }
  if (content?.kind !== AI_CONTENT_KINDS.MULTIMODAL) {
    throw new Error(`Unsupported Google content kind: ${content?.kind || 'UNKNOWN'}`);
  }

  return [{
    role: 'user',
    parts: content.parts.map((part) => {
      if (part.kind === AI_CONTENT_PART_KINDS.TEXT) return { text: part.text };
      if (part.kind === AI_CONTENT_PART_KINDS.IMAGE) {
        return { inlineData: { mimeType: part.mimeType, data: part.source.data } };
      }
      throw new Error(`Unsupported Google content part: ${part.kind}`);
    }),
  }];
}

function serializeGoogleResponseSchema(value) {
  if (Array.isArray(value)) return value.map(serializeGoogleResponseSchema);
  if (value == null || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    // Gemini's responseSchema accepts boolean fields, but its enum values are
    // string-typed. Preserve the neutral KIWI schema invariant internally and
    // remove only the provider-incompatible boolean enum at this adapter edge.
    if (key === 'enum' && value.type === 'boolean') continue;
    result[key] = serializeGoogleResponseSchema(child);
  }
  return result;
}

function serializeGoogleExecutionRequest(request) {
  if (!request || request.provider !== AI_PROVIDERS.GOOGLE) {
    throw new Error('Google adapter requires a GOOGLE execution request');
  }

  const generation = request.generation || {};
  const generationConfig = {};

  for (const [key, value] of Object.entries(generation)) {
    if (key === 'reasoning' || key === 'structuredOutput' || value === undefined) continue;
    generationConfig[key] = value;
  }

  if (generation.reasoning?.resolved) {
    generationConfig.thinkingConfig = {
      thinkingLevel: String(generation.reasoning.resolved).toLowerCase(),
    };
  }

  if (generation.structuredOutput) {
    generationConfig.responseMimeType = generation.structuredOutput.mimeType || 'application/json';
    if (generation.structuredOutput.schema != null) {
      generationConfig.responseSchema = serializeGoogleResponseSchema(generation.structuredOutput.schema);
    }
  }

  return Object.freeze({
    contents: serializeGoogleContent(request.content),
    generationConfig: Object.freeze(generationConfig),
  });
}

function createGoogleProviderAdapter({
  fetchImpl = globalThis.fetch,
  endpointBase,
  httpTransport = null,
} = {}) {
  const transport = httpTransport || createGoogleHttpTransport({ fetchImpl, endpointBase });

  async function generate({ credential, request, timeoutMs = 30000, signal = null }) {
    if (!request) throw new Error('Google adapter requires request');
    const apiKey = typeof credential === 'string' ? credential : credential?.apiKey;
    if (!apiKey) throw new Error('Google adapter requires credential apiKey');

    const result = await transport.generate({
      apiKey,
      modelId: request.model.modelId,
      body: serializeGoogleExecutionRequest(request),
      timeoutMs,
      signal,
    });

    return Object.freeze({
      ...result,
      normalized: normalizeGeminiResponse(result.raw, {
        modelId: request.model.modelId,
        slotId: credential?.id || null,
        latencyMs: result.latencyMs,
      }),
    });
  }

  return Object.freeze({
    provider: AI_PROVIDERS.GOOGLE,
    quotaPolicy: GOOGLE_QUOTA_POLICY,
    generate,
    listModels: (args = {}) => transport.listModels(args),
    serialize: serializeGoogleExecutionRequest,
  });
}

module.exports = {
  serializeGoogleContent,
  serializeGoogleResponseSchema,
  serializeGoogleExecutionRequest,
  createGoogleProviderAdapter,
};
