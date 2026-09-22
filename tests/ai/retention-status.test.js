'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPostgresAIStore } = require('../../services/ai/postgres-store');
const {
  createAIRuntime,
  parseCleanupIntervalMs,
  parseRetentionDays,
} = require('../../services/ai/runtime');

test('AI retention policy clamps unsafe values', () => {
  assert.equal(parseRetentionDays(undefined, 30, 7, 180), 30);
  assert.equal(parseRetentionDays(1, 30, 7, 180), 7);
  assert.equal(parseRetentionDays(9999, 30, 7, 180), 180);

  assert.equal(parseCleanupIntervalMs(1000), 60 * 60 * 1000);
  assert.equal(
    parseCleanupIntervalMs(30 * 24 * 60 * 60 * 1000),
    7 * 24 * 60 * 60 * 1000
  );
});

test('operational-history cleanup deletes only bounded telemetry history', async () => {
  const calls = [];
  const store = createPostgresAIStore({
    randomUUID: () => '00000000-0000-0000-0000-000000000001',
    async query(sql, params) {
      calls.push({ sql, params });
      if (/DELETE FROM ai_requests/i.test(sql)) return { rowCount: 4, rows: [] };
      if (/DELETE FROM ai_model_qualifications/i.test(sql)) return { rowCount: 2, rows: [] };
      if (/DELETE FROM ai_daily_rollups/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    },
  });

  const result = await store.cleanupOperationalHistory({
    requestRetentionDays: 30,
    qualificationRetentionDays: 180,
    rollupRetentionDays: 365,
  });

  assert.deepEqual(result, {
    requestsDeleted: 4,
    qualificationsDeleted: 2,
    rollupsDeleted: 1,
    requestRetentionDays: 30,
    qualificationRetentionDays: 180,
    rollupRetentionDays: 365,
  });

  const qualificationDelete = calls.find((call) =>
    /DELETE FROM ai_model_qualifications/i.test(call.sql)
  );
  assert.match(qualificationDelete.sql, /SELECT DISTINCT ON \(model_id\) id/i);
  assert.match(qualificationDelete.sql, /ORDER BY model_id, created_at DESC, id DESC/i);
});

test('runtime status exposes routing health without keys or prompt content', () => {
  const runtime = createAIRuntime({
    query: async () => ({ rows: [] }),
    randomUUID: () => '00000000-0000-0000-0000-000000000001',
    env: {
      GEMINI_API_KEY: 'secret-one',
      GEMINI_API_KEY_2: 'secret-two',
      AI_AUTO_DISCOVERY: 'true',
      AI_AUTO_PROMOTE: 'true',
    },
    fetchImpl: async () => {
      throw new Error('not used');
    },
    logger: { log() {}, warn() {} },
    timers: {
      setImmediate: null,
      setInterval: null,
      clearInterval() {},
    },
  });

  const status = runtime.status();
  const serialized = JSON.stringify(status);

  assert.equal(status.projectSlots.total, 2);
  assert.equal(status.projectSlots.enabled, 2);
  assert.equal(status.routes.VVIP.primaryModel, 'gemini-3.8-flash');
  assert.equal(status.routes.VIP.primaryModel, 'gemini-3.7-flash');
  assert.equal(status.routes.IP.primaryModel, 'gemini-3.5-flash-lite');
  assert.equal(status.discovery.enabled, true);
  assert.equal(status.discovery.autoPromote, true);
  assert.doesNotMatch(serialized, /secret-one|secret-two/);
  assert.doesNotMatch(serialized, /GEMINI_API_KEY/);
});
