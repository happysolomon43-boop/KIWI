'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { createProjectPool } = require('../../services/ai/project-pool');
const {
  createQuotaManager,
  PROJECT_MODEL_STATES,
} = require('../../services/ai/quota-manager');
const {
  createProviderHealth,
  CIRCUIT_STATES,
} = require('../../services/ai/provider-health');
const { createAITrafficController } = require('../../services/ai/traffic-controller');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

const quietLogger = Object.freeze({
  log() {},
  warn() {},
  error() {},
});

function okRaw(text = 'OK') {
  return {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text }] },
    }],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
  };
}

function slotNumber(apiKey) {
  return Number(String(apiKey || '').replace(/^key-/, '')) || 0;
}

function projectSlots(count = 14) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    index: index + 1,
    envName: index === 0 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${index + 1}`,
    apiKey: `key-${index + 1}`,
    enabled: true,
  }));
}

function overloaded(message = 'provider overloaded') {
  return new AIError(message, {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    status: 503,
    retryable: true,
    scope: 'PROVIDER_MODEL',
  });
}

function dailyQuota(message = 'daily quota exhausted') {
  return new AIError(message, {
    code: AI_ERROR_CODES.RATE_LIMIT_RPD,
    status: 429,
    retryable: true,
    scope: 'MODEL_SLOT',
    details: {
      error: {
        message,
        details: [{
          quotaMetric: 'requestsPerDayPerProjectPerModel',
          quotaValue: 20,
        }],
      },
    },
  });
}

function rpmLimit(message = 'requests per minute exceeded') {
  return new AIError(message, {
    code: AI_ERROR_CODES.RATE_LIMIT_RPM,
    status: 429,
    retryable: true,
    scope: 'MODEL_SLOT',
    retryAfterMs: 60000,
  });
}

function clockMs(clock) {
  const value = clock();
  return value instanceof Date ? value.getTime() : Number(value);
}

function buildHarness({
  transport,
  slotCount = 14,
  clock = () => Date.now(),
  env = {},
  quotaManager = undefined,
  providerHealth = undefined,
  trafficController = undefined,
  providerStore = null,
} = {}) {
  const projectPool = createProjectPool({ slots: projectSlots(slotCount) });
  const resolvedQuotaManager = quotaManager === undefined
    ? createQuotaManager({
        clock: () => new Date(clockMs(clock)),
      })
    : quotaManager;
  const resolvedProviderHealth = providerHealth || createProviderHealth({
    clock,
    store: providerStore,
    failureEvidenceWindowMs: 30000,
    openCooldownMs: 20000,
    minDistinctFailureSlots: 2,
  });
  const resolvedTrafficController = trafficController || createAITrafficController({
    env: {
      AI_GLOBAL_CONCURRENCY: '6',
      AI_MAX_QUEUE_DEPTH: '96',
      AI_CONGESTION_SIGNAL_WINDOW_MS: '30000',
      ...env,
    },
    clock,
    logger: quietLogger,
  });

  const ai = createAIOrchestrator({
    projectPool,
    quotaManager: resolvedQuotaManager,
    providerHealth: resolvedProviderHealth,
    trafficController: resolvedTrafficController,
    transport,
    logger: quietLogger,
    clock,
    env: {
      AI_PROVIDER_FAILURE_EVIDENCE_SLOTS: '2',
      AI_MODEL_TRANSIENT_COOLDOWN_MS: '20000',
      ...env,
    },
  });

  return {
    ai,
    projectPool,
    quotaManager: resolvedQuotaManager,
    providerHealth: resolvedProviderHealth,
    trafficController: resolvedTrafficController,
  };
}

async function waitUntil(predicate, {
  timeoutMs = 1000,
  intervalMs = 2,
} = {}) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error('Timed out waiting for Delivery C stress condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test('Delivery C: one project 503 stays isolated when another slot serves the same model', async () => {
  const calls = [];
  const { ai, providerHealth } = buildHarness({
    slotCount: 14,
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, slot: slotNumber(args.apiKey) });
        if (
          args.modelId === 'gemini-3.8-flash' &&
          slotNumber(args.apiKey) === 1
        ) {
          throw overloaded('p1 temporary overload');
        }
        return {
          raw: okRaw('same-model recovery'),
          latencyMs: 3,
          httpStatus: 200,
        };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'single-slot-503' });

  assert.equal(result.requestedModel, 'gemini-3.8-flash');
  assert.equal(result.projectSlot, 'p2');
  assert.equal(result.attempts, 2);
  assert.deepEqual(calls.slice(0, 2), [
    { modelId: 'gemini-3.8-flash', slot: 1 },
    { modelId: 'gemini-3.8-flash', slot: 2 },
  ]);

  const state = providerHealth.snapshot('gemini-3.8-flash');
  assert.equal(state.state, CIRCUIT_STATES.CLOSED);
  assert.equal(state.distinctFailureSlots, 0);
});

test('Delivery C: corroborated 503s bound probing instead of burning the remaining 12 project slots', async () => {
  const calls = [];
  const { ai, providerHealth } = buildHarness({
    slotCount: 14,
    transport: {
      async generate(args) {
        const slot = slotNumber(args.apiKey);
        calls.push({ modelId: args.modelId, slot });

        if (args.modelId === 'gemini-3.8-flash' && slot <= 2) {
          throw overloaded(`3.8 overload on p${slot}`);
        }

        // These routes are healthy, but Delivery A intentionally treats two
        // independent 503s as enough evidence to move to the next model.
        return {
          raw: okRaw(`${args.modelId}-success`),
          latencyMs: 3,
          httpStatus: 200,
        };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'bounded-provider-probe' });

  assert.equal(result.requestedModel, 'gemini-3.7-flash');
  assert.equal(
    calls.filter((call) => call.modelId === 'gemini-3.8-flash').length,
    2
  );
  assert.ok(
    calls.every((call) => !(
      call.modelId === 'gemini-3.8-flash' &&
      call.slot >= 3
    ))
  );
  assert.equal(
    providerHealth.snapshot('gemini-3.8-flash').state,
    CIRCUIT_STATES.OPEN
  );
});

test('Delivery C: isolated 429 rotates project slots without global provider backpressure', async () => {
  const calls = [];
  const {
    ai,
    quotaManager,
    providerHealth,
    trafficController,
  } = buildHarness({
    slotCount: 4,
    transport: {
      async generate(args) {
        const slot = slotNumber(args.apiKey);
        calls.push({ modelId: args.modelId, slot });
        if (
          args.modelId === 'gemini-3.8-flash' &&
          slot === 1 &&
          calls.length === 1
        ) {
          throw rpmLimit();
        }
        return {
          raw: okRaw('quota-rotation-success'),
          latencyMs: 2,
          httpStatus: 200,
        };
      },
    },
  });

  const first = await ai.run('MAIN_CBT', { content: 'isolated-429' });
  assert.equal(first.requestedModel, 'gemini-3.8-flash');
  assert.equal(first.projectSlot, 'p2');

  assert.equal(
    quotaManager.get('p1', 'gemini-3.8-flash').state,
    PROJECT_MODEL_STATES.COOLDOWN_RPM
  );
  assert.equal(
    providerHealth.snapshot('gemini-3.8-flash').state,
    CIRCUIT_STATES.CLOSED
  );

  const traffic = trafficController.snapshot();
  assert.equal(traffic.congestionLevel, 'NORMAL');
  assert.equal(traffic.effectiveConcurrency, traffic.baseConcurrency);

  calls.length = 0;
  const second = await ai.run('MAIN_CBT', { content: 'isolated-429-followup' });
  assert.equal(second.requestedModel, 'gemini-3.8-flash');
  assert.ok(calls.every((call) => call.slot !== 1));
});

test('Delivery C: all project routes exhausted for 3.8 preserve quality by falling to 3.7', async () => {
  const calls = [];
  const { ai, quotaManager, trafficController } = buildHarness({
    slotCount: 6,
    transport: {
      async generate(args) {
        const slot = slotNumber(args.apiKey);
        calls.push({ modelId: args.modelId, slot });

        if (args.modelId === 'gemini-3.8-flash') {
          throw dailyQuota();
        }

        return {
          raw: okRaw('fallback-after-daily-quota'),
          latencyMs: 2,
          httpStatus: 200,
        };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'top-model-daily-exhaustion' });

  assert.equal(result.requestedModel, 'gemini-3.7-flash');
  assert.equal(
    calls.filter((call) => call.modelId === 'gemini-3.8-flash').length,
    6
  );

  for (let index = 1; index <= 6; index++) {
    assert.equal(
      quotaManager.get(`p${index}`, 'gemini-3.8-flash').state,
      PROJECT_MODEL_STATES.EXHAUSTED_RPD
    );
  }

  assert.equal(
    quotaManager.get('p1', 'gemini-3.7-flash').state,
    PROJECT_MODEL_STATES.READY
  );
  assert.equal(trafficController.snapshot().congestionLevel, 'NORMAL');
});

test('Delivery C: provider-wide outage returns PROVIDER_OVERLOADED, not false capacity exhaustion', async () => {
  const calls = [];
  const { ai, providerHealth, trafficController } = buildHarness({
    slotCount: 14,
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, slot: slotNumber(args.apiKey) });
        throw overloaded();
      },
    },
  });

  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'provider-wide-outage' }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      assert.notEqual(error.code, AI_ERROR_CODES.CAPACITY_EXHAUSTED);
      assert.equal(error.details.hadEligibleRoute, true);
      assert.equal(error.details.attempts.length, 8);
      return true;
    }
  );

  assert.equal(calls.length, 8);
  for (const modelId of [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ]) {
    assert.equal(providerHealth.snapshot(modelId).state, CIRCUIT_STATES.OPEN);
  }
  assert.equal(trafficController.snapshot().congestionLevel, 'SEVERE');
  assert.equal(trafficController.snapshot().effectiveConcurrency, 1);

  const callsBeforeSecond = calls.length;
  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'provider-wide-outage-second-request' }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
      assert.equal(error.details.blockedOnlyByProviderHealth, true);
      assert.equal(error.details.attempts.length, 0);
      return true;
    }
  );
  assert.equal(calls.length, callsBeforeSecond);
});

test('Delivery C: provider circuit half-opens and restores 3.8 after the outage window', async () => {
  let now = Date.parse('2026-09-24T00:00:00Z');
  let outage = true;
  const calls = [];

  const { ai, providerHealth, trafficController } = buildHarness({
    slotCount: 4,
    clock: () => now,
    env: {
      AI_MODEL_TRANSIENT_COOLDOWN_MS: '20000',
      AI_CONGESTION_SIGNAL_WINDOW_MS: '30000',
    },
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, slot: slotNumber(args.apiKey) });
        if (outage && args.modelId === 'gemini-3.8-flash') {
          throw overloaded();
        }
        return {
          raw: okRaw(`${args.modelId}-success`),
          latencyMs: 2,
          httpStatus: 200,
        };
      },
    },
  });

  const degraded = await ai.run('MAIN_CBT', { content: 'outage' });
  assert.equal(degraded.requestedModel, 'gemini-3.7-flash');
  assert.equal(
    providerHealth.snapshot('gemini-3.8-flash').state,
    CIRCUIT_STATES.OPEN
  );

  outage = false;
  now += 30001;
  calls.length = 0;

  const recovered = await ai.run('MAIN_CBT', { content: 'recovered' });
  assert.equal(recovered.requestedModel, 'gemini-3.8-flash');
  assert.equal(calls[0].modelId, 'gemini-3.8-flash');
  assert.equal(
    providerHealth.snapshot('gemini-3.8-flash').state,
    CIRCUIT_STATES.CLOSED
  );
  assert.equal(trafficController.snapshot().congestionLevel, 'NORMAL');
  assert.equal(
    trafficController.snapshot().effectiveConcurrency,
    trafficController.snapshot().baseConcurrency
  );
});

test('Delivery C: 20 simultaneous VVIP requests never exceed central concurrency', async () => {
  let inFlight = 0;
  let peakTransportInFlight = 0;

  const { ai, trafficController } = buildHarness({
    slotCount: 14,
    env: {
      AI_GLOBAL_CONCURRENCY: '4',
      AI_MAX_QUEUE_DEPTH: '64',
    },
    transport: {
      async generate(args) {
        inFlight += 1;
        peakTransportInFlight = Math.max(peakTransportInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return {
          raw: okRaw(String(args.content || 'success')),
          latencyMs: 5,
          httpStatus: 200,
        };
      },
    },
  });

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) => (
      ai.run('MAIN_CBT', { content: `vvip-${index + 1}` })
    ))
  );

  assert.equal(results.length, 20);
  assert.ok(results.every((result) => result.text.startsWith('vvip-')));
  assert.ok(peakTransportInFlight <= 4);

  const traffic = trafficController.snapshot();
  assert.equal(traffic.peakActive, 4);
  assert.equal(traffic.active, 0);
  assert.equal(traffic.queued, 0);
  assert.equal(traffic.admittedTotal, 20);
  assert.ok(traffic.maxObservedQueue >= 16);
});

test('Delivery C: queued VVIP work is admitted before VIP and IP work under saturation', async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let firstCall = true;

  const { ai, trafficController } = buildHarness({
    slotCount: 4,
    env: {
      AI_GLOBAL_CONCURRENCY: '1',
      AI_MAX_QUEUE_DEPTH: '16',
    },
    transport: {
      async generate(args) {
        order.push(String(args.content));
        if (firstCall) {
          firstCall = false;
          await firstGate;
        }
        return {
          raw: okRaw(String(args.content)),
          latencyMs: 1,
          httpStatus: 200,
        };
      },
    },
  });

  const holder = ai.run('CARD_EXPLANATION', { content: 'ip-holder' });
  await waitUntil(() => trafficController.snapshot().active === 1);

  const ipWaiting = ai.run('CARD_EXPLANATION', { content: 'ip-waiting' });
  const vipWaiting = ai.run('QUICK_QUESTIONS', { content: 'vip-waiting' });
  const vvipWaiting = ai.run('MAIN_CBT', { content: 'vvip-waiting' });

  await waitUntil(() => trafficController.snapshot().queued === 3);
  releaseFirst();

  await Promise.all([holder, ipWaiting, vipWaiting, vvipWaiting]);

  assert.deepEqual(order, [
    'ip-holder',
    'vvip-waiting',
    'vip-waiting',
    'ip-waiting',
  ]);
});

test('Delivery C: provider circuit persistence survives a simulated backend restart', async () => {
  let now = Date.parse('2026-09-24T00:10:00Z');
  const rows = new Map();

  const store = {
    async loadProviderModelHealth() {
      return [...rows.values()];
    },
    async upsertProviderModelHealth(record) {
      const updatedAt = new Date(now).toISOString();
      const row = {
        model_id: record.modelId,
        state: record.state,
        open_until: record.openUntil
          ? new Date(record.openUntil).toISOString()
          : null,
        failure_slots: record.failureSlots || [],
        last_error_code: record.lastErrorCode || null,
        last_http_status: record.lastHttpStatus ?? null,
        last_failure_at: record.lastFailureAt
          ? new Date(record.lastFailureAt).toISOString()
          : null,
        last_success_at: record.lastSuccessAt
          ? new Date(record.lastSuccessAt).toISOString()
          : null,
        updated_at: updatedAt,
      };
      rows.set(record.modelId, row);
      return row;
    },
  };

  const runtimeOneCalls = [];
  const first = buildHarness({
    slotCount: 4,
    clock: () => now,
    providerStore: store,
    transport: {
      async generate(args) {
        runtimeOneCalls.push(args.modelId);
        if (args.modelId === 'gemini-3.8-flash') throw overloaded();
        return {
          raw: okRaw('runtime-one-fallback'),
          latencyMs: 1,
          httpStatus: 200,
        };
      },
    },
  });

  const runtimeOneResult = await first.ai.run(
    'MAIN_CBT',
    { content: 'runtime-one' }
  );
  assert.equal(runtimeOneResult.requestedModel, 'gemini-3.7-flash');
  assert.equal(
    first.providerHealth.snapshot('gemini-3.8-flash').state,
    CIRCUIT_STATES.OPEN
  );
  assert.equal(rows.get('gemini-3.8-flash').state, CIRCUIT_STATES.OPEN);

  const runtimeTwoCalls = [];
  const second = buildHarness({
    slotCount: 4,
    clock: () => now,
    providerStore: store,
    transport: {
      async generate(args) {
        runtimeTwoCalls.push(args.modelId);
        return {
          raw: okRaw('runtime-two'),
          latencyMs: 1,
          httpStatus: 200,
        };
      },
    },
  });

  const hydrated = await second.ai.initialize();
  assert.ok(hydrated.hydratedProviderModelHealth >= 1);

  const runtimeTwoResult = await second.ai.run(
    'MAIN_CBT',
    { content: 'runtime-two' }
  );
  assert.equal(runtimeTwoResult.requestedModel, 'gemini-3.7-flash');
  assert.ok(runtimeTwoCalls.every((modelId) => modelId !== 'gemini-3.8-flash'));
});

test('Delivery C: CAPACITY_EXHAUSTED is emitted only when no project-model route is eligible', async () => {
  let transportCalls = 0;
  const noCapacityQuotaManager = {
    filterEligibleSlots() { return []; },
    async hydrate() { return 0; },
    snapshot() { return []; },
  };

  const { ai } = buildHarness({
    slotCount: 14,
    quotaManager: noCapacityQuotaManager,
    transport: {
      async generate() {
        transportCalls += 1;
        return {
          raw: okRaw('should-never-run'),
          latencyMs: 1,
          httpStatus: 200,
        };
      },
    },
  });

  await assert.rejects(
    ai.run('MAIN_CBT', { content: 'real-capacity-exhaustion' }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.CAPACITY_EXHAUSTED);
      assert.equal(error.retryable, false);
      assert.equal(error.details.hadEligibleRoute, false);
      assert.equal(error.details.attempts.length, 0);
      assert.equal(error.details.blockedOnlyByProviderHealth, false);
      return true;
    }
  );

  assert.equal(transportCalls, 0);
});
