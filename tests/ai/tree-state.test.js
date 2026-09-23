'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TREE_STAGE_LABELS,
  buildTreeState,
  labelForStage,
} = require('../../services/tree-state');

test('TreeState v4 defaults are safe and vine-native', () => {
  const state = buildTreeState();

  assert.equal(state.schemaVersion, 4);
  assert.equal(state.growthModelVersion, 3);
  assert.equal(state.stage, 1);
  assert.equal(state.stageLabel, 'SEEDLING');
  assert.equal(state.growthPoints, 0);
  assert.equal(state.growthProgress, 0);
  assert.equal(state.overallGrowthProgress, 0);
  assert.equal(state.postAncientGrowth, 0);

  assert.ok(state.vineStructure);
  assert.ok(state.vineHealth);
  assert.equal(Object.hasOwn(state, 'structuralGrowth'), false);
  assert.equal(Object.hasOwn(state, 'visualHealth'), false);
  assert.equal(Object.hasOwn(state, 'health'), false);

  assert.equal(state.vitality, 100);
  assert.equal(state.knowledgeScore, 0);
  assert.equal(state.leaves, 4);
  assert.equal(state.fruits, 0);
  assert.equal(state.rings, 0);
  assert.deepEqual(state.milestones, []);
  assert.equal(state.streak, 0);

  assert.deepEqual(state.nextStage, {
    next_stage: 2,
    next_stage_label: 'SPROUT',
    current_growth_points: 0,
    target_growth_points: 25,
    growth_points_needed: 25,
  });

  assert.deepEqual(state.growthInterval, {
    currentStageStart: 0,
    nextStageStart: 25,
    pointsIntoStage: 0,
    pointsInStage: 25,
    pointsToNextStage: 25,
  });
});

test('canonical TreeState exposes only kiwifruit-vine morphology', () => {
  const state = buildTreeState({
    stage: 5,
    growthPoints: 900,
    vitality: 80,
  });

  assert.deepEqual(Object.keys(state.vineStructure), [
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
  ]);

  for (const genericTreeKey of [
    'trunkHeight',
    'trunkThickness',
    'rootSpread',
    'branchDevelopment',
    'branchComplexity',
    'canopyCapacity',
    'barkMaturity',
  ]) {
    assert.equal(Object.hasOwn(state.vineStructure, genericTreeKey), false);
  }

  for (const retiredTopLevelAlias of [
    'structuralGrowth',
    'visualHealth',
    'health',
  ]) {
    assert.equal(Object.hasOwn(state, retiredTopLevelAlias), false);
  }
});

test('TreeState clamps maturity and vitality while preserving permanent progression', () => {
  const state = buildTreeState({
    stage: 99,
    health: -20,
    growthPoints: 3450,
    knowledgeScore: 137,
    fruits: 6,
    streak: 12,
  });

  assert.equal(state.stage, 8);
  assert.equal(state.stageLabel, 'ANCIENT');
  assert.equal(state.vitality, 0);
  assert.equal(state.growthPoints, 3450);
  assert.equal(state.growthProgress, 1);
  assert.equal(state.overallGrowthProgress, 1);
  assert.ok(state.postAncientGrowth > 0);
  assert.equal(state.knowledgeScore, 100);
  assert.equal(state.leaves, 50);
  assert.equal(state.fruits, 6);
  assert.equal(state.streak, 12);
  assert.equal(state.nextStage, null);
});

test('TreeState derives foliage hint from global KS only when no explicit leaf hint exists', () => {
  assert.equal(buildTreeState({ knowledgeScore: 42 }).leaves, 21);
  assert.equal(buildTreeState({ knowledgeScore: 0 }).leaves, 4);
  assert.equal(buildTreeState({ knowledgeScore: 100 }).leaves, 50);
  assert.equal(buildTreeState({ knowledgeScore: 100, leaves: 17 }).leaves, 17);
});

test('TreeState derives next-stage state from permanent Growth Points', () => {
  const state = buildTreeState({
    stage: 4,
    growthPoints: 320,
    milestones: [30, 7, 30, '100', -1, 'bad'],
  });

  assert.deepEqual(state.milestones, [7, 30, 100]);
  assert.equal(state.rings, 3);
  assert.deepEqual(state.nextStage, {
    next_stage: 5,
    next_stage_label: 'THRIVING',
    current_growth_points: 320,
    target_growth_points: 700,
    growth_points_needed: 380,
  });
  assert.equal(state.growthInterval.currentStageStart, 300);
  assert.equal(state.growthInterval.nextStageStart, 700);
  assert.equal(state.growthInterval.pointsIntoStage, 20);
  assert.equal(state.growthInterval.pointsInStage, 400);
  assert.equal(state.growthInterval.pointsToNextStage, 380);
  assert.equal(state.growthProgress, 0.05);
});

test('TreeState accepts database snake_case and legacy input health but emits canonical vitality', () => {
  const state = buildTreeState({
    tree_stage: 3,
    tree_health: 42,
    growth_points: 111,
    global_knowledge_score: 64,
    current_streak: 9,
    vitality_breakdown: {
      memory_condition: 61.5,
      seven_day_consistency: 71.43,
      calmness: 80,
      recent_session_quality: 55,
    },
  });

  assert.equal(state.stage, 3);
  assert.equal(state.stageLabel, 'SAPLING');
  assert.equal(state.vitality, 42);
  assert.equal(Object.hasOwn(state, 'health'), false);
  assert.equal(state.growthPoints, 111);
  assert.equal(state.knowledgeScore, 64);
  assert.equal(state.leaves, 32);
  assert.equal(state.streak, 9);
  assert.ok(state.growthProgress > 0);
  assert.ok(state.overallGrowthProgress > 0);
  assert.deepEqual(state.vitalityBreakdown, {
    memory_condition: 61.5,
    seven_day_consistency: 71.43,
    calmness: 80,
    recent_session_quality: 55,
  });
});

test('Growth Points advance stale persisted stage but can never visually de-age the vine', () => {
  const advanced = buildTreeState({ stage: 1, growthPoints: 320 });
  assert.equal(advanced.stage, 4);
  assert.equal(advanced.stageLabel, 'YOUNG TREE');

  const protectedStage = buildTreeState({ stage: 5, growthPoints: 100 });
  assert.equal(protectedStage.stage, 5);
  assert.equal(protectedStage.stageLabel, 'THRIVING');
  assert.equal(protectedStage.growthProgress, 0);
});

test('Vitality changes current vine health without changing permanent woody structure', () => {
  const healthy = buildTreeState({ growthPoints: 900, vitality: 95 });
  const critical = buildTreeState({ growthPoints: 900, vitality: 10 });

  assert.equal(healthy.stage, critical.stage);
  assert.equal(healthy.overallGrowthProgress, critical.overallGrowthProgress);
  assert.deepEqual(healthy.vineStructure, critical.vineStructure);

  assert.notDeepEqual(healthy.vineHealth, critical.vineHealth);
  assert.ok(healthy.vineHealth.leafDensity > critical.vineHealth.leafDensity);
  assert.ok(healthy.vineHealth.leafDroop < critical.vineHealth.leafDroop);
  assert.ok(
    healthy.vineHealth.leafSaturation >
      critical.vineHealth.leafSaturation
  );
  assert.ok(
    healthy.vineHealth.shootVigor >
      critical.vineHealth.shootVigor
  );
});

test('Tree stage labels stay aligned with the existing eight-stage product language', () => {
  const expected = [
    '',
    'SEEDLING',
    'SPROUT',
    'SAPLING',
    'YOUNG TREE',
    'THRIVING',
    'BLOOMING',
    'MATURE',
    'ANCIENT',
  ];
  assert.deepEqual(TREE_STAGE_LABELS, expected);
  for (let stage = 1; stage <= 8; stage += 1) {
    assert.equal(labelForStage(stage), expected[stage]);
  }
});
