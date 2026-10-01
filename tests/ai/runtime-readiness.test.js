'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIRuntime } = require('../../services/ai/runtime');
const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { AI_PROVIDERS } = require('../../services/ai/providers');
const { createProviderRegistry } = require('../../services/ai/provider-registry');
const { createCredentialRegistry } = require('../../services/ai/credential-registry');
const { isAIAvailabilityError, AI_ERROR_CODES } = require('../../services/ai/errors');

function harness(failPattern = null) {
  let failing = true;
  let calls = 0;
  const intervals = new Set();
  const queries = [];
  const runtime = createAIRuntime({
    query: async (sql) => {
      queries.push(sql);
      if (failing && failPattern?.test(sql)) throw new Error('private-database-details');
      return { rows: /SELECT/i.test(sql) && !/INSERT/i.test(sql) ? [] : [{}], rowCount: 0 };
    },
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    env: { GEMINI_API_KEY: 'private-key', AI_AUTO_DISCOVERY: 'false' },
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }),
      };
    },
    logger: { log() {}, warn() {} },
    timers: {
      setImmediate: null,
      setInterval(fn, ms) { const timer = { fn, ms, unref() {} }; intervals.add(timer); return timer; },
      clearInterval(timer) { intervals.delete(timer); },
    },
  });
  return { runtime, intervals, queries, recover() { failing = false; }, calls: () => calls };
}

async function assertBlocked(runtime) {
  await assert.rejects(runtime.orchestrator.run('CARD_EXPLANATION', { content: 'hello' }), (error) => {
    assert.equal(error.code, AI_ERROR_CODES.NOT_READY);
    assert.equal(error.status, 503);
    assert.equal(error.retryable, true);
    assert.equal(isAIAvailabilityError(error), true);
    assert.ok(error.retryAfterMs > 0);
    return true;
  });
}

test('AI admission is blocked before initialization without consuming a provider request', async () => {
  const h = harness();
  await assertBlocked(h.runtime);
  assert.equal(h.calls(), 0);
  assert.equal(h.queries.length, 0);
});

for (const [phase, pattern] of [
  ['catalog read', /SELECT[\s\S]*FROM ai_model_catalog/i],
  ['catalog write', /INSERT INTO ai_model_catalog/i],
  ['quota hydration', /SELECT[\s\S]*FROM ai_project_model_state/i],
  ['provider health hydration', /SELECT[\s\S]*FROM ai_provider_model_health/i],
]) {
  test(`${phase} failure blocks AI; a scheduled retry restores service`, async () => {
    const h = harness(pattern);
    const first = h.runtime.initialize();
    assert.strictEqual(h.runtime.initialize(), first);
    await assert.rejects(first, /private-database-details/);
    await assertBlocked(h.runtime);
    assert.equal(h.calls(), 0);
    assert.equal(h.intervals.size, 1);
    assert.equal(h.runtime.status().readiness.state, 'NOT_READY');
    assert.doesNotMatch(JSON.stringify(h.runtime.status()), /private-database-details|private-key/);
    h.recover();
    const retryTimer = [...h.intervals][0];
    retryTimer.fn();
    await h.runtime.initialize();
    assert.equal(h.runtime.status().readiness.state, 'READY');
    assert.equal(h.runtime.status().readiness.attempts, 2);
    assert.equal(h.runtime.status().readiness.retryScheduled, false);
    assert.equal(h.intervals.has(retryTimer), false);
    const result = await h.runtime.orchestrator.run('CARD_EXPLANATION', { content: 'hello' });
    assert.equal(result.text, 'ok');
    assert.equal(h.calls(), 1);
    const count = h.queries.length;
    await h.runtime.initialize();
    assert.equal(h.queries.length, count, 'ready initialization must not rehydrate active state');
  });
}

test('route status reports unavailable when all configured slots are exhausted', async () => {
  const h = harness();
  await h.runtime.initialize();
  for (const model of h.runtime.catalog.list()) {
    if (model.provider !== AI_PROVIDERS.GOOGLE) continue;
    await h.runtime.quotaManager.markFailure('google-key-01', model.routeKey, {
      code: AI_ERROR_CODES.RATE_LIMIT_RPD,
    });
  }
  for (const route of Object.values(h.runtime.status().routes)) {
    assert.equal(route.available, false);
    assert.equal(route.primaryCredentialSlot, null);
  }
});

test('generation affinity expires unused entries and remains bounded', async () => {
  let now = Date.now();
  const providerRegistry = createProviderRegistry([{
    provider: AI_PROVIDERS.GOOGLE,
    async generate() { return { normalized: { text: 'ok', usage: {} }, latencyMs: 1 }; },
  }]);
  const credentialRegistry = createCredentialRegistry({ env: { GEMINI_API_KEY: 'test-key' } });
  const ai = createAIOrchestrator({
    clock: () => now,
    providerRegistry,
    credentialRegistry,
    logger: { warn() {} },
  });
  for (let i = 0; i < 2000; i++) {
    ai.generationAffinity.set(`ASSESSMENT_GENERATION::old-${i}`, {
      routeKey: 'GOOGLE::gemini-3.8-flash',
      updatedAt: now,
    });
  }
  await ai.run('MAIN_CBT', { content: 'test' }, { generationGroupId: 'new' });
  assert.equal(ai.generationAffinity.size, 2000);
  assert.equal(ai.generationAffinity.has('ASSESSMENT_GENERATION::old-0'), false);
  now += 30 * 60 * 1000;
  await ai.run('MAIN_CBT', { content: 'test' }, { generationGroupId: 'after-expiry' });
  assert.equal(ai.generationAffinity.size, 1);
  assert.equal(ai.generationAffinity.has('ASSESSMENT_GENERATION::after-expiry'), true);
});

test('route-store failure releases a recovery probe and records one terminal failure', async () => {
  const { createProviderHealth } = require('../../services/ai/provider-health');
  let now = Date.now();
  let failLease = true;
  let generated = 0;
  const finished = [];
  const routeKey = 'GOOGLE::gemini-3.5-flash-lite';
  const credentialSlotId = 'google-key-01';
  const health = createProviderHealth({ clock: () => now, openCooldownMs: 5000 });
  health.recordFailure(routeKey, credentialSlotId, {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED, status: 503,
  }, { totalEligibleSlots: 1 });
  now += 5001;

  const providerRegistry = createProviderRegistry([{
    provider: AI_PROVIDERS.GOOGLE,
    async generate() {
      generated += 1;
      return { normalized: { text: 'recovered', usage: {} }, latencyMs: 1 };
    },
  }]);
  const credentialRegistry = createCredentialRegistry({ env: { GEMINI_API_KEY: 'test-key' } });
  const ai = createAIOrchestrator({
    clock: () => now,
    providerHealth: health,
    providerRegistry,
    credentialRegistry,
    logger: { warn() {} },
    routeScheduler: {
      orderSlots: (_routeKey, slots) => slots,
      async acquire() {
        if (failLease) throw new Error('private-lease-database-details');
        return { available: true, pacingWaitMs: 0, routeStateBefore: {}, async release() {} };
      },
      async recordSuccess() {},
      async recordFailure() {},
    },
    telemetry: {
      async beginRequest() { return 'request-1'; },
      async recordAttempt() {},
      async finishRequest(id, result) { finished.push(result); },
    },
  });

  await assert.rejects(ai.run('MAIN_CBT', { content: 'test' }), (error) => {
    assert.equal(error.code, AI_ERROR_CODES.RUNTIME_UNAVAILABLE);
    assert.equal(error.status, 503);
    assert.equal(isAIAvailabilityError(error), true);
    assert.doesNotMatch(error.message, /private-lease/);
    return true;
  });
  assert.equal(generated, 0);
  assert.equal(health.availability(routeKey).available, true);
  assert.equal(ai.trafficController.snapshot().active, 0);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].attemptCount, 0);

  failLease = false;
  assert.equal((await ai.run('MAIN_CBT', { content: 'test' })).text, 'recovered');
  assert.equal(generated, 1);
});
