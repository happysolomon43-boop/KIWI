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


test('repeated failures from the same slot do not impersonate independent model evidence', () => {
  const health = createProviderHealth({
    minDistinctFailureSlots: 2,
  });

  for (let i = 0; i < 5; i++) {
    health.recordFailure(
      'gemini-3.8-flash',
      'p1',
      overloaded(),
      { totalEligibleSlots: 14 }
    );
  }

  const snapshot = health.snapshot('gemini-3.8-flash');
  assert.equal(snapshot.state, CIRCUIT_STATES.CLOSED);
  assert.equal(snapshot.distinctFailureSlots, 1);
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


test('provider circuit state hydrates across restart and persists recovery', async () => {
  let now = Date.parse('2026-09-23T20:00:00Z');
  const writes = [];
  const store = {
    async loadProviderModelHealth() {
      return [{
        model_id: 'gemini-3.8-flash',
        state: 'OPEN',
        open_until: new Date(now + 20000).toISOString(),
        failure_slots: [
          { slotId: 'p1', failedAt: new Date(now - 1000).toISOString() },
          { slotId: 'p2', failedAt: new Date(now - 500).toISOString() },
        ],
        last_error_code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
        last_http_status: 503,
        last_failure_at: new Date(now - 500).toISOString(),
        last_success_at: null,
      }];
    },
    async upsertProviderModelHealth(record) {
      writes.push(record);
      return record;
    },
  };

  const health = createProviderHealth({
    clock: () => now,
    store,
    failureEvidenceWindowMs: 30000,
    openCooldownMs: 20000,
  });

  assert.equal(await health.hydrate(), 1);
  assert.equal(health.snapshot('gemini-3.8-flash').state, CIRCUIT_STATES.OPEN);
  assert.equal(health.snapshot('gemini-3.8-flash').distinctFailureSlots, 2);
  assert.equal(health.availability('gemini-3.8-flash').available, false);

  now += 20001;
  assert.equal(
    health.availability('gemini-3.8-flash').state,
    CIRCUIT_STATES.HALF_OPEN
  );

  health.recordSuccess('gemini-3.8-flash');
  await health.persist('gemini-3.8-flash');

  assert.equal(writes.length, 1);
  assert.equal(writes[0].state, CIRCUIT_STATES.CLOSED);
  assert.deepEqual(writes[0].failureSlots, []);
  assert.equal(writes[0].lastHttpStatus, 200);
});


test('provider health refresh ignores stale database rows and accepts newer cross-instance state', async () => {
  let now = Date.parse('2026-09-23T20:00:00Z');
  let rows = [{
    model_id: 'gemini-3.8-flash',
    state: 'OPEN',
    open_until: new Date(now + 20000).toISOString(),
    failure_slots: [
      { slotId: 'p1', failedAt: new Date(now - 1000).toISOString() },
      { slotId: 'p2', failedAt: new Date(now - 500).toISOString() },
    ],
    last_error_code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    last_http_status: 503,
    last_failure_at: new Date(now - 500).toISOString(),
    last_success_at: null,
    updated_at: new Date(now - 250).toISOString(),
  }];

  const health = createProviderHealth({
    clock: () => now,
    store: {
      async loadProviderModelHealth() { return rows; },
      async upsertProviderModelHealth(record) {
        return { ...record, updated_at: new Date(now).toISOString() };
      },
    },
  });

  assert.equal(await health.hydrate(), 1);
  health.recordSuccess('gemini-3.8-flash');
  const locallyClosed = health.snapshot('gemini-3.8-flash');
  assert.equal(locallyClosed.state, CIRCUIT_STATES.CLOSED);

  // A stale OPEN row must not roll the runtime backward.
  assert.equal(await health.refreshFromStore(), 0);
  assert.equal(health.snapshot('gemini-3.8-flash').state, CIRCUIT_STATES.CLOSED);

  now += 1000;
  rows = [{
    ...rows[0],
    state: 'OPEN',
    open_until: new Date(now + 20000).toISOString(),
    updated_at: new Date(now + 1).toISOString(),
  }];

  assert.equal(await health.refreshFromStore(), 1);
  assert.equal(health.snapshot('gemini-3.8-flash').state, CIRCUIT_STATES.OPEN);
});


test('first provider failure permits exactly one confirmation probe owner', () => {
  const health = createProviderHealth({
    minDistinctFailureSlots: 2,
  });

  const afterOne = health.recordFailure(
    'gemini-3.8-flash',
    'p1',
    overloaded(),
    { totalEligibleSlots: 14 }
  );
  assert.equal(afterOne.state, CIRCUIT_STATES.CLOSED);
  assert.equal(afterOne.distinctFailureSlots, 1);

  assert.equal(health.beginConfirmationProbe('gemini-3.8-flash'), true);
  assert.equal(
    health.snapshot('gemini-3.8-flash').confirmationProbeInFlight,
    true
  );
  assert.equal(health.availability('gemini-3.8-flash').available, false);
  assert.equal(health.beginConfirmationProbe('gemini-3.8-flash'), false);

  health.endConfirmationProbe('gemini-3.8-flash');
  assert.equal(health.availability('gemini-3.8-flash').available, true);
});
