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

function mixColor(a, b, t) {
  const p = clamp01(t);
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * p) << 16) |
    (Math.round(ag + (bg - ag) * p) << 8) |
    Math.round(ab + (bb - ab) * p)
  );
}

function blendAngle(from, to, amount) {
  let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * clamp01(amount);
}

function layerForCandidate(zone, seed) {
  const r = deterministicUnit(seed + ':layer');
  if (zone.depthBias === 'front') {
    return r < 0.28 ? 'foregroundFoliage' : 'foliage';
  }
  if (r < 0.27) return 'rearFoliage';
  if (r > 0.82) return 'foregroundFoliage';
  return 'foliage';
}

function candidateCountForSegment(kind, profileName) {
  const base = kind === 'cordon' ? 9 : kind === 'leader' ? 7 : 8;
  if (profileName === 'mobile') return Math.max(4, base - 3);
  if (profileName === 'tablet') return Math.max(5, base - 1);
  return base;
}

function leafColor(health, layer) {
  const muted = 0x7b8050;
  const healthy = layer === 'rearFoliage'
    ? 0x2f704d
    : layer === 'foregroundFoliage'
      ? 0x69a94f
      : 0x4d9152;
  const stressed = 0x887647;
  const saturated = mixColor(muted, healthy, health.leafSaturation);
  return mixColor(saturated, stressed, health.stress * 0.28);
}

function buildCandidates(blueprint, profileName) {
  const segmentById = new Map(
    blueprint.vineSegments.map((segment) => [segment.id, segment])
  );
  const candidates = [];

  for (const zone of blueprint.foliageZones) {
    for (const segmentId of zone.segments) {
      const segment = segmentById.get(segmentId);
      if (!segment) continue;

      const count = candidateCountForSegment(segment.kind, profileName);
      const order = Array.from({ length: count }, (_, index) => ({
        index,
        priority: deterministicUnit(
          'leaf:' + zone.id + ':' + segmentId + ':' + index + ':priority'
        ),
      })).sort((a, b) => a.priority - b.priority);

      const thresholdByIndex = new Map(
        order.map((entry, rank) => [
          entry.index,
          (rank + 0.42) / Math.max(1, count),
        ])
      );

      for (let index = 0; index < count; index += 1) {
        const id = 'leaf:' + zone.id + ':' + segmentId + ':' + index;
        const t = deterministicRange(id + ':t', 0.12, 0.94);
        const tangent = cubicTangent(segment, t);
        const point = cubicPoint(segment, t);
        const side = deterministicUnit(id + ':side') < 0.5 ? -1 : 1;
        const normal = { x: -tangent.y * side, y: tangent.x * side };
        const offset = deterministicRange(id + ':offset', 0.010, 0.024);
        const center = {
          x: point.x + normal.x * offset,
          y: point.y + normal.y * offset,
        };
        const baseAngle =
          cubicAngle(segment, t) +
          side * deterministicRange(id + ':angle-side', 0.78, 1.20) +
          deterministicRange(id + ':jitter', -0.22, 0.22);
        const layer = layerForCandidate(zone, id);

        candidates.push({
          id,
          zoneId: zone.id,
          segmentId,
          segment,
          t,
          attach: point,
          center,
          baseAngle,
          side,
          size: deterministicRange(id + ':size', 0.030, 0.052),
          aspect: deterministicRange(id + ':aspect', 0.76, 0.94),
          activationThreshold:
            (thresholdByIndex.get(index) ?? 1) /
            Math.max(0.62, Number(zone.densityWeight) || 1),
          layer,
          phase: deterministicRange(id + ':phase', 0, Math.PI * 2),
          speed: deterministicRange(id + ':speed', 0.42, 0.78),
          sway: deterministicRange(id + ':sway', 0.018, 0.050),
        });
      }
    }
  }

  return candidates;
}

const candidateCache = new Map();

function getCandidates(blueprint, profileName) {
  const key = String(blueprint.version) + ':' + profileName;
  if (!candidateCache.has(key)) {
    candidateCache.set(key, buildCandidates(blueprint, profileName));
  }
  return candidateCache.get(key);
}

export function buildFoliagePlan(
  blueprint,
  inputState,
  structurePlan,
  profileName = 'desktop'
) {
  const state = normalizeVineRenderState(inputState);
  const profile =
    blueprint.compositionProfiles?.[profileName] ||
    blueprint.compositionProfiles?.desktop ||
    {};
  const candidates = getCandidates(blueprint, profileName);
  const maxFoliageScale = clamp01(Number(profile.maxFoliageScale) || 1);
  const health = state.vineHealth;

  // Capacity is permanent; density and retention are reversible current condition.
  const leafLevel = clamp01(
    state.vineStructure.foliageCapacity *
      maxFoliageScale *
      (0.32 + 0.68 * health.leafDensity) *
      health.leafRetention
  );

  const leaves = [];

  for (const candidate of candidates) {
    const segmentProgress =
      structurePlan.progressById[candidate.segmentId] || 0;
    const growthVisibility = smoothstep(
      candidate.t - 0.07,
      candidate.t + 0.025,
      segmentProgress
    );
    if (growthVisibility <= 0.001) continue;

    const healthVisibility = smoothstep(
      candidate.activationThreshold - 0.10,
      candidate.activationThreshold + 0.035,
      leafLevel
    );
    const visibility = clamp01(growthVisibility * healthVisibility);
    if (visibility <= 0.002) continue;

    const droopedAngle = blendAngle(
      candidate.baseAngle,
      Math.PI / 2,
      health.leafDroop * 0.58
    );
    const droopDistance = candidate.size * health.leafDroop * 0.19;

    leaves.push({
      ...candidate,
      center: {
        x: candidate.center.x,
        y: candidate.center.y + droopDistance,
      },
      rotation: droopedAngle,
      visibility,
      alpha: (0.52 + 0.46 * health.leafRetention) * visibility,
      scale: (0.56 + 0.44 * visibility) * (0.94 + health.shootVigor * 0.06),
      color: leafColor(health, candidate.layer),
      veinColor: mixColor(0x34523a, 0xb2c98a, health.leafSaturation * 0.58),
      movementStrength:
        health.movementStrength * (1 - health.leafDroop * 0.28),
    });
  }

  return {
    leafLevel,
    leaves,
    health,
    candidateCount: candidates.length,
  };
}

export function clearFoliageCandidateCacheForTests() {
  candidateCache.clear();
}
