'use strict';

const VINE_GROWTH_MODEL_VERSION = 3;

const VINE_GROWTH_THRESHOLDS = Object.freeze([
  Object.freeze({ stage: 1, growthPoints: 0, label: 'SEEDLING' }),
  Object.freeze({ stage: 2, growthPoints: 25, label: 'SPROUT' }),
  Object.freeze({ stage: 3, growthPoints: 100, label: 'SAPLING' }),
  Object.freeze({ stage: 4, growthPoints: 300, label: 'YOUNG TREE' }),
  Object.freeze({ stage: 5, growthPoints: 700, label: 'THRIVING' }),
  Object.freeze({ stage: 6, growthPoints: 1200, label: 'BLOOMING' }),
  Object.freeze({ stage: 7, growthPoints: 2000, label: 'MATURE' }),
  Object.freeze({ stage: 8, growthPoints: 3000, label: 'ANCIENT' }),
]);

// KIWI keeps the existing milestone names for product continuity, but the
// biological model beneath those labels is a trained woody kiwifruit vine.
const VINE_VISUAL_MATURITY_ANCHORS = Object.freeze([
  Object.freeze({ stage: 1, progress: 0.00 }),
  Object.freeze({ stage: 2, progress: 0.12 }),
  Object.freeze({ stage: 3, progress: 0.26 }),
  Object.freeze({ stage: 4, progress: 0.43 }),
  Object.freeze({ stage: 5, progress: 0.61 }),
  Object.freeze({ stage: 6, progress: 0.75 }),
  Object.freeze({ stage: 7, progress: 0.89 }),
  Object.freeze({ stage: 8, progress: 1.00 }),
]);

const VINE_STAGE_LABELS = Object.freeze([
  '',
  ...VINE_GROWTH_THRESHOLDS.map((item) => item.label),
]);

const ANCIENT_GROWTH_POINTS =
  VINE_GROWTH_THRESHOLDS[VINE_GROWTH_THRESHOLDS.length - 1].growthPoints;

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
  return Math.floor(clamp(value, 1, VINE_GROWTH_THRESHOLDS.length));
}

function computeGrowthStage(growthPoints) {
  const points = Math.max(0, finiteNumber(growthPoints, 0));
  let stage = 1;
  for (const threshold of VINE_GROWTH_THRESHOLDS) {
    if (points >= threshold.growthPoints) stage = threshold.stage;
  }
  return stage;
}

function getThresholdForStage(stage) {
  return VINE_GROWTH_THRESHOLDS[normalizeStage(stage) - 1];
}

function getMaturityAnchor(stage) {
  return VINE_VISUAL_MATURITY_ANCHORS[normalizeStage(stage) - 1];
}

function buildNextStage(stage, growthPoints) {
  const normalizedStage = normalizeStage(stage);
  if (normalizedStage >= VINE_GROWTH_THRESHOLDS.length) return null;

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
  const stageFloor = normalizeStage(
    persistedStage == null ? earnedStage : persistedStage
  );

  // Persisted maturity is a floor: state inconsistencies can never visually
  // rewind a woody vine to an earlier biological structure.
  const stage = Math.max(stageFloor, earnedStage);
  const currentThreshold = getThresholdForStage(stage);
  const currentAnchor = getMaturityAnchor(stage);

  if (stage >= VINE_GROWTH_THRESHOLDS.length) {
    const excess = Math.max(0, points - ANCIENT_GROWTH_POINTS);
    const postAncientGrowth =
      excess <= 0 ? 0 : excess / (excess + ANCIENT_GROWTH_POINTS);

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
  const interval = Math.max(
    1,
    nextThreshold.growthPoints - currentThreshold.growthPoints
  );
  const pointsIntoStage = clamp(
    points - currentThreshold.growthPoints,
    0,
    interval
  );
  const growthProgress = clamp01(pointsIntoStage / interval);

  // Zero-velocity interpolation at both ends means milestone labels may change
  // while the visible woody structure remains continuous.
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
    pointsToNextStage: Math.max(
      0,
      Math.ceil(nextThreshold.growthPoints - points)
    ),
    nextStage: buildNextStage(stage, points),
  };
}

/**
 * Permanent kiwifruit-vine morphology.
 *
 * These values describe a trained woody climber, not a freestanding tree.
 * All outputs are normalized 0..1 and depend only on permanent growth.
 */
function computeVineStructure(overallGrowthProgress, postAncientGrowth) {
  const p = clamp01(overallGrowthProgress);
  const ancient = clamp01(postAncientGrowth);

  // The root system and vertical leader establish first.
  const rootEstablishment = clamp01(
    0.08 + 0.84 * Math.pow(p, 0.60) + 0.08 * ancient
  );
  const mainStemReach = clamp01(
    0.06 + 0.88 * (1 - Math.pow(1 - p, 1.75)) + 0.06 * ancient
  );
  const baseStemThickness = clamp01(
    0.025 + 0.90 * Math.pow(p, 0.76) + 0.075 * ancient
  );

  // Woody permanence emerges after the young leader has established.
  const woodyMaturity = clamp01(
    0.95 * smoothstep(0.18, 0.96, p) + 0.05 * ancient
  );

  // Trained horizontal arms (cordons) establish after the main stem has reached
  // its support. Thickness lags slightly behind reach.
  const cordonReach = clamp01(
    smoothstep(0.13, 0.88, p)
  );
  const cordonThickness = clamp01(
    0.02 +
      0.92 * Math.pow(smoothstep(0.17, 1.00, p), 0.82) +
      0.06 * ancient
  );

  // Fruiting laterals and twining shoots multiply progressively along cordons.
  const lateralShootDevelopment = clamp01(
    smoothstep(0.22, 0.92, p)
  );
  const vineComplexity = clamp01(
    0.96 * Math.pow(smoothstep(0.18, 1.00, p), 0.80) +
      0.04 * ancient
  );

  // Foliage capacity tracks usable shoot network, not a generic tree canopy.
  const foliageCapacity = clamp01(
    0.04 + 0.92 * smoothstep(0.08, 0.94, p) + 0.04 * ancient
  );

  // Reproductive capacity emerges only after substantial woody development.
  const floweringCapacity = clamp01(
    smoothstep(0.48, 0.80, p)
  );
  const fruitingCapacity = clamp01(
    smoothstep(0.57, 0.89, p)
  );

  return {
    rootEstablishment: round4(rootEstablishment),
    baseStemThickness: round4(baseStemThickness),
    woodyMaturity: round4(woodyMaturity),
    mainStemReach: round4(mainStemReach),
    cordonReach: round4(cordonReach),
    cordonThickness: round4(cordonThickness),
    lateralShootDevelopment: round4(lateralShootDevelopment),
    vineComplexity: round4(vineComplexity),
    foliageCapacity: round4(foliageCapacity),
    floweringCapacity: round4(floweringCapacity),
    fruitingCapacity: round4(fruitingCapacity),
  };
}

/**
 * Reversible current condition. Vitality can change these values in either
 * direction without changing permanent woody structure.
 */
function computeVineHealth(vitality) {
  const v = clamp(vitality, 0, 100) / 100;

  const leafDensity = clamp01(
    0.12 + 0.88 * smoothstep(0.05, 0.90, v)
  );
  const leafRetention = clamp01(
    0.08 + 0.92 * smoothstep(0.08, 0.90, v)
  );
  const leafDroop = clamp01(
    1 - smoothstep(0.20, 0.78, v)
  );
  const leafSaturation = clamp01(
    0.35 + 0.65 * Math.pow(v, 0.72)
  );
  const movementStrength = clamp01(
    0.16 + 0.84 * smoothstep(0.15, 0.90, v)
  );
  const shootVigor = clamp01(
    0.10 + 0.90 * smoothstep(0.18, 0.92, v)
  );
  const flowerVigor = clamp01(
    smoothstep(0.62, 0.96, v)
  );
  const stress = round4(1 - v);

  return {
    leafDensity: round4(leafDensity),
    leafRetention: round4(leafRetention),
    leafDroop: round4(leafDroop),
    leafSaturation: round4(leafSaturation),
    movementStrength: round4(movementStrength),
    shootVigor: round4(shootVigor),
    flowerVigor: round4(flowerVigor),
    stress,
  };
}

function computeContinuousVineGrowth(input) {
  const source = input && typeof input === 'object' ? input : {};
  const position = computeGrowthPosition(source.growthPoints, source.stage);
  const vineStructure = computeVineStructure(
    position.overallGrowthProgress,
    position.postAncientGrowth
  );
  const vineHealth = computeVineHealth(source.vitality);

  return {
    growthModelVersion: VINE_GROWTH_MODEL_VERSION,
    ...position,
    vineStructure,
    vineHealth,
  };
}

module.exports = {
  VINE_GROWTH_MODEL_VERSION,
  VINE_GROWTH_THRESHOLDS,
  VINE_VISUAL_MATURITY_ANCHORS,
  VINE_STAGE_LABELS,
  ANCIENT_GROWTH_POINTS,
  computeGrowthStage,
  computeGrowthPosition,
  computeVineStructure,
  computeVineHealth,
  computeContinuousVineGrowth,
};
