'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');
const {
  AI_VISUAL_CAPABILITIES,
  DEFAULT_IMAGE_GENERATION_STEPS,
  createImageGenerationRequest,
  imageGenerationCacheKey,
  createGeneratedImageResponse,
  createDiagramRenderRequest,
  diagramCacheKey,
  createDiagramRenderResponse,
} = require('./visual-contracts');
const { IMAGE_GENERATION_ROUTE, KROKI_RENDER_ROUTE } = require('./visual-model-catalog');
const { createVisualTelemetry } = require('./visual-telemetry');

const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 90000;
const DEFAULT_DIAGRAM_RENDER_TIMEOUT_MS = 12000;

function boundedTimeout(value, fallback, min = 1000, max = 120000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function createBoundedVisualCache({ maxEntries = 16, maxBytes = 32 * 1024 * 1024 } = {}) {
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

  function snapshot() {
    return Object.freeze({ entries: map.size, bytes: totalBytes, maxEntries: entryLimit, maxBytes: byteLimit });
  }

  return Object.freeze({ get, set, snapshot });
}

function _isCredentialFailure(error) {
  return error?.code === AI_ERROR_CODES.AUTH;
}

function _providerError(error, provider, message) {
  if (error instanceof AIError) return error;
  return new AIError(message, {
    code: AI_ERROR_CODES.UNKNOWN,
    retryable: true,
    scope: 'ATTEMPT',
    provider,
    cause: error,
  });
}

function createVisualCapabilityRuntime({
  env = process.env,
  cloudflareTransport,
  cloudflareCredentialPool,
  krokiRenderer = null,
  telemetry = null,
  imageCache = null,
  diagramCache = null,
  logger = console,
} = {}) {
  if (!cloudflareTransport?.generate) {
    throw new Error('D05 visual runtime requires a Cloudflare image transport');
  }
  if (!cloudflareCredentialPool?.orderedSlots) {
    throw new Error('D05 visual runtime requires a Cloudflare credential pool');
  }

  const visualTelemetry = telemetry || createVisualTelemetry({ logger });
  const generatedImageCache = imageCache || createBoundedVisualCache({ maxEntries: 8, maxBytes: 32 * 1024 * 1024 });
  const renderedDiagramCache = diagramCache || createBoundedVisualCache({ maxEntries: 64, maxBytes: 8 * 1024 * 1024 });
  const imageTimeoutMs = boundedTimeout(
    env.AI_IMAGE_GENERATION_TIMEOUT_MS,
    DEFAULT_IMAGE_GENERATION_TIMEOUT_MS
  );
  const diagramTimeoutMs = boundedTimeout(
    env.AI_DIAGRAM_RENDER_TIMEOUT_MS,
    DEFAULT_DIAGRAM_RENDER_TIMEOUT_MS
  );

  async function generateIllustrativeImage({
    prompt,
    altText,
    steps = DEFAULT_IMAGE_GENERATION_STEPS,
    seed = null,
    metadata = {},
    signal = null,
  } = {}) {
    const request = createImageGenerationRequest({ prompt, altText, steps, seed, metadata });
    const cacheKey = imageGenerationCacheKey(request, IMAGE_GENERATION_ROUTE.modelId);
    const cached = generatedImageCache.get(cacheKey);
    if (cached) {
      const hit = Object.freeze({ ...cached, cacheHit: true, latencyMs: 0 });
      visualTelemetry.record({
        capability: AI_VISUAL_CAPABILITIES.IMAGE_GENERATION,
        outcome: 'SUCCESS',
        provider: hit.provider,
        modelId: hit.modelId,
        cacheHit: true,
        mimeType: hit.image.mimeType,
        byteLength: hit.image.byteLength,
        width: hit.image.width,
        height: hit.image.height,
      });
      return hit;
    }

    const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    if (!accountId) {
      throw new AIError('Cloudflare image generation is not configured with an account ID', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'CAPABILITY',
        provider: AI_PROVIDERS.CLOUDFLARE,
      });
    }
    const slots = cloudflareCredentialPool.orderedSlots(
      `${AI_PROVIDERS.CLOUDFLARE}::${IMAGE_GENERATION_ROUTE.modelId}`
    );
    if (slots.length === 0) {
      throw new AIError('No Cloudflare Workers AI token is configured for image generation', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'CAPABILITY',
        provider: AI_PROVIDERS.CLOUDFLARE,
      });
    }

    let lastError = null;
    for (const credential of slots) {
      const startedAt = Date.now();
      try {
        const result = await cloudflareTransport.generate({
          accountId,
          apiToken: credential.apiToken,
          modelId: IMAGE_GENERATION_ROUTE.modelId,
          request,
          timeoutMs: imageTimeoutMs,
          signal,
        });
        const response = createGeneratedImageResponse({
          request,
          provider: AI_PROVIDERS.CLOUDFLARE,
          modelId: IMAGE_GENERATION_ROUTE.modelId,
          data: result.imageBase64,
          cacheKey,
          cacheHit: false,
          latencyMs: result.latencyMs ?? (Date.now() - startedAt),
          credentialSlot: credential.id,
        });
        generatedImageCache.set(cacheKey, response, response.image.byteLength);
        visualTelemetry.record({
          capability: AI_VISUAL_CAPABILITIES.IMAGE_GENERATION,
          outcome: 'SUCCESS',
          provider: response.provider,
          modelId: response.modelId,
          credentialSlot: credential.id,
          latencyMs: response.latencyMs,
          cacheHit: false,
          mimeType: response.image.mimeType,
          byteLength: response.image.byteLength,
          width: response.image.width,
          height: response.image.height,
        });
        return response;
      } catch (error) {
        lastError = _providerError(error, AI_PROVIDERS.CLOUDFLARE, 'Cloudflare image generation failed');
        visualTelemetry.record({
          capability: AI_VISUAL_CAPABILITIES.IMAGE_GENERATION,
          outcome: 'FAILED',
          provider: AI_PROVIDERS.CLOUDFLARE,
          modelId: IMAGE_GENERATION_ROUTE.modelId,
          credentialSlot: credential.id,
          latencyMs: Date.now() - startedAt,
          errorCode: lastError.code,
        });
        if (lastError.code === AI_ERROR_CODES.CANCELLED || signal?.aborted) throw lastError;
        if (_isCredentialFailure(lastError)) {
          cloudflareCredentialPool.disable?.(credential.id, lastError.code);
          continue;
        }
        // Cloudflare quotas/capacity are account/provider scoped. Never sweep
        // the token pool after a non-auth failure.
        break;
      }
    }
    throw lastError || new AIError('Cloudflare image generation failed', {
      code: AI_ERROR_CODES.UNKNOWN,
      retryable: true,
      scope: 'CAPABILITY',
      provider: AI_PROVIDERS.CLOUDFLARE,
    });
  }

  async function renderStructuredDiagram({
    diagramType,
    source,
    altText,
    fallbackText = null,
    metadata = {},
    signal = null,
  } = {}) {
    const request = createDiagramRenderRequest({ diagramType, source, altText, fallbackText, metadata });
    const cacheKey = diagramCacheKey(request, KROKI_RENDER_ROUTE.rendererId);
    const cached = renderedDiagramCache.get(cacheKey);
    if (cached) {
      const hit = Object.freeze({ ...cached, cacheHit: true, latencyMs: 0 });
      visualTelemetry.record({
        capability: AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER,
        outcome: 'SUCCESS',
        provider: AI_PROVIDERS.KROKI,
        rendererId: KROKI_RENDER_ROUTE.rendererId,
        cacheHit: true,
        mimeType: hit.output.mimeType,
        byteLength: hit.output.byteLength,
        diagramType: hit.diagramType,
      });
      return hit;
    }

    if (!krokiRenderer?.render) {
      const failure = new AIError('Kroki diagram rendering is not configured', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'CAPABILITY',
        provider: AI_PROVIDERS.KROKI,
      });
      visualTelemetry.record({
        capability: AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER,
        outcome: 'DEGRADED',
        provider: AI_PROVIDERS.KROKI,
        rendererId: KROKI_RENDER_ROUTE.rendererId,
        diagramType: request.diagramType,
        degraded: true,
        errorCode: failure.code,
      });
      return createDiagramRenderResponse({
        request,
        provider: AI_PROVIDERS.KROKI,
        rendererId: KROKI_RENDER_ROUTE.rendererId,
        cacheKey,
        degraded: true,
        failure,
      });
    }

    const startedAt = Date.now();
    try {
      const result = await krokiRenderer.render({ request, timeoutMs: diagramTimeoutMs, signal });
      const response = createDiagramRenderResponse({
        request,
        provider: AI_PROVIDERS.KROKI,
        rendererId: KROKI_RENDER_ROUTE.rendererId,
        svg: result.svg,
        cacheKey,
        cacheHit: false,
        latencyMs: result.latencyMs ?? (Date.now() - startedAt),
      });
      renderedDiagramCache.set(cacheKey, response, response.output.byteLength);
      visualTelemetry.record({
        capability: AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER,
        outcome: 'SUCCESS',
        provider: AI_PROVIDERS.KROKI,
        rendererId: KROKI_RENDER_ROUTE.rendererId,
        latencyMs: response.latencyMs,
        cacheHit: false,
        mimeType: response.output.mimeType,
        byteLength: response.output.byteLength,
        diagramType: response.diagramType,
      });
      return response;
    } catch (error) {
      const failure = _providerError(error, AI_PROVIDERS.KROKI, 'Kroki diagram rendering failed');
      if (failure.code === AI_ERROR_CODES.CANCELLED || signal?.aborted) throw failure;
      visualTelemetry.record({
        capability: AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER,
        outcome: 'DEGRADED',
        provider: AI_PROVIDERS.KROKI,
        rendererId: KROKI_RENDER_ROUTE.rendererId,
        latencyMs: Date.now() - startedAt,
        diagramType: request.diagramType,
        degraded: true,
        errorCode: failure.code,
      });
      return createDiagramRenderResponse({
        request,
        provider: AI_PROVIDERS.KROKI,
        rendererId: KROKI_RENDER_ROUTE.rendererId,
        cacheKey,
        latencyMs: Date.now() - startedAt,
        degraded: true,
        failure,
      });
    }
  }

  function status() {
    return Object.freeze({
      imageGeneration: Object.freeze({
        configured: Boolean(String(env.CLOUDFLARE_ACCOUNT_ID || '').trim()) && cloudflareCredentialPool.peekOrderedSlots?.('D05_STATUS')?.length > 0,
        provider: AI_PROVIDERS.CLOUDFLARE,
        modelId: IMAGE_GENERATION_ROUTE.modelId,
        defaultSteps: IMAGE_GENERATION_ROUTE.defaultSteps,
        timeoutMs: imageTimeoutMs,
        quotaScope: 'ACCOUNT',
        cache: generatedImageCache.snapshot(),
      }),
      diagramRender: Object.freeze({
        configured: Boolean(krokiRenderer?.render),
        provider: AI_PROVIDERS.KROKI,
        rendererId: KROKI_RENDER_ROUTE.rendererId,
        timeoutMs: diagramTimeoutMs,
        supportedDiagramTypes: KROKI_RENDER_ROUTE.supportedDiagramTypes,
        cache: renderedDiagramCache.snapshot(),
      }),
      telemetry: visualTelemetry.snapshot(),
    });
  }

  return Object.freeze({
    generateIllustrativeImage,
    renderStructuredDiagram,
    status,
    telemetry: visualTelemetry,
  });
}

module.exports = {
  DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
  DEFAULT_DIAGRAM_RENDER_TIMEOUT_MS,
  createBoundedVisualCache,
  createVisualCapabilityRuntime,
};
