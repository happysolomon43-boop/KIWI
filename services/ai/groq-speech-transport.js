'use strict';

const { AI_PROVIDERS } = require('./providers');
const {
  AIError,
  timeoutError,
  networkError,
} = require('./errors');
const {
  GROQ_ERROR_CODES,
  classifyGroqHttpError,
} = require('./groq-error-classifier');

const DEFAULT_GROQ_SPEECH_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
const GROQ_SPEECH_ERROR_CONTEXT = Object.freeze({
  provider: AI_PROVIDERS.GROQ,
  providerLabel: 'Groq',
});

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

async function _errorBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return text; }
}

function _isWav(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE';
}

function createGroqSpeechTransport({
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_GROQ_SPEECH_ENDPOINT,
  clock = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Groq speech transport requires fetch implementation');
  }

  async function synthesize({
    apiKey,
    body,
    timeoutMs = 15000,
    signal = null,
  } = {}) {
    if (!apiKey) throw new Error('Groq speech transport requires apiKey');
    if (!body || typeof body !== 'object') {
      throw new Error('Groq speech transport requires request body');
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
    } else {
      signal?.addEventListener?.('abort', onAbort, { once: true });
    }

    const startedAt = Number(clock()) || Date.now();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'audio/wav',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const latencyMs = Math.max(0, (Number(clock()) || Date.now()) - startedAt);

      if (!response.ok) {
        const raw = await _errorBody(response);
        throw classifyGroqHttpError({
          status: response.status,
          body: raw,
          headers: response.headers,
        });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!_isWav(buffer)) {
        throw new AIError('Groq speech returned invalid WAV audio', {
          code: GROQ_ERROR_CODES.INVALID_OUTPUT,
          status: response.status,
          retryable: true,
          scope: 'ATTEMPT',
          provider: AI_PROVIDERS.GROQ,
        });
      }

      return Object.freeze({
        audioBuffer: buffer,
        mimeType: 'audio/wav',
        latencyMs,
        httpStatus: response.status,
        rateLimit: _safeRateLimitSnapshot(response.headers),
      });
    } catch (error) {
      if (error instanceof AIError) throw error;

      if (externalAbort || signal?.aborted) {
        throw new AIError('Groq speech request was cancelled', {
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
        throw timeoutError(timeoutMs, error, GROQ_SPEECH_ERROR_CONTEXT);
      }

      throw networkError(error, GROQ_SPEECH_ERROR_CONTEXT);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  return Object.freeze({ synthesize });
}

module.exports = {
  DEFAULT_GROQ_SPEECH_ENDPOINT,
  GROQ_SPEECH_ERROR_CONTEXT,
  createGroqSpeechTransport,
};
