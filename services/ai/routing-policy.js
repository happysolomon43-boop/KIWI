'use strict';

const { AI_PROVIDERS } = require('./providers');
const { MODEL_QUALITY_TIERS, GROQ_MODEL_IDS } = require('./model-catalog');
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
const MAIN_CBT_GROQ_MODEL_ID = GROQ_MODEL_IDS.QWEN_3_8_27B;
const MAIN_CBT_GROQ_REASONING = REASONING_LEVELS.HIGH;
const MAIN_CBT_GROQ_MAX_COMPLETION_TOKENS = 16384;

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

function mainCbtProviderMode(env = process.env) {
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
  // than the previous GPT-OSS-specific MEDIUM translation. Google fallbacks
  // also retain the task's original HIGH reasoning intent.
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
  // Explicit product-owner Main CBT override. This does not globally promote
  // Qwen 3.8 to HIGH_STAKES or make the preview model generally eligible. It
  // admits the PREMIUM model only inside MAIN_CBT's dedicated provider switch.
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
  // MAIN_CBT alone has an independent controlled activation switch. Default is
  // GOOGLE_ONLY. Other protected assessment routes remain Google-only until
  // they receive their own qualification/activation decision.
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
  const mainCbtOverride = taskId === 'MAIN_CBT' && mode !== PROVIDER_MODES.GOOGLE_ONLY;
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
    allowedGroqModelIds: mainCbtOverride
      ? Object.freeze([MAIN_CBT_GROQ_MODEL_ID])
      : null,
    assessmentProtected: PROTECTED_ASSESSMENT_TASKS.has(taskId),
    multimodalProtected: hasLegacyMultimodalRequirement(task),
    routeOverride: mainCbtOverride
      ? Object.freeze({
          scope: 'MAIN_CBT',
          modelId: MAIN_CBT_GROQ_MODEL_ID,
          reasoning: MAIN_CBT_GROQ_REASONING,
          maxCompletionTokens: MAIN_CBT_GROQ_MAX_COMPLETION_TOKENS,
          source: MAIN_CBT_PROVIDER_MODE_ENV,
        })
      : null,
  });
}

module.exports = {
  PROVIDER_MODES,
  MAIN_CBT_PROVIDER_MODE_ENV,
  MAIN_CBT_GROQ_MODEL_ID,
  MAIN_CBT_GROQ_REASONING,
  MAIN_CBT_GROQ_MAX_COMPLETION_TOKENS,
  PROTECTED_ASSESSMENT_TASKS,
  LOW_RISK_GROQ_20B_TASKS,
  normalizeProviderMode,
  mainCbtProviderMode,
  mainCbtGroqOverrideActive,
  reasoningForProvider,
  requiredQualityTier,
  providerModeForTask,
  providerOrder,
  preferEfficientGroqModel,
  routingRequirement,
};
