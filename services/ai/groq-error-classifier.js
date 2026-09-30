'use strict';

const { AI_PROVIDERS } = require('./providers');
const {
  AIError,
  AI_ERROR_CODES,
  QUOTA_DIMENSIONS,
  extractProviderMessage,
  extractRetryDelayMs,
} = require('./errors');

const GROQ_ERROR_CODES = Object.freeze({
  PERMISSION: 'PERMISSION',
  CANCELLED: 'CANCELLED',
  INVALID_OUTPUT: 'INVALID_OUTPUT',
});

function _header(headers, name) {
  return headers?.get?.(name) ?? headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
}

function _finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function _groqRateDimension(body, headers = null) {
  const message = String(body?.error?.message || body?.message || body || '').toLowerCase();

  if (/requests?\s*per\s*day|\brpd\b|daily request/.test(message)) {
    return QUOTA_DIMENSIONS.RPD;
  }
  if (
    /tokens?\s*per\s*day|\btpd\b/.test(message)
  ) {
    return QUOTA_DIMENSIONS.RPD;
  }
  if (
    /tokens?\s*per\s*minute|\btpm\b|\bitpm\b|\botpm\b/.test(message)
  ) {
    return QUOTA_DIMENSIONS.TPM;
  }
  if (/requests?\s*per\s*minute|\brpm\b/.test(message)) {
    return QUOTA_DIMENSIONS.RPM;
  }

  // Groq documents request-limit headers as RPD and token-limit headers as TPM.
  // They are useful corroborating evidence, but cannot distinguish an RPM 429
  // without an explicit message, so only use a zero remaining value as a hint.
  const remainingRequests = _finiteNumber(_header(headers, 'x-ratelimit-remaining-requests'));
  const remainingTokens = _finiteNumber(_header(headers, 'x-ratelimit-remaining-tokens'));
  if (remainingRequests === 0) return QUOTA_DIMENSIONS.RPD;
  if (remainingTokens === 0) return QUOTA_DIMENSIONS.TPM;

  return QUOTA_DIMENSIONS.UNKNOWN;
}

function _quotaCode(dimension) {
  switch (dimension) {
    case QUOTA_DIMENSIONS.RPD:
      return AI_ERROR_CODES.RATE_LIMIT_RPD;
    case QUOTA_DIMENSIONS.RPM:
      return AI_ERROR_CODES.RATE_LIMIT_RPM;
    case QUOTA_DIMENSIONS.TPM:
      return AI_ERROR_CODES.RATE_LIMIT_TPM;
    default:
      return AI_ERROR_CODES.RATE_LIMIT_UNKNOWN;
  }
}

function extractGroqEvidence(body, headers = null) {
  const error = body && typeof body === 'object' ? (body.error || body) : null;
  const providerErrorCode = error?.code == null ? null : String(error.code);
  const providerStatus = error?.type == null ? null : String(error.type);
  const quotaDimension = _groqRateDimension(body, headers);

  return Object.freeze({
    providerErrorCode,
    providerStatus,
    quotaDimension,
    retryAfterMs: extractRetryDelayMs(body, headers),
    requestId: _header(headers, 'x-request-id') || null,
    limitRequests: _finiteNumber(_header(headers, 'x-ratelimit-limit-requests')),
    remainingRequests: _finiteNumber(_header(headers, 'x-ratelimit-remaining-requests')),
    resetRequests: _header(headers, 'x-ratelimit-reset-requests') || null,
    limitTokens: _finiteNumber(_header(headers, 'x-ratelimit-limit-tokens')),
    remainingTokens: _finiteNumber(_header(headers, 'x-ratelimit-remaining-tokens')),
    resetTokens: _header(headers, 'x-ratelimit-reset-tokens') || null,
    classificationSource: quotaDimension === QUOTA_DIMENSIONS.UNKNOWN
      ? 'GROQ_HTTP_STATUS'
      : 'GROQ_RATE_LIMIT_EVIDENCE',
  });
}

function classifyGroqHttpError({ status, body, headers = null }) {
  const message = extractProviderMessage(body, `Groq HTTP ${status}`);
  const providerEvidence = extractGroqEvidence(body, headers);
  const common = {
    provider: AI_PROVIDERS.GROQ,
    status,
    providerEvidence,
    retryAfterMs: providerEvidence.retryAfterMs,
  };
  const providerCode = String(body?.error?.code || '').toLowerCase();

  if (status === 400 && providerCode === 'blocked_api_access') {
    return new AIError(message, {
      ...common,
      code: AI_ERROR_CODES.CAPACITY_EXHAUSTED,
      retryable: false,
      scope: 'ACCOUNT',
      details: body,
    });
  }

  if (status === 400 || status === 413 || status === 422) {
    return new AIError(message, {
      ...common,
      code: AI_ERROR_CODES.BAD_REQUEST,
      retryable: false,
      scope: 'REQUEST',
      details: body,
    });
  }

  if (status === 401) {
    return new AIError(message, {
      ...common,
      code: AI_ERROR_CODES.AUTH,
      retryable: false,
      scope: 'SLOT',
      details: body,
    });
  }

  if (status === 403) {
    return new AIError(message, {
      ...common,
      code: GROQ_ERROR_CODES.PERMISSION,
      retryable: false,
      scope: 'PROVIDER_MODEL',
      details: body,
    });
  }

  if (status === 404) {
    return new AIError(message, {
      ...common,
      code: AI_ERROR_CODES.MODEL_NOT_FOUND,
      retryable: false,
      scope: 'MODEL',
      details: body,
    });
  }

  if (status === 408) {
    return new AIError(message, {
      ...common,
      code: AI_ERROR_CODES.TIMEOUT,
      retryable: true,
      scope: 'ATTEMPT',
      details: body,
    });
  }

  if (status === 429) {
    return new AIError(message, {
      ...common,
      code: _quotaCode(providerEvidence.quotaDimension),
      retryable: true,
      // Groq limits are shared beyond one API key. Do not treat a 429 as a
      // credential defect or sweep every key in the pool.
      scope: 'PROVIDER_MODEL',
      details: body,
    });
  }

  if (status === 498) {
    return new AIError(message, {
      ...common,
      code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
      retryable: true,
      scope: 'PROVIDER',
      details: body,
    });
  }

  if (status === 499) {
    return new AIError(message, {
      ...common,
      code: GROQ_ERROR_CODES.CANCELLED,
      retryable: false,
      scope: 'ATTEMPT',
      details: body,
    });
  }

  if (status === 424 || status === 500 || status === 502) {
    return new AIError(message, {
      ...common,
      code: AI_ERROR_CODES.TRANSIENT,
      retryable: true,
      scope: 'PROVIDER_MODEL',
      details: body,
    });
  }

  if (status === 503 || (status >= 504 && status <= 599)) {
    return new AIError(message, {
      ...common,
      code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
      retryable: true,
      scope: 'PROVIDER',
      details: body,
    });
  }

  return new AIError(message, {
    ...common,
    code: AI_ERROR_CODES.UNKNOWN,
    retryable: false,
    scope: 'REQUEST',
    details: body,
  });
}

module.exports = {
  GROQ_ERROR_CODES,
  extractGroqEvidence,
  classifyGroqHttpError,
};
