'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AI_CAPABILITIES } = require('./capabilities');
const { AIError, AI_ERROR_CODES } = require('./errors');
const {
  createSpeechSynthesisRequest,
  createSpeechSynthesisResponse,
  createAudioSegment,
  splitSpeechTranscript,
} = require('./execution-contracts');
const {
  DEFAULT_IMAGE_GENERATION_STEPS,
  SUPPORTED_DIAGRAM_TYPES,
  createImageGenerationRequest,
  imageGenerationCacheKey,
  createGeneratedImageResponse,
  createDiagramRenderRequest,
  diagramCacheKey,
  createDiagramRenderResponse,
} = require('./visual-contracts');
const { resolveTeacherVoice } = require('./teacher-voices');

const DEFAULT_SPEECH_TIMEOUT_MS = 15000;
const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 120000;
const DEFAULT_DIAGRAM_RENDER_TIMEOUT_MS = 12000;

function boundedTimeout(value, fallback, min = 1000, max = 180000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function createBoundedCapabilityCache({ maxEntries = 16, maxBytes = 32 * 1024 * 1024 } = {}) {
  const map = new Map();
  let totalBytes = 0;
  const entryLimit = Math.max(1, Math.min(256, Number(maxEntries) || 16));
  const byteLimit = Math.max(1024 * 1024, Number(maxBytes) || 32 * 1024 * 1024);

  function get(key) {
    if (!map.has(key)) return null;
    const entry = map.get(key);
    map.delete(key);
    map.set(key, entry);
    return entry.value;
  }

  function set(key, value, byteLength = 0) {
    const weight = Math.max(0, Number(byteLength) || 0);
    if (weight > byteLimit) return false;
    if (map.has(key)) {
      totalBytes -= map.get(key).weight;
      map.delete(key);
    }
    map.set(key, { value, weight });
    totalBytes += weight;
    while (map.size > entryLimit || totalBytes > byteLimit) {
      const oldest = map.keys().next().value;
      const removed = map.get(oldest);
      totalBytes -= removed.weight;
      map.delete(oldest);
    }
    return true;
  }

  return Object.freeze({
    get,
    set,
    snapshot: () => Object.freeze({
      entries: map.size,
      bytes: totalBytes,
      maxEntries: entryLimit,
      maxBytes: byteLimit,
    }),
  });
}

function providerFailure(error, provider, message) {
  if (error instanceof AIError) return error;
  return new AIError(message, {
    code: AI_ERROR_CODES.UNKNOWN,
    retryable: true,
    scope: 'ATTEMPT',
    provider,
    cause: error,
  });
}

function languageFamily(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'ar' || normalized.startsWith('ar-')) return 'ar';
  return null;
}

function createCapabilityRuntime({
  env = process.env,
  catalog,
  providerRegistry,
  credentialRegistry,
  logger = console,
  imageCache = null,
  diagramCache = null,
} = {}) {
  if (!catalog?.firstApprovedCapability) throw new Error('Capability runtime requires the shared model catalog');
  if (!providerRegistry?.require) throw new Error('Capability runtime requires provider registry');
  if (!credentialRegistry?.ordered) throw new Error('Capability runtime requires credential registry');

  const generatedImageCache = imageCache || createBoundedCapabilityCache({
    maxEntries: 8,
    maxBytes: 32 * 1024 * 1024,
  });
  const renderedDiagramCache = diagramCache || createBoundedCapabilityCache({
    maxEntries: 64,
    maxBytes: 8 * 1024 * 1024,
  });
  const speechTimeoutMs = boundedTimeout(env.AI_SPEECH_ATTEMPT_TIMEOUT_MS, DEFAULT_SPEECH_TIMEOUT_MS, 1000, 60000);
  const imageTimeoutMs = boundedTimeout(env.AI_IMAGE_GENERATION_TIMEOUT_MS, DEFAULT_IMAGE_GENERATION_TIMEOUT_MS);
  const diagramTimeoutMs = boundedTimeout(env.AI_DIAGRAM_RENDER_TIMEOUT_MS, DEFAULT_DIAGRAM_RENDER_TIMEOUT_MS, 1000, 60000);

  function capabilityModel(capability) {
    const model = catalog.firstApprovedCapability(capability);
    if (!model) {
      throw new AIError(`No approved model provides ${capability}`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'CAPABILITY',
      });
    }
    return model;
  }

  async function synthesizeSpeech({
    transcript,
    voiceId = null,
    language = 'en',
    metadata = {},
    signal = null,
  } = {}) {
    void voiceId;
    const profile = resolveTeacherVoice(env);
    if (!profile) {
      throw new AIError('KIWI teacher voice configuration is invalid', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'CAPABILITY',
      });
    }
    if (languageFamily(language) !== languageFamily(profile.language)) {
      throw new AIError('Requested speech language does not match the configured KIWI teacher voice', {
        code: AI_ERROR_CODES.BAD_REQUEST,
        retryable: false,
        scope: 'REQUEST',
        details: {
          requestedLanguage: String(language || ''),
          configuredVoiceLanguage: profile.language,
          configuredVoiceId: profile.id,
        },
      });
    }

    const model = catalog.get(profile.modelId, profile.provider);
    if (!model?.capabilities?.includes(AI_CAPABILITIES.SPEECH_SYNTHESIS)) {
      throw new AIError('Configured teacher voice model is not approved for speech synthesis', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'CAPABILITY',
      });
    }

    const request = createSpeechSynthesisRequest({
      transcript,
      voiceId: profile.id,
      language: profile.language,
      metadata,
    });
    const chunks = splitSpeechTranscript(request.transcript);
    const slots = credentialRegistry.ordered(model.provider, model.routeKey);
    if (!slots.length) {
      return createSpeechSynthesisResponse({
        transcript: request.transcript,
        voiceId: profile.id,
        provider: model.provider,
        modelId: model.id,
        segments: [],
        degraded: true,
        failure: { code: AI_ERROR_CODES.CONFIG, provider: model.provider, retryable: true },
      });
    }

    const adapter = providerRegistry.require(model.provider, 'synthesizeSpeech');
    let lastError = null;
    for (const credential of slots) {
      const segments = [];
      const startedAt = Date.now();
      try {
        for (let index = 0; index < chunks.length; index++) {
          const result = await adapter.synthesizeSpeech({
            credential,
            request,
            voiceProfile: profile,
            input: chunks[index],
            timeoutMs: speechTimeoutMs,
            signal,
          });
          segments.push(createAudioSegment({
            data: result.audioBuffer.toString('base64'),
            mimeType: result.mimeType,
            byteLength: result.audioBuffer.length,
            index,
          }));
        }
        return createSpeechSynthesisResponse({
          transcript: request.transcript,
          voiceId: profile.id,
          provider: model.provider,
          modelId: model.id,
          segments,
          latencyMs: Date.now() - startedAt,
          degraded: false,
          credentialSlot: credential.id,
        });
      } catch (error) {
        lastError = providerFailure(error, model.provider, 'Teacher speech synthesis failed');
        if (lastError.code === AI_ERROR_CODES.CANCELLED || signal?.aborted) throw lastError;
        if (lastError.code === AI_ERROR_CODES.AUTH) {
          credentialRegistry.disable(model.provider, credential.id, lastError.code);
          continue;
        }
        break;
      }
    }

    logger?.warn?.('[KIWI AI] teacher speech degraded', {
      provider: model.provider,
      modelId: model.id,
      code: lastError?.code || AI_ERROR_CODES.UNKNOWN,
    });
    return createSpeechSynthesisResponse({
      transcript: request.transcript,
      voiceId: profile.id,
      provider: model.provider,
      modelId: model.id,
      segments: [],
      degraded: true,
      failure: {
        code: lastError?.code || AI_ERROR_CODES.UNKNOWN,
        provider: model.provider,
        retryable: Boolean(lastError?.retryable),
      },
    });
  }

  async function generateImage({
    prompt,
    altText,
    steps = DEFAULT_IMAGE_GENERATION_STEPS,
    seed = null,
    metadata = {},
    signal = null,
  } = {}) {
    const model = capabilityModel(AI_CAPABILITIES.IMAGE_GENERATION);
    const request = createImageGenerationRequest({ prompt, altText, steps, seed, metadata });
    const cacheKey = imageGenerationCacheKey(request, model.id);
    const cached = generatedImageCache.get(cacheKey);
    if (cached) return Object.freeze({ ...cached, cacheHit: true, latencyMs: 0 });

    const slots = credentialRegistry.ordered(model.provider, model.routeKey);
    if (!slots.length) {
      throw new AIError('No credential is configured for image generation', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'CAPABILITY',
        provider: model.provider,
      });
    }

    const adapter = providerRegistry.require(model.provider, 'generateImage');
    let lastError = null;
    for (const credential of slots) {
      const startedAt = Date.now();
      try {
        const result = await adapter.generateImage({
          credential,
          modelId: model.id,
          request,
          timeoutMs: imageTimeoutMs,
          signal,
        });
        const response = createGeneratedImageResponse({
          request,
          provider: model.provider,
          modelId: model.id,
          data: result.imageBase64,
          cacheKey,
          cacheHit: false,
          latencyMs: result.latencyMs ?? (Date.now() - startedAt),
          credentialSlot: credential.id,
        });
        generatedImageCache.set(cacheKey, response, response.image.byteLength);
        return response;
      } catch (error) {
        lastError = providerFailure(error, model.provider, 'Image generation failed');
        if (lastError.code === AI_ERROR_CODES.CANCELLED || signal?.aborted) throw lastError;
        if (lastError.code === AI_ERROR_CODES.AUTH) {
          credentialRegistry.disable(model.provider, credential.id, lastError.code);
          continue;
        }
        // Cloudflare quotas and capacity are account/provider scoped. Do not
        // sweep extra tokens after a non-authentication failure.
        break;
      }
    }
    throw lastError || new AIError('Image generation failed', {
      code: AI_ERROR_CODES.UNKNOWN,
      retryable: true,
      scope: 'CAPABILITY',
      provider: model.provider,
    });
  }

  async function renderDiagram({
    diagramType,
    source,
    altText,
    fallbackText = null,
    metadata = {},
    signal = null,
  } = {}) {
    const model = capabilityModel(AI_CAPABILITIES.DIAGRAM_RENDER);
    const request = createDiagramRenderRequest({
      diagramType,
      source,
      altText,
      fallbackText,
      metadata,
    });
    const cacheKey = diagramCacheKey(request, model.id);
    const cached = renderedDiagramCache.get(cacheKey);
    if (cached) return Object.freeze({ ...cached, cacheHit: true, latencyMs: 0 });

    let adapter;
    try {
      adapter = providerRegistry.require(model.provider, 'renderDiagram');
    } catch (error) {
      return createDiagramRenderResponse({
        request,
        provider: model.provider,
        rendererId: model.id,
        cacheKey,
        degraded: true,
        failure: error,
      });
    }

    const startedAt = Date.now();
    try {
      const result = await adapter.renderDiagram({
        request,
        timeoutMs: diagramTimeoutMs,
        signal,
      });
      const response = createDiagramRenderResponse({
        request,
        provider: model.provider,
        rendererId: model.id,
        svg: result.svg,
        cacheKey,
        cacheHit: false,
        latencyMs: result.latencyMs ?? (Date.now() - startedAt),
      });
      renderedDiagramCache.set(cacheKey, response, response.output.byteLength);
      return response;
    } catch (error) {
      const failure = providerFailure(error, model.provider, 'Diagram rendering failed');
      if (failure.code === AI_ERROR_CODES.CANCELLED || signal?.aborted) throw failure;
      return createDiagramRenderResponse({
        request,
        provider: model.provider,
        rendererId: model.id,
        cacheKey,
        latencyMs: Date.now() - startedAt,
        degraded: true,
        failure,
      });
    }
  }

  async function execute(capability, request = {}) {
    switch (capability) {
      case AI_CAPABILITIES.SPEECH_SYNTHESIS:
        return synthesizeSpeech(request);
      case AI_CAPABILITIES.IMAGE_GENERATION:
        return generateImage(request);
      case AI_CAPABILITIES.DIAGRAM_RENDER:
        return renderDiagram(request);
      default:
        throw new AIError(`Unsupported direct capability ${capability}`, {
          code: AI_ERROR_CODES.CONFIG,
          retryable: false,
          scope: 'CAPABILITY',
        });
    }
  }

  function status() {
    const speech = catalog.firstApprovedCapability(AI_CAPABILITIES.SPEECH_SYNTHESIS);
    const image = catalog.firstApprovedCapability(AI_CAPABILITIES.IMAGE_GENERATION);
    const diagram = catalog.firstApprovedCapability(AI_CAPABILITIES.DIAGRAM_RENDER);
    return Object.freeze({
      speech: Object.freeze({
        configured: Boolean(speech && credentialRegistry.peek(speech.provider, speech.routeKey).length),
        provider: speech?.provider || null,
        modelId: speech?.id || null,
        timeoutMs: speechTimeoutMs,
      }),
      imageGeneration: Object.freeze({
        configured: Boolean(image && credentialRegistry.peek(image.provider, image.routeKey).length),
        provider: image?.provider || null,
        modelId: image?.id || null,
        defaultSteps: Number(image?.metadata?.defaultSteps) || DEFAULT_IMAGE_GENERATION_STEPS,
        timeoutMs: imageTimeoutMs,
        cache: generatedImageCache.snapshot(),
      }),
      diagramRender: Object.freeze({
        configured: Boolean(diagram && providerRegistry.supports(diagram.provider, 'renderDiagram')),
        provider: diagram?.provider || null,
        modelId: diagram?.id || null,
        timeoutMs: diagramTimeoutMs,
        supportedDiagramTypes: SUPPORTED_DIAGRAM_TYPES,
        cache: renderedDiagramCache.snapshot(),
      }),
    });
  }

  return Object.freeze({
    synthesizeSpeech,
    generateImage,
    renderDiagram,
    execute,
    status,
  });
}

module.exports = {
  DEFAULT_SPEECH_TIMEOUT_MS,
  DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
  DEFAULT_DIAGRAM_RENDER_TIMEOUT_MS,
  createBoundedCapabilityCache,
  createCapabilityRuntime,
};
