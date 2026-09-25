'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_ERROR_CODES,
  QUOTA_DIMENSIONS,
  classifyGeminiHttpError,
  extractProviderEvidence,
  extractRetryDelayMs,
} = require('../../services/ai/errors');

test('classifies bad requests as non-retryable request failures', () => {
  const error = classifyGeminiHttpError({
    status: 400,
    body: { error: { message: 'Invalid generation config' } },
  });

  assert.equal(error.code, AI_ERROR_CODES.BAD_REQUEST);
  assert.equal(error.retryable, false);
  assert.equal(error.scope, 'REQUEST');
});

test('classifies auth failures as slot-scoped', () => {
  const error = classifyGeminiHttpError({
    status: 403,
    body: { error: { message: 'API key not authorized' } },
  });

  assert.equal(error.code, AI_ERROR_CODES.AUTH);
  assert.equal(error.scope, 'SLOT');
});

test('classifies model-not-found as model-scoped', () => {
  const error = classifyGeminiHttpError({
    status: 404,
    body: { error: { message: 'Model not found' } },
  });

  assert.equal(error.code, AI_ERROR_CODES.MODEL_NOT_FOUND);
  assert.equal(error.scope, 'MODEL');
});

test('distinguishes Gemini daily, request-per-minute and token-per-minute quota errors', () => {
  const rpd = classifyGeminiHttpError({
    status: 429,
    body: {
      error: {
        details: [{
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        }],
      },
    },
  });
  const rpm = classifyGeminiHttpError({
    status: 429,
    body: { error: { message: 'RequestsPerMinute quota exceeded' } },
  });
  const tpm = classifyGeminiHttpError({
    status: 429,
    body: { error: { message: 'TokensPerMinute quota exceeded' } },
  });

  assert.equal(rpd.code, AI_ERROR_CODES.RATE_LIMIT_RPD);
  assert.equal(rpm.code, AI_ERROR_CODES.RATE_LIMIT_RPM);
  assert.equal(tpm.code, AI_ERROR_CODES.RATE_LIMIT_TPM);
  assert.equal(rpd.retryable, true);
});

test('classifies 503 service-unavailable as provider overload', () => {
  const error = classifyGeminiHttpError({
    status: 503,
    body: { error: { message: 'Service unavailable' } },
  });

  assert.equal(error.code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
  assert.equal(error.retryable, true);
  assert.equal(error.scope, 'PROVIDER_MODEL');
});

test('keeps other 5xx failures as transient provider-model failures', () => {
  const error = classifyGeminiHttpError({
    status: 502,
    body: { error: { message: 'Bad gateway' } },
  });

  assert.equal(error.code, AI_ERROR_CODES.TRANSIENT);
  assert.equal(error.retryable, true);
  assert.equal(error.scope, 'PROVIDER_MODEL');
});


test('extracts Gemini RetryInfo delays and attaches them to retryable errors', () => {
  const body = {
    error: {
      details: [{
        '@type': 'type.googleapis.com/google.rpc.RetryInfo',
        retryDelay: '12.5s',
      }],
    },
  };

  assert.equal(extractRetryDelayMs(body), 12500);

  const error = classifyGeminiHttpError({
    status: 429,
    body,
  });
  assert.equal(error.retryAfterMs, 12500);
});

test('Retry-After response header is honored when present', () => {
  const error = classifyGeminiHttpError({
    status: 503,
    body: { error: { message: 'Service unavailable' } },
    headers: {
      get(name) {
        return name.toLowerCase() === 'retry-after' ? '7' : null;
      },
    },
  });

  assert.equal(error.retryAfterMs, 7000);
});


test('structured Gemini quota evidence is retained without prompt or key material', () => {
  const body = {
    error: {
      status: 'RESOURCE_EXHAUSTED',
      message: 'Quota exceeded',
      details: [{
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
        quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        quotaValue: '20',
      }],
    },
  };

  const evidence = extractProviderEvidence(body);
  assert.equal(evidence.providerStatus, 'RESOURCE_EXHAUSTED');
  assert.equal(evidence.quotaDimension, QUOTA_DIMENSIONS.RPD);
  assert.equal(evidence.quotaLimitValue, 20);
  assert.equal(
    evidence.quotaLimitName,
    'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
  );
  assert.equal(evidence.classificationSource, 'STRUCTURED_QUOTA');
});

test('machine-readable short-window provider codes never become daily exhaustion without daily evidence', () => {
  const error = classifyGeminiHttpError({
    status: 429,
    body: {
      error: {
        code: 'rate_limit_exceeded',
        message: 'Please retry later',
      },
    },
  });

  assert.equal(error.code, AI_ERROR_CODES.RATE_LIMIT_UNKNOWN);
  assert.equal(error.providerEvidence.quotaDimension, QUOTA_DIMENSIONS.UNKNOWN);
  assert.equal(error.providerEvidence.classificationSource, 'PROVIDER_CODE');
});

test('machine-readable quota_exceeded is treated as confirmed daily exhaustion', () => {
  const error = classifyGeminiHttpError({
    status: 429,
    body: {
      error: {
        code: 'quota_exceeded',
        message: 'Daily quota exhausted',
      },
    },
  });

  assert.equal(error.code, AI_ERROR_CODES.RATE_LIMIT_RPD);
  assert.equal(error.providerEvidence.quotaDimension, QUOTA_DIMENSIONS.RPD);
});

test('generic daily wording does not quarantine a route as RPD', () => {
  const error = classifyGeminiHttpError({
    status: 429,
    body: {
      error: {
        status: 'RESOURCE_EXHAUSTED',
        message: 'Temporary limit reached during daily processing',
      },
    },
  });

  assert.equal(error.code, AI_ERROR_CODES.RATE_LIMIT_UNKNOWN);
  assert.equal(error.providerEvidence.quotaDimension, QUOTA_DIMENSIONS.UNKNOWN);
});
