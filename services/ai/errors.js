'use strict';

const AI_ERROR_CODES = Object.freeze({
  CONFIG: 'CONFIG',
  BAD_REQUEST: 'BAD_REQUEST',
  AUTH: 'AUTH',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  RATE_LIMIT_RPM: 'RATE_LIMIT_RPM',
  RATE_LIMIT_TPM: 'RATE_LIMIT_TPM',
  RATE_LIMIT_RPD: 'RATE_LIMIT_RPD',
  RATE_LIMIT_UNKNOWN: 'RATE_LIMIT_UNKNOWN',
  TIMEOUT: 'TIMEOUT',
  TRANSIENT: 'TRANSIENT',
  NETWORK: 'NETWORK',
  SAFETY: 'SAFETY',
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  CAPACITY_EXHAUSTED: 'CAPACITY_EXHAUSTED',
  UNKNOWN: 'UNKNOWN',
});

class AIError extends Error {
  constructor(message, {
    code = AI_ERROR_CODES.UNKNOWN,
    status = null,
    retryable = false,
    scope = 'REQUEST',
    provider = 'gemini',
    details = null,
    cause = null,
  } = {}) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.scope = scope;
    this.provider = provider;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

function _safeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function _quotaCode(body) {
  const text = _safeString(body).toLowerCase();

  if (
    text.includes('requestsperday') ||
    text.includes('requests_per_day') ||
    text.includes('perdayperprojectpermodel') ||
    text.includes('per day') ||
    text.includes('daily')
  ) {
    return AI_ERROR_CODES.RATE_LIMIT_RPD;
  }

  if (
    text.includes('tokensperminute') ||
    text.includes('tokens_per_minute') ||
    text.includes('token per minute') ||
    text.includes('tpm')
  ) {
    return AI_ERROR_CODES.RATE_LIMIT_TPM;
  }

  if (
    text.includes('requestsperminute') ||
    text.includes('requests_per_minute') ||
    text.includes('request per minute') ||
    text.includes('rpm')
  ) {
    return AI_ERROR_CODES.RATE_LIMIT_RPM;
  }

  return AI_ERROR_CODES.RATE_LIMIT_UNKNOWN;
}

function extractProviderMessage(body, fallback = 'Gemini request failed') {
  if (!body) return fallback;
  if (typeof body === 'string') return body.slice(0, 1000);
  const message = body?.error?.message || body?.message || body?.error_description;
  return message ? String(message).slice(0, 1000) : fallback;
}

function classifyGeminiHttpError({ status, body }) {
  const message = extractProviderMessage(body, `Gemini HTTP ${status}`);

  if (status === 400 || status === 422) {
    return new AIError(message, {
      code: AI_ERROR_CODES.BAD_REQUEST,
      status,
      retryable: false,
      scope: 'REQUEST',
      details: body,
    });
  }

  if (status === 401 || status === 403) {
    return new AIError(message, {
      code: AI_ERROR_CODES.AUTH,
      status,
      retryable: false,
      scope: 'SLOT',
      details: body,
    });
  }

  if (status === 404) {
    return new AIError(message, {
      code: AI_ERROR_CODES.MODEL_NOT_FOUND,
      status,
      retryable: false,
      scope: 'MODEL',
      details: body,
    });
  }

  if (status === 408) {
    return new AIError(message, {
      code: AI_ERROR_CODES.TIMEOUT,
      status,
      retryable: true,
      scope: 'ATTEMPT',
      details: body,
    });
  }

  if (status === 429) {
    return new AIError(message, {
      code: _quotaCode(body),
      status,
      retryable: true,
      scope: 'MODEL_SLOT',
      details: body,
    });
  }

  if (status >= 500 && status <= 599) {
    return new AIError(message, {
      code: AI_ERROR_CODES.TRANSIENT,
      status,
      retryable: true,
      scope: 'ATTEMPT',
      details: body,
    });
  }

  return new AIError(message, {
    code: AI_ERROR_CODES.UNKNOWN,
    status,
    retryable: false,
    scope: 'REQUEST',
    details: body,
  });
}

function timeoutError(timeoutMs, cause = null) {
  return new AIError(
    `Gemini request timed out after ${Math.round(timeoutMs / 1000)}s`,
    {
      code: AI_ERROR_CODES.TIMEOUT,
      retryable: true,
      scope: 'ATTEMPT',
      cause,
    }
  );
}

function networkError(cause) {
  return new AIError(
    cause?.message ? `Gemini network error: ${cause.message}` : 'Gemini network error',
    {
      code: AI_ERROR_CODES.NETWORK,
      retryable: true,
      scope: 'ATTEMPT',
      cause,
    }
  );
}

const AVAILABILITY_ERROR_CODES = new Set([
  AI_ERROR_CODES.MODEL_NOT_FOUND,
  AI_ERROR_CODES.RATE_LIMIT_RPM,
  AI_ERROR_CODES.RATE_LIMIT_TPM,
  AI_ERROR_CODES.RATE_LIMIT_RPD,
  AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
  AI_ERROR_CODES.TIMEOUT,
  AI_ERROR_CODES.TRANSIENT,
  AI_ERROR_CODES.NETWORK,
  AI_ERROR_CODES.EMPTY_RESPONSE,
  AI_ERROR_CODES.CAPACITY_EXHAUSTED,
]);

function isAIAvailabilityError(error) {
  return Boolean(error && AVAILABILITY_ERROR_CODES.has(error.code));
}

function safetyError(details = null) {
  return new AIError('Gemini blocked the response for safety reasons', {
    code: AI_ERROR_CODES.SAFETY,
    retryable: false,
    scope: 'REQUEST',
    details,
  });
}

module.exports = {
  AI_ERROR_CODES,
  AIError,
  classifyGeminiHttpError,
  extractProviderMessage,
  timeoutError,
  networkError,
  safetyError,
  AVAILABILITY_ERROR_CODES,
  isAIAvailabilityError,
};
