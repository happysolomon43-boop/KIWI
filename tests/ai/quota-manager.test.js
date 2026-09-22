'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROJECT_MODEL_STATES,
  pacificDayKey,
  extractObservedQuotaLimit,
  createQuotaManager,
} = require('../../services/ai/quota-manager');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

test('Pacific quota day changes at Pacific midnight rather than UTC midnight', () => {
  assert.equal(
    pacificDayKey(new Date('2026-01-01T07:30:00Z')),
    '2025-12-31'
  );
  assert.equal(
    pacificDayKey(new Date('2026-01-01T08:30:00Z')),
    '2026-01-01'
  );
});

test('daily RPD exhaustion resets automatically on the next Pacific quota day', async () => {
  let now = new Date('2026-09-22T20:00:00Z');
  const persisted = [];
  const manager = createQuotaManager({
    clock: () => now,
    store: {
      async loadProjectModelStates() { return []; },
      async upsertProjectModelState(state) { persisted.push({ ...state }); },
    },
  });

  await manager.markFailure('p1', 'gemini-3.8-flash', new AIError('daily', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPD,
    status: 429,
    retryable: true,
    details: { quotaValue: 20 },
  }));

  assert.equal(manager.get('p1', 'gemini-3.8-flash').state, PROJECT_MODEL_STATES.EXHAUSTED_RPD);
  assert.equal(manager.get('p1', 'gemini-3.8-flash').observedQuotaLimit, 20);
  assert.equal(manager.isEligible('p1', 'gemini-3.8-flash'), false);

  now = new Date('2026-09-23T08:01:00Z');
  assert.equal(manager.isEligible('p1', 'gemini-3.8-flash'), true);
  assert.equal(manager.get('p1', 'gemini-3.8-flash').attemptsToday, 0);
});

test('RPM and TPM produce temporary cooldowns instead of daily exhaustion', async () => {
  let now = new Date('2026-09-22T20:00:00Z');
  const manager = createQuotaManager({
    clock: () => now,
    rpmCooldownMs: 60000,
    tpmCooldownMs: 120000,
  });

  await manager.markFailure('p1', 'm1', new AIError('rpm', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPM,
    status: 429,
    retryable: true,
  }));
  assert.equal(manager.get('p1', 'm1').state, PROJECT_MODEL_STATES.COOLDOWN_RPM);
  assert.equal(manager.isEligible('p1', 'm1'), false);

  now = new Date('2026-09-22T20:01:01Z');
  assert.equal(manager.isEligible('p1', 'm1'), true);

  await manager.markFailure('p1', 'm1', new AIError('tpm', {
    code: AI_ERROR_CODES.RATE_LIMIT_TPM,
    status: 429,
    retryable: true,
  }));
  assert.equal(manager.get('p1', 'm1').state, PROJECT_MODEL_STATES.COOLDOWN_TPM);
});

test('quota state is model-specific within the same project slot', async () => {
  const manager = createQuotaManager();

  await manager.markFailure('p1', 'gemini-3.8-flash', new AIError('daily', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPD,
    status: 429,
    retryable: true,
  }));

  assert.equal(manager.isEligible('p1', 'gemini-3.8-flash'), false);
  assert.equal(manager.isEligible('p1', 'gemini-3.7-flash'), true);
});

test('hydration restores persisted project-model state', async () => {
  const manager = createQuotaManager({
    clock: () => new Date('2026-09-22T20:00:00Z'),
    store: {
      async loadProjectModelStates() {
        return [{
          project_slot: 'p3',
          model_id: 'm3',
          state: 'EXHAUSTED_RPD',
          quota_day: '2026-09-22',
          attempts_today: 20,
          successes_today: 20,
          observed_quota_limit: 20,
        }];
      },
      async upsertProjectModelState() {},
    },
  });

  assert.equal(await manager.hydrate(), 1);
  assert.equal(manager.isEligible('p3', 'm3'), false);
  assert.equal(manager.get('p3', 'm3').attemptsToday, 20);
});

test('quota limit extraction walks Gemini error detail objects', () => {
  assert.equal(
    extractObservedQuotaLimit({
      error: {
        details: [{
          quotaMetric: 'x',
          quotaValue: '500',
        }],
      },
    }),
    500
  );
});


test('project/model 403 and 404 availability failures recover after cooldown', async () => {
  let now = new Date('2026-09-22T20:00:00Z');
  const manager = createQuotaManager({
    clock: () => now,
    modelUnavailableCooldownMs: 60000,
  });

  await manager.markFailure('p1', 'm1', new AIError('rollout 404', {
    code: AI_ERROR_CODES.MODEL_NOT_FOUND,
    status: 404,
    retryable: true,
    scope: 'MODEL_SLOT',
  }));
  assert.equal(manager.get('p1', 'm1').state, PROJECT_MODEL_STATES.MODEL_UNAVAILABLE);
  assert.equal(manager.isEligible('p1', 'm1'), false);
  assert.equal(manager.isEligible('p2', 'm1'), true);

  await manager.markFailure('p1', 'm2', new AIError('permission 403', {
    code: AI_ERROR_CODES.ACCESS_DENIED,
    status: 403,
    retryable: true,
    scope: 'MODEL_SLOT',
  }));
  assert.equal(manager.get('p1', 'm2').state, PROJECT_MODEL_STATES.MODEL_UNAVAILABLE);
  assert.equal(manager.isEligible('p1', 'm2'), false);

  now = new Date('2026-09-22T20:01:01Z');
  assert.equal(manager.isEligible('p1', 'm1'), true);
  assert.equal(manager.isEligible('p1', 'm2'), true);
});

test('true credential failure remains distinct from temporary model availability', async () => {
  let now = new Date('2026-09-22T20:00:00Z');
  const manager = createQuotaManager({
    clock: () => now,
    modelUnavailableCooldownMs: 1000,
  });

  await manager.markFailure('p1', 'm1', new AIError('bad key', {
    code: AI_ERROR_CODES.AUTH,
    status: 401,
    retryable: false,
    scope: 'SLOT',
  }));

  assert.equal(manager.get('p1', 'm1').state, PROJECT_MODEL_STATES.KEY_INVALID);
  now = new Date('2026-09-23T20:00:00Z');
  assert.equal(manager.isEligible('p1', 'm1'), false);
});
