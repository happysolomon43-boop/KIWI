'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createModelRouter } = require('../../services/ai/model-router');

test('VVIP routes through four approved stable Flash models for resilient quality-preserving fallback', () => {
  const router = createModelRouter();
  const ids = router.resolveCandidates('MAIN_CBT').map((entry) => entry.modelId);

  assert.deepEqual(ids, [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ]);
});

test('flashcard generation receives the same VVIP model chain as main CBT', () => {
  const router = createModelRouter();
  const ids = router.resolveCandidates('FLASHCARD_GENERATION').map((entry) => entry.modelId);

  assert.deepEqual(ids, [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ]);
});

test('VIP starts one stable Flash generation below VVIP primary', () => {
  const router = createModelRouter();
  const ids = router.resolveCandidates('DEEP_AUDIT').map((entry) => entry.modelId);

  assert.deepEqual(ids, [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ]);
});

test('confirmed background tasks with a Flash-Lite floor stay Lite-first', () => {
  const router = createModelRouter();

  for (const taskId of ['MORNING_BRIEF', 'STUDY_TASK_GENERATION']) {
    const ids = router.resolveCandidates(taskId).map((entry) => entry.modelId);
    assert.deepEqual(ids, [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ], taskId);
  }
});

test('interactive degradable VIP tasks still preserve their Flash-first policy', () => {
  const router = createModelRouter();
  const ids = router.resolveCandidates('DAILY_INVITATIONS').map((entry) => entry.modelId);

  assert.deepEqual(ids, [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ]);
});

test('IP tasks stay on the Flash-Lite family', () => {
  const router = createModelRouter();
  const ids = router.resolveCandidates('CARD_EXPLANATION').map((entry) => entry.modelId);

  assert.deepEqual(ids, [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ]);
});

test('preferred model creates an affinity ceiling instead of upgrading unexpectedly', () => {
  const router = createModelRouter();
  const ids = router.resolveCandidates('MAIN_CBT', {
    preferredModelId: 'gemini-3.7-flash',
  }).map((entry) => entry.modelId);

  assert.deepEqual(ids, [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ]);
});
