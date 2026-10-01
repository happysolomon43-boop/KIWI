'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');

const DEFAULT_CLOUDFLARE_AI_BASE_URL = 'https://api.cloudflare.com/client/v4';
const CLOUDFLARE_IMAGE_QUOTA_POLICY = Object.freeze({
  provider: AI_PROVIDERS.CLOUDFLARE,
  credentialScopedAuth: true,
  rotateOnAuthenticationFailure: true,
  rotateOnPermissionFailure: false,
  rotateOnRateLimit: false,
  dailyAllocationScope: 'ACCOUNT',
  rateLimitScope: 'ACCOUNT_MODEL',
});

function _accountId(value) {
  const id = String(value || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(id)) {
    throw new AIError('Cloudflare Workers AI requires a valid account ID', {
      code: AI_ERROR_CODES.CONFIG,
      retryable: false,
      scope: 'PROVIDER',
      provider: AI_PROVIDERS.CLOUDFLARE,
    });
  }
  return id;
}

function _safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

function _providerCode(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const raw = errors[0]?.code ?? body?.error?.code ?? null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : raw;
}

function _providerMessage(body, status) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  return String(
    errors[0]?.message || body?.error?.message || body?.message || `Cloudflare Workers AI HTTP ${status}`
  ).slice(0, 1000);
}

function classifyCloudflareHttpError({ status, body, headers = null } = {}) {
  const cloudflareCode = _providerCode(body);
  const message = _providerMessage(body, status);
  const retryAfter = Number(headers?.get?.('retry-after'));
  const retryAfterMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : null;
  const common = {
    provider: AI_PROVIDERS.CLOUDFLARE,
    status,
    providerEvidence: { cloudflareCode },
    retryAfterMs,
  };

  if (status === 401) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.AUTH, retryable: false, scope: 'SLOT' });
  }
  if (status === 403) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.PERMISSION, retryable: false, scope: 'ACCOUNT' });
  }
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    const modelMissing = cloudflareCode === 5007 || cloudflareCode === 3042 || status === 404;
    return new AIError(message, {
      ...common,
      code: modelMissing ? AI_ERROR_CODES.MODEL_NOT_FOUND : AI_ERROR_CODES.BAD_REQUEST,
      retryable: false,
      scope: modelMissing ? 'MODEL' : 'REQUEST',
    });
  }
  if (status === 408) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.TIMEOUT, retryable: true, scope: 'ATTEMPT' });
  }
  if (status === 429 && cloudflareCode === 3036) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.RATE_LIMIT_RPD, retryable: true, scope: 'ACCOUNT' });
  }
  if (status === 429 && cloudflareCode === 3040) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.PROVIDER_OVERLOADED, retryable: true, scope: 'PROVIDER_MODEL' });
  }
  if (status === 429) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.RATE_LIMIT_RPM, retryable: true, scope: 'ACCOUNT_MODEL' });
  }
  if (status >= 500 && status <= 599) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.TRANSIENT, retryable: true, scope: 'PROVIDER_MODEL' });
  }
  return new AIError(message, { ...common, code: AI_ERROR_CODES.UNKNOWN, retryable: false, scope: 'REQUEST' });
}

function _abortController(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    release() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    },
  };
}

function _createFlux2MultipartBody(request) {
  if (typeof globalThis.FormData !== 'function') {
    throw new AIError('Cloudflare FLUX.2 requires FormData support in the runtime', {
      code: AI_ERROR_CODES.CONFIG,
      retryable: false,
      scope: 'PROVIDER',
      provider: AI_PROVIDERS.CLOUDFLARE,
    });
  }
  const form = new globalThis.FormData();
  form.append('prompt', request.prompt);
  form.append('steps', String(request.steps));
  if (request.seed != null) form.append('seed', String(request.seed));
  return form;
}

function createCloudflareImageTransport({
  fetchImpl = globalThis.fetch,
  endpointBase = DEFAULT_CLOUDFLARE_AI_BASE_URL,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Cloudflare image transport requires fetch');
  const base = String(endpointBase || DEFAULT_CLOUDFLARE_AI_BASE_URL).replace(/\/+$/, '');

  async function generate({
    accountId,
    apiToken,
    modelId,
    request,
    timeoutMs = 30000,
    signal = null,
  } = {}) {
    const id = _accountId(accountId);
    const token = String(apiToken || '').trim();
    if (!token) {
      throw new AIError('Cloudflare Workers AI requires an API token', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'SLOT',
        provider: AI_PROVIDERS.CLOUDFLARE,
      });
    }
    const model = String(modelId || '').trim();
    if (!model.startsWith('@cf/')) {
      throw new AIError('Cloudflare image transport requires an approved Workers AI model ID', {
        code: AI_ERROR_CODES.BAD_REQUEST,
        retryable: false,
        scope: 'MODEL',
        provider: AI_PROVIDERS.CLOUDFLARE,
      });
    }
    const body = _createFlux2MultipartBody(request);
    const abort = _abortController(signal, Math.max(1000, Number(timeoutMs) || 30000));
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(
        `${base}/accounts/${id}/ai/run/${model}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          body,
          signal: abort.signal,
        }
      );
      const text = await response.text();
      const payload = _safeJson(text);
      if (!response.ok || payload?.success === false) {
        throw classifyCloudflareHttpError({ status: response.status, body: payload || { message: text }, headers: response.headers });
      }
      const image = payload?.result?.image ?? payload?.image ?? payload?.result;
      if (typeof image !== 'string' || !image.trim()) {
        throw new AIError('Cloudflare FLUX returned no image payload', {
          code: AI_ERROR_CODES.EMPTY_RESPONSE,
          retryable: true,
          scope: 'ATTEMPT',
          provider: AI_PROVIDERS.CLOUDFLARE,
        });
      }
      return Object.freeze({
        imageBase64: image.trim(),
        latencyMs: Date.now() - startedAt,
        providerRequestId: response.headers?.get?.('cf-ray') || null,
      });
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (abort.signal.aborted) {
        const cancelled = Boolean(signal?.aborted);
        throw new AIError(cancelled ? 'Cloudflare image generation was cancelled' : 'Cloudflare image generation timed out', {
          code: cancelled ? AI_ERROR_CODES.CANCELLED : AI_ERROR_CODES.TIMEOUT,
          retryable: !cancelled,
          scope: 'ATTEMPT',
          provider: AI_PROVIDERS.CLOUDFLARE,
          cause: error,
        });
      }
      throw new AIError('Cloudflare Workers AI network failure', {
        code: AI_ERROR_CODES.NETWORK,
        retryable: true,
        scope: 'ATTEMPT',
        provider: AI_PROVIDERS.CLOUDFLARE,
        cause: error,
      });
    } finally {
      abort.release();
    }
  }

  return Object.freeze({ generate, quotaPolicy: CLOUDFLARE_IMAGE_QUOTA_POLICY });
}

module.exports = {
  DEFAULT_CLOUDFLARE_AI_BASE_URL,
  CLOUDFLARE_IMAGE_QUOTA_POLICY,
  classifyCloudflareHttpError,
  createCloudflareImageTransport,
};
