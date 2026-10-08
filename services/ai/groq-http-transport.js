'use strict';

const { AI_PROVIDERS } = require('./providers');
const {
  AIError,
  AI_ERROR_CODES,
  timeoutError,
  networkError,
} = require('./errors');
const {
  GROQ_ERROR_CODES,
  classifyGroqHttpError,
} = require('./groq-error-classifier');

const DEFAULT_GROQ_CHAT_COMPLETIONS_ENDPOINT =
  'https://api.groq.com/openai/v1/chat/completions';

const GROQ_ERROR_CONTEXT = Object.freeze({
  provider: AI_PROVIDERS.GROQ,
  providerLabel: 'Groq',
});

async function readGroqResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function _safeRateLimitSnapshot(headers) {
  const get = (name) => headers?.get?.(name) ?? null;
  return Object.freeze({
    limitRequests: get('x-ratelimit-limit-requests'),
    remainingRequests: get('x-ratelimit-remaining-requests'),
    resetRequests: get('x-ratelimit-reset-requests'),
    limitTokens: get('x-ratelimit-limit-tokens'),
    remainingTokens: get('x-ratelimit-remaining-tokens'),
    resetTokens: get('x-ratelimit-reset-tokens'),
    retryAfter: get('retry-after'),
    requestId: get('x-request-id'),
  });
}

function createGroqHttpTransport({
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_GROQ_CHAT_COMPLETIONS_ENDPOINT,
  clock = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Groq HTTP transport requires fetch implementation');
  }

  async function generate({
    apiKey,
    body,
    timeoutMs = 30000,
    signal = null,
  } = {}) {
    if (!apiKey) throw new Error('Groq HTTP transport requires apiKey');
    if (!body || typeof body !== 'object') {
      throw new Error('Groq HTTP transport requires request body');
    }

    const controller = new AbortController();
    let externalAbort = false;
    const onAbort = () => {
      externalAbort = true;
      controller.abort(signal?.reason);
    };

    if (signal?.aborted) {
      externalAbort = true;
      controller.abort(signal.reason);
    } else if (signal?.addEventListener) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const startedAt = Number(clock()) || Date.now();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await readGroqResponseBody(response);
      const latencyMs = Math.max(0, (Number(clock()) || Date.now()) - startedAt);
      if (externalAbort || signal?.aborted) throw new AIError('Groq request was cancelled', {code:GROQ_ERROR_CODES.CANCELLED,status:499,retryable:false,scope:'ATTEMPT',provider:AI_PROVIDERS.GROQ});

      if (!response.ok) {
        throw classifyGroqHttpError({
          status: response.status,
          body: raw,
          headers: response.headers,
        });
      }

      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new AIError('Groq returned a malformed response envelope', {
          code: GROQ_ERROR_CODES.INVALID_OUTPUT,
          status: response.status,
          retryable: true,
          scope: 'ATTEMPT',
          provider: AI_PROVIDERS.GROQ,
        });
      }

      return Object.freeze({
        raw,
        latencyMs,
        httpStatus: response.status,
        rateLimit: _safeRateLimitSnapshot(response.headers),
      });
    } catch (error) {
      if (error instanceof AIError) throw error;

      if (externalAbort || signal?.aborted) {
        throw new AIError('Groq request was cancelled', {
          code: GROQ_ERROR_CODES.CANCELLED,
          status: 499,
          retryable: false,
          scope: 'ATTEMPT',
          provider: AI_PROVIDERS.GROQ,
          cause: error,
        });
      }

      if (
        controller.signal.aborted ||
        String(error?.name || '').toLowerCase() === 'aborterror' ||
        String(error?.message || '').toLowerCase().includes('aborted')
      ) {
        throw timeoutError(timeoutMs, error, GROQ_ERROR_CONTEXT);
      }

      throw networkError(error, GROQ_ERROR_CONTEXT);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  return Object.freeze({
    generate,
  });
}

module.exports = {
  DEFAULT_GROQ_CHAT_COMPLETIONS_ENDPOINT,
  GROQ_ERROR_CONTEXT,
  readGroqResponseBody,
  createGroqHttpTransport,
};
