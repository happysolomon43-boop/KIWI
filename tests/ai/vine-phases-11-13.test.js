'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '../..');
const expansionJson = require('../../public/tree/vine-expansion-map.json');
const expansionServer = require('../../services/vine-expansion-map');
const blueprint = require('../../public/tree/vine-blueprint.json');

async function importModule(relativePath) {
  return import(
    pathToFileURL(path.join(ROOT, relativePath)).href +
      '?phase1113=' +
      Date.now() +
      Math.random()
  );
}

test('Phase 11 browser and backend share one expansion contract', () => {
  assert.equal(expansionJson.version, 2);
  assert.equal(
    expansionServer.VINE_EXPANSION_MAP_VERSION,
    expansionJson.version
  );
  assert.deepEqual(
    expansionServer.ROUTE_EXPANSION_MAP,
    expansionJson.routeExpansionMap
  );
  assert.deepEqual(
    expansionServer.ROUTE_POLICY,
    expansionJson.routePolicy
  );

  assert.equal(
    expansionJson.routeExpansionMap.dashboard.localSceneSelector,
    '#dashboardTree'
  );
  assert.equal(
    expansionJson.routeExpansionMap.biome.localSceneSelector,
    '#biomeTree'
  );
  assert.equal(
    expansionJson.routeExpansionMap.brain.localSceneSelector,
    null
  );
});

test('spillover geometry resolves card edges and local vine sockets deterministically', async () => {
  const {
    edgePoint,
    localSocketPoint,
  } = await importModule(
    'public/tree/vine-expansion-plan.mjs'
  );

  const rect = {
    left: 100,
    top: 50,
    right: 500,
    bottom: 250,
    width: 400,
    height: 200,
  };

  assert.deepEqual(
    edgePoint(rect, 'top-right', 10, null),
    { x: 490, y: 60 }
  );
  assert.deepEqual(
    edgePoint(rect, 'right', 8, 0.25),
    { x: 492, y: 100 }
  );

  const socket =
    blueprint.localExitSockets.find(
      (item) => item.id === 'exit-right-upper'
    );
  const point = localSocketPoint(
    rect,
    socket,
    blueprint.compositionProfiles.desktop
  );

  assert.ok(point.x > rect.left);
  assert.ok(point.x < rect.right);
  assert.ok(point.y > rect.top);
  assert.ok(point.y < rect.bottom);
});

test('spillover paths can detect forbidden UI and route around the page perimeter', async () => {
  const {
    corridorPoints,
    fallbackPerimeterPath,
    pathIntersectsRects,
  } = await importModule(
    'public/tree/vine-expansion-plan.mjs'
  );

  const source = { x: 100, y: 100 };
  const target = { x: 500, y: 400 };
  const bounds = {
    left: 0,
    top: 0,
    right: 700,
    bottom: 600,
    width: 700,
    height: 600,
  };
  const forbidden = [{
    left: 250,
    top: 80,
    right: 470,
    bottom: 450,
    width: 220,
    height: 370,
  }];

  const direct = corridorPoints(
    source,
    target,
    'column-gap',
    bounds,
    14
  );
  assert.equal(
    pathIntersectsRects(direct, forbidden, 0),
    true
  );

  const fallback = fallbackPerimeterPath(
    source,
    target,
    bounds,
    forbidden,
    14
  );

  assert.equal(
    pathIntersectsRects(fallback, forbidden, 0),
    false
  );
});

test('partial spillover growth is monotonic and ends at the declared target', async () => {
  const {
    partialPolyline,
    polylineLength,
  } = await importModule(
    'public/tree/vine-expansion-plan.mjs'
  );

  const pathPoints = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  const quarter = partialPolyline(pathPoints, 0.25);
  const half = partialPolyline(pathPoints, 0.5);
  const full = partialPolyline(pathPoints, 1);

  assert.ok(
    polylineLength(quarter) <
      polylineLength(half)
  );
  assert.ok(
    polylineLength(half) <
      polylineLength(full)
  );
  assert.deepEqual(
    full[full.length - 1],
    { x: 100, y: 100 }
  );
});

test('external decorations remain sparse and fruit-free', async () => {
  const {
    createPathDecorations,
  } = await importModule(
    'public/tree/vine-expansion-plan.mjs'
  );

  const pathPlan = {
    id: 'test-path',
    points: [
      { x: 0, y: 0 },
      { x: 700, y: 0 },
    ],
    leafBudget: 4,
    flowerBudget: 1,
  };

  const decorations = createPathDecorations(
    pathPlan,
    expansionJson.externalVineStyle,
    'test'
  );

  assert.ok(decorations.leaves.length <= 4);
  assert.ok(decorations.flowers.length <= 1);
  assert.equal(
    expansionJson.externalVineStyle.fruitAllowed,
    false
  );
  assert.equal(
    expansionJson.externalVineStyle.pointerEvents,
    'none'
  );
});

test('Phase 12 reaction planner derives growth, milestone, recovery, fruit and streak events', async () => {
  const {
    deriveTreeReactions,
    strongestTreeReaction,
  } = await importModule(
    'public/tree/tree-reaction-plan.mjs'
  );

  const previous = {
    growthPoints: 690,
    stage: 4,
    vitality: 52,
    fruits: 1,
    rings: 1,
    milestones: [7],
    vineStructure: {
      floweringCapacity: 0.05,
    },
    vineHealth: {
      flowerVigor: 0.1,
    },
  };

  const next = {
    growthPoints: 720,
    stage: 5,
    vitality: 67,
    fruits: 3,
    rings: 2,
    milestones: [7, 30],
    vineStructure: {
      floweringCapacity: 0.22,
    },
    vineHealth: {
      flowerVigor: 0.42,
    },
  };

  const reactions =
    deriveTreeReactions(previous, next);
  const types = new Set(
    reactions.map((reaction) => reaction.type)
  );

  for (const type of [
    'growth',
    'milestone',
    'recovery',
    'fruit-set',
    'streak-root',
    'bloom',
  ]) {
    assert.equal(
      types.has(type),
      true,
      'missing reaction ' + type
    );
  }

  assert.equal(
    strongestTreeReaction(reactions).type,
    'milestone'
  );
});

test('stress changes never masquerade as permanent growth reactions', async () => {
  const {
    deriveTreeReactions,
  } = await importModule(
    'public/tree/tree-reaction-plan.mjs'
  );

  const reactions = deriveTreeReactions(
    {
      growthPoints: 1200,
      stage: 6,
      vitality: 80,
      fruits: 4,
      milestones: [7, 30],
      rings: 2,
    },
    {
      growthPoints: 1200,
      stage: 6,
      vitality: 55,
      fruits: 4,
      milestones: [7, 30],
      rings: 2,
    }
  );

  assert.deepEqual(
    reactions.map((reaction) => reaction.type),
    ['stress-settle']
  );
});

test('tree-state channel replays only recent reactions that still match current state', async () => {
  const channel = await importModule(
    'public/tree/tree-state-channel.mjs'
  );
  channel.resetTreeStateChannel();

  channel.publishTreeState(
    {
      growthPoints: 100,
      stage: 3,
      vitality: 70,
      fruits: 0,
      milestones: [],
      rings: 0,
    },
    { silent: true, source: 'baseline' }
  );

  channel.publishTreeState(
    {
      growthPoints: 130,
      stage: 3,
      vitality: 78,
      fruits: 0,
      milestones: [],
      rings: 0,
    },
    { source: 'study-session-complete' }
  );

  let replay = null;
  const unsubscribe = channel.subscribeTreeState(
    (event) => {
      replay = event;
    },
    {
      emitCurrent: true,
      emitRecentReactions: true,
      consumeRecentReactions: true,
      reactionTtlMs: 60000,
    }
  );

  assert.ok(replay);
  assert.equal(replay.source, 'recent-reaction');
  assert.ok(
    replay.reactions.some(
      (reaction) => reaction.type === 'growth'
    )
  );
  assert.ok(
    replay.reactions.some(
      (reaction) => reaction.type === 'recovery'
    )
  );

  unsubscribe();

  let secondReplay = null;
  const unsubscribeSecond = channel.subscribeTreeState(
    (event) => {
      secondReplay = event;
    },
    {
      emitCurrent: true,
      emitRecentReactions: true,
      consumeRecentReactions: true,
      reactionTtlMs: 60000,
    }
  );
  assert.ok(secondReplay);
  assert.equal(secondReplay.source, 'current');
  assert.deepEqual(secondReplay.reactions, []);

  unsubscribeSecond();
  channel.resetTreeStateChannel();
});

test('Phase 11 state endpoint is lightweight and canonical', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'index.js'),
    'utf8'
  );

  assert.match(
    source,
    /progressRouter\.get\('\/tree-state'/
  );
  assert.match(
    source,
    /db\.userStats\.get\(req\.user\.id\)/
  );
  assert.match(
    source,
    /db\.subjectStats\.findMany\(req\.user\.id\)/
  );
  assert.match(
    source,
    /const treeState = buildTreeState\(\{/
  );
  assert.match(
    source,
    /res\.json\(\{ treeState \}\)/
  );
});

test('app shell wires state publishing, route spillover, study invalidation and logout cleanup', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'index.html'),
    'utf8'
  );

  assert.match(
    source,
    /ensureKiwiVineSystem/
  );
  assert.match(
    source,
    /vine-expansion-controller\.mjs/
  );
  assert.match(
    source,
    /_fetchCanonicalKiwiTreeState/
  );
  assert.match(
    source,
    /apiRequest\('\/tree-state'\)/
  );
  assert.match(
    source,
    /_scheduleKiwiVineRefresh\(\)/
  );
  assert.match(
    source,
    /_invalidateKiwiTreeState\('study-session-complete'\)/
  );
  assert.match(
    source,
    /_destroyKiwiVineSystem/
  );
  assert.match(
    source,
    /emitRecentReactions: true/
  );
  assert.match(
    source,
    /kiwi-vine-expansion-overlay/
  );
  assert.match(
    source,
    /pointer-events: none !important/
  );
  const controller = fs.readFileSync(
    path.join(
      ROOT,
      'public/tree/vine-expansion-controller.mjs'
    ),
    'utf8'
  );
  assert.match(
    controller,
    /aria-live', 'polite'/
  );
});

test('local and external Pixi renderers both consume Phase 12 reactions', () => {
  const localSource = fs.readFileSync(
    path.join(
      ROOT,
      'public/tree/kiwi-vine-renderer.mjs'
    ),
    'utf8'
  );
  const gatewaySource = fs.readFileSync(
    path.join(
      ROOT,
      'public/tree/tree-renderer-gateway.mjs'
    ),
    'utf8'
  );
  const externalSource = fs.readFileSync(
    path.join(
      ROOT,
      'public/tree/vine-expansion-renderer.mjs'
    ),
    'utf8'
  );

  assert.match(localSource, /playReactions\(reactions\)/);
  assert.match(localSource, /_reactionType/);
  assert.match(gatewaySource, /playReactions\(reactions\)/);
  assert.match(externalSource, /playReactions\(reactions\)/);
});

test('Phase 13 respects dynamic Reduced Motion and document visibility', () => {
  const source = fs.readFileSync(
    path.join(
      ROOT,
      'public/tree/vine-expansion-renderer.mjs'
    ),
    'utf8'
  );

  assert.match(
    source,
    /prefers-reduced-motion: reduce/
  );
  assert.match(
    source,
    /visibilitychange/
  );
  assert.match(
    source,
    /document\.hidden/
  );
  assert.match(
    source,
    /removeEventListener/
  );
  assert.match(
    source,
    /removeListener/
  );
});

test('Phase 13 still fails closed on mobile and high-focus routes', () => {
  for (const route of [
    'exam',
    'exam-config',
    'settings',
    'admin',
  ]) {
    const decision =
      expansionServer.getExpansionDecision({
        route,
        overallGrowthProgress: 1,
        viewportWidth: 1440,
      });
    assert.equal(decision.enabled, false);
  }

  const mobile =
    expansionServer.getExpansionDecision({
      route: 'dashboard',
      overallGrowthProgress: 1,
      viewportWidth: 390,
    });

  assert.equal(mobile.enabled, false);
  assert.equal(mobile.reason, 'mobile-profile');
});

test('Phase 14 adaptation preserves the Phase 11-13 fail-closed contract', () => {
  const controller = fs.readFileSync(
    path.join(
      ROOT,
      'public/tree/vine-expansion-controller.mjs'
    ),
    'utf8'
  );

  assert.match(
    controller,
    /derivePixiRuntimePolicy/
  );
  assert.match(
    controller,
    /_ensureRenderer/
  );
  assert.match(
    controller,
    /_scheduleRendererRelease/
  );

  const mobile =
    expansionServer.getExpansionDecision({
      route: 'dashboard',
      overallGrowthProgress: 1,
      viewportWidth: 390,
    });

  assert.equal(mobile.enabled, false);
  assert.equal(mobile.reason, 'mobile-profile');
});
