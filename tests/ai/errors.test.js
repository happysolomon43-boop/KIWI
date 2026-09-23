'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_ERROR_CODES,
  classifyGeminiHttpError,
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

test('classifies provider overload separately from generic server transients', () => {
  const overloaded = classifyGeminiHttpError({
    status: 503,
    body: { error: { message: 'Service unavailable' } },
  });
  const transient = classifyGeminiHttpError({
    status: 500,
    body: { error: { message: 'Internal error' } },
  });

  assert.equal(overloaded.code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
  assert.equal(overloaded.retryable, true);
  assert.equal(overloaded.scope, 'PROVIDER_MODEL');
  assert.equal(transient.code, AI_ERROR_CODES.TRANSIENT);
  assert.equal(transient.retryable, true);
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
