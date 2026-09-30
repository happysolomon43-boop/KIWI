'use strict';

const { AI_PROVIDERS } = require('./providers');
const { MODEL_QUALITY_TIERS } = require('./model-catalog');
const {
  AI_CLASSES,
  AI_EXECUTION_LANES,
  QUALITY_FLOORS,
} = require('./task-registry');

const PROVIDER_MODES = Object.freeze({
  GROQ_FIRST: 'GROQ_FIRST',
  GOOGLE_FIRST: 'GOOGLE_FIRST',
  GOOGLE_ONLY: 'GOOGLE_ONLY',
});

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

function requiredQualityTier(taskId, task) {
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
  return Object.freeze({
    taskId,
    requiredCapabilities: Object.freeze([...(task?.capabilities || [])]),
    requiredQualityTier: requiredQualityTier(taskId, task),
    providerMode: mode,
    providerOrder: providerOrder(mode),
    preferEfficientGroqModel: preferEfficientGroqModel(taskId, task),
    assessmentProtected: PROTECTED_ASSESSMENT_TASKS.has(taskId),
    multimodalProtected: hasLegacyMultimodalRequirement(task),
  });
}

module.exports = {
  PROVIDER_MODES,
  PROTECTED_ASSESSMENT_TASKS,
  LOW_RISK_GROQ_20B_TASKS,
  normalizeProviderMode,
  requiredQualityTier,
  providerModeForTask,
  providerOrder,
  preferEfficientGroqModel,
  routingRequirement,
};
