'use strict';

const { AI_PROVIDERS } = require('./providers');
const {
  AI_CONTENT_KINDS,
  AI_CONTENT_PART_KINDS,
  createExecutionRequest,
} = require('./execution-contracts');
const {
  createGoogleHttpTransport,
  normalizeGoogleContents,
} = require('./google-http-transport');
const { GOOGLE_QUOTA_POLICY } = require('./quota-policy');

function _reasoningFromLegacyThinkingConfig(thinkingConfig) {
  const level = String(thinkingConfig?.thinkingLevel || '').trim().toUpperCase();
  if (!level) return null;
  return Object.freeze({ requested: level, resolved: level });
}

function _structuredOutputFromLegacyGeneration(generationConfig = {}) {
  const hasMimeType = generationConfig.responseMimeType != null;
  const hasSchema = generationConfig.responseSchema != null;
  if (!hasMimeType && !hasSchema) return null;

  return Object.freeze({
    mimeType: hasMimeType
      ? String(generationConfig.responseMimeType)
      : 'application/json',
    schema: hasSchema ? generationConfig.responseSchema : null,
  });
}

function legacyInvocationToExecutionRequest({
  modelId,
  content,
  generationConfig = {},
  taskId = null,
} = {}) {
  const {
    thinkingConfig = null,
    responseMimeType = undefined,
    responseSchema = undefined,
    ...restGeneration
  } = generationConfig || {};

  const reasoning = _reasoningFromLegacyThinkingConfig(thinkingConfig);
  const structuredOutput = _structuredOutputFromLegacyGeneration({
    responseMimeType,
    responseSchema,
  });
  const generation = {
    ...restGeneration,
    ...(reasoning ? { reasoning } : {}),
    ...(structuredOutput ? { structuredOutput } : {}),
  };

  return createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId,
    taskId,
    content,
    generation,
    legacyProviderContent: AI_PROVIDERS.GOOGLE,
    metadata: {
      compatibilitySource: 'GEMINI_TRANSPORT_V1',
    },
  });
}

function _serializeGoogleMultimodal(content) {
  const parts = content.parts.map((part) => {
    if (part.kind === AI_CONTENT_PART_KINDS.TEXT) {
      return { text: part.text };
    }
    if (part.kind === AI_CONTENT_PART_KINDS.IMAGE) {
      return {
        inlineData: {
          mimeType: part.mimeType,
          data: part.source.data,
        },
      };
    }
    throw new Error(`Unsupported Google multimodal part kind: ${part.kind}`);
  });
  return [{ role: 'user', parts }];
}

function serializeGoogleExecutionRequest(request) {
  if (!request || request.provider !== AI_PROVIDERS.GOOGLE) {
    throw new Error('Google provider adapter requires a GOOGLE execution request');
  }

  let contents;
  if (request.content?.kind === AI_CONTENT_KINDS.TEXT) {
    contents = normalizeGoogleContents(request.content.text);
  } else if (request.content?.kind === AI_CONTENT_KINDS.MULTIMODAL) {
    contents = _serializeGoogleMultimodal(request.content);
  } else if (request.content?.kind === AI_CONTENT_KINDS.LEGACY_PROVIDER_CONTENT) {
    if (
      request.content.provider &&
      request.content.provider !== AI_PROVIDERS.GOOGLE
    ) {
      throw new Error('Google provider adapter cannot serialize another provider\'s native content');
    }
    contents = normalizeGoogleContents(request.content.value);
  } else {
    throw new Error(`Unsupported Google execution content kind: ${request.content?.kind}`);
  }

  const generation = request.generation || {};
  const {
    reasoning = null,
    structuredOutput = null,
    ...generationConfig
  } = generation;

  if (reasoning?.resolved) {
    generationConfig.thinkingConfig = {
      thinkingLevel: String(reasoning.resolved).toLowerCase(),
    };
  }

  if (structuredOutput) {
    generationConfig.responseMimeType = structuredOutput.mimeType || 'application/json';
    if (structuredOutput.schema != null) {
      generationConfig.responseSchema = structuredOutput.schema;
    }
  }

  return Object.freeze({
    contents,
    generationConfig: Object.freeze({ ...generationConfig }),
  });
}

function createGoogleProviderAdapter({
  fetchImpl = globalThis.fetch,
  endpointBase,
  httpTransport = null,
} = {}) {
  const transport = httpTransport || createGoogleHttpTransport({
    fetchImpl,
    endpointBase,
  });

  async function generate({ credential, request, timeoutMs = 30000 }) {
    if (!request) throw new Error('Google provider adapter requires request');
    const apiKey = typeof credential === 'string'
      ? credential
      : credential?.apiKey;
    if (!apiKey) throw new Error('Google provider adapter requires credential apiKey');

    const body = serializeGoogleExecutionRequest(request);
    return transport.generate({
      apiKey,
      modelId: request.model.modelId,
      body,
      timeoutMs,
    });
  }

  async function listModels(args = {}) {
    return transport.listModels(args);
  }

  const legacyTransport = Object.freeze({
    async generate({
      apiKey,
      modelId,
      content,
      generationConfig = {},
      timeoutMs = 30000,
      taskId = null,
    }) {
      const request = legacyInvocationToExecutionRequest({
        modelId,
        content,
        generationConfig,
        taskId,
      });
      return generate({
        credential: { apiKey },
        request,
        timeoutMs,
      });
    },
    listModels,
  });

  return Object.freeze({
    provider: AI_PROVIDERS.GOOGLE,
    quotaPolicy: GOOGLE_QUOTA_POLICY,
    generate,
    listModels,
    legacyTransport,
    serialize: serializeGoogleExecutionRequest,
  });
}

module.exports = {
  legacyInvocationToExecutionRequest,
  serializeGoogleExecutionRequest,
  createGoogleProviderAdapter,
};
