'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');

const DEFAULT_KROKI_TIMEOUT_MS = 12000;

function normalizeKrokiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new AIError('Kroki requires KROKI_BASE_URL configuration', {
      code: AI_ERROR_CODES.CONFIG,
      retryable: false,
      scope: 'PROVIDER',
      provider: AI_PROVIDERS.KROKI,
    });
  }
  let parsed;
  try { parsed = new URL(raw); } catch (_) {
    throw new AIError('KROKI_BASE_URL is not a valid URL', {
      code: AI_ERROR_CODES.CONFIG,
      retryable: false,
      scope: 'PROVIDER',
      provider: AI_PROVIDERS.KROKI,
    });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new AIError('KROKI_BASE_URL must use HTTP(S) without embedded credentials', {
      code: AI_ERROR_CODES.CONFIG,
      retryable: false,
      scope: 'PROVIDER',
      provider: AI_PROVIDERS.KROKI,
    });
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function classifyKrokiHttpError({ status, body = '' } = {}) {
  const message = String(body || `Kroki HTTP ${status}`).slice(0, 1000);
  const common = { provider: AI_PROVIDERS.KROKI, status };
  if (status === 400 || status === 404 || status === 415 || status === 422) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.BAD_REQUEST, retryable: false, scope: 'REQUEST' });
  }
  if (status === 408 || status === 504) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.TIMEOUT, retryable: true, scope: 'ATTEMPT' });
  }
  if (status === 429) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.RATE_LIMIT_UNKNOWN, retryable: true, scope: 'PROVIDER' });
  }
  if (status >= 500 && status <= 599) {
    return new AIError(message, { ...common, code: AI_ERROR_CODES.TRANSIENT, retryable: true, scope: 'PROVIDER' });
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

function createKrokiRenderer({
  fetchImpl = globalThis.fetch,
  baseUrl,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Kroki renderer requires fetch');
  const endpoint = normalizeKrokiBaseUrl(baseUrl);

  async function render({ request, timeoutMs = DEFAULT_KROKI_TIMEOUT_MS, signal = null } = {}) {
    const abort = _abortController(signal, Math.max(1000, Number(timeoutMs) || DEFAULT_KROKI_TIMEOUT_MS));
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(`${endpoint}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'image/svg+xml',
        },
        body: JSON.stringify({
          diagram_source: request.source,
          diagram_type: request.diagramType,
          output_format: 'svg',
        }),
        signal: abort.signal,
      });
      const text = await response.text();
      if (!response.ok) throw classifyKrokiHttpError({ status: response.status, body: text });
      const mimeType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
      if (mimeType !== 'image/svg+xml') {
        throw new AIError('Kroki returned an unexpected output MIME type', {
          code: AI_ERROR_CODES.INVALID_OUTPUT,
          retryable: false,
          scope: 'ATTEMPT',
          provider: AI_PROVIDERS.KROKI,
          details: { mimeType: mimeType || null },
        });
      }
      if (!text.trim()) {
        throw new AIError('Kroki returned an empty diagram', {
          code: AI_ERROR_CODES.EMPTY_RESPONSE,
          retryable: true,
          scope: 'ATTEMPT',
          provider: AI_PROVIDERS.KROKI,
        });
      }
      return Object.freeze({
        svg: text,
        mimeType,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (abort.signal.aborted) {
        const cancelled = Boolean(signal?.aborted);
        throw new AIError(cancelled ? 'Kroki rendering was cancelled' : 'Kroki rendering timed out', {
          code: cancelled ? AI_ERROR_CODES.CANCELLED : AI_ERROR_CODES.TIMEOUT,
          retryable: !cancelled,
          scope: 'ATTEMPT',
          provider: AI_PROVIDERS.KROKI,
          cause: error,
        });
      }
      throw new AIError('Kroki renderer network failure', {
        code: AI_ERROR_CODES.NETWORK,
        retryable: true,
        scope: 'ATTEMPT',
        provider: AI_PROVIDERS.KROKI,
        cause: error,
      });
    } finally {
      abort.release();
    }
  }

  return Object.freeze({ render, baseUrl: endpoint });
}

module.exports = {
  DEFAULT_KROKI_TIMEOUT_MS,
  normalizeKrokiBaseUrl,
  classifyKrokiHttpError,
  createKrokiRenderer,
};
