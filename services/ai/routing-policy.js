'use strict';

const { AI_PROVIDERS } = require('./providers');
const { MODEL_FAMILIES, MODEL_IDS } = require('./model-catalog');

const ROUTE_SLOT_KINDS = Object.freeze({
  LATEST_FAMILY: 'LATEST_FAMILY',
  MODEL: 'MODEL',
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

function routeSlotsForTask(taskId) {
  return taskId === 'FLASHCARD_GENERATION'
    ? FLASHCARD_GENERATION_ROUTE
    : DEFAULT_INFERENCE_ROUTE;
}

module.exports = {
  ROUTE_SLOT_KINDS,
  DEFAULT_INFERENCE_ROUTE,
  FLASHCARD_GENERATION_ROUTE,
  routeSlotsForTask,
};
