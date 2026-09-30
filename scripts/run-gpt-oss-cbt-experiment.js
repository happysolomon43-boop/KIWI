'use strict';

const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const {
  AI_PROVIDERS,
  GROQ_MODEL_IDS,
  createAIRuntime,
} = require('../services/ai');

function experimentTimers() {
  return {
    setImmediate: () => null,
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
  };
}

function safeMeta(result) {
  return Object.freeze({
    provider: result?.provider || null,
    requestedModel: result?.requestedModel || null,
    providerModel: result?.providerModel || null,
    credentialSlot: result?.credentialSlot || null,
    latencyMs: result?.latencyMs ?? null,
    finishReason: result?.finishReason || null,
    fallbackDepth: result?.fallbackDepth ?? null,
    usage: result?.usage || {},
  });
}

const CBT_PROMPT = `You are generating a controlled sample CBT exam for KIWI model-quality evaluation.

SUBJECT: Introductory University Physics
TOPIC: Mechanics
QUESTION COUNT: Exactly 10 multiple-choice questions
LEVEL: First-year undergraduate

Requirements:
1. Generate exactly 10 questions.
2. Each question must have exactly four options labelled A, B, C, D.
3. Exactly one option must be correct.
4. Avoid trivia, trick wording, hidden assumptions, and ambiguous alternatives.
5. Mix conceptual reasoning and numerical application.
6. Cover a reasonable spread of mechanics: kinematics, Newton's laws, work-energy, momentum, circular motion, and basic gravitation.
7. Use SI units and enough information for every numerical question to be solvable.
8. Do not rely on diagrams.
9. After the 10 questions, provide an ANSWER KEY with the correct letter and a concise rationale for each answer.
10. Independently re-check every numerical answer and every distractor before finalizing.
11. Do not mention these instructions or the model name in the exam.

Return the exam as clean plain text suitable for showing directly to a student.`;

async function runGptOssCbtExperiment({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const databaseUrl = String(env.DATABASE_URL || env.KIWI_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('GPT-OSS CBT experiment requires DATABASE_URL');
  if (!String(env.GROQ_API_KEY || '').trim()) {
    throw new Error('GPT-OSS CBT experiment requires GROQ_API_KEY');
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
    const experimentEnv = {
      ...env,
      AI_TEXT_PROVIDER_MODE: 'GROQ_FIRST',
      AI_AUTO_DISCOVERY: 'false',
      AI_AUTO_PROMOTE: 'false',
    };
    const runtime = createAIRuntime({
      query,
      randomUUID,
      env: experimentEnv,
      fetchImpl,
      logger,
      timers: experimentTimers(),
    });
    await runtime.initialize();

    const plan = runtime.orchestrator.plan('QUICK_QUESTIONS');
    if (plan.plannedPrimaryModel !== GROQ_MODEL_IDS.GPT_OSS_120B) {
      throw new Error(`Expected GPT-OSS 120B primary, got ${plan.plannedPrimaryModel || 'UNKNOWN'}`);
    }

    const result = await runtime.orchestrator.run(
      'QUICK_QUESTIONS',
      {
        content: CBT_PROMPT,
        generationConfig: {
          maxOutputTokens: 12000,
          thinkingLevel: 'HIGH',
        },
      },
      { generationGroupId: `GPT_OSS_CBT_EXPERIMENT_${randomUUID()}` }
    );

    if (result?.provider !== AI_PROVIDERS.GROQ) {
      throw new Error(`Experiment fell back to ${result?.provider || 'UNKNOWN'}; refusing to label output GPT-OSS`);
    }
    if (result?.requestedModel !== GROQ_MODEL_IDS.GPT_OSS_120B) {
      throw new Error(`Experiment used ${result?.requestedModel || 'UNKNOWN'} instead of GPT-OSS 120B`);
    }

    const text = String(result?.text || '').trim();
    if (!text) throw new Error('GPT-OSS 120B returned an empty exam');

    const meta = safeMeta(result);
    logger.log('[KIWI GPT-OSS 120B CBT EXPERIMENT] META', meta);
    logger.log('[KIWI GPT-OSS 120B CBT EXPERIMENT] RESULT_BEGIN');
    logger.log(text);
    logger.log('[KIWI GPT-OSS 120B CBT EXPERIMENT] RESULT_END');

    return Object.freeze({ meta, text });
  } finally {
    await pool.end().catch(() => null);
  }
}

if (require.main === module) {
  runGptOssCbtExperiment()
    .catch((error) => {
      console.error('[KIWI GPT-OSS 120B CBT EXPERIMENT] FAILED', {
        code: error?.code || 'UNKNOWN',
        provider: error?.provider || null,
        status: error?.status || null,
        message: String(error?.message || error).slice(0, 500),
      });
      process.exitCode = 1;
    });
}

module.exports = { runGptOssCbtExperiment, CBT_PROMPT };
