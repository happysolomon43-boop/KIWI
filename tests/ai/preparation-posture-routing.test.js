'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createModelRouter } = require('../../services/ai/model-router');
const {
  PREPARATION_ROUTE_POSTURES,
  modelFamiliesForPreparationPosture,
} = require('../../services/ai/routing-policy');
const { MODEL_FAMILIES } = require('../../services/ai/model-catalog');

const router = createModelRouter();

test('central AI owns all canonical preparation route postures without Teaching model IDs', () => {
  assert.deepEqual(PREPARATION_ROUTE_POSTURES, [
    'economy_maintenance',
    'bounded_interpretive',
    'strong_design',
    'independent_validation',
    'final_reconciliation',
  ]);
  assert.deepEqual(modelFamiliesForPreparationPosture('economy_maintenance'), [MODEL_FAMILIES.FLASH_LITE]);
  assert.deepEqual(modelFamiliesForPreparationPosture('strong_design'), [MODEL_FAMILIES.FLASH]);
  assert.deepEqual(modelFamiliesForPreparationPosture('final_reconciliation'), [MODEL_FAMILIES.FLASH]);
});

test('economy preparation selects only centrally classified Lite-family routes', () => {
  const routes = router.resolveCandidates('QUICK_QUESTIONS', { preparationRoutePosture:'economy_maintenance' });
  assert.ok(routes.length > 0);
  assert.equal(routes.every((route) => route.model.family === MODEL_FAMILIES.FLASH_LITE), true);
});

test('strong and final preparation select only centrally classified Flash-family routes', () => {
  for (const posture of ['strong_design','independent_validation','final_reconciliation']) {
    const routes = router.resolveCandidates('QUICK_QUESTIONS', { preparationRoutePosture:posture });
    assert.ok(routes.length > 0, posture);
    assert.equal(routes.every((route) => route.model.family === MODEL_FAMILIES.FLASH), true, posture);
  }
});

test('bounded interpretive preparation can use Lite or Flash, but not unclassified preview routes', () => {
  const routes = router.resolveCandidates('QUICK_QUESTIONS', { preparationRoutePosture:'bounded_interpretive' });
  assert.ok(routes.length > 0);
  assert.equal(routes.every((route) => [MODEL_FAMILIES.FLASH_LITE,MODEL_FAMILIES.FLASH].includes(route.model.family)), true);
  assert.equal(routes.some((route) => route.model.family == null), false);
});

test('ordinary route ordering remains unchanged when no preparation posture is requested', () => {
  const ordinary = router.resolveCandidates('QUICK_QUESTIONS');
  assert.ok(ordinary.length > 0);
  assert.equal(ordinary.some((route) => route.model.family == null), true);
});

test('invalid preparation posture fails closed', () => {
  assert.throws(
    () => router.resolveCandidates('QUICK_QUESTIONS', { preparationRoutePosture:'cheap_magic' }),
    /Unknown central AI preparation route posture/
  );
});
