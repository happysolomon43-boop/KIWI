'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTelemetry } = require('../../services/ai/telemetry');

test('shadow telemetry stores routing metadata only', async () => {
  const writes = [];
  const store = {
    async createRequest(record) {
      writes.push({ type: 'request', record });
      return '11111111-1111-4111-8111-111111111111';
    },
    async recordAttempt(record) {
      writes.push({ type: 'attempt', record });
    },
    async finishRequest(id, record) {
      writes.push({ type: 'finish', id, record });
    },
    async incrementDailyRollup(record) {
      writes.push({ type: 'rollup', record });
    },
  };

  const telemetry = createTelemetry({
    store,
    clock: () => new Date('2026-09-22T20:00:00Z'),
    logger: { warn() {} },
  });

  await telemetry.recordShadowDecision({
    taskId: 'MAIN_CBT',
    taskClass: 'VVIP',
    requestedReasoning: 'HIGH',
    candidateModels: [
      { modelId: 'gemini-3.8-flash' },
      { modelId: 'gemini-3.7-flash' },
    ],
    legacyModel: 'legacy-preview',
    plannedProjectSlot: 'gemini-project-03',
  });

  const serialized = JSON.stringify(writes);
  assert.match(serialized, /MAIN_CBT/);
  assert.match(serialized, /gemini-3\.8-flash/);
  assert.match(serialized, /gemini-project-03/);
  assert.doesNotMatch(serialized, /prompt|study notes|secret-key/i);
});

test('telemetry failures are best-effort and do not throw', async () => {
  const telemetry = createTelemetry({
    store: {
      async createRequest() { throw new Error('db down'); },
    },
    logger: { warn() {} },
  });

  const id = await telemetry.beginRequest({
    taskId: 'CARD_EXPLANATION',
    taskClass: 'IP',
    mode: 'SHADOW',
  });

  assert.equal(id, null);
});


test('live telemetry exposes recent provider errors, fallbacks and queue wait without content', async () => {
  const writes = [];
  const store = {
    async createRequest() { return '22222222-2222-4222-8222-222222222222'; },
    async recordAttempt(record) { writes.push({ type: 'attempt', record }); },
    async finishRequest(id, record) { writes.push({ type: 'finish', id, record }); },
    async incrementDailyRollup() {},
  };

  const telemetry = createTelemetry({
    store,
    clock: () => new Date('2026-09-23T20:00:00Z'),
    logger: { warn() {} },
  });

  await telemetry.recordAttempt({
    requestId: '22222222-2222-4222-8222-222222222222',
    attemptNumber: 1,
    modelId: 'gemini-3.8-flash',
    projectSlot: 'gemini-project-01',
    outcome: 'FAILED',
    errorCode: 'PROVIDER_OVERLOADED',
    httpStatus: 503,
    latencyMs: 1200,
  });
  await telemetry.recordAttempt({
    requestId: '22222222-2222-4222-8222-222222222222',
    attemptNumber: 2,
    modelId: 'gemini-3.7-flash',
    projectSlot: 'gemini-project-02',
    outcome: 'SUCCESS',
    latencyMs: 900,
  });
  await telemetry.finishRequest(
    '22222222-2222-4222-8222-222222222222',
    {
      taskId: 'RECKONING_CBT',
      taskClass: 'VVIP',
      mode: 'LIVE',
      selectedModel: 'gemini-3.7-flash',
      selectedProjectSlot: 'gemini-project-02',
      outcome: 'SUCCESS',
      fallbackDepth: 1,
      attemptCount: 2,
      latencyMs: 2400,
      queueWaitMs: 350,
      admissionLimit: 2,
      congestionLevel: 'HIGH',
      usage: {},
    }
  );

  const status = telemetry.snapshot();
  assert.equal(status.attempts, 2);
  assert.equal(status.successfulAttempts, 1);
  assert.equal(status.failedAttempts, 1);
  assert.equal(status.errorsByCode.PROVIDER_OVERLOADED, 1);
  assert.equal(status.httpStatuses['503'], 1);
  assert.equal(status.fallbackRequests, 1);
  assert.equal(status.averageQueueWaitMs, 350);

  const finish = writes.find((entry) => entry.type === 'finish');
  assert.equal(finish.record.queueWaitMs, 350);
  assert.equal(finish.record.admissionLimit, 2);
  assert.equal(finish.record.congestionLevel, 'HIGH');
  assert.doesNotMatch(JSON.stringify(status), /prompt|question text|study notes/i);
});
