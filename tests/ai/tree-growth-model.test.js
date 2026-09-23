'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const tree = require('../../services/tree-growth-model');
const vine = require('../../services/vine-growth-model');

test('legacy tree growth module mirrors canonical vine progression constants', () => {
  assert.equal(
    tree.TREE_GROWTH_MODEL_VERSION,
    vine.VINE_GROWTH_MODEL_VERSION
  );
  assert.deepEqual(
    tree.TREE_GROWTH_THRESHOLDS,
    vine.VINE_GROWTH_THRESHOLDS
  );
  assert.deepEqual(
    tree.TREE_VISUAL_MATURITY_ANCHORS,
    vine.VINE_VISUAL_MATURITY_ANCHORS
  );
  assert.deepEqual(tree.TREE_STAGE_LABELS, vine.VINE_STAGE_LABELS);
});

test('legacy computeStructuralGrowth maps canonical vine anatomy without changing values', () => {
  const canonical = vine.computeVineStructure(0.64, 0.2);
  const legacy = tree.computeStructuralGrowth(0.64, 0.2);

  assert.deepEqual(legacy, {
    trunkHeight: canonical.mainStemReach,
    trunkThickness: canonical.baseStemThickness,
    rootSpread: canonical.rootEstablishment,
    branchDevelopment: canonical.cordonReach,
    branchComplexity: canonical.vineComplexity,
    canopyCapacity: canonical.foliageCapacity,
    barkMaturity: canonical.woodyMaturity,
    fruitingCapacity: canonical.fruitingCapacity,
  });
});

test('legacy computeVisualHealth maps canonical vine health without changing values', () => {
  const canonical = vine.computeVineHealth(72);
  const legacy = tree.computeVisualHealth(72);

  assert.deepEqual(legacy, {
    leafDensity: canonical.leafDensity,
    leafRetention: canonical.leafRetention,
    droop: canonical.leafDroop,
    saturation: canonical.leafSaturation,
    movementStrength: canonical.movementStrength,
    bloomStrength: canonical.flowerVigor,
    stress: canonical.stress,
  });
});

test('legacy continuous tree call exposes canonical vine data plus compatibility aliases', () => {
  const result = tree.computeContinuousTreeGrowth({
    growthPoints: 900,
    stage: 5,
    vitality: 80,
  });

  assert.ok(result.vineStructure);
  assert.ok(result.vineHealth);
  assert.ok(result.structuralGrowth);
  assert.ok(result.visualHealth);
  assert.equal(
    result.structuralGrowth.trunkHeight,
    result.vineStructure.mainStemReach
  );
  assert.equal(
    result.visualHealth.droop,
    result.vineHealth.leafDroop
  );
});
