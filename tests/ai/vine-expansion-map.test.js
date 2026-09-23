'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const blueprint = require('../../services/vine-visual-blueprint');
const {
  VINE_EXPANSION_MAP_VERSION,
  VIEWPORT_BREAKPOINTS,
  EXPANSION_MATURITY,
  SHELL_ANCHORS,
  GLOBAL_SUSPEND_SELECTORS,
  GLOBAL_FORBIDDEN_SELECTORS,
  EXTERNAL_VINE_STYLE,
  ROUTE_EXPANSION_MAP,
  ROUTE_POLICY,
  viewportProfile,
  getRouteMap,
  getEligibleExpansionPaths,
  getExpansionDecision,
} = require('../../services/vine-expansion-map');

test('expansion map has stable version and matches KIWI responsive breakpoints', () => {
  assert.equal(VINE_EXPANSION_MAP_VERSION, 1);
  assert.deepEqual(VIEWPORT_BREAKPOINTS, {
    mobileMax: 768,
    tabletMax: 1024,
  });

  assert.equal(viewportProfile(375), 'mobile');
  assert.equal(viewportProfile(768), 'mobile');
  assert.equal(viewportProfile(769), 'tablet');
  assert.equal(viewportProfile(1024), 'tablet');
  assert.equal(viewportProfile(1025), 'desktop');
});

test('external expansion is late-life behavior', () => {
  assert.ok(EXPANSION_MATURITY.firstEscape >= 0.70);
  assert.ok(EXPANSION_MATURITY.sectionReach > EXPANSION_MATURITY.firstEscape);
  assert.ok(EXPANSION_MATURITY.contextualReach > EXPANSION_MATURITY.sectionReach);
  assert.ok(EXPANSION_MATURITY.pageReach > EXPANSION_MATURITY.contextualReach);
  assert.ok(EXPANSION_MATURITY.ecosystemReach > EXPANSION_MATURITY.pageReach);
  assert.ok(EXPANSION_MATURITY.ecosystemReach <= 1);
});

test('every local-socket path references a real Phase 5 exit socket', () => {
  const socketIds = new Set(blueprint.LOCAL_EXIT_SOCKETS.map((socket) => socket.id));

  for (const routeMap of Object.values(ROUTE_EXPANSION_MAP)) {
    for (const expansionPath of routeMap.paths) {
      if (expansionPath.source.kind === 'local-socket') {
        assert.equal(
          socketIds.has(expansionPath.source.socketId),
          true,
          `unknown socket ${expansionPath.source.socketId}`
        );
      }
    }
  }
});

test('path-end dependencies always point to an earlier path on the same route', () => {
  for (const [route, routeMap] of Object.entries(ROUTE_EXPANSION_MAP)) {
    const earlier = new Set();

    for (const expansionPath of [...routeMap.paths].sort((a, b) => a.order - b.order)) {
      if (expansionPath.source.kind === 'path-end') {
        assert.equal(
          earlier.has(expansionPath.source.pathId),
          true,
          `${route} path ${expansionPath.id} references missing/later source ${expansionPath.source.pathId}`
        );
      }
      earlier.add(expansionPath.id);
    }
  }
});

test('shell-entry paths reference declared shell anchors', () => {
  for (const routeMap of Object.values(ROUTE_EXPANSION_MAP)) {
    for (const expansionPath of routeMap.paths) {
      if (expansionPath.source.kind === 'shell-anchor') {
        assert.ok(SHELL_ANCHORS[expansionPath.source.anchorId]);
      }
    }
  }
});

test('all mapped paths are perimeter-safe and external vines cannot intercept UI', () => {
  assert.equal(EXTERNAL_VINE_STYLE.pointerEvents, 'none');
  assert.equal(EXTERNAL_VINE_STYLE.fruitAllowed, false);
  assert.ok(EXTERNAL_VINE_STYLE.maxScreenCoverageRatio <= 0.14);
  assert.ok(EXTERNAL_VINE_STYLE.maxThicknessScale < 0.6);

  for (const routeMap of Object.values(ROUTE_EXPANSION_MAP)) {
    for (const expansionPath of routeMap.paths) {
      assert.equal(expansionPath.target.perimeterOnly, true);
      assert.ok(expansionPath.target.clearancePx >= 10);
      assert.ok(expansionPath.leafBudget >= 0);
      assert.ok(expansionPath.flowerBudget >= 0);
      assert.ok(expansionPath.motionScale <= 0.5);
      assert.equal(expansionPath.profiles.includes('mobile'), false);
    }
  }
});

test('mobile never receives website spillover in Phase 6', () => {
  for (const route of Object.keys(ROUTE_EXPANSION_MAP)) {
    const decision = getExpansionDecision({
      route,
      overallGrowthProgress: 1,
      viewportWidth: 390,
    });

    assert.equal(decision.enabled, false);
    assert.equal(decision.mode, 'local-only');
    assert.equal(decision.reason, 'mobile-profile');
    assert.deepEqual(decision.paths, []);
  }
});

test('Dashboard expansion grows progressively with maturity', () => {
  const atFirstEscape = getEligibleExpansionPaths({
    route: 'dashboard',
    overallGrowthProgress: 0.72,
    viewportWidth: 1440,
  }).map((p) => p.id);

  const atSectionReach = getEligibleExpansionPaths({
    route: 'dashboard',
    overallGrowthProgress: 0.84,
    viewportWidth: 1440,
  }).map((p) => p.id);

  const ancient = getEligibleExpansionPaths({
    route: 'dashboard',
    overallGrowthProgress: 1,
    viewportWidth: 1440,
  }).map((p) => p.id);

  assert.deepEqual(atFirstEscape, ['dashboard-right-rail']);
  assert.deepEqual(atSectionReach, [
    'dashboard-right-rail',
    'dashboard-streak-wrap',
    'dashboard-invitations-reach',
  ]);
  assert.deepEqual(ancient, [
    'dashboard-right-rail',
    'dashboard-streak-wrap',
    'dashboard-invitations-reach',
    'dashboard-hero-reach',
    'dashboard-main-right-rail',
  ]);
});

test('tablet receives nearby Dashboard/Biome reach but not desktop-only deep colonization', () => {
  const dashboard = getEligibleExpansionPaths({
    route: 'dashboard',
    overallGrowthProgress: 1,
    viewportWidth: 900,
  }).map((p) => p.id);

  const biome = getEligibleExpansionPaths({
    route: 'biome',
    overallGrowthProgress: 1,
    viewportWidth: 900,
  }).map((p) => p.id);

  assert.deepEqual(dashboard, [
    'dashboard-right-rail',
    'dashboard-streak-wrap',
  ]);
  assert.deepEqual(biome, [
    'biome-grid-left',
    'biome-grid-right',
  ]);
});

test('Brain remains contextual and lower-motion than ecosystem showcase routes', () => {
  const brain = getRouteMap('brain');
  assert.equal(brain.mode, 'contextual');

  for (const expansionPath of brain.paths) {
    assert.ok(expansionPath.minMaturity >= 0.86);
    assert.ok(expansionPath.motionScale <= 0.28);
    assert.equal(expansionPath.flowerBudget, 0);
  }

  assert.ok(brain.forbiddenSelectors.includes('.brain-pressure-row'));
  assert.ok(brain.forbiddenSelectors.includes('#brainActiveReckoningCard'));
});

test('active Study suppresses all external vines even for an Ancient organism', () => {
  const decision = getExpansionDecision({
    route: 'study',
    overallGrowthProgress: 1,
    viewportWidth: 1440,
    activeStudySession: true,
  });

  assert.equal(decision.enabled, false);
  assert.equal(decision.mode, 'local-only');
  assert.equal(decision.reason, 'active-study-focus');
  assert.deepEqual(decision.paths, []);
});

test('focus overlays and Reckoning suspend expansion globally', () => {
  for (const flags of [
    { overlayActive: true },
    { reckoningActive: true },
    { tourActive: true },
  ]) {
    const decision = getExpansionDecision({
      route: 'dashboard',
      overallGrowthProgress: 1,
      viewportWidth: 1440,
      ...flags,
    });

    assert.equal(decision.enabled, false);
    assert.equal(decision.mode, 'suspended');
    assert.equal(decision.reason, 'focus-overlay');
  }

  assert.ok(GLOBAL_SUSPEND_SELECTORS.includes('#reckoningOverlay'));
  assert.ok(GLOBAL_SUSPEND_SELECTORS.includes('#bubblePanelOverlay'));
  assert.ok(GLOBAL_SUSPEND_SELECTORS.includes('#_qqOverlay'));
  assert.ok(GLOBAL_SUSPEND_SELECTORS.includes('.modal-overlay'));
});

test('high-focus and account routes are explicitly disabled rather than inheriting vines', () => {
  for (const route of [
    'exam',
    'exam-config',
    'card-browser',
    'generating-cards',
    'settings',
    'admin',
    'landing',
    'onboarding',
  ]) {
    assert.equal(ROUTE_POLICY[route], 'disabled');

    const decision = getExpansionDecision({
      route,
      overallGrowthProgress: 1,
      viewportWidth: 1440,
    });

    assert.equal(decision.enabled, false);
    assert.equal(decision.mode, 'disabled');
  }
});

test('unmapped routes fail closed until a dedicated design is approved', () => {
  for (const route of [
    'library',
    'chronicle',
    'progress',
    'community',
    'marketplace',
  ]) {
    assert.equal(ROUTE_POLICY[route], 'unmapped');

    const decision = getExpansionDecision({
      route,
      overallGrowthProgress: 1,
      viewportWidth: 1440,
    });

    assert.equal(decision.enabled, false);
    assert.equal(decision.mode, 'unmapped');
    assert.equal(decision.reason, 'route-not-yet-mapped');
  }
});

test('navigation and interactive controls are globally forbidden surfaces', () => {
  for (const selector of [
    '#sidebar',
    '#sidebarNav',
    '#bottomNav',
    '.mobile-bar',
    'button',
    'input',
    'select',
    'textarea',
  ]) {
    assert.ok(GLOBAL_FORBIDDEN_SELECTORS.includes(selector));
  }
});

test('mapped selectors are grounded in the current KIWI source', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

  const requiredSourceMarkers = [
    'id="mainContent"',
    'class="dashboard-grid"',
    'class="dashboard-right"',
    'id="tree-card"',
    'id="invitations-card"',
    'class="streak-widget"',
    'class="ks-hero"',
    'id="biomeTree"',
    'id="biome-container"',
    'class="biome-zone',
    'id="brain-gauges"',
    'class="brain-pressure-row"',
    'id="studyLayout"',
    'id="studyArena"',
    'id="studySubject"',
    'id="startStudyBtn"',
    'id="bubblePanelOverlay"',
    'id="reckoningOverlay"',
  ];

  for (const marker of requiredSourceMarkers) {
    assert.equal(
      source.includes(marker),
      true,
      `current index.html no longer contains expected expansion-map anchor: ${marker}`
    );
  }

  for (const route of Object.keys(ROUTE_EXPANSION_MAP)) {
    assert.equal(
      source.includes(`${route}:`) || source.includes(`"${route}":`) || source.includes(`${route}: {`),
      true,
      `mapped route ${route} is not present in ROUTES source`
    );
  }
});
