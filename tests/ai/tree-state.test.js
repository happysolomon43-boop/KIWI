'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TREE_STAGE_LABELS,
  buildTreeState,
  labelForStage,
} = require('../../services/tree-state');

test('TreeState defaults are safe and renderer-compatible', () => {
  const state = buildTreeState();

  assert.equal(state.schemaVersion, 1);
  assert.equal(state.stage, 1);
  assert.equal(state.stageLabel, 'SEEDLING');
  assert.equal(state.growthPoints, 0);
  assert.equal(state.vitality, 100);
  assert.equal(state.health, 100);
  assert.equal(state.knowledgeScore, 0);
  assert.equal(state.leaves, 4);
  assert.equal(state.fruits, 0);
  assert.equal(state.rings, 0);
  assert.deepEqual(state.milestones, []);
  assert.equal(state.streak, 0);
  assert.equal(state.nextStage, null);
});

test('TreeState clamps maturity and vitality while preserving permanent progression inputs', () => {
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
  assert.equal(state.health, 0);
  assert.equal(state.growthPoints, 3450);
  assert.equal(state.knowledgeScore, 100);
  assert.equal(state.leaves, 50);
  assert.equal(state.fruits, 6);
  assert.equal(state.streak, 12);
});

test('TreeState derives canopy density from global KS only when no explicit leaf hint is supplied', () => {
  assert.equal(buildTreeState({ knowledgeScore: 42 }).leaves, 21);
  assert.equal(buildTreeState({ knowledgeScore: 0 }).leaves, 4);
  assert.equal(buildTreeState({ knowledgeScore: 100 }).leaves, 50);
  assert.equal(buildTreeState({ knowledgeScore: 100, leaves: 17 }).leaves, 17);
});

test('TreeState normalizes milestone rings and next-stage payload', () => {
  const state = buildTreeState({
    stage: 4,
    growthPoints: 320,
    milestones: [30, 7, 30, '100', -1, 'bad'],
    nextStage: {
      next_stage: 5,
      next_stage_label: 'THRIVING',
      current_growth_points: 320,
      target_growth_points: 700,
      growth_points_needed: 380,
    },
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
});

test('TreeState accepts database snake_case inputs and keeps health as a vitality alias', () => {
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
  assert.equal(state.health, 42);
  assert.equal(state.growthPoints, 111);
  assert.equal(state.knowledgeScore, 64);
  assert.equal(state.leaves, 32);
  assert.equal(state.streak, 9);
  assert.deepEqual(state.vitalityBreakdown, {
    memory_condition: 61.5,
    seven_day_consistency: 71.43,
    calmness: 80,
    recent_session_quality: 55,
  });
});

test('Tree stage labels stay aligned with the eight-stage ecosystem', () => {
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
