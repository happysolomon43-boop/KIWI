'use strict';

/**
 * KIWI Phase 5 renderer-neutral visual blueprint.
 *
 * Coordinates are normalized to the local vine scene:
 *   x: 0 = left edge, 1 = right edge
 *   y: 0 = top edge, 1 = bottom edge
 *
 * This file deliberately contains no PixiJS code. It is the stable visual
 * contract that a future renderer consumes.
 */

const VINE_BLUEPRINT_VERSION = 1;

const DEPTH_LAYERS = Object.freeze({
  BACKDROP: 0,
  REAR_FOLIAGE: 10,
  TRELLIS_REAR: 20,
  WOODY_VINE: 30,
  FOLIAGE: 40,
  FLOWERS: 50,
  FRUIT: 60,
  FOREGROUND_FOLIAGE: 70,
  AMBIENT: 80,
});

const TRELLIS = Object.freeze({
  style: 'warm-minimal-wood',
  bounds: Object.freeze({ x: 0.09, y: 0.16, width: 0.82, height: 0.68 }),
  members: Object.freeze([
    Object.freeze({
      id: 'post-left',
      role: 'post',
      from: Object.freeze({ x: 0.15, y: 0.22 }),
      to: Object.freeze({ x: 0.15, y: 0.84 }),
      thickness: 0.026,
      depth: DEPTH_LAYERS.TRELLIS_REAR,
    }),
    Object.freeze({
      id: 'post-center',
      role: 'post',
      from: Object.freeze({ x: 0.50, y: 0.22 }),
      to: Object.freeze({ x: 0.50, y: 0.84 }),
      thickness: 0.024,
      depth: DEPTH_LAYERS.TRELLIS_REAR,
    }),
    Object.freeze({
      id: 'post-right',
      role: 'post',
      from: Object.freeze({ x: 0.85, y: 0.22 }),
      to: Object.freeze({ x: 0.85, y: 0.84 }),
      thickness: 0.026,
      depth: DEPTH_LAYERS.TRELLIS_REAR,
    }),
    Object.freeze({
      id: 'beam-top',
      role: 'beam',
      from: Object.freeze({ x: 0.10, y: 0.23 }),
      to: Object.freeze({ x: 0.90, y: 0.23 }),
      thickness: 0.030,
      depth: DEPTH_LAYERS.TRELLIS_REAR,
    }),
    Object.freeze({
      id: 'beam-cordon',
      role: 'beam',
      from: Object.freeze({ x: 0.12, y: 0.34 }),
      to: Object.freeze({ x: 0.88, y: 0.34 }),
      thickness: 0.018,
      depth: DEPTH_LAYERS.TRELLIS_REAR,
    }),
    Object.freeze({
      id: 'brace-left',
      role: 'brace',
      from: Object.freeze({ x: 0.15, y: 0.38 }),
      to: Object.freeze({ x: 0.30, y: 0.23 }),
      thickness: 0.014,
      depth: DEPTH_LAYERS.TRELLIS_REAR,
    }),
    Object.freeze({
      id: 'brace-right',
      role: 'brace',
      from: Object.freeze({ x: 0.85, y: 0.38 }),
      to: Object.freeze({ x: 0.70, y: 0.23 }),
      thickness: 0.014,
      depth: DEPTH_LAYERS.TRELLIS_REAR,
    }),
  ]),
});

const VINE_SEGMENTS = Object.freeze([
  Object.freeze({
    id: 'leader-main',
    parentId: null,
    kind: 'leader',
    unlockAt: 0.00,
    completeAt: 0.24,
    from: Object.freeze({ x: 0.50, y: 0.88 }),
    c1: Object.freeze({ x: 0.47, y: 0.72 }),
    c2: Object.freeze({ x: 0.54, y: 0.50 }),
    to: Object.freeze({ x: 0.50, y: 0.32 }),
    thicknessRole: 'base-to-leader',
  }),
  Object.freeze({
    id: 'cordon-left',
    parentId: 'leader-main',
    kind: 'cordon',
    unlockAt: 0.16,
    completeAt: 0.62,
    from: Object.freeze({ x: 0.50, y: 0.32 }),
    c1: Object.freeze({ x: 0.42, y: 0.29 }),
    c2: Object.freeze({ x: 0.28, y: 0.31 }),
    to: Object.freeze({ x: 0.13, y: 0.30 }),
    thicknessRole: 'cordon',
  }),
  Object.freeze({
    id: 'cordon-right',
    parentId: 'leader-main',
    kind: 'cordon',
    unlockAt: 0.16,
    completeAt: 0.62,
    from: Object.freeze({ x: 0.50, y: 0.32 }),
    c1: Object.freeze({ x: 0.58, y: 0.29 }),
    c2: Object.freeze({ x: 0.72, y: 0.31 }),
    to: Object.freeze({ x: 0.87, y: 0.30 }),
    thicknessRole: 'cordon',
  }),

  Object.freeze({
    id: 'lateral-l1',
    parentId: 'cordon-left',
    kind: 'lateral',
    unlockAt: 0.28,
    completeAt: 0.48,
    from: Object.freeze({ x: 0.42, y: 0.31 }),
    c1: Object.freeze({ x: 0.39, y: 0.40 }),
    c2: Object.freeze({ x: 0.35, y: 0.48 }),
    to: Object.freeze({ x: 0.31, y: 0.55 }),
    thicknessRole: 'lateral',
  }),
  Object.freeze({
    id: 'lateral-l2',
    parentId: 'cordon-left',
    kind: 'lateral',
    unlockAt: 0.34,
    completeAt: 0.56,
    from: Object.freeze({ x: 0.32, y: 0.30 }),
    c1: Object.freeze({ x: 0.28, y: 0.38 }),
    c2: Object.freeze({ x: 0.22, y: 0.48 }),
    to: Object.freeze({ x: 0.18, y: 0.61 }),
    thicknessRole: 'lateral',
  }),
  Object.freeze({
    id: 'lateral-l3',
    parentId: 'cordon-left',
    kind: 'lateral',
    unlockAt: 0.42,
    completeAt: 0.66,
    from: Object.freeze({ x: 0.24, y: 0.30 }),
    c1: Object.freeze({ x: 0.20, y: 0.25 }),
    c2: Object.freeze({ x: 0.16, y: 0.21 }),
    to: Object.freeze({ x: 0.12, y: 0.18 }),
    thicknessRole: 'lateral',
  }),
  Object.freeze({
    id: 'lateral-l4',
    parentId: 'cordon-left',
    kind: 'lateral',
    unlockAt: 0.55,
    completeAt: 0.78,
    from: Object.freeze({ x: 0.16, y: 0.30 }),
    c1: Object.freeze({ x: 0.11, y: 0.38 }),
    c2: Object.freeze({ x: 0.08, y: 0.48 }),
    to: Object.freeze({ x: 0.08, y: 0.58 }),
    thicknessRole: 'lateral',
  }),

  Object.freeze({
    id: 'lateral-r1',
    parentId: 'cordon-right',
    kind: 'lateral',
    unlockAt: 0.28,
    completeAt: 0.48,
    from: Object.freeze({ x: 0.58, y: 0.31 }),
    c1: Object.freeze({ x: 0.61, y: 0.40 }),
    c2: Object.freeze({ x: 0.65, y: 0.48 }),
    to: Object.freeze({ x: 0.69, y: 0.55 }),
    thicknessRole: 'lateral',
  }),
  Object.freeze({
    id: 'lateral-r2',
    parentId: 'cordon-right',
    kind: 'lateral',
    unlockAt: 0.34,
    completeAt: 0.56,
    from: Object.freeze({ x: 0.68, y: 0.30 }),
    c1: Object.freeze({ x: 0.72, y: 0.38 }),
    c2: Object.freeze({ x: 0.78, y: 0.48 }),
    to: Object.freeze({ x: 0.82, y: 0.61 }),
    thicknessRole: 'lateral',
  }),
  Object.freeze({
    id: 'lateral-r3',
    parentId: 'cordon-right',
    kind: 'lateral',
    unlockAt: 0.42,
    completeAt: 0.66,
    from: Object.freeze({ x: 0.76, y: 0.30 }),
    c1: Object.freeze({ x: 0.80, y: 0.25 }),
    c2: Object.freeze({ x: 0.84, y: 0.21 }),
    to: Object.freeze({ x: 0.88, y: 0.18 }),
    thicknessRole: 'lateral',
  }),
  Object.freeze({
    id: 'lateral-r4',
    parentId: 'cordon-right',
    kind: 'lateral',
    unlockAt: 0.55,
    completeAt: 0.78,
    from: Object.freeze({ x: 0.84, y: 0.30 }),
    c1: Object.freeze({ x: 0.89, y: 0.38 }),
    c2: Object.freeze({ x: 0.92, y: 0.48 }),
    to: Object.freeze({ x: 0.92, y: 0.58 }),
    thicknessRole: 'lateral',
  }),

  Object.freeze({
    id: 'secondary-lower-left',
    parentId: 'leader-main',
    kind: 'secondary',
    unlockAt: 0.50,
    completeAt: 0.82,
    from: Object.freeze({ x: 0.49, y: 0.48 }),
    c1: Object.freeze({ x: 0.43, y: 0.52 }),
    c2: Object.freeze({ x: 0.37, y: 0.60 }),
    to: Object.freeze({ x: 0.32, y: 0.70 }),
    thicknessRole: 'secondary',
  }),
  Object.freeze({
    id: 'secondary-lower-right',
    parentId: 'leader-main',
    kind: 'secondary',
    unlockAt: 0.50,
    completeAt: 0.82,
    from: Object.freeze({ x: 0.51, y: 0.48 }),
    c1: Object.freeze({ x: 0.57, y: 0.52 }),
    c2: Object.freeze({ x: 0.63, y: 0.60 }),
    to: Object.freeze({ x: 0.68, y: 0.70 }),
    thicknessRole: 'secondary',
  }),
]);

const FOLIAGE_ZONES = Object.freeze([
  Object.freeze({
    id: 'crown-left',
    segments: Object.freeze(['cordon-left','lateral-l1','lateral-l2','lateral-l3']),
    bounds: Object.freeze({ x: 0.10, y: 0.16, width: 0.40, height: 0.46 }),
    densityWeight: 1.00,
    depthBias: 'mixed',
  }),
  Object.freeze({
    id: 'crown-right',
    segments: Object.freeze(['cordon-right','lateral-r1','lateral-r2','lateral-r3']),
    bounds: Object.freeze({ x: 0.50, y: 0.16, width: 0.40, height: 0.46 }),
    densityWeight: 1.00,
    depthBias: 'mixed',
  }),
  Object.freeze({
    id: 'lower-center',
    segments: Object.freeze(['leader-main','secondary-lower-left','secondary-lower-right']),
    bounds: Object.freeze({ x: 0.28, y: 0.42, width: 0.44, height: 0.34 }),
    densityWeight: 0.72,
    depthBias: 'front',
  }),
]);

const REPRODUCTIVE_ZONES = Object.freeze([
  Object.freeze({
    id: 'fruit-left-inner',
    segmentId: 'lateral-l1',
    tRange: Object.freeze([0.44, 0.82]),
    flowerUnlockAt: 0.54,
    fruitUnlockAt: 0.63,
    maxVisibleClusters: 3,
  }),
  Object.freeze({
    id: 'fruit-left-outer',
    segmentId: 'lateral-l2',
    tRange: Object.freeze([0.34, 0.76]),
    flowerUnlockAt: 0.60,
    fruitUnlockAt: 0.69,
    maxVisibleClusters: 2,
  }),
  Object.freeze({
    id: 'fruit-right-inner',
    segmentId: 'lateral-r1',
    tRange: Object.freeze([0.44, 0.82]),
    flowerUnlockAt: 0.54,
    fruitUnlockAt: 0.63,
    maxVisibleClusters: 3,
  }),
  Object.freeze({
    id: 'fruit-right-outer',
    segmentId: 'lateral-r2',
    tRange: Object.freeze([0.34, 0.76]),
    flowerUnlockAt: 0.60,
    fruitUnlockAt: 0.69,
    maxVisibleClusters: 2,
  }),
  Object.freeze({
    id: 'fruit-center-left',
    segmentId: 'secondary-lower-left',
    tRange: Object.freeze([0.42, 0.78]),
    flowerUnlockAt: 0.68,
    fruitUnlockAt: 0.76,
    maxVisibleClusters: 2,
  }),
  Object.freeze({
    id: 'fruit-center-right',
    segmentId: 'secondary-lower-right',
    tRange: Object.freeze([0.42, 0.78]),
    flowerUnlockAt: 0.68,
    fruitUnlockAt: 0.76,
    maxVisibleClusters: 2,
  }),
]);

const LOCAL_EXIT_SOCKETS = Object.freeze([
  Object.freeze({
    id: 'exit-left-upper',
    sourceSegmentId: 'lateral-l3',
    point: Object.freeze({ x: 0.08, y: 0.19 }),
    direction: Object.freeze({ x: -1.0, y: -0.08 }),
    minimumMaturity: 0.72,
  }),
  Object.freeze({
    id: 'exit-right-upper',
    sourceSegmentId: 'lateral-r3',
    point: Object.freeze({ x: 0.92, y: 0.19 }),
    direction: Object.freeze({ x: 1.0, y: -0.08 }),
    minimumMaturity: 0.72,
  }),
  Object.freeze({
    id: 'exit-left-mid',
    sourceSegmentId: 'lateral-l4',
    point: Object.freeze({ x: 0.07, y: 0.55 }),
    direction: Object.freeze({ x: -1.0, y: 0.12 }),
    minimumMaturity: 0.82,
  }),
  Object.freeze({
    id: 'exit-right-mid',
    sourceSegmentId: 'lateral-r4',
    point: Object.freeze({ x: 0.93, y: 0.55 }),
    direction: Object.freeze({ x: 1.0, y: 0.12 }),
    minimumMaturity: 0.82,
  }),
]);

const COMPOSITION_PROFILES = Object.freeze({
  desktop: Object.freeze({
    visibleSegmentKinds: Object.freeze(['leader','cordon','lateral','secondary']),
    maxFoliageScale: 1.00,
    maxVisibleFruitClusters: 12,
    allowExitSockets: true,
    safeMargin: 0.055,
  }),
  tablet: Object.freeze({
    visibleSegmentKinds: Object.freeze(['leader','cordon','lateral','secondary']),
    maxFoliageScale: 0.88,
    maxVisibleFruitClusters: 9,
    allowExitSockets: true,
    safeMargin: 0.07,
  }),
  mobile: Object.freeze({
    visibleSegmentKinds: Object.freeze(['leader','cordon','lateral','secondary']),
    suppressSegments: Object.freeze(['lateral-l4','lateral-r4']),
    maxFoliageScale: 0.72,
    maxVisibleFruitClusters: 6,
    allowExitSockets: false,
    safeMargin: 0.09,
  }),
});

const ART_DIRECTION = Object.freeze({
  silhouette: 'wide-trained-vine-with-open-center',
  trellisPresence: 'architectural-but-subordinate',
  woodCharacter: 'warm-rounded-minimal-not-rustic',
  vineCharacter: 'woody-twining-organic-controlled',
  foliageCharacter: 'broad-kiwi-leaves-layered-not-bushy',
  fruitCharacter: 'small-hanging-clusters-never-scattered',
  motionCharacter: 'slow-breathing-sway-with-local-tip-motion',
  lightingCharacter: 'soft-ambient-with-subtle-depth-not-glow-heavy',
  rule: 'structure-first-foliage-second-fruit-last',
});

module.exports = {
  VINE_BLUEPRINT_VERSION,
  DEPTH_LAYERS,
  TRELLIS,
  VINE_SEGMENTS,
  FOLIAGE_ZONES,
  REPRODUCTIVE_ZONES,
  LOCAL_EXIT_SOCKETS,
  COMPOSITION_PROFILES,
  ART_DIRECTION,
};
