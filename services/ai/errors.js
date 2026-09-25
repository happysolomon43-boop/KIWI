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
  PROVIDER_OVERLOADED: 'PROVIDER_OVERLOADED',
  ORCHESTRATOR_BUSY: 'ORCHESTRATOR_BUSY',
  QUEUE_TIMEOUT: 'QUEUE_TIMEOUT',
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
    retryAfterMs = null,
    providerEvidence = null,
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
    this.retryAfterMs = Number.isFinite(Number(retryAfterMs))
      ? Math.max(0, Number(retryAfterMs))
      : null;
    this.providerEvidence = providerEvidence
      ? Object.freeze({ ...providerEvidence })
      : null;
    if (cause) this.cause = cause;
  }
}

function _safeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

const QUOTA_DIMENSIONS = Object.freeze({
  RPM: 'RPM',
  TPM: 'TPM',
  RPD: 'RPD',
  UNKNOWN: 'UNKNOWN',
});

function _firstFiniteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function _dimensionFromText(value) {
  const text = _safeString(value).toLowerCase();
  if (!text) return null;

  if (
    /requests?\s*per\s*day/.test(text) ||
    text.includes('requestsperday') ||
    text.includes('requests_per_day') ||
    text.includes('perdayperprojectpermodel') ||
    /\brpd\b/.test(text) ||
    text.includes('daily request quota')
  ) {
    return QUOTA_DIMENSIONS.RPD;
  }

  if (
    /tokens?\s*per\s*minute/.test(text) ||
    text.includes('tokensperminute') ||
    text.includes('tokens_per_minute') ||
    /\btpm\b/.test(text)
  ) {
    return QUOTA_DIMENSIONS.TPM;
  }

  if (
    /requests?\s*per\s*minute/.test(text) ||
    text.includes('requestsperminute') ||
    text.includes('requests_per_minute') ||
    /\brpm\b/.test(text)
  ) {
    return QUOTA_DIMENSIONS.RPM;
  }

  return null;
}

function extractProviderEvidence(body, headers = null) {
  const error = body && typeof body === 'object' ? (body.error || body) : null;
  const rawCode = error?.code;
  const providerErrorCode =
    typeof rawCode === 'string'
      ? rawCode.toLowerCase()
      : null;
  const providerStatus =
    typeof error?.status === 'string'
      ? error.status
      : null;

  let quotaMetric = null;
  let quotaLimitName = null;
  let quotaLimitValue = null;
  let errorInfoReason = null;
  let structuredDimension = null;

  function walk(value) {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object') return;

    for (const [key, item] of Object.entries(value)) {
      const lower = key.toLowerCase();

      if (!quotaMetric && (lower === 'quotametric' || lower === 'quota_metric')) {
        quotaMetric = item == null ? null : String(item);
      } else if (
        !quotaLimitName &&
        (lower === 'quotaid' || lower === 'quotalimit' || lower === 'quota_limit')
      ) {
        quotaLimitName = item == null ? null : String(item);
      } else if (
        quotaLimitValue == null &&
        (lower === 'quotavalue' || lower === 'quotalimitvalue' || lower === 'quota_limit_value')
      ) {
        quotaLimitValue = _firstFiniteNumber(item);
      } else if (!errorInfoReason && lower === 'reason' && typeof item === 'string') {
        errorInfoReason = item;
      }

      if (!structuredDimension) {
        structuredDimension = _dimensionFromText(
          lower === 'description' || lower.includes('quota') ? item : null
        ) || structuredDimension;
      }

      walk(item);
    }
  }

  walk(error?.details || []);

  structuredDimension =
    _dimensionFromText(quotaLimitName) ||
    _dimensionFromText(quotaMetric) ||
    structuredDimension;

  let quotaDimension = null;
  let classificationSource = null;

  // The newer Gemini error contract exposes machine-readable 429 codes.
  // quota_exceeded is specifically daily quota; rate_limit_exceeded and
  // too_many_requests are short-window throttles but do not by themselves
  // distinguish request-rate from token-rate.
  if (providerErrorCode === 'quota_exceeded') {
    quotaDimension = QUOTA_DIMENSIONS.RPD;
    classificationSource = 'PROVIDER_CODE';
  } else if (
    providerErrorCode === 'rate_limit_exceeded' ||
    providerErrorCode === 'too_many_requests'
  ) {
    quotaDimension = structuredDimension || QUOTA_DIMENSIONS.UNKNOWN;
    classificationSource = structuredDimension
      ? 'STRUCTURED_QUOTA'
      : 'PROVIDER_CODE';
  } else if (structuredDimension) {
    quotaDimension = structuredDimension;
    classificationSource = 'STRUCTURED_QUOTA';
  } else {
    // GenerateContent commonly returns RESOURCE_EXHAUSTED plus google.rpc
    // details. Only if those details are absent do we use the human message,
    // and even then the match must name a quota dimension explicitly.
    const messageDimension = _dimensionFromText(error?.message || body);
    if (messageDimension) {
      quotaDimension = messageDimension;
      classificationSource = 'MESSAGE_HEURISTIC';
    }
  }

  return Object.freeze({
    providerErrorCode,
    providerStatus,
    errorInfoReason,
    quotaDimension: quotaDimension || QUOTA_DIMENSIONS.UNKNOWN,
    quotaMetric,
    quotaLimitName,
    quotaLimitValue,
    retryAfterMs: extractRetryDelayMs(body, headers),
    classificationSource: classificationSource || 'UNCLASSIFIED',
  });
}

function _quotaCodeFromEvidence(evidence) {
  switch (evidence?.quotaDimension) {
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

function extractProviderMessage(body, fallback = 'Gemini request failed') {
  if (!body) return fallback;
  if (typeof body === 'string') return body.slice(0, 1000);
  const message = body?.error?.message || body?.message || body?.error_description;
  return message ? String(message).slice(0, 1000) : fallback;
}

function _durationToMs(value) {
  if (value == null) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value * 1000);
  }

  if (typeof value === 'object') {
    const seconds = Number(value.seconds);
    const nanos = Number(value.nanos);
    if (Number.isFinite(seconds) || Number.isFinite(nanos)) {
      return Math.max(
        0,
        (Number.isFinite(seconds) ? seconds * 1000 : 0) +
        (Number.isFinite(nanos) ? nanos / 1000000 : 0)
      );
    }
  }

  const text = String(value).trim();
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m)?$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] || 's').toLowerCase();
  if (unit === 'ms') return amount;
  if (unit === 'm') return amount * 60000;
  return amount * 1000;
}

function extractRetryDelayMs(body, headers = null) {
  const headerValue =
    headers?.get?.('retry-after') ??
    headers?.['retry-after'] ??
    headers?.['Retry-After'] ??
    null;

  if (headerValue != null) {
    const numeric = Number(headerValue);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1000;

    const absolute = Date.parse(String(headerValue));
    if (Number.isFinite(absolute)) return Math.max(0, absolute - Date.now());
  }

  let found = null;
  function walk(value) {
    if (found != null || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object') return;

    for (const [key, item] of Object.entries(value)) {
      if (/retry(delay|after)/i.test(key)) {
        const parsed = _durationToMs(item);
        if (parsed != null) {
          found = parsed;
          return;
        }
      }
      walk(item);
    }
  }

  walk(body);
  return found;
}

function classifyGeminiHttpError({ status, body, headers = null }) {
  const message = extractProviderMessage(body, `Gemini HTTP ${status}`);
  const providerEvidence = extractProviderEvidence(body, headers);
  const retryAfterMs = providerEvidence.retryAfterMs;

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
      code: _quotaCodeFromEvidence(providerEvidence),
      status,
      retryable: true,
      scope: 'MODEL_SLOT',
      details: body,
      retryAfterMs,
      providerEvidence,
    });
  }

  if (status === 503) {
    return new AIError(message, {
      code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
      status,
      retryable: true,
      scope: 'PROVIDER_MODEL',
      details: body,
      retryAfterMs,
      providerEvidence,
    });
  }

  if (status >= 500 && status <= 599) {
    return new AIError(message, {
      code: AI_ERROR_CODES.TRANSIENT,
      status,
      retryable: true,
      scope: 'PROVIDER_MODEL',
      details: body,
      retryAfterMs,
      providerEvidence,
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
  AI_ERROR_CODES.PROVIDER_OVERLOADED,
  AI_ERROR_CODES.ORCHESTRATOR_BUSY,
  AI_ERROR_CODES.QUEUE_TIMEOUT,
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
  QUOTA_DIMENSIONS,
  classifyGeminiHttpError,
  extractProviderEvidence,
  extractProviderMessage,
  extractRetryDelayMs,
  timeoutError,
  networkError,
  safetyError,
  AVAILABILITY_ERROR_CODES,
  isAIAvailabilityError,
};
