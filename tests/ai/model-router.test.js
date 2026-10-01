'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { MODEL_IDS, MODEL_STATUS, createModelCatalog } = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');
const { createTextContentPart, createImageContentPart, createMultimodalContent } = require('../../services/ai/execution-contracts');

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7lT8AAAAASUVORK5CYII=';

test('ordinary inference uses the single global model-neutral route', () => {
  const ids = createModelRouter().resolveCandidates('MAIN_CBT').map((entry) => entry.modelId);
  assert.deepEqual(ids, [
    MODEL_IDS.GEMINI_3_5_FLASH_LITE,
    MODEL_IDS.GEMINI_3_1_FLASH_LITE,
    MODEL_IDS.QWEN_3_8_27B,
    MODEL_IDS.GEMINI_3_8_FLASH,
  ]);
});

test('flashcard generation is the only task with a distinct model order', () => {
  const router = createModelRouter();
  const ordinary = router.resolveCandidates('MAIN_CBT').map((entry) => entry.routeKey);
  const flashcards = router.resolveCandidates('FLASHCARD_GENERATION').map((entry) => entry.routeKey);
  assert.notDeepEqual(flashcards, ordinary);
  assert.equal(flashcards[0], `${AI_PROVIDERS.GOOGLE}::${MODEL_IDS.GEMINI_3_8_FLASH}`);
  assert.equal(flashcards.at(-1), `${AI_PROVIDERS.GOOGLE}::${MODEL_IDS.GEMINI_3_5_FLASH}`);
});

test('multimodal inference automatically excludes text-only routes', () => {
  const content = createMultimodalContent([
    createTextContentPart('Describe this image.'),
    createImageContentPart({ mimeType: 'image/png', data: TINY_PNG_BASE64 }),
  ]);
  const candidates = createModelRouter().resolveCandidates('IMPORT_IMAGE_EXTRACTION', { content });
  assert.ok(candidates.length > 0);
  assert.equal(candidates.some((entry) => entry.modelId === MODEL_IDS.QWEN_3_8_27B), false);
  assert.ok(candidates.every((entry) => entry.provider === AI_PROVIDERS.GOOGLE));
});

test('preferred route creates an affinity ceiling only after eligibility filtering', () => {
  const router = createModelRouter();
  const preferredRouteKey = `${AI_PROVIDERS.GROQ}::${MODEL_IDS.QWEN_3_8_27B}`;
  const ids = router.resolveCandidates('MAIN_CBT', { preferredRouteKey }).map((entry) => entry.modelId);
  assert.deepEqual(ids, [MODEL_IDS.QWEN_3_8_27B, MODEL_IDS.GEMINI_3_8_FLASH]);
});

test('suspended or non-production models cannot be resurrected by preferredRouteKey', () => {
  const catalog = createModelCatalog();
  const routeKey = `${AI_PROVIDERS.GROQ}::${MODEL_IDS.QWEN_3_8_27B}`;
  catalog.setStatus(routeKey, MODEL_STATUS.SUSPENDED);
  const router = createModelRouter({ catalog });
  const candidates = router.resolveCandidates('MAIN_CBT', { preferredRouteKey: routeKey });
  assert.equal(candidates.some((entry) => entry.routeKey === routeKey), false);
});
