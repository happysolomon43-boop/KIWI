'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAIRuntime,
  parseHealthSyncIntervalMs,
} = require('../../services/ai/runtime');

test('health synchronization interval is bounded', () => {
  assert.equal(parseHealthSyncIntervalMs(undefined), 15000);
  assert.equal(parseHealthSyncIntervalMs(100), 5000);
  assert.equal(parseHealthSyncIntervalMs(9999999), 5 * 60 * 1000);
});

test('runtime schedules persisted health convergence and exposes secret-free durable operations', async () => {
  const sqlSeen = [];
  const intervals = [];

  async function query(sql) {
    sqlSeen.push(sql);

    if (/FROM ai_model_catalog/i.test(sql) && /SELECT/i.test(sql)) {
      return { rows: [] };
    }
    if (/FROM ai_project_model_state/i.test(sql) && /SELECT/i.test(sql)) {
      return { rows: [] };
    }
    if (/FROM ai_provider_model_health/i.test(sql) && /SELECT/i.test(sql)) {
      return { rows: [] };
    }
    if (/FROM ai_attempts/i.test(sql) && /GROUP BY model_id/i.test(sql)) {
      return {
        rows: [{
          model_id: 'gemini-test-flash',
          project_slot: 'gemini-project-01',
          outcome: 'FAILED',
          error_code: 'PROVIDER_OVERLOADED',
          http_status: 503,
          attempts: 2,
          last_seen_at: '2026-09-23T21:00:00Z',
        }],
      };
    }
    if (/FROM ai_requests/i.test(sql) && /GROUP BY task_id/i.test(sql)) {
      return {
        rows: [{
          task_id: 'MAIN_CBT',
          class: 'VVIP',
          requests: 2,
          successes: 1,
          failures: 1,
          fallback_requests: 1,
          average_queue_wait_ms: 40,
          last_request_at: '2026-09-23T21:00:00Z',
        }],
      };
    }
    if (/FROM ai_requests/i.test(sql) && /average_admission_limit/i.test(sql)) {
      return {
        rows: [{
          requests: 2,
          successes: 1,
          failures: 1,
          blocked: 0,
          pending: 0,
          fallback_requests: 1,
          average_latency_ms: 900,
          average_queue_wait_ms: 40,
          max_queue_wait_ms: 70,
          average_admission_limit: 3,
        }],
      };
    }

    return { rows: [], rowCount: 0 };
  }

  const runtime = createAIRuntime({
    query,
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    env: {
      GEMINI_API_KEY: 'server-secret-never-exposed',
      AI_AUTO_DISCOVERY: 'false',
      AI_HEALTH_SYNC_INTERVAL_MS: '10000',
    },
    fetchImpl: async () => { throw new Error('network not expected'); },
    logger: { log() {}, warn() {} },
    timers: {
      setImmediate: null,
      setInterval(fn, ms) {
        const handle = { fn, ms, unref() {} };
        intervals.push(handle);
        return handle;
      },
      clearInterval() {},
    },
  });

  const initialized = await runtime.initialize();
  assert.equal(initialized.healthSyncScheduled, true);
  assert.ok(intervals.some((entry) => entry.ms === 10000));

  const sync = await runtime.runHealthSyncCycle();
  assert.deepEqual(sync, { quotaRows: 0, providerRows: 0 });

  const status = runtime.status();
  assert.equal(status.healthSync.intervalMs, 10000);
  assert.ok(status.traffic);
  assert.ok(status.providerHealth);
  assert.ok(status.telemetry);

  const report = await runtime.operationalReport({ windowMinutes: 15 });
  assert.equal(report.persistent.windowMinutes, 15);
  assert.equal(report.persistent.requests.requests, 2);
  assert.equal(report.persistent.attempts[0].http_status, 503);
  assert.equal(report.live.traffic.baseConcurrency > 0, true);

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /server-secret-never-exposed/);
  assert.doesNotMatch(serialized, /apiKey|prompt|study notes/i);
  assert.ok(sqlSeen.some((sql) => /ai_provider_model_health/i.test(sql)));
});
