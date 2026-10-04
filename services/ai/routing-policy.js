'use strict';

const { AI_PROVIDERS } = require('./providers');
const { MODEL_FAMILIES, MODEL_IDS } = require('./model-catalog');

const ROUTE_SLOT_KINDS = Object.freeze({
  LATEST_FAMILY: 'LATEST_FAMILY',
  MODEL: 'MODEL',
});

const PREPARATION_ROUTE_POSTURES = Object.freeze([
  'economy_maintenance',
  'bounded_interpretive',
  'strong_design',
  'independent_validation',
  'final_reconciliation',
]);

// Central KIWI AI configuration owns posture-to-runtime-class mapping. Teaching
// carries only the posture intent; it never names provider model IDs. Routes
// without an explicitly classified model family remain eligible for ordinary
// inference but are fail-closed for PPL stages until centrally classified.
const PREPARATION_POSTURE_MODEL_FAMILIES = Object.freeze({
  economy_maintenance: Object.freeze([MODEL_FAMILIES.FLASH_LITE]),
  bounded_interpretive: Object.freeze([MODEL_FAMILIES.FLASH_LITE, MODEL_FAMILIES.FLASH]),
  strong_design: Object.freeze([MODEL_FAMILIES.FLASH]),
  independent_validation: Object.freeze([MODEL_FAMILIES.FLASH]),
  final_reconciliation: Object.freeze([MODEL_FAMILIES.FLASH]),
});

function latestFamily(provider, family, { excludeIds = [] } = {}) {
  return Object.freeze({
    kind: ROUTE_SLOT_KINDS.LATEST_FAMILY,
    provider,
    family,
    excludeIds: Object.freeze([...excludeIds]),
  });
}

function explicitModel(provider, modelId) {
  return Object.freeze({
    kind: ROUTE_SLOT_KINDS.MODEL,
    provider,
    modelId,
  });
}

const DEFAULT_INFERENCE_ROUTE = Object.freeze([
  latestFamily(AI_PROVIDERS.GOOGLE, MODEL_FAMILIES.FLASH_LITE, {
    excludeIds: [MODEL_IDS.GEMINI_3_1_FLASH_LITE],
  }),
  explicitModel(AI_PROVIDERS.GOOGLE, MODEL_IDS.GEMINI_3_1_FLASH_LITE),
  explicitModel(AI_PROVIDERS.GROQ, MODEL_IDS.QWEN_3_8_27B),
  latestFamily(AI_PROVIDERS.GOOGLE, MODEL_FAMILIES.FLASH),
]);

const FLASHCARD_GENERATION_ROUTE = Object.freeze([
  latestFamily(AI_PROVIDERS.GOOGLE, MODEL_FAMILIES.FLASH, {
    excludeIds: [MODEL_IDS.GEMINI_3_5_FLASH],
  }),
  latestFamily(AI_PROVIDERS.GOOGLE, MODEL_FAMILIES.FLASH_LITE, {
    excludeIds: [MODEL_IDS.GEMINI_3_1_FLASH_LITE],
  }),
  explicitModel(AI_PROVIDERS.GOOGLE, MODEL_IDS.GEMINI_3_1_FLASH_LITE),
  explicitModel(AI_PROVIDERS.GROQ, MODEL_IDS.QWEN_3_8_27B),
  explicitModel(AI_PROVIDERS.GOOGLE, MODEL_IDS.GEMINI_3_5_FLASH),
]);

function assertPreparationRoutePosture(value) {
  const normalized = String(value || '').trim();
  if (!PREPARATION_ROUTE_POSTURES.includes(normalized)) {
    const error = new Error(`Unknown central AI preparation route posture: ${value}`);
    error.code = 'AI_PREPARATION_ROUTE_POSTURE_INVALID';
    throw error;
  }
  return normalized;
}

function modelFamiliesForPreparationPosture(posture) {
  if (posture == null || String(posture).trim() === '') return null;
  const normalized = assertPreparationRoutePosture(posture);
  return PREPARATION_POSTURE_MODEL_FAMILIES[normalized];
}

function routeSlotsForTask(taskId) {
  return taskId === 'FLASHCARD_GENERATION'
    ? FLASHCARD_GENERATION_ROUTE
    : DEFAULT_INFERENCE_ROUTE;
}

module.exports = {
  ROUTE_SLOT_KINDS,
  PREPARATION_ROUTE_POSTURES,
  PREPARATION_POSTURE_MODEL_FAMILIES,
  DEFAULT_INFERENCE_ROUTE,
  FLASHCARD_GENERATION_ROUTE,
  assertPreparationRoutePosture,
  modelFamiliesForPreparationPosture,
  routeSlotsForTask,
};