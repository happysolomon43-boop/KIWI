'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRouteScheduler } = require('../../services/ai/route-scheduler');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

test('route scheduler keeps a busy route visible but selects a free route first', async () => {
  const scheduler = createRouteScheduler({
    env: { AI_ROUTE_MAX_IN_FLIGHT: '1' },
  });
  const slots = [{ id: 'p1' }, { id: 'p2' }];

  const first = await scheduler.acquire('m1', slots[0]);
  assert.equal(first.available, true);

  const ordered = scheduler.orderSlots('m1', slots);
  assert.deepEqual(ordered.map((slot) => slot.id), ['p2', 'p1']);

  const duplicate = await scheduler.acquire('m1', slots[0]);
  assert.equal(duplicate.available, false);
  assert.equal(duplicate.reason, 'LOCAL_ROUTE_BUSY');

  await first.release();
  assert.equal((await scheduler.acquire('m1', slots[0])).available, true);
});

test('short-window throttling paces subsequent project probes and success clears pacing', async () => {
  let now = 1000;
  const sleeps = [];
  const scheduler = createRouteScheduler({
    clock: () => now,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    env: {
      AI_SHORT_RATE_LIMIT_BACKOFF_BASE_MS: '100',
      AI_SHORT_RATE_LIMIT_BACKOFF_MAX_MS: '1000',
    },
  });

  await scheduler.recordFailure('m1', 'p1', new AIError('rpm', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPM,
    status: 429,
    retryable: true,
  }));

  assert.equal(scheduler.modelWaitMs('m1'), 75);
  const lease = await scheduler.acquire('m1', { id: 'p2' });
  assert.equal(lease.available, true);
  assert.deepEqual(sleeps, [75]);
  await lease.release();

  await scheduler.recordSuccess('m1', 'p2');
  assert.equal(scheduler.modelWaitMs('m1'), 0);
  assert.equal(scheduler.snapshotModel('m1').shortRateLimitStreak, 0);
});

test('daily quota exhaustion never creates model-wide short-window pacing', async () => {
  const scheduler = createRouteScheduler({
    random: () => 0,
  });

  await scheduler.recordFailure('m1', 'p1', new AIError('rpd', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPD,
    status: 429,
    retryable: true,
  }));

  assert.equal(scheduler.modelWaitMs('m1'), 0);
  assert.equal(scheduler.snapshotModel('m1').shortRateLimitStreak, 0);
});

test('distributed lease denial is reported as route contention, not provider capacity loss', async () => {
  const scheduler = createRouteScheduler({
    store: {
      async acquireRouteRuntimeLease() { return null; },
    },
  });

  const lease = await scheduler.acquire('m1', { id: 'p1' });
  assert.equal(lease.available, false);
  assert.equal(lease.reason, 'DISTRIBUTED_ROUTE_BUSY');
});
