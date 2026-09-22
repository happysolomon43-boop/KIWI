'use strict';

const TREE_GROWTH_MODEL_VERSION = 1;

const TREE_GROWTH_THRESHOLDS = Object.freeze([
  Object.freeze({ stage: 1, growthPoints: 0, label: 'SEEDLING' }),
  Object.freeze({ stage: 2, growthPoints: 25, label: 'SPROUT' }),
  Object.freeze({ stage: 3, growthPoints: 100, label: 'SAPLING' }),
  Object.freeze({ stage: 4, growthPoints: 300, label: 'YOUNG TREE' }),
  Object.freeze({ stage: 5, growthPoints: 700, label: 'THRIVING' }),
  Object.freeze({ stage: 6, growthPoints: 1200, label: 'BLOOMING' }),
  Object.freeze({ stage: 7, growthPoints: 2000, label: 'MATURE' }),
  Object.freeze({ stage: 8, growthPoints: 3000, label: 'ANCIENT' }),
]);

// Visual maturity is deliberately not growthPoints / 3000. KIWI's milestone
// gaps widen as the tree matures; mapping them directly to 0..1 would compress
// the early life of the tree into a visually tiny range. These anchors preserve
// meaningful early development while remaining continuous at every threshold.
const TREE_VISUAL_MATURITY_ANCHORS = Object.freeze([
  Object.freeze({ stage: 1, progress: 0.00 }),
  Object.freeze({ stage: 2, progress: 0.12 }),
  Object.freeze({ stage: 3, progress: 0.26 }),
  Object.freeze({ stage: 4, progress: 0.43 }),
  Object.freeze({ stage: 5, progress: 0.61 }),
  Object.freeze({ stage: 6, progress: 0.75 }),
  Object.freeze({ stage: 7, progress: 0.89 }),
  Object.freeze({ stage: 8, progress: 1.00 }),
]);

const TREE_STAGE_LABELS = Object.freeze([
  '',
  ...TREE_GROWTH_THRESHOLDS.map((item) => item.label),
]);

const ANCIENT_GROWTH_POINTS = TREE_GROWTH_THRESHOLDS[TREE_GROWTH_THRESHOLDS.length - 1].growthPoints;

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, min)));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function round4(value) {
  return Math.round(finiteNumber(value, 0) * 10000) / 10000;
}

function lerp(start, end, progress) {
  return start + (end - start) * clamp01(progress);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function smootherstep(value) {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function normalizeStage(value) {
  return Math.floor(clamp(value, 1, TREE_GROWTH_THRESHOLDS.length));
}

function computeGrowthStage(growthPoints) {
  const points = Math.max(0, finiteNumber(growthPoints, 0));
  let stage = 1;
  for (const threshold of TREE_GROWTH_THRESHOLDS) {
    if (points >= threshold.growthPoints) stage = threshold.stage;
  }
  return stage;
}

function getThresholdForStage(stage) {
  return TREE_GROWTH_THRESHOLDS[normalizeStage(stage) - 1];
}

function getMaturityAnchor(stage) {
  return TREE_VISUAL_MATURITY_ANCHORS[normalizeStage(stage) - 1];
}

function buildNextStage(stage, growthPoints) {
  const normalizedStage = normalizeStage(stage);
  if (normalizedStage >= TREE_GROWTH_THRESHOLDS.length) return null;
  const current = getThresholdForStage(normalizedStage);
  const next = getThresholdForStage(normalizedStage + 1);
  const points = Math.max(0, Math.floor(finiteNumber(growthPoints, 0)));
  return {
    next_stage: next.stage,
    next_stage_label: next.label,
    current_growth_points: points,
    target_growth_points: next.growthPoints,
    growth_points_needed: Math.max(0, next.growthPoints - points),
    stage_start_growth_points: current.growthPoints,
  };
}

function computeGrowthPosition(growthPoints, persistedStage) {
  const points = Math.max(0, finiteNumber(growthPoints, 0));
  const earnedStage = computeGrowthStage(points);
  const stageFloor = normalizeStage(persistedStage == null ? earnedStage : persistedStage);
  // A persisted stage is a permanent maturity floor. Growth Points may advance
  // the stage, but a transient inconsistency must never visually de-age the tree.
  const stage = Math.max(stageFloor, earnedStage);

  const currentThreshold = getThresholdForStage(stage);
  const currentAnchor = getMaturityAnchor(stage);

  if (stage >= TREE_GROWTH_THRESHOLDS.length) {
    const excess = Math.max(0, points - ANCIENT_GROWTH_POINTS);
    // Ancient trees keep aging subtly instead of becoming completely static.
    // At +3000 GP beyond Ancient this reaches 0.5 and asymptotically approaches 1.
    const postAncientGrowth = excess <= 0 ? 0 : excess / (excess + ANCIENT_GROWTH_POINTS);
    return {
      stage,
      growthProgress: 1,
      overallGrowthProgress: 1,
      postAncientGrowth: round4(postAncientGrowth),
      currentStageStart: currentThreshold.growthPoints,
      nextStageStart: null,
      pointsIntoStage: Math.max(0, points - currentThreshold.growthPoints),
      pointsInStage: null,
      pointsToNextStage: 0,
      nextStage: null,
    };
  }

  const nextThreshold = getThresholdForStage(stage + 1);
  const nextAnchor = getMaturityAnchor(stage + 1);
  const interval = Math.max(1, nextThreshold.growthPoints - currentThreshold.growthPoints);
  const pointsIntoStage = clamp(points - currentThreshold.growthPoints, 0, interval);
  const growthProgress = clamp01(pointsIntoStage / interval);

  // Smootherstep gives zero velocity at milestone boundaries. Crossing a stage
  // therefore never causes a visual snap even though the label changes.
  const visualIntervalProgress = smootherstep(growthProgress);
  const overallGrowthProgress = lerp(
    currentAnchor.progress,
    nextAnchor.progress,
    visualIntervalProgress
  );

  return {
    stage,
    growthProgress: round4(growthProgress),
    overallGrowthProgress: round4(overallGrowthProgress),
    postAncientGrowth: 0,
    currentStageStart: currentThreshold.growthPoints,
    nextStageStart: nextThreshold.growthPoints,
    pointsIntoStage: Math.floor(pointsIntoStage),
    pointsInStage: interval,
    pointsToNextStage: Math.max(0, Math.ceil(nextThreshold.growthPoints - points)),
    nextStage: buildNextStage(stage, points),
  };
}

function computeStructuralGrowth(overallGrowthProgress, postAncientGrowth) {
  const p = clamp01(overallGrowthProgress);
  const ancient = clamp01(postAncientGrowth);

  const trunkHeight = clamp01(
    0.07 + 0.87 * (1 - Math.pow(1 - p, 1.65)) + 0.06 * ancient
  );
  const trunkThickness = clamp01(
    0.03 + 0.91 * Math.pow(p, 0.78) + 0.06 * ancient
  );
  const rootSpread = clamp01(
    0.05 + 0.89 * Math.pow(p, 0.68) + 0.06 * ancient
  );
  const branchDevelopment = clamp01(
    smoothstep(0.08, 0.88, p)
  );
  const branchComplexity = clamp01(
    0.96 * Math.pow(smoothstep(0.10, 1.00, p), 0.82) + 0.04 * ancient
  );
  const canopyCapacity = clamp01(
    0.04 + 0.92 * smoothstep(0.06, 0.94, p) + 0.04 * ancient
  );
  const barkMaturity = clamp01(
    0.96 * smoothstep(0.24, 1.00, p) + 0.04 * ancient
  );
  const fruitingCapacity = clamp01(
    smoothstep(0.45, 0.86, p)
  );

  return {
    trunkHeight: round4(trunkHeight),
    trunkThickness: round4(trunkThickness),
    rootSpread: round4(rootSpread),
    branchDevelopment: round4(branchDevelopment),
    branchComplexity: round4(branchComplexity),
    canopyCapacity: round4(canopyCapacity),
    barkMaturity: round4(barkMaturity),
    fruitingCapacity: round4(fruitingCapacity),
  };
}

function computeVisualHealth(vitality) {
  const v = clamp(vitality, 0, 100) / 100;

  // Vitality changes current condition only. It does not change permanent size,
  // stage, branch topology, or any structural-growth value.
  const leafDensity = clamp01(
    0.12 + 0.88 * smoothstep(0.05, 0.90, v)
  );
  const leafRetention = clamp01(
    0.08 + 0.92 * smoothstep(0.08, 0.90, v)
  );
  const droop = clamp01(
    1 - smoothstep(0.20, 0.78, v)
  );
  const saturation = clamp01(
    0.35 + 0.65 * Math.pow(v, 0.72)
  );
  const movementStrength = clamp01(
    0.16 + 0.84 * smoothstep(0.15, 0.90, v)
  );
  const bloomStrength = clamp01(
    smoothstep(0.62, 0.96, v)
  );
  const stress = round4(1 - v);

  return {
    leafDensity: round4(leafDensity),
    leafRetention: round4(leafRetention),
    droop: round4(droop),
    saturation: round4(saturation),
    movementStrength: round4(movementStrength),
    bloomStrength: round4(bloomStrength),
    stress,
  };
}

function computeContinuousTreeGrowth(input) {
  const source = input && typeof input === 'object' ? input : {};
  const position = computeGrowthPosition(source.growthPoints, source.stage);
  return {
    growthModelVersion: TREE_GROWTH_MODEL_VERSION,
    ...position,
    structuralGrowth: computeStructuralGrowth(
      position.overallGrowthProgress,
      position.postAncientGrowth
    ),
    visualHealth: computeVisualHealth(source.vitality),
  };
}

module.exports = {
  TREE_GROWTH_MODEL_VERSION,
  TREE_GROWTH_THRESHOLDS,
  TREE_VISUAL_MATURITY_ANCHORS,
  TREE_STAGE_LABELS,
  ANCIENT_GROWTH_POINTS,
  computeGrowthStage,
  computeGrowthPosition,
  computeStructuralGrowth,
  computeVisualHealth,
  computeContinuousTreeGrowth,
};
