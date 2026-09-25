'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOperationBudget } = require('../../services/ai/operation-budget');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

test('operation budget is shared across calls that use the same generation operation id', async () => {
  const budget = createOperationBudget({
    env: {
      AI_VVIP_OPERATION_MAX_PROVIDER_ATTEMPTS: '2',
      AI_VVIP_OPERATION_MAX_AVAILABILITY_FAILURES: '10',
      AI_VVIP_OPERATION_MAX_SHORT_RATE_FAILURES: '10',
      AI_VVIP_OPERATION_MAX_PROVIDER_OVERLOAD_FAILURES: '10',
    },
  });

  assert.equal((await budget.claim({ operationId: 'reckoning-1', taskClass: 'VVIP' })).allowed, true);
  assert.equal((await budget.claim({ operationId: 'reckoning-1', taskClass: 'VVIP' })).allowed, true);

  const blocked = await budget.claim({ operationId: 'reckoning-1', taskClass: 'VVIP' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.state.providerAttempts, 2);
});

test('short-rate failure budget stops repeated waves before provider-attempt ceiling', async () => {
  const budget = createOperationBudget({
    env: {
      AI_VVIP_OPERATION_MAX_PROVIDER_ATTEMPTS: '20',
      AI_VVIP_OPERATION_MAX_AVAILABILITY_FAILURES: '20',
      AI_VVIP_OPERATION_MAX_SHORT_RATE_FAILURES: '2',
      AI_VVIP_OPERATION_MAX_PROVIDER_OVERLOAD_FAILURES: '20',
    },
  });

  const rateError = new AIError('rpm', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPM,
    status: 429,
    retryable: true,
  });

  assert.equal((await budget.claim({ operationId: 'op-rate', taskClass: 'VVIP' })).allowed, true);
  await budget.recordOutcome('op-rate', rateError);
  assert.equal((await budget.claim({ operationId: 'op-rate', taskClass: 'VVIP' })).allowed, true);
  await budget.recordOutcome('op-rate', rateError);

  const blocked = await budget.claim({ operationId: 'op-rate', taskClass: 'VVIP' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.state.shortRateLimitFailures, 2);
});

test('operation budget resets after its TTL rather than poisoning a future operation forever', async () => {
  let now = 1000;
  const budget = createOperationBudget({
    clock: () => now,
    env: {
      AI_OPERATION_BUDGET_TTL_MS: '60000',
      AI_IP_OPERATION_MAX_PROVIDER_ATTEMPTS: '1',
    },
  });

  assert.equal((await budget.claim({ operationId: 'op-expire', taskClass: 'IP' })).allowed, true);
  assert.equal((await budget.claim({ operationId: 'op-expire', taskClass: 'IP' })).allowed, false);

  now += 60001;
  assert.equal((await budget.claim({ operationId: 'op-expire', taskClass: 'IP' })).allowed, true);
});
