'use strict';

const { AI_PROVIDERS } = require('./providers');
const {
  MODEL_QUALITY_TIERS,
  GROQ_MODEL_IDS,
  GENERAL_EMERGENCY_FALLBACK_MODEL_ID,
} = require('./model-catalog');
const {
  AI_CLASSES,
  AI_EXECUTION_LANES,
  QUALITY_FLOORS,
  REASONING_LEVELS,
} = require('./task-registry');

const PROVIDER_MODES = Object.freeze({
  GROQ_FIRST: 'GROQ_FIRST',
  GOOGLE_FIRST: 'GOOGLE_FIRST',
  GOOGLE_ONLY: 'GOOGLE_ONLY',
});

const MAIN_CBT_PROVIDER_MODE_ENV = 'AI_MAIN_CBT_PROVIDER_MODE';
const MAIN_CBT_MODEL_OVERRIDE_ENV = 'AI_MAIN_CBT_MODEL_OVERRIDE';
const MAIN_CBT_GROQ_MODEL_ID = GROQ_MODEL_IDS.QWEN_3_8_27B;
const MAIN_CBT_GROQ_REASONING = REASONING_LEVELS.HIGH;
const MAIN_CBT_GROQ_MAX_COMPLETION_TOKENS = 16384;
const MAIN_CBT_GROQ_ATTEMPT_TIMEOUT_MS = 75000;
const MAIN_CBT_GROQ_OPERATION_TIMEOUT_MS = 180000;
const MAIN_CBT_GEMINI_LITE_MODEL_ID = GENERAL_EMERGENCY_FALLBACK_MODEL_ID;
const MAIN_CBT_GEMINI_LITE_REASONING = REASONING_LEVELS.HIGH;
const MAIN_CBT_GEMINI_LITE_MAX_COMPLETION_TOKENS = 16384;
const MAIN_CBT_GEMINI_LITE_ATTEMPT_TIMEOUT_MS = 75000;
const MAIN_CBT_GEMINI_LITE_OPERATION_TIMEOUT_MS = 180000;

const PROTECTED_ASSESSMENT_TASKS = Object.freeze(new Set([
  'MAIN_CBT',
  'RECKONING_CBT',
  'CBT_COMPLETION',
  'CBT_QUESTION_AUDIT',
]));

const LOW_RISK_GROQ_20B_TASKS = Object.freeze(new Set([
  'STUDY_TASK_GENERATION',
  'MORNING_BRIEF',
  'WEEKLY_ANCHOR',
  'CARD_EXPLANATION',
  'RECLASSIFICATION_ALERT',
  'MASTERY_MOMENT',
  'ZONE_DESCRIPTION',
  'HIDDEN_DISCOVERY',
  'RETURN_GREETING',
  'CHRONICLE_ARTIFACT',
]));

function normalizeProviderMode(value, fallback = PROVIDER_MODES.GOOGLE_ONLY) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.values(PROVIDER_MODES).includes(normalized)
    ? normalized
    : fallback;
}

function mainCbtModelOverride(env = process.env) {
  const requested = String(env?.[MAIN_CBT_MODEL_OVERRIDE_ENV] || '').trim();
  return requested === MAIN_CBT_GEMINI_LITE_MODEL_ID
    ? MAIN_CBT_GEMINI_LITE_MODEL_ID
    : null;
}

function mainCbtGeminiLiteOverrideActive(env = process.env) {
  return mainCbtModelOverride(env) === MAIN_CBT_GEMINI_LITE_MODEL_ID;
}

function mainCbtProviderMode(env = process.env) {
  // A route-scoped Google model override takes precedence over an older Groq
  // experiment switch. This lets KIWI test a specific approved Gemini model
  // without allowing stale provider configuration to reinsert Groq ahead of it.
  if (mainCbtGeminiLiteOverrideActive(env)) return PROVIDER_MODES.GOOGLE_ONLY;
  return normalizeProviderMode(
    env?.[MAIN_CBT_PROVIDER_MODE_ENV],
    PROVIDER_MODES.GOOGLE_ONLY
  );
}

function mainCbtGroqOverrideActive(env = process.env) {
  return mainCbtProviderMode(env) !== PROVIDER_MODES.GOOGLE_ONLY;
}

function reasoningForProvider(taskId, task, provider, env = process.env) {
  // MAIN_CBT remains a HIGH-reasoning assessment task canonically. During the
  // controlled Qwen 3.8 route test, Groq receives the same HIGH intent rather
  // than the previous GPT-OSS-specific MEDIUM translation. Google routes,
  // including the scoped Gemini 3.5 Lite test, retain HIGH reasoning as well.
  if (
    taskId === 'MAIN_CBT' &&
    provider === AI_PROVIDERS.GROQ &&
    mainCbtGroqOverrideActive(env)
  ) {
    return MAIN_CBT_GROQ_REASONING;
  }
  return task?.reasoning || null;
}

function requiredQualityTier(taskId, task, env = process.env) {
  // Explicit product-owner Main CBT Groq override. This does not globally
  // promote Qwen 3.8 to HIGH_STAKES or make the preview model generally
  // eligible. The Gemini 3.5 Lite test intentionally keeps MAIN_CBT's
  // HIGH_STAKES requirement and is admitted only through its scoped override.
  if (taskId === 'MAIN_CBT' && mainCbtGroqOverrideActive(env)) {
    return MODEL_QUALITY_TIERS.PREMIUM;
  }
  if (PROTECTED_ASSESSMENT_TASKS.has(taskId)) {
    return MODEL_QUALITY_TIERS.HIGH_STAKES;
  }
  if (task?.class === AI_CLASSES.VVIP) {
    return MODEL_QUALITY_TIERS.PREMIUM;
  }
  if (task?.qualityFloor === QUALITY_FLOORS.FLASH) {
    return MODEL_QUALITY_TIERS.PREMIUM;
  }
  return MODEL_QUALITY_TIERS.STANDARD;
}

function hasLegacyMultimodalRequirement(task) {
  return Boolean(task?.capabilities?.includes('vision'));
}

function providerModeForTask(taskId, task, env = process.env) {
  // MAIN_CBT alone has independent controlled activation switches. A scoped
  // Gemini model override wins over the older provider switch. Other protected
  // assessment routes remain Google-only until their own activation decision.
  if (taskId === 'MAIN_CBT') return mainCbtProviderMode(env);
  if (PROTECTED_ASSESSMENT_TASKS.has(taskId)) return PROVIDER_MODES.GOOGLE_ONLY;
  // D04 owns neutral multimodal routing. D03 must not send provider-native
  // image payloads to a text-only Groq adapter.
  if (hasLegacyMultimodalRequirement(task)) return PROVIDER_MODES.GOOGLE_ONLY;
  return normalizeProviderMode(env?.AI_TEXT_PROVIDER_MODE, PROVIDER_MODES.GOOGLE_ONLY);
}

function providerOrder(mode) {
  switch (mode) {
    case PROVIDER_MODES.GROQ_FIRST:
      return Object.freeze([AI_PROVIDERS.GROQ, AI_PROVIDERS.GOOGLE]);
    case PROVIDER_MODES.GOOGLE_FIRST:
      return Object.freeze([AI_PROVIDERS.GOOGLE, AI_PROVIDERS.GROQ]);
    default:
      return Object.freeze([AI_PROVIDERS.GOOGLE]);
  }
}

function preferEfficientGroqModel(taskId, task) {
  return LOW_RISK_GROQ_20B_TASKS.has(taskId) ||
    task?.executionLane === AI_EXECUTION_LANES.BACKGROUND ||
    task?.class === AI_CLASSES.IP;
}

function routingRequirement(taskId, task, env = process.env) {
  const mode = providerModeForTask(taskId, task, env);
  const mainCbtGeminiLiteOverride =
    taskId === 'MAIN_CBT' && mainCbtGeminiLiteOverrideActive(env);
  const mainCbtGroqOverride =
    taskId === 'MAIN_CBT' && !mainCbtGeminiLiteOverride && mode !== PROVIDER_MODES.GOOGLE_ONLY;

  return Object.freeze({
    taskId,
    requiredCapabilities: Object.freeze([...(task?.capabilities || [])]),
    requiredQualityTier: requiredQualityTier(taskId, task, env),
    providerMode: mode,
    providerOrder: providerOrder(mode),
    preferEfficientGroqModel: preferEfficientGroqModel(taskId, task),
    providerReasoning: Object.freeze({
      [AI_PROVIDERS.GROQ]: reasoningForProvider(taskId, task, AI_PROVIDERS.GROQ, env),
      [AI_PROVIDERS.GOOGLE]: reasoningForProvider(taskId, task, AI_PROVIDERS.GOOGLE, env),
    }),
    allowedGroqModelIds: mainCbtGroqOverride
      ? Object.freeze([MAIN_CBT_GROQ_MODEL_ID])
      : null,
    allowedGoogleModelIds: mainCbtGeminiLiteOverride
      ? Object.freeze([MAIN_CBT_GEMINI_LITE_MODEL_ID])
      : null,
    assessmentProtected: PROTECTED_ASSESSMENT_TASKS.has(taskId),
    multimodalProtected: hasLegacyMultimodalRequirement(task),
    routeOverride: mainCbtGeminiLiteOverride
      ? Object.freeze({
          scope: 'MAIN_CBT',
          provider: AI_PROVIDERS.GOOGLE,
          modelId: MAIN_CBT_GEMINI_LITE_MODEL_ID,
          reasoning: MAIN_CBT_GEMINI_LITE_REASONING,
          maxCompletionTokens: MAIN_CBT_GEMINI_LITE_MAX_COMPLETION_TOKENS,
          attemptTimeoutMs: MAIN_CBT_GEMINI_LITE_ATTEMPT_TIMEOUT_MS,
          operationTimeoutMs: MAIN_CBT_GEMINI_LITE_OPERATION_TIMEOUT_MS,
          source: MAIN_CBT_MODEL_OVERRIDE_ENV,
        })
      : mainCbtGroqOverride
        ? Object.freeze({
            scope: 'MAIN_CBT',
            provider: AI_PROVIDERS.GROQ,
            modelId: MAIN_CBT_GROQ_MODEL_ID,
            reasoning: MAIN_CBT_GROQ_REASONING,
            maxCompletionTokens: MAIN_CBT_GROQ_MAX_COMPLETION_TOKENS,
            attemptTimeoutMs: MAIN_CBT_GROQ_ATTEMPT_TIMEOUT_MS,
            operationTimeoutMs: MAIN_CBT_GROQ_OPERATION_TIMEOUT_MS,
            source: MAIN_CBT_PROVIDER_MODE_ENV,
          })
        : null,
  });
}

module.exports = {
  PROVIDER_MODES,
  MAIN_CBT_PROVIDER_MODE_ENV,
  MAIN_CBT_MODEL_OVERRIDE_ENV,
  MAIN_CBT_GROQ_MODEL_ID,
  MAIN_CBT_GROQ_REASONING,
  MAIN_CBT_GROQ_MAX_COMPLETION_TOKENS,
  MAIN_CBT_GROQ_ATTEMPT_TIMEOUT_MS,
  MAIN_CBT_GROQ_OPERATION_TIMEOUT_MS,
  MAIN_CBT_GEMINI_LITE_MODEL_ID,
  MAIN_CBT_GEMINI_LITE_REASONING,
  MAIN_CBT_GEMINI_LITE_MAX_COMPLETION_TOKENS,
  MAIN_CBT_GEMINI_LITE_ATTEMPT_TIMEOUT_MS,
  MAIN_CBT_GEMINI_LITE_OPERATION_TIMEOUT_MS,
  PROTECTED_ASSESSMENT_TASKS,
  LOW_RISK_GROQ_20B_TASKS,
  normalizeProviderMode,
  mainCbtModelOverride,
  mainCbtGeminiLiteOverrideActive,
  mainCbtProviderMode,
  mainCbtGroqOverrideActive,
  reasoningForProvider,
  requiredQualityTier,
  providerModeForTask,
  providerOrder,
  preferEfficientGroqModel,
  routingRequirement,
};
