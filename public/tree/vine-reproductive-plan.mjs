import {
  clamp01,
  cubicAngle,
  cubicPoint,
  cubicTangent,
  deterministicRange,
  deterministicUnit,
} from './vine-geometry.mjs';
import { normalizeVineRenderState } from './vine-render-state.mjs';

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function buildZoneCandidates(blueprint) {
  const segmentById = new Map(
    blueprint.vineSegments.map((segment) => [segment.id, segment])
  );
  const flowers = [];
  const fruits = [];

  for (const zone of blueprint.reproductiveZones) {
    const segment = segmentById.get(zone.segmentId);
    if (!segment) continue;

    const flowerCount = Math.max(3, zone.maxVisibleClusters * 2);
    for (let index = 0; index < flowerCount; index += 1) {
      const id = 'flower:' + zone.id + ':' + index;
      const span = zone.tRange[1] - zone.tRange[0];
      const baseT =
        zone.tRange[0] +
        span * ((index + 0.5) / flowerCount);
      const t = Math.min(
        zone.tRange[1],
        Math.max(
          zone.tRange[0],
          baseT + deterministicRange(id + ':jitter', -0.035, 0.035)
        )
      );
      const point = cubicPoint(segment, t);
      const tangent = cubicTangent(segment, t);
      const side = deterministicUnit(id + ':side') < 0.5 ? -1 : 1;
      const normal = { x: -tangent.y * side, y: tangent.x * side };
      const offset = deterministicRange(id + ':offset', 0.006, 0.014);

      flowers.push({
        id,
        zoneId: zone.id,
        segmentId: zone.segmentId,
        t,
        attach: point,
        center: {
          x: point.x + normal.x * offset,
          y: point.y + normal.y * offset,
        },
        activationThreshold: (index + 0.35) / flowerCount,
        phase: deterministicRange(id + ':phase', 0, Math.PI * 2),
        size: deterministicRange(id + ':size', 0.010, 0.016),
        baseRotation:
          cubicAngle(segment, t) +
          side * deterministicRange(id + ':angle', 0.55, 0.95),
        unlockAt: zone.flowerUnlockAt,
      });
    }

    for (let index = 0; index < zone.maxVisibleClusters; index += 1) {
      const id = 'fruit:' + zone.id + ':' + index;
      const span = zone.tRange[1] - zone.tRange[0];
      const baseT =
        zone.tRange[0] +
        span * ((index + 0.5) / zone.maxVisibleClusters);
      const t = Math.min(
        zone.tRange[1],
        Math.max(
          zone.tRange[0],
          baseT + deterministicRange(id + ':jitter', -0.028, 0.028)
        )
      );
      const point = cubicPoint(segment, t);

      fruits.push({
        id,
        zoneId: zone.id,
        segmentId: zone.segmentId,
        t,
        attach: point,
        unlockAt: zone.fruitUnlockAt,
        priority: deterministicUnit(id + ':priority'),
        phase: deterministicRange(id + ':phase', 0, Math.PI * 2),
        sway: deterministicRange(id + ':sway', 0.012, 0.030),
        stemLength: deterministicRange(id + ':stem', 0.020, 0.034),
        size: deterministicRange(id + ':size', 0.012, 0.017),
        spread: deterministicRange(id + ':spread', 0.008, 0.014),
      });
    }
  }

  // Stable global order: fruit is added without relocating existing clusters.
  fruits.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  fruits.forEach((fruit, rank) => {
    fruit.rank = rank;
  });

  return { flowers, fruits };
}

const candidateCache = new Map();

function getCandidates(blueprint) {
  const key = String(blueprint.version);
  if (!candidateCache.has(key)) {
    candidateCache.set(key, buildZoneCandidates(blueprint));
  }
  return candidateCache.get(key);
}

export function buildReproductivePlan(
  blueprint,
  inputState,
  structurePlan,
  profileName = 'desktop'
) {
  const state = normalizeVineRenderState(inputState);
  const rawFruitSignal = Math.max(0, Number(inputState?.fruits) || 0);
  const profile =
    blueprint.compositionProfiles?.[profileName] ||
    blueprint.compositionProfiles?.desktop ||
    {};
  const candidates = getCandidates(blueprint);
  const health = state.vineHealth;
  const maturity = state.overallGrowthProgress;

  const flowerLevel = clamp01(
    state.vineStructure.floweringCapacity * health.flowerVigor
  );

  const flowers = [];
  for (const item of candidates.flowers) {
    const segmentProgress = structurePlan.progressById[item.segmentId] || 0;
    const maturityVisibility = smoothstep(
      item.unlockAt - 0.025,
      item.unlockAt + 0.035,
      maturity
    );
    const growthVisibility = smoothstep(
      item.t - 0.055,
      item.t + 0.018,
      segmentProgress
    );
    const capacityVisibility = smoothstep(
      item.activationThreshold - 0.12,
      item.activationThreshold + 0.045,
      flowerLevel
    );
    const visibility = clamp01(
      maturityVisibility * growthVisibility * capacityVisibility
    );
    if (visibility <= 0.002) continue;

    flowers.push({
      ...item,
      visibility,
      alpha: visibility * (0.48 + 0.50 * health.flowerVigor),
      scale: 0.58 + 0.42 * visibility,
      movementStrength: health.movementStrength * 0.42,
    });
  }

  const cap = Math.max(0, Number(profile.maxVisibleFruitClusters) || 0);
  const capacityLimit = Math.ceil(
    cap * state.vineStructure.fruitingCapacity
  );
  const requestedClusters = Math.min(
    cap,
    capacityLimit,
    rawFruitSignal
  );
  const visibleBase = Math.max(1, Math.floor(requestedClusters || 1));
  const compression =
    requestedClusters > 0
      ? Math.max(1, rawFruitSignal / visibleBase)
      : 1;
  const clusterSize = Math.min(3, Math.max(1, Math.ceil(compression)));

  const fruits = [];
  for (const item of candidates.fruits) {
    if (item.rank >= cap) continue;

    const segmentProgress = structurePlan.progressById[item.segmentId] || 0;
    const maturityVisibility = smoothstep(
      item.unlockAt - 0.025,
      item.unlockAt + 0.040,
      maturity
    );
    const growthVisibility = smoothstep(
      item.t - 0.050,
      item.t + 0.018,
      segmentProgress
    );
    const countVisibility = smoothstep(
      item.rank + 0.10,
      item.rank + 0.92,
      requestedClusters
    );
    const visibility = clamp01(
      maturityVisibility * growthVisibility * countVisibility
    );
    if (visibility <= 0.002) continue;

    fruits.push({
      ...item,
      visibility,
      alpha: 0.72 + 0.28 * visibility,
      scale: 0.62 + 0.38 * visibility,
      clusterSize,
      movementStrength: health.movementStrength * 0.30,
    });
  }

  return {
    flowerLevel,
    requestedClusters,
    flowers,
    fruits,
  };
}

export function clearReproductiveCandidateCacheForTests() {
  candidateCache.clear();
}
