'use strict';

const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const {
  AI_PROVIDERS,
  GROQ_MODEL_IDS,
  createAIRuntime,
} = require('../services/ai');

const MARKERS = Object.freeze({
  PREMIUM: 'KIWI_D03_120B_OK',
  BACKGROUND: 'KIWI_D03_20B_OK',
  FALLBACK: 'KIWI_D03_GEMINI_FALLBACK_OK',
});

function safeError(error) {
  return Object.freeze({
    code: error?.code || 'UNKNOWN',
    status: error?.status || null,
    scope: error?.scope || null,
    provider: error?.provider || null,
    retryable: Boolean(error?.retryable),
    message: String(error?.message || 'D03 routing smoke failed').slice(0, 300),
  });
}

function smokeTimers() {
  return {
    setImmediate: () => null,
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
  };
}

function runtimeEnv(env, mode) {
  return {
    ...env,
    AI_TEXT_PROVIDER_MODE: mode,
    AI_AUTO_DISCOVERY: 'false',
    AI_AUTO_PROMOTE: 'false',
  };
}

function createSmokeRuntime({ env, query, fetchImpl, logger }) {
  return createAIRuntime({
    query,
    randomUUID,
    env,
    fetchImpl,
    logger,
    timers: smokeTimers(),
  });
}

function markerPrompt(marker) {
  return `Return exactly ${marker} and nothing else.`;
}

function verifyMarker(result, marker, expectedProvider, expectedModel = null) {
  const text = String(result?.text || '').trim();
  if (!text.includes(marker)) {
    const error = new Error(`D03 smoke response did not contain marker ${marker}`);
    error.code = 'INVALID_OUTPUT';
    throw error;
  }
  if (result?.provider !== expectedProvider) {
    const error = new Error(
      `D03 smoke expected provider ${expectedProvider} but received ${result?.provider || 'UNKNOWN'}`
    );
    error.code = 'ROUTING_MISMATCH';
    throw error;
  }
  if (expectedModel && result?.requestedModel !== expectedModel) {
    const error = new Error(
      `D03 smoke expected model ${expectedModel} but received ${result?.requestedModel || 'UNKNOWN'}`
    );
    error.code = 'ROUTING_MISMATCH';
    throw error;
  }
  return Object.freeze({
    provider: result.provider,
    model: result.providerModel || result.requestedModel || null,
    credentialSlot: result.credentialSlot || null,
    latencyMs: result.latencyMs ?? null,
    finishReason: result.finishReason || null,
    fallbackDepth: result.fallbackDepth ?? null,
    usage: result.usage || {},
  });
}

function syntheticGroqOutageFetch(realFetch) {
  return async (url, options) => {
    const target = String(url || '');
    if (target.includes('api.groq.com')) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'AIM-D03 synthetic Groq outage for fallback verification',
            type: 'server_error',
          },
        }),
        {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }
      );
    }
    return realFetch(url, options);
  };
}

async function runD03RoutingSmoke({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const databaseUrl = String(env.DATABASE_URL || env.KIWI_DATABASE_URL || '').trim();
  if (!databaseUrl) {
    const error = new Error('D03 routing smoke requires DATABASE_URL');
    error.code = 'CONFIG';
    throw error;
  }
  if (!String(env.GROQ_API_KEY || '').trim()) {
    const error = new Error('D03 routing smoke requires an enabled Groq credential');
    error.code = 'CONFIG';
    throw error;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 25000,
  });
  const query = (text, params) => pool.query(text, params);

  try {
    const groqEnv = runtimeEnv(env, 'GROQ_FIRST');
    const runtime = createSmokeRuntime({
      env: groqEnv,
      query,
      fetchImpl,
      logger,
    });
    await runtime.initialize();

    const premiumPlan = runtime.orchestrator.plan('QUICK_QUESTIONS');
    if (premiumPlan.plannedPrimaryModel !== GROQ_MODEL_IDS.GPT_OSS_120B) {
      throw new Error(`D03 premium plan did not select ${GROQ_MODEL_IDS.GPT_OSS_120B}`);
    }
    const premium = await runtime.orchestrator.run(
      'QUICK_QUESTIONS',
      { prompt: markerPrompt(MARKERS.PREMIUM) },
      { generationGroupId: `AIM_D03_SMOKE_${randomUUID()}` }
    );
    const premiumSafe = verifyMarker(
      premium,
      MARKERS.PREMIUM,
      AI_PROVIDERS.GROQ,
      GROQ_MODEL_IDS.GPT_OSS_120B
    );

    const backgroundPlan = runtime.orchestrator.plan('MORNING_BRIEF');
    if (backgroundPlan.plannedPrimaryModel !== GROQ_MODEL_IDS.GPT_OSS_20B) {
      throw new Error(`D03 background plan did not select ${GROQ_MODEL_IDS.GPT_OSS_20B}`);
    }
    const background = await runtime.orchestrator.run(
      'MORNING_BRIEF',
      { prompt: markerPrompt(MARKERS.BACKGROUND) }
    );
    const backgroundSafe = verifyMarker(
      background,
      MARKERS.BACKGROUND,
      AI_PROVIDERS.GROQ,
      GROQ_MODEL_IDS.GPT_OSS_20B
    );

    for (const protectedTask of [
      'MAIN_CBT',
      'RECKONING_CBT',
      'CBT_COMPLETION',
      'CBT_QUESTION_AUDIT',
    ]) {
      const plan = runtime.orchestrator.plan(protectedTask);
      const modelIds = plan.candidates.map((candidate) => candidate.modelId);
      if (modelIds.some((modelId) => modelId === GROQ_MODEL_IDS.GPT_OSS_120B || modelId === GROQ_MODEL_IDS.GPT_OSS_20B)) {
        throw new Error(`Protected assessment task ${protectedTask} unexpectedly includes Groq`);
      }
    }

    const fallbackRuntime = createSmokeRuntime({
      env: groqEnv,
      query,
      fetchImpl: syntheticGroqOutageFetch(fetchImpl),
      logger,
    });
    await fallbackRuntime.initialize();
    const fallback = await fallbackRuntime.orchestrator.run(
      'QUICK_QUESTIONS',
      { prompt: markerPrompt(MARKERS.FALLBACK) }
    );
    const fallbackSafe = verifyMarker(
      fallback,
      MARKERS.FALLBACK,
      AI_PROVIDERS.GOOGLE
    );

    const rollbackRuntime = createSmokeRuntime({
      env: runtimeEnv(env, 'GOOGLE_ONLY'),
      query,
      fetchImpl,
      logger,
    });
    await rollbackRuntime.initialize();
    const rollbackPlan = rollbackRuntime.orchestrator.plan('QUICK_QUESTIONS');
    if (!String(rollbackPlan.plannedPrimaryModel || '').startsWith('gemini-')) {
      throw new Error('D03 GOOGLE_ONLY rollback did not restore a Gemini primary');
    }
    if (rollbackPlan.candidates.some((candidate) =>
      candidate.modelId === GROQ_MODEL_IDS.GPT_OSS_120B ||
      candidate.modelId === GROQ_MODEL_IDS.GPT_OSS_20B
    )) {
      throw new Error('D03 GOOGLE_ONLY rollback still exposed a Groq candidate');
    }

    const result = Object.freeze({
      ok: true,
      premium: premiumSafe,
      background: backgroundSafe,
      protectedAssessments: true,
      fallback: fallbackSafe,
      rollbackPrimary: rollbackPlan.plannedPrimaryModel,
    });
    logger?.log?.('[KIWI AIM-D03] provider-aware routing smoke succeeded', result);
    return result;
  } finally {
    await pool.end().catch(() => null);
  }
}

if (require.main === module) {
  runD03RoutingSmoke()
    .then(() => { process.exitCode = 0; })
    .catch((error) => {
      console.error('[KIWI AIM-D03] provider-aware routing smoke failed', safeError(error));
      process.exitCode = 1;
    });
}

module.exports = {
  MARKERS,
  safeError,
  syntheticGroqOutageFetch,
  runD03RoutingSmoke,
};
