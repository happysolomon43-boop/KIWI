import {
  clamp01,
  partialCubic,
  segmentGrowthProgress,
} from './vine-geometry.mjs';
import { normalizeVineRenderState } from './vine-render-state.mjs';

const WOOD_COLORS = Object.freeze({
  young: 0x6f8f45,
  mid: 0x795437,
  mature: 0x5b3b27,
  deep: 0x3b261b,
});

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

function segmentWidth(segment, structure) {
  switch (segment.kind) {
    case 'leader':
      return 0.006 + 0.034 * structure.baseStemThickness;
    case 'cordon':
      return 0.005 + 0.024 * structure.cordonThickness;
    case 'secondary':
      return 0.0035 + 0.014 * (0.55 * structure.woodyMaturity + 0.45 * structure.lateralShootDevelopment);
    case 'lateral':
    default:
      return 0.0028 + 0.0105 * (0.35 * structure.woodyMaturity + 0.65 * structure.lateralShootDevelopment);
  }
}

function woodColor(structure, segment) {
  const maturity = structure.woodyMaturity;
  const youngToMid = mixColor(WOOD_COLORS.young, WOOD_COLORS.mid, clamp01(maturity * 1.8));
  const midToMature = mixColor(WOOD_COLORS.mid, WOOD_COLORS.mature, clamp01((maturity - 0.35) / 0.5));
  let color = maturity < 0.35 ? youngToMid : midToMature;
  if (segment.kind === 'leader' || segment.kind === 'cordon') {
    color = mixColor(color, WOOD_COLORS.deep, clamp01((maturity - 0.72) / 0.28) * 0.35);
  }
  return color;
}

export function buildStructurePlan(blueprint, inputState, profileName = 'desktop') {
  const state = normalizeVineRenderState(inputState);
  const profile =
    blueprint.compositionProfiles?.[profileName] ||
    blueprint.compositionProfiles?.desktop ||
    {};
  const suppressed = new Set(profile.suppressSegments || []);
  const allowedKinds = new Set(profile.visibleSegmentKinds || []);

  const trellis = blueprint.trellis.members.map((member) => ({
    ...member,
    alpha: member.role === 'brace' ? 0.72 : 0.86,
  }));

  const segments = [];
  const progressById = Object.create(null);

  for (const segment of blueprint.vineSegments) {
    if (suppressed.has(segment.id)) {
      progressById[segment.id] = 0;
      continue;
    }
    if (allowedKinds.size && !allowedKinds.has(segment.kind)) {
      progressById[segment.id] = 0;
      continue;
    }

    let progress = segmentGrowthProgress(segment, state.overallGrowthProgress);
    if (segment.kind === 'leader') {
      progress = Math.min(progress, state.vineStructure.mainStemReach);
    } else if (segment.kind === 'cordon') {
      progress = Math.min(progress, state.vineStructure.cordonReach);
    } else {
      progress = Math.min(
        progress,
        Math.max(
          state.vineStructure.lateralShootDevelopment,
          state.vineStructure.vineComplexity * 0.82
        )
      );
    }

    progress = clamp01(progress);
    progressById[segment.id] = progress;
    if (progress <= 0.001) continue;

    segments.push({
      id: segment.id,
      kind: segment.kind,
      parentId: segment.parentId,
      progress,
      curve: partialCubic(segment, progress),
      sourceCurve: segment,
      width: segmentWidth(segment, state.vineStructure),
      color: woodColor(state.vineStructure, segment),
      alpha: 0.82 + 0.18 * state.vineStructure.woodyMaturity,
      tipActive: progress < 0.995,
    });
  }

  return {
    state,
    profileName,
    trellis,
    segments,
    progressById,
    roots: {
      strength: state.vineStructure.rootEstablishment,
      baseThickness: state.vineStructure.baseStemThickness,
    },
    ground: {
      alpha: 0.22 + state.vineStructure.rootEstablishment * 0.18,
      spread: 0.05 + state.vineStructure.rootEstablishment * 0.08,
    },
  };
}
