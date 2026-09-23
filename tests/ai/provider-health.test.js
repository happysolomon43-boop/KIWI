'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CIRCUIT_STATES,
  createProviderHealth,
} = require('../../services/ai/provider-health');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function overloaded(retryAfterMs = null) {
  return new AIError('provider overloaded', {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    status: 503,
    retryable: true,
    scope: 'PROVIDER_MODEL',
    retryAfterMs,
  });
}

test('one failing slot is evidence but does not open a multi-slot model circuit', () => {
  let now = 1000;
  const health = createProviderHealth({
    clock: () => now,
    minDistinctFailureSlots: 2,
    openCooldownMs: 20000,
  });

  const afterOne = health.recordFailure(
    'gemini-3.8-flash',
    'p1',
    overloaded(),
    { totalEligibleSlots: 14 }
  );

  assert.equal(afterOne.state, CIRCUIT_STATES.CLOSED);
  assert.equal(afterOne.distinctFailureSlots, 1);
  assert.equal(health.availability('gemini-3.8-flash').available, true);
});

test('independent slot failures open the circuit and cooldown becomes half-open', () => {
  let now = 1000;
  const health = createProviderHealth({
    clock: () => now,
    minDistinctFailureSlots: 2,
    openCooldownMs: 20000,
  });

  health.recordFailure('gemini-3.8-flash', 'p1', overloaded(), {
    totalEligibleSlots: 14,
  });
  const opened = health.recordFailure('gemini-3.8-flash', 'p2', overloaded(), {
    totalEligibleSlots: 14,
  });

  assert.equal(opened.state, CIRCUIT_STATES.OPEN);
  assert.equal(health.availability('gemini-3.8-flash').available, false);

  now += 20001;
  const halfOpen = health.availability('gemini-3.8-flash');
  assert.equal(halfOpen.state, CIRCUIT_STATES.HALF_OPEN);
  assert.equal(halfOpen.available, true);

  const lease = health.acquire('gemini-3.8-flash');
  assert.equal(lease.halfOpenProbe, true);
  assert.equal(health.availability('gemini-3.8-flash').available, false);

  health.recordSuccess('gemini-3.8-flash');
  assert.equal(health.snapshot('gemini-3.8-flash').state, CIRCUIT_STATES.CLOSED);
});

test('failed half-open provider probe immediately reopens the circuit', () => {
  let now = 1000;
  const health = createProviderHealth({
    clock: () => now,
    minDistinctFailureSlots: 2,
    openCooldownMs: 10000,
  });

  health.recordFailure('gemini-3.8-flash', 'p1', overloaded(), {
    totalEligibleSlots: 2,
  });
  health.recordFailure('gemini-3.8-flash', 'p2', overloaded(), {
    totalEligibleSlots: 2,
  });

  now += 10001;
  assert.equal(health.acquire('gemini-3.8-flash').halfOpenProbe, true);

  const reopened = health.recordFailure(
    'gemini-3.8-flash',
    'p1',
    overloaded(),
    { totalEligibleSlots: 2 }
  );

  assert.equal(reopened.state, CIRCUIT_STATES.OPEN);
  assert.equal(health.availability('gemini-3.8-flash').available, false);
});

test('a single-slot model can still open its circuit after its only independent route fails', () => {
  const health = createProviderHealth({
    minDistinctFailureSlots: 2,
  });

  const state = health.recordFailure(
    'gemini-3.8-flash',
    'only-slot',
    overloaded(),
    { totalEligibleSlots: 1 }
  );

  assert.equal(state.state, CIRCUIT_STATES.OPEN);
});

test('quota errors do not count as provider-model outage evidence', () => {
  const health = createProviderHealth({
    minDistinctFailureSlots: 2,
  });

  health.recordFailure(
    'gemini-3.8-flash',
    'p1',
    new AIError('rate limited', {
      code: AI_ERROR_CODES.RATE_LIMIT_RPM,
      status: 429,
      retryable: true,
      scope: 'MODEL_SLOT',
    }),
    { totalEligibleSlots: 14 }
  );

  const snapshot = health.snapshot('gemini-3.8-flash');
  assert.equal(snapshot.state, CIRCUIT_STATES.CLOSED);
  assert.equal(snapshot.distinctFailureSlots, 0);
});
