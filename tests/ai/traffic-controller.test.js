'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAITrafficController } = require('../../services/ai/traffic-controller');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

test('traffic controller enforces global concurrency and prioritizes VVIP over queued lower classes', async () => {
  const controller = createAITrafficController({
    env: {
      AI_GLOBAL_CONCURRENCY: '1',
      AI_MAX_QUEUE_DEPTH: '20',
    },
  });

  const first = await controller.acquire({ taskId: 'ip-1', taskClass: 'IP' });
  const ipPromise = controller.acquire({ taskId: 'ip-2', taskClass: 'IP' });
  const vipPromise = controller.acquire({ taskId: 'vip-1', taskClass: 'VIP' });
  const vvipPromise = controller.acquire({ taskId: 'vvip-1', taskClass: 'VVIP' });

  assert.equal(controller.snapshot().active, 1);
  assert.equal(controller.snapshot().queued, 3);

  first.release();
  const vvip = await vvipPromise;
  assert.equal(vvip.taskId, 'vvip-1');
  vvip.release();

  const vip = await vipPromise;
  assert.equal(vip.taskId, 'vip-1');
  vip.release();

  const ip = await ipPromise;
  assert.equal(ip.taskId, 'ip-2');
  ip.release();

  assert.equal(controller.snapshot().active, 0);
  assert.equal(controller.snapshot().queued, 0);
});

test('provider congestion automatically contracts admission concurrency', () => {
  const controller = createAITrafficController({
    env: {
      AI_GLOBAL_CONCURRENCY: '6',
      AI_CONGESTION_SIGNAL_WINDOW_MS: '30000',
    },
  });

  assert.equal(controller.snapshot().effectiveConcurrency, 6);
  assert.equal(controller.snapshot().congestionLevel, 'NORMAL');

  controller.noteFailure(new AIError('overloaded', {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    status: 503,
    retryable: true,
  }));
  assert.equal(controller.snapshot().effectiveConcurrency, 2);
  assert.equal(controller.snapshot().congestionLevel, 'HIGH');

  controller.noteFailure(new AIError('overloaded again', {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    status: 503,
    retryable: true,
  }));
  assert.equal(controller.snapshot().effectiveConcurrency, 1);
  assert.equal(controller.snapshot().congestionLevel, 'SEVERE');
});

test('project rate limits apply lighter central backpressure than provider overload', () => {
  const controller = createAITrafficController({
    env: { AI_GLOBAL_CONCURRENCY: '6' },
  });

  controller.noteFailure(new AIError('rpm', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPM,
    status: 429,
    retryable: true,
  }));

  const state = controller.snapshot();
  assert.equal(state.congestionLevel, 'ELEVATED');
  assert.equal(state.effectiveConcurrency, 4);
  assert.equal(state.recentSignals.RATE_LIMIT_RPM, 1);
});

test('queue timeout returns a retryable orchestrator availability error', async () => {
  const handles = [];
  const timers = {
    setTimeout(fn) {
      const handle = { fn, cancelled: false, unref() {} };
      handles.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      if (handle) handle.cancelled = true;
    },
  };

  const controller = createAITrafficController({
    env: {
      AI_GLOBAL_CONCURRENCY: '1',
      AI_VIP_QUEUE_TIMEOUT_MS: '1000',
    },
    timers,
  });

  const first = await controller.acquire({ taskId: 'hold', taskClass: 'VVIP' });
  const waiting = controller.acquire({ taskId: 'wait', taskClass: 'VIP' });

  const pendingTimer = handles.find((handle) => !handle.cancelled);
  assert.ok(pendingTimer);
  pendingTimer.fn();

  await assert.rejects(
    waiting,
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.QUEUE_TIMEOUT);
      assert.equal(error.retryable, true);
      assert.equal(error.scope, 'ORCHESTRATOR');
      return true;
    }
  );

  first.release();
  assert.equal(controller.snapshot().timedOutTotal, 1);
});

test('full queue fails fast instead of growing without bounds', async () => {
  const controller = createAITrafficController({
    env: {
      AI_GLOBAL_CONCURRENCY: '1',
      AI_MAX_QUEUE_DEPTH: '4',
      AI_IP_QUEUE_TIMEOUT_MS: '180000',
    },
  });

  const first = await controller.acquire({ taskId: 'hold', taskClass: 'VVIP' });
  const queued = [
    controller.acquire({ taskId: 'q1', taskClass: 'IP' }),
    controller.acquire({ taskId: 'q2', taskClass: 'IP' }),
    controller.acquire({ taskId: 'q3', taskClass: 'IP' }),
    controller.acquire({ taskId: 'q4', taskClass: 'IP' }),
  ];

  await assert.rejects(
    controller.acquire({ taskId: 'overflow', taskClass: 'IP' }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.ORCHESTRATOR_BUSY);
      assert.equal(error.retryable, true);
      return true;
    }
  );

  first.release();
  for (const pending of queued) {
    const lease = await pending;
    lease.release();
  }

  assert.equal(controller.snapshot().rejectedOverflowTotal, 1);
});
