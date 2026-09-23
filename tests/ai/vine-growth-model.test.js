'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ecosystem = require('../../ecosystem_v2');
const {
  VINE_GROWTH_MODEL_VERSION,
  VINE_GROWTH_THRESHOLDS,
  VINE_VISUAL_MATURITY_ANCHORS,
  computeGrowthStage,
  computeGrowthPosition,
  computeVineStructure,
  computeVineHealth,
  computeContinuousVineGrowth,
} = require('../../services/vine-growth-model');

test('vine model stays aligned with Ecosystem V2 growth thresholds', () => {
  assert.equal(VINE_GROWTH_MODEL_VERSION, 2);
  assert.deepEqual(VINE_GROWTH_THRESHOLDS, ecosystem.TREE_GROWTH_THRESHOLDS);
});

test('existing eight KIWI stages remain milestone checkpoints', () => {
  const cases = [
    [0, 1], [24, 1],
    [25, 2], [99, 2],
    [100, 3], [299, 3],
    [300, 4], [699, 4],
    [700, 5], [1199, 5],
    [1200, 6], [1999, 6],
    [2000, 7], [2999, 7],
    [3000, 8], [9000, 8],
  ];
  for (const [points, expectedStage] of cases) {
    assert.equal(computeGrowthStage(points), expectedStage);
  }
});

test('visual maturity anchors stay continuous from Seedling to Ancient', () => {
  assert.equal(VINE_VISUAL_MATURITY_ANCHORS[0].progress, 0);
  assert.equal(
    VINE_VISUAL_MATURITY_ANCHORS[VINE_VISUAL_MATURITY_ANCHORS.length - 1].progress,
    1
  );
  for (let i = 1; i < VINE_VISUAL_MATURITY_ANCHORS.length; i += 1) {
    assert.ok(
      VINE_VISUAL_MATURITY_ANCHORS[i].progress >
        VINE_VISUAL_MATURITY_ANCHORS[i - 1].progress
    );
  }
});

test('crossing a milestone does not snap the vine maturity', () => {
  for (let i = 1; i < VINE_GROWTH_THRESHOLDS.length; i += 1) {
    const threshold = VINE_GROWTH_THRESHOLDS[i].growthPoints;
    const before = computeGrowthPosition(threshold - 1, i);
    const at = computeGrowthPosition(threshold, i + 1);

    assert.ok(at.overallGrowthProgress >= before.overallGrowthProgress);
    assert.ok(
      Math.abs(at.overallGrowthProgress - before.overallGrowthProgress) <= 0.01,
      `visual jump too large at ${threshold} GP`
    );
  }
});

test('canonical structure uses kiwifruit-vine anatomy, not generic tree anatomy', () => {
  const structure = computeVineStructure(0.65, 0);

  const expectedKeys = [
    'rootEstablishment',
    'baseStemThickness',
    'woodyMaturity',
    'mainStemReach',
    'cordonReach',
    'cordonThickness',
    'lateralShootDevelopment',
    'vineComplexity',
    'foliageCapacity',
    'floweringCapacity',
    'fruitingCapacity',
  ];

  assert.deepEqual(Object.keys(structure), expectedKeys);
  for (const key of expectedKeys) {
    assert.ok(structure[key] >= 0 && structure[key] <= 1, key);
  }

  for (const genericTreeKey of [
    'trunkHeight',
    'trunkThickness',
    'rootSpread',
    'branchDevelopment',
    'branchComplexity',
    'canopyCapacity',
    'barkMaturity',
  ]) {
    assert.equal(Object.hasOwn(structure, genericTreeKey), false);
  }
});

test('kiwi vine develops in a biologically useful order', () => {
  const early = computeVineStructure(0.16, 0);
  const established = computeVineStructure(0.45, 0);
  const reproductive = computeVineStructure(0.72, 0);

  // The leader/root system establish before a broad trained cordon network.
  assert.ok(early.mainStemReach > early.cordonReach);
  assert.ok(early.rootEstablishment > early.lateralShootDevelopment);

  // By mid-development, cordons and laterals have become meaningful.
  assert.ok(established.cordonReach > early.cordonReach);
  assert.ok(
    established.lateralShootDevelopment > early.lateralShootDevelopment
  );

  // Reproductive capacity is deliberately later than basic structural growth.
  assert.ok(reproductive.floweringCapacity > established.floweringCapacity);
  assert.ok(reproductive.fruitingCapacity > established.fruitingCapacity);
});

test('permanent vine morphology is monotonic across lifetime growth', () => {
  const samples = [0, 25, 100, 300, 700, 1200, 2000, 3000, 6000];
  let previous = null;

  for (const growthPoints of samples) {
    const state = computeContinuousVineGrowth({
      growthPoints,
      stage: computeGrowthStage(growthPoints),
      vitality: 80,
    });
    const current = state.vineStructure;

    if (previous) {
      for (const key of Object.keys(current)) {
        assert.ok(
          current[key] >= previous[key],
          `${key} regressed at ${growthPoints} GP`
        );
      }
    }
    previous = current;
  }
});

test('Ancient vines keep subtle woody aging without adding a ninth stage', () => {
  const ancient = computeGrowthPosition(3000, 8);
  const older = computeGrowthPosition(6000, 8);
  const muchOlder = computeGrowthPosition(12000, 8);

  assert.equal(ancient.stage, 8);
  assert.equal(older.stage, 8);
  assert.equal(muchOlder.stage, 8);
  assert.equal(ancient.postAncientGrowth, 0);
  assert.ok(older.postAncientGrowth > 0);
  assert.ok(muchOlder.postAncientGrowth > older.postAncientGrowth);

  const ancientStructure = computeVineStructure(1, ancient.postAncientGrowth);
  const olderStructure = computeVineStructure(1, older.postAncientGrowth);
  assert.ok(
    olderStructure.baseStemThickness >= ancientStructure.baseStemThickness
  );
  assert.ok(
    olderStructure.rootEstablishment >= ancientStructure.rootEstablishment
  );
  assert.ok(olderStructure.woodyMaturity >= ancientStructure.woodyMaturity);
});

test('Vitality changes reversible vine health but never permanent structure', () => {
  const healthy = computeContinuousVineGrowth({
    growthPoints: 900,
    stage: 5,
    vitality: 95,
  });
  const critical = computeContinuousVineGrowth({
    growthPoints: 900,
    stage: 5,
    vitality: 10,
  });

  assert.deepEqual(healthy.vineStructure, critical.vineStructure);
  assert.notDeepEqual(healthy.vineHealth, critical.vineHealth);

  assert.ok(healthy.vineHealth.leafDensity > critical.vineHealth.leafDensity);
  assert.ok(healthy.vineHealth.leafDroop < critical.vineHealth.leafDroop);
  assert.ok(
    healthy.vineHealth.leafSaturation > critical.vineHealth.leafSaturation
  );
  assert.ok(healthy.vineHealth.shootVigor > critical.vineHealth.shootVigor);
});

test('vine health outputs stay bounded and reversible', () => {
  const critical = computeVineHealth(0);
  const weak = computeVineHealth(30);
  const healthy = computeVineHealth(80);
  const thriving = computeVineHealth(100);

  for (const state of [critical, weak, healthy, thriving]) {
    for (const value of Object.values(state)) {
      assert.ok(value >= 0 && value <= 1);
    }
  }

  assert.ok(thriving.leafDensity > healthy.leafDensity);
  assert.ok(healthy.leafDensity > weak.leafDensity);
  assert.ok(weak.leafDensity > critical.leafDensity);

  assert.ok(critical.leafDroop > weak.leafDroop);
  assert.ok(weak.leafDroop > healthy.leafDroop);
  assert.ok(thriving.stress < healthy.stress);
  assert.ok(healthy.stress < weak.stress);
  assert.ok(weak.stress < critical.stress);
});
