'use strict';

const TREE_STATE_SCHEMA_VERSION = 1;

const TREE_STAGE_LABELS = Object.freeze([
  '',
  'SEEDLING',
  'SPROUT',
  'SAPLING',
  'YOUNG TREE',
  'THRIVING',
  'BLOOMING',
  'MATURE',
  'ANCIENT',
]);

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
  return Math.floor(clamp(value, 1, 8, 1));
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
 * Canonical fields:
 * - stage / stageLabel: permanent maturity (1-8)
 * - growthPoints / nextStage: permanent progression
 * - vitality: current reversible health (0-100)
 * - knowledgeScore: current global KS used only for canopy-density hinting
 * - leaves: visual density hint, currently derived from global KS for compatibility
 * - fruits: permanent fruit count
 * - rings / milestones: permanent streak milestone marks
 * - streak: current streak context
 *
 * health is intentionally retained as a backwards-compatible alias for vitality
 * until the SVG renderer is replaced.
 */
function buildTreeState(input) {
  const source = input && typeof input === 'object' ? input : {};

  const stage = normalizeStage(firstDefined(source.stage, source.tree_stage));
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
  const nextStage = normalizeNextStage(
    firstDefined(source.nextStage, source.next_tree_stage),
    growthPoints
  );

  return {
    schemaVersion: TREE_STATE_SCHEMA_VERSION,
    stage,
    stageLabel: labelForStage(stage),
    growthPoints,
    nextStage,
    vitality,
    vitalityBreakdown: normalizeVitalityBreakdown(
      firstDefined(source.vitalityBreakdown, source.vitality_breakdown)
    ),
    knowledgeScore,
    leaves,
    fruits,
    rings,
    milestones,
    streak,

    // Backwards-compatible alias consumed by the existing SVG KiwiTree.
    health: vitality,
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
