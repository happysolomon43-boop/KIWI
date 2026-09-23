'use strict';

const {
  VINE_GROWTH_MODEL_VERSION,
  VINE_STAGE_LABELS,
  computeContinuousVineGrowth,
} = require('./vine-growth-model');

const TREE_STAGE_LABELS = VINE_STAGE_LABELS;
const TREE_STATE_SCHEMA_VERSION = 4;

function firstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
  }
  return undefined;
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max, fallback) {
  const numeric = finiteNumber(value, fallback);
  return Math.min(max, Math.max(min, numeric));
}

function nonNegativeInt(value, fallback) {
  return Math.max(0, Math.floor(finiteNumber(value, fallback)));
}

function normalizeStage(value) {
  return Math.floor(clamp(value, 1, TREE_STAGE_LABELS.length - 1, 1));
}

function labelForStage(stage) {
  return TREE_STAGE_LABELS[normalizeStage(stage)] || 'SEEDLING';
}

function normalizeMilestones(value) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(
    input
      .map((item) => Math.floor(Number(item)))
      .filter((item) => Number.isFinite(item) && item > 0)
  )].sort((a, b) => a - b);
}

function normalizeVitalityBreakdown(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const read = (key) => {
    const n = Number(value[key]);
    return Number.isFinite(n) ? Math.round(clamp(n, 0, 100, 0) * 100) / 100 : null;
  };
  return {
    memory_condition: read('memory_condition'),
    seven_day_consistency: read('seven_day_consistency'),
    calmness: read('calmness'),
    recent_session_quality: read('recent_session_quality'),
  };
}

function normalizeNextStage(value, currentGrowthPoints) {
  if (!value || typeof value !== 'object') return null;

  const nextStage = normalizeStage(firstDefined(value.next_stage, value.stage, 1));
  const targetGrowthPoints = nonNegativeInt(
    firstDefined(value.target_growth_points, value.targetGrowthPoints),
    currentGrowthPoints
  );
  const current = nonNegativeInt(
    firstDefined(value.current_growth_points, value.currentGrowthPoints),
    currentGrowthPoints
  );
  const needed = nonNegativeInt(
    firstDefined(value.growth_points_needed, value.growthPointsNeeded),
    Math.max(0, targetGrowthPoints - current)
  );

  return {
    next_stage: nextStage,
    next_stage_label:
      String(firstDefined(value.next_stage_label, value.nextStageLabel, labelForStage(nextStage)) || labelForStage(nextStage)),
    current_growth_points: current,
    target_growth_points: targetGrowthPoints,
    growth_points_needed: needed,
  };
}

/**
 * Build the single renderer-facing KIWI TreeState contract.
 *
 * Permanent progression:
 * - stage / stageLabel: named maturity milestones
 * - growthPoints: permanent progression
 * - growthProgress: continuous 0..1 progress inside the current milestone span
 * - overallGrowthProgress: continuous biological maturity across the whole tree life
 * - vineStructure: canonical kiwifruit-vine physical-development values
 *
 * Current condition:
 * - vitality: reversible 0..100 ecosystem health
 * - vineHealth: canonical reversible vine/foliage presentation values
 *
 * Schema v4 is vine-native. Generic-tree renderer aliases were retired after
 * the PixiJS rollout completed.
 */
function buildTreeState(input) {
  const source = input && typeof input === 'object' ? input : {};

  const vitality = Math.round(clamp(
    firstDefined(source.vitality, source.health, source.tree_health),
    0,
    100,
    100
  ));
  const growthPoints = nonNegativeInt(
    firstDefined(source.growthPoints, source.growth_points),
    0
  );
  const requestedStage = normalizeStage(
    firstDefined(source.stage, source.tree_stage, 1)
  );

  const continuousGrowth = computeContinuousVineGrowth({
    growthPoints,
    stage: requestedStage,
    vitality,
  });
  const stage = continuousGrowth.stage;

  const knowledgeScore = Math.round(
    clamp(
      firstDefined(source.knowledgeScore, source.globalKS, source.global_knowledge_score),
      0,
      100,
      0
    ) * 100
  ) / 100;

  const milestones = normalizeMilestones(source.milestones);
  const leavesInput = firstDefined(source.leaves, source.leafCount, source.leaf_count);
  const leaves = leavesInput === undefined
    ? Math.max(4, Math.round(knowledgeScore * 0.5))
    : nonNegativeInt(leavesInput, 4);

  const fruits = nonNegativeInt(
    firstDefined(source.fruits, source.fruitCount, source.fruit_count),
    0
  );
  const rings = nonNegativeInt(
    firstDefined(source.rings, source.ringCount, source.ring_count),
    milestones.length
  );
  const streak = nonNegativeInt(
    firstDefined(source.streak, source.currentStreak, source.current_streak),
    0
  );

  return {
    schemaVersion: TREE_STATE_SCHEMA_VERSION,
    growthModelVersion: VINE_GROWTH_MODEL_VERSION,

    stage,
    stageLabel: labelForStage(stage),
    growthPoints,
    nextStage: normalizeNextStage(continuousGrowth.nextStage, growthPoints),

    growthProgress: continuousGrowth.growthProgress,
    overallGrowthProgress: continuousGrowth.overallGrowthProgress,
    postAncientGrowth: continuousGrowth.postAncientGrowth,
    growthInterval: {
      currentStageStart: continuousGrowth.currentStageStart,
      nextStageStart: continuousGrowth.nextStageStart,
      pointsIntoStage: continuousGrowth.pointsIntoStage,
      pointsInStage: continuousGrowth.pointsInStage,
      pointsToNextStage: continuousGrowth.pointsToNextStage,
    },
    vineStructure: continuousGrowth.vineStructure,

    vitality,
    vitalityBreakdown: normalizeVitalityBreakdown(
      firstDefined(source.vitalityBreakdown, source.vitality_breakdown)
    ),
    vineHealth: continuousGrowth.vineHealth,

    knowledgeScore,
    leaves,
    fruits,
    rings,
    milestones,
    streak,
  };
}

module.exports = {
  TREE_STATE_SCHEMA_VERSION,
  TREE_STAGE_LABELS,
  buildTreeState,
  labelForStage,
  normalizeMilestones,
  normalizeNextStage,
};
