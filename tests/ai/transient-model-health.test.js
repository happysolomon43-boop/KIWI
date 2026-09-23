'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTransientModelHealth } = require('../../services/ai/transient-model-health');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function overload(retryAfterMs = null) {
  return new AIError('provider overloaded', {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    status: 503,
    retryable: true,
    scope: 'PROVIDER_MODEL',
    retryAfterMs,
  });
}

test('one failing project slot does not open a model-wide transient circuit', () => {
  let now = Date.parse('2026-09-23T12:00:00Z');
  const health = createTransientModelHealth({
    clock: () => now,
    failureThreshold: 2,
    failureWindowMs: 30000,
    defaultCooldownMs: 20000,
  });

  const state = health.recordFailure('gemini-3.8-flash', 'p1', overload());

  assert.equal(state.opened, false);
  assert.equal(state.distinctFailureSlots, 1);
  assert.equal(health.isAvailable('gemini-3.8-flash'), true);
  assert.equal(health.cooldownUntil('gemini-3.8-flash'), null);
});

test('failures across independent project slots open the model circuit', () => {
  let now = Date.parse('2026-09-23T12:00:00Z');
  const health = createTransientModelHealth({
    clock: () => now,
    failureThreshold: 2,
    failureWindowMs: 30000,
    defaultCooldownMs: 20000,
  });

  health.recordFailure('gemini-3.8-flash', 'p1', overload());
  const state = health.recordFailure('gemini-3.8-flash', 'p2', overload());

  assert.equal(state.opened, true);
  assert.equal(state.distinctFailureSlots, 2);
  assert.equal(health.isAvailable('gemini-3.8-flash'), false);
  assert.equal(
    health.cooldownUntil('gemini-3.8-flash'),
    now + 20000
  );
});

test('repeated failure from the same slot does not manufacture independent evidence', () => {
  const health = createTransientModelHealth({
    failureThreshold: 2,
  });

  health.recordFailure('gemini-3.8-flash', 'p1', overload());
  const state = health.recordFailure('gemini-3.8-flash', 'p1', overload());

  assert.equal(state.opened, false);
  assert.equal(state.distinctFailureSlots, 1);
  assert.equal(health.isAvailable('gemini-3.8-flash'), true);
});

test('success clears transient evidence immediately', () => {
  const health = createTransientModelHealth({
    failureThreshold: 2,
  });

  health.recordFailure('gemini-3.8-flash', 'p1', overload());
  health.recordFailure('gemini-3.8-flash', 'p2', overload());
  assert.equal(health.isAvailable('gemini-3.8-flash'), false);

  health.recordSuccess('gemini-3.8-flash');

  assert.equal(health.isAvailable('gemini-3.8-flash'), true);
  assert.equal(health.snapshot().length, 0);
});

test('expired transient circuits recover automatically for half-open probing', () => {
  let now = Date.parse('2026-09-23T12:00:00Z');
  const health = createTransientModelHealth({
    clock: () => now,
    failureThreshold: 2,
    defaultCooldownMs: 10000,
  });

  health.recordFailure('gemini-3.8-flash', 'p1', overload());
  health.recordFailure('gemini-3.8-flash', 'p2', overload());
  assert.equal(health.isAvailable('gemini-3.8-flash'), false);

  now += 10001;

  assert.equal(health.isAvailable('gemini-3.8-flash'), true);
  assert.equal(health.cooldownUntil('gemini-3.8-flash'), null);
});

test('provider Retry-After controls the bounded transient cooldown', () => {
  let now = Date.parse('2026-09-23T12:00:00Z');
  const health = createTransientModelHealth({
    clock: () => now,
    failureThreshold: 2,
    defaultCooldownMs: 20000,
  });

  health.recordFailure('gemini-3.8-flash', 'p1', overload(45000));
  const state = health.recordFailure('gemini-3.8-flash', 'p2', overload(45000));

  assert.equal(state.cooldownUntil, now + 45000);
});
