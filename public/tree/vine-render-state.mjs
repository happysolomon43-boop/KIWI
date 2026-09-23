import { clamp01 } from './vine-geometry.mjs';

const MATURITY_ANCHORS = [0, 0.00, 0.12, 0.26, 0.43, 0.61, 0.75, 0.89, 1.00];

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function vitalityFallback(vitality) {
  const v = Math.min(100, Math.max(0, finite(vitality, 100))) / 100;
  return {
    leafDensity: 0.12 + 0.88 * v,
    leafRetention: 0.08 + 0.92 * v,
    leafDroop: 1 - v,
    leafSaturation: 0.35 + 0.65 * Math.pow(v, 0.72),
    movementStrength: 0.16 + 0.84 * v,
    shootVigor: 0.10 + 0.90 * v,
    flowerVigor: Math.max(0, (v - 0.62) / 0.38),
    stress: 1 - v,
  };
}

function structureFallback(_source, maturity) {
  const p = clamp01(maturity);
  return {
    rootEstablishment: clamp01(0.08 + 0.92 * Math.pow(p, 0.60)),
    baseStemThickness: clamp01(0.025 + 0.975 * Math.pow(p, 0.76)),
    woodyMaturity: clamp01(Math.max(0, (p - 0.18) / 0.78)),
    mainStemReach: clamp01(0.06 + 0.94 * (1 - Math.pow(1 - p, 1.75))),
    cordonReach: clamp01(Math.max(0, (p - 0.13) / 0.75)),
    cordonThickness: clamp01(0.02 + 0.98 * Math.max(0, (p - 0.17) / 0.83)),
    lateralShootDevelopment: clamp01(Math.max(0, (p - 0.22) / 0.70)),
    vineComplexity: clamp01(Math.max(0, (p - 0.18) / 0.82)),
    foliageCapacity: clamp01(0.04 + 0.96 * Math.max(0, (p - 0.08) / 0.86)),
    floweringCapacity: clamp01(Math.max(0, (p - 0.48) / 0.32)),
    fruitingCapacity: clamp01(Math.max(0, (p - 0.57) / 0.32)),
  };
}

export function normalizeVineRenderState(input = {}) {
  const stage = Math.min(8, Math.max(1, Math.floor(finite(input.stage, 1))));
  const fallbackMaturity = MATURITY_ANCHORS[stage] || 0;
  const maturity = clamp01(finite(input.overallGrowthProgress, fallbackMaturity));
  const vitality = Math.min(100, Math.max(0, finite(input.vitality ?? input.health, 100)));

  const healthSource = input.vineHealth || null;
  const healthFallback = vitalityFallback(vitality);
  const vineHealth = {
    leafDensity: clamp01(finite(healthSource?.leafDensity, healthFallback.leafDensity)),
    leafRetention: clamp01(finite(healthSource?.leafRetention, healthFallback.leafRetention)),
    leafDroop: clamp01(finite(healthSource?.leafDroop, healthFallback.leafDroop)),
    leafSaturation: clamp01(finite(healthSource?.leafSaturation, healthFallback.leafSaturation)),
    movementStrength: clamp01(finite(healthSource?.movementStrength, healthFallback.movementStrength)),
    shootVigor: clamp01(finite(healthSource?.shootVigor, healthFallback.shootVigor)),
    flowerVigor: clamp01(finite(healthSource?.flowerVigor, healthFallback.flowerVigor)),
    stress: clamp01(finite(healthSource?.stress, healthFallback.stress)),
  };

  const vineStructure = input.vineStructure
    ? Object.fromEntries(
        Object.entries(structureFallback(input, maturity)).map(([key, fallback]) => [
          key,
          clamp01(finite(input.vineStructure[key], fallback)),
        ])
      )
    : structureFallback(input, maturity);

  return {
    schemaVersion: finite(input.schemaVersion, 0),
    stage,
    stageLabel: String(input.stageLabel || ''),
    growthPoints: Math.max(0, Math.floor(finite(input.growthPoints, 0))),
    overallGrowthProgress: maturity,
    postAncientGrowth: clamp01(finite(input.postAncientGrowth, 0)),
    vitality,
    vineStructure,
    vineHealth,
    fruits: Math.max(0, Math.floor(finite(input.fruits, 0))),
    rings: Math.max(0, Math.floor(finite(input.rings, 0))),
  };
}

export function interpolateVineRenderState(fromInput, toInput, progress) {
  const from = normalizeVineRenderState(fromInput);
  const to = normalizeVineRenderState(toInput);
  const t = clamp01(progress);
  const mix = (a, b) => a + (b - a) * t;

  const vineStructure = {};
  for (const key of Object.keys(to.vineStructure)) {
    vineStructure[key] = mix(from.vineStructure[key] ?? 0, to.vineStructure[key]);
  }

  const vineHealth = {};
  for (const key of Object.keys(to.vineHealth)) {
    vineHealth[key] = mix(from.vineHealth[key] ?? 0, to.vineHealth[key]);
  }

  return {
    ...to,
    overallGrowthProgress: mix(from.overallGrowthProgress, to.overallGrowthProgress),
    postAncientGrowth: mix(from.postAncientGrowth, to.postAncientGrowth),
    vitality: mix(from.vitality, to.vitality),
    vineStructure,
    vineHealth,
    fruits: mix(from.fruits, to.fruits),
    rings: Math.round(mix(from.rings, to.rings)),
  };
}
