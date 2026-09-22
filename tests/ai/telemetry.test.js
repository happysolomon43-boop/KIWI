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
