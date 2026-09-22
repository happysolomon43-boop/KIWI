'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_ERROR_CODES,
  classifyGeminiHttpError,
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

test('classifies server errors as transient', () => {
  const error = classifyGeminiHttpError({
    status: 503,
    body: { error: { message: 'Service unavailable' } },
  });

  assert.equal(error.code, AI_ERROR_CODES.TRANSIENT);
  assert.equal(error.retryable, true);
});
