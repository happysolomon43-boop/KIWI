'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ecosystem = require('../../ecosystem_v2');
const {
  TREE_GROWTH_THRESHOLDS,
  TREE_VISUAL_MATURITY_ANCHORS,
  computeGrowthStage,
  computeGrowthPosition,
  computeStructuralGrowth,
  computeVisualHealth,
  computeContinuousTreeGrowth,
} = require('../../services/tree-growth-model');

test('continuous model stays aligned with Ecosystem V2 growth thresholds', () => {
  assert.deepEqual(TREE_GROWTH_THRESHOLDS, ecosystem.TREE_GROWTH_THRESHOLDS);
});

test('growth stages remain the same named milestone checkpoints', () => {
  const cases = [
    [0, 1],
    [24, 1],
    [25, 2],
    [99, 2],
    [100, 3],
    [299, 3],
    [300, 4],
    [699, 4],
    [700, 5],
    [1199, 5],
    [1200, 6],
    [1999, 6],
    [2000, 7],
    [2999, 7],
    [3000, 8],
    [9000, 8],
  ];
  for (const [points, expectedStage] of cases) {
    assert.equal(computeGrowthStage(points), expectedStage);
  }
});

test('visual maturity anchors are strictly increasing and end at Ancient', () => {
  assert.equal(TREE_VISUAL_MATURITY_ANCHORS[0].progress, 0);
  assert.equal(
    TREE_VISUAL_MATURITY_ANCHORS[TREE_VISUAL_MATURITY_ANCHORS.length - 1].progress,
    1
  );
  for (let i = 1; i < TREE_VISUAL_MATURITY_ANCHORS.length; i += 1) {
    assert.ok(
      TREE_VISUAL_MATURITY_ANCHORS[i].progress >
      TREE_VISUAL_MATURITY_ANCHORS[i - 1].progress
    );
  }
});

test('crossing a stage threshold does not create a visual maturity jump', () => {
  for (let i = 1; i < TREE_GROWTH_THRESHOLDS.length; i += 1) {
    const threshold = TREE_GROWTH_THRESHOLDS[i].growthPoints;
    const before = computeGrowthPosition(threshold - 1, i);
    const at = computeGrowthPosition(threshold, i + 1);

    assert.ok(at.overallGrowthProgress >= before.overallGrowthProgress);
    assert.ok(
      Math.abs(at.overallGrowthProgress - before.overallGrowthProgress) <= 0.01,
      `visual jump too large at ${threshold} GP`
    );
  }
});

test('growth within an interval changes continuously instead of swapping appearances', () => {
  const start = computeGrowthPosition(300, 4);
  const quarter = computeGrowthPosition(400, 4);
  const half = computeGrowthPosition(500, 4);
  const almost = computeGrowthPosition(699, 4);

  assert.equal(start.growthProgress, 0);
  assert.equal(quarter.growthProgress, 0.25);
  assert.equal(half.growthProgress, 0.5);
  assert.ok(almost.growthProgress > 0.99);

  assert.ok(quarter.overallGrowthProgress > start.overallGrowthProgress);
  assert.ok(half.overallGrowthProgress > quarter.overallGrowthProgress);
  assert.ok(almost.overallGrowthProgress > half.overallGrowthProgress);
});

test('structural morphology develops monotonically across the tree lifetime', () => {
  const samples = [0, 25, 100, 300, 700, 1200, 2000, 3000, 6000];
  let previous = null;

  for (const growthPoints of samples) {
    const growth = computeContinuousTreeGrowth({
      growthPoints,
      stage: computeGrowthStage(growthPoints),
      vitality: 80,
    });
    const current = growth.structuralGrowth;

    if (previous) {
      for (const key of [
        'trunkHeight',
        'trunkThickness',
        'rootSpread',
        'branchDevelopment',
        'branchComplexity',
        'canopyCapacity',
        'barkMaturity',
        'fruitingCapacity',
      ]) {
        assert.ok(
          current[key] >= previous[key],
          `${key} regressed at ${growthPoints} GP`
        );
      }
    }
    previous = current;
  }
});

test('Ancient trees keep subtle post-milestone aging without adding new stages', () => {
  const ancient = computeGrowthPosition(3000, 8);
  const older = computeGrowthPosition(6000, 8);
  const muchOlder = computeGrowthPosition(12000, 8);

  assert.equal(ancient.stage, 8);
  assert.equal(older.stage, 8);
  assert.equal(muchOlder.stage, 8);
  assert.equal(ancient.overallGrowthProgress, 1);
  assert.equal(older.overallGrowthProgress, 1);
  assert.equal(ancient.postAncientGrowth, 0);
  assert.ok(older.postAncientGrowth > 0);
  assert.ok(muchOlder.postAncientGrowth > older.postAncientGrowth);

  const ancientStructure = computeStructuralGrowth(1, ancient.postAncientGrowth);
  const olderStructure = computeStructuralGrowth(1, older.postAncientGrowth);
  assert.ok(olderStructure.trunkThickness >= ancientStructure.trunkThickness);
  assert.ok(olderStructure.rootSpread >= ancientStructure.rootSpread);
});

test('visual health is reversible and bounded independently of structural growth', () => {
  const critical = computeVisualHealth(0);
  const weak = computeVisualHealth(30);
  const healthy = computeVisualHealth(80);
  const thriving = computeVisualHealth(100);

  for (const state of [critical, weak, healthy, thriving]) {
    for (const value of Object.values(state)) {
      assert.ok(value >= 0 && value <= 1);
    }
  }

  assert.ok(thriving.leafDensity > healthy.leafDensity);
  assert.ok(healthy.leafDensity > weak.leafDensity);
  assert.ok(weak.leafDensity > critical.leafDensity);

  assert.ok(critical.droop > weak.droop);
  assert.ok(weak.droop > healthy.droop);
  assert.ok(thriving.stress < healthy.stress);
  assert.ok(healthy.stress < weak.stress);
  assert.ok(weak.stress < critical.stress);
});
