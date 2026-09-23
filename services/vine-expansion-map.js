'use strict';

const { LOCAL_EXIT_SOCKETS } = require('./vine-visual-blueprint');

const VINE_EXPANSION_MAP_VERSION = 1;

const VIEWPORT_BREAKPOINTS = Object.freeze({
  mobileMax: 768,
  tabletMax: 1024,
});

const EXPANSION_MATURITY = Object.freeze({
  localOnly: 0.00,
  firstEscape: 0.72,
  sectionReach: 0.80,
  contextualReach: 0.86,
  pageReach: 0.92,
  ecosystemReach: 0.97,
});

const SHELL_ANCHORS = Object.freeze({
  mainTopRight: Object.freeze({
    selector: '#mainContent .page-wrap',
    edge: 'top-right',
    insetPx: 18,
    purpose: 'route-entry',
  }),
  mainTopLeft: Object.freeze({
    selector: '#mainContent .page-wrap',
    edge: 'top-left',
    insetPx: 18,
    purpose: 'route-entry',
  }),
  mainRightRail: Object.freeze({
    selector: '#mainContent .page-wrap',
    edge: 'right',
    ratio: 0.28,
    insetPx: 8,
    purpose: 'decorative-rail',
  }),
  mainLeftRail: Object.freeze({
    selector: '#mainContent .page-wrap',
    edge: 'left',
    ratio: 0.28,
    insetPx: 8,
    purpose: 'decorative-rail',
  }),
});

const GLOBAL_SUSPEND_SELECTORS = Object.freeze([
  '#reckoningOverlay',
  '#examGeneratingScreen',
  '#authOverlay.active',
  '#bubblePanelOverlay',
  '#_qqOverlay',
  '#_qqGenOverlay',
  '.modal-overlay',
  '#kiwiTourExit.visible',
  'body.kiwi-tour-active',
]);

const GLOBAL_FORBIDDEN_SELECTORS = Object.freeze([
  '#sidebar',
  '#sidebarNav',
  '#bottomNav',
  '.mobile-bar',
  '#toastContainer',
  '#kiwiGenBanner',
  'button',
  'input',
  'select',
  'textarea',
  '[role="dialog"]',
  '[aria-modal="true"]',
]);

const EXTERNAL_VINE_STYLE = Object.freeze({
  // External tendrils should be visually lighter than the local organism.
  maxThicknessScale: 0.52,
  minThicknessScale: 0.24,
  leafScale: 0.76,
  leafSpacingPx: 58,
  flowerSpacingPx: 120,
  fruitAllowed: false,
  pointerEvents: 'none',
  preferredZBand: 'decorative-between-surface-and-content',
  motionScale: 0.55,
  maxScreenCoverageRatio: 0.14,
});

function socket(id) {
  const found = LOCAL_EXIT_SOCKETS.find((item) => item.id === id);
  if (!found) throw new Error('Unknown local vine exit socket: ' + id);
  return Object.freeze({
    kind: 'local-socket',
    socketId: id,
  });
}

function pathEnd(pathId) {
  return Object.freeze({
    kind: 'path-end',
    pathId,
  });
}

function shell(anchorId) {
  if (!SHELL_ANCHORS[anchorId]) {
    throw new Error('Unknown shell anchor: ' + anchorId);
  }
  return Object.freeze({
    kind: 'shell-anchor',
    anchorId,
  });
}

function target(selector, edge, options) {
  const extra = options && typeof options === 'object' ? options : {};
  return Object.freeze({
    selector,
    edge,
    insetPx: Number.isFinite(extra.insetPx) ? extra.insetPx : 8,
    ratio: Number.isFinite(extra.ratio) ? extra.ratio : null,
    targetMode: extra.targetMode || 'single',
    maxTargets: Number.isFinite(extra.maxTargets) ? extra.maxTargets : 1,
    perimeterOnly: extra.perimeterOnly !== false,
    clearancePx: Number.isFinite(extra.clearancePx) ? extra.clearancePx : 10,
  });
}

const ROUTE_EXPANSION_MAP = Object.freeze({
  dashboard: Object.freeze({
    mode: 'full',
    requiredSelectors: Object.freeze([
      '#tree-card',
      '#invitations-card',
      '.dashboard-grid',
      '.dashboard-right',
    ]),
    originSelector: '#tree-card',
    forbiddenSelectors: Object.freeze([
      '#tree-card .tree-health-bar',
      '#tree-card .section-header',
      '#invitations-card .invitation-item',
      '#invitations-card .invitation-dismiss',
      '.ks-hero-subjects',
    ]),
    paths: Object.freeze([
      Object.freeze({
        id: 'dashboard-right-rail',
        order: 10,
        source: socket('exit-right-upper'),
        minMaturity: 0.72,
        profiles: Object.freeze(['desktop', 'tablet']),
        target: target('.dashboard-right', 'right', {
          ratio: 0.18,
          insetPx: -10,
          clearancePx: 12,
        }),
        corridor: 'outer-gutter',
        leafBudget: 5,
        flowerBudget: 0,
        motionScale: 0.48,
      }),
      Object.freeze({
        id: 'dashboard-streak-wrap',
        order: 20,
        source: pathEnd('dashboard-right-rail'),
        minMaturity: 0.80,
        profiles: Object.freeze(['desktop', 'tablet']),
        target: target('.streak-widget', 'top-right', {
          insetPx: 7,
          clearancePx: 12,
        }),
        corridor: 'right-column-perimeter',
        leafBudget: 4,
        flowerBudget: 0,
        motionScale: 0.42,
      }),
      Object.freeze({
        id: 'dashboard-invitations-reach',
        order: 30,
        source: socket('exit-left-upper'),
        minMaturity: 0.84,
        profiles: Object.freeze(['desktop']),
        target: target('#invitations-card', 'top-right', {
          insetPx: 10,
          clearancePx: 14,
        }),
        corridor: 'column-gap',
        leafBudget: 5,
        flowerBudget: 1,
        motionScale: 0.44,
      }),
      Object.freeze({
        id: 'dashboard-hero-reach',
        order: 40,
        source: pathEnd('dashboard-invitations-reach'),
        minMaturity: 0.92,
        profiles: Object.freeze(['desktop']),
        target: target('.ks-hero', 'bottom-right', {
          insetPx: 14,
          clearancePx: 14,
        }),
        corridor: 'page-outer-perimeter',
        leafBudget: 4,
        flowerBudget: 1,
        motionScale: 0.38,
      }),
      Object.freeze({
        id: 'dashboard-main-right-rail',
        order: 50,
        source: socket('exit-right-mid'),
        minMaturity: 0.97,
        profiles: Object.freeze(['desktop']),
        target: target('#mainContent .page-wrap', 'right', {
          ratio: 0.62,
          insetPx: -6,
          clearancePx: 16,
        }),
        corridor: 'page-right-safe-rail',
        leafBudget: 6,
        flowerBudget: 1,
        motionScale: 0.34,
      }),
    ]),
  }),

  biome: Object.freeze({
    mode: 'full',
    requiredSelectors: Object.freeze([
      '#biomeTree',
      '#biome-container',
    ]),
    originSelector: '#biomeTree',
    forbiddenSelectors: Object.freeze([
      '.biome-zone .pressure-bar-wrap',
      '.biome-zone .bubble-mini-indicator',
      '.biome-zone .biome-tooltip',
      '.biome-zone button',
    ]),
    paths: Object.freeze([
      Object.freeze({
        id: 'biome-grid-left',
        order: 10,
        source: socket('exit-left-mid'),
        minMaturity: 0.76,
        profiles: Object.freeze(['desktop', 'tablet']),
        target: target('#biome-container', 'top-left', {
          insetPx: 8,
          clearancePx: 14,
        }),
        corridor: 'tree-card-to-grid-outer-left',
        leafBudget: 5,
        flowerBudget: 0,
        motionScale: 0.46,
      }),
      Object.freeze({
        id: 'biome-grid-right',
        order: 20,
        source: socket('exit-right-mid'),
        minMaturity: 0.76,
        profiles: Object.freeze(['desktop', 'tablet']),
        target: target('#biome-container', 'top-right', {
          insetPx: 8,
          clearancePx: 14,
        }),
        corridor: 'tree-card-to-grid-outer-right',
        leafBudget: 5,
        flowerBudget: 0,
        motionScale: 0.46,
      }),
      Object.freeze({
        id: 'biome-zone-perimeter-left',
        order: 30,
        source: pathEnd('biome-grid-left'),
        minMaturity: 0.88,
        profiles: Object.freeze(['desktop']),
        target: target('.biome-zone[data-zone-id]', 'top-left', {
          targetMode: 'outermost-per-column',
          maxTargets: 2,
          insetPx: 7,
          clearancePx: 16,
        }),
        corridor: 'grid-perimeter-only',
        leafBudget: 5,
        flowerBudget: 1,
        motionScale: 0.38,
      }),
      Object.freeze({
        id: 'biome-zone-perimeter-right',
        order: 40,
        source: pathEnd('biome-grid-right'),
        minMaturity: 0.88,
        profiles: Object.freeze(['desktop']),
        target: target('.biome-zone[data-zone-id]', 'top-right', {
          targetMode: 'outermost-per-column',
          maxTargets: 2,
          insetPx: 7,
          clearancePx: 16,
        }),
        corridor: 'grid-perimeter-only',
        leafBudget: 5,
        flowerBudget: 1,
        motionScale: 0.38,
      }),
    ]),
  }),

  brain: Object.freeze({
    mode: 'contextual',
    requiredSelectors: Object.freeze([
      '#brain-gauges',
      '.dashboard-grid',
    ]),
    originSelector: null,
    forbiddenSelectors: Object.freeze([
      '#brainDeferredReckoningCard',
      '#brainActiveReckoningCard',
      '.brain-pressure-row',
      '.pressure-exp-popover',
    ]),
    paths: Object.freeze([
      Object.freeze({
        id: 'brain-shell-to-gauges',
        order: 10,
        source: shell('mainTopRight'),
        minMaturity: 0.86,
        profiles: Object.freeze(['desktop', 'tablet']),
        target: target('#brain-gauges', 'top-right', {
          insetPx: 8,
          clearancePx: 14,
        }),
        corridor: 'page-right-safe-rail',
        leafBudget: 4,
        flowerBudget: 0,
        motionScale: 0.28,
      }),
      Object.freeze({
        id: 'brain-left-card-perimeter',
        order: 20,
        source: shell('mainTopLeft'),
        minMaturity: 0.94,
        profiles: Object.freeze(['desktop']),
        target: target('#mainContent .dashboard-left > .card', 'top-left', {
          insetPx: 8,
          clearancePx: 14,
        }),
        corridor: 'page-left-safe-rail',
        leafBudget: 3,
        flowerBudget: 0,
        motionScale: 0.24,
      }),
    ]),
  }),

  study: Object.freeze({
    mode: 'restrained',
    requiredSelectors: Object.freeze([
      '#mainContent',
    ]),
    originSelector: null,
    // The active study layout is a focus surface. Its presence suppresses
    // external vines completely; only the local ecosystem remains elsewhere.
    suppressWhenSelectorsPresent: Object.freeze([
      '#studyLayout',
      '#studyArena',
      '#_qqOverlay',
      '#_qqGenOverlay',
    ]),
    forbiddenSelectors: Object.freeze([
      '#studyArena',
      '#studySubject',
      '#stateFilters',
      '#startStudyBtn',
      '.study-header',
      '.session-seed',
      '.kiwi-prev-nav',
      '.kiwi-resume-nav',
      '#cardTimerWrap',
    ]),
    paths: Object.freeze([
      Object.freeze({
        id: 'study-setup-edge',
        order: 10,
        source: shell('mainTopLeft'),
        minMaturity: 0.92,
        profiles: Object.freeze(['desktop']),
        target: target('#studySubject', 'top-left', {
          insetPx: -18,
          clearancePx: 24,
        }),
        corridor: 'setup-card-outer-left-only',
        leafBudget: 2,
        flowerBudget: 0,
        motionScale: 0.16,
        resolveTargetAncestor: '.card',
      }),
    ]),
  }),
});

const ROUTE_POLICY = Object.freeze({
  dashboard: 'mapped',
  biome: 'mapped',
  brain: 'mapped',
  study: 'mapped',

  // High-focus / high-stakes routes: no external vine.
  exam: 'disabled',
  'exam-config': 'disabled',
  'card-browser': 'disabled',
  'generating-cards': 'disabled',

  // Utility/account surfaces stay visually clean.
  settings: 'disabled',
  admin: 'disabled',
  landing: 'disabled',
  onboarding: 'disabled',

  // Not mapped in Phase 6. A future version may add shell-perimeter paths after
  // visual verification. Unmapped is intentionally different from enabled.
  library: 'unmapped',
  chronicle: 'unmapped',
  progress: 'unmapped',
  community: 'unmapped',
  marketplace: 'unmapped',
});

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function viewportProfile(width) {
  const value = Number(width);
  if (!Number.isFinite(value)) return 'desktop';
  if (value <= VIEWPORT_BREAKPOINTS.mobileMax) return 'mobile';
  if (value <= VIEWPORT_BREAKPOINTS.tabletMax) return 'tablet';
  return 'desktop';
}

function getRouteMap(route) {
  return ROUTE_EXPANSION_MAP[String(route || '')] || null;
}

function getEligibleExpansionPaths(input) {
  const source = input && typeof input === 'object' ? input : {};
  const route = String(source.route || '');
  const maturity = clamp01(source.overallGrowthProgress);
  const profile = viewportProfile(source.viewportWidth);
  const routeMap = getRouteMap(route);

  if (!routeMap) return [];
  if (profile === 'mobile') return [];
  if (maturity < EXPANSION_MATURITY.firstEscape) return [];
  if (source.overlayActive || source.reckoningActive || source.tourActive) return [];
  if (route === 'study' && source.activeStudySession) return [];

  return routeMap.paths
    .filter((path) => maturity >= path.minMaturity)
    .filter((path) => path.profiles.includes(profile))
    .slice()
    .sort((a, b) => a.order - b.order);
}

function getExpansionDecision(input) {
  const source = input && typeof input === 'object' ? input : {};
  const route = String(source.route || '');
  const maturity = clamp01(source.overallGrowthProgress);
  const profile = viewportProfile(source.viewportWidth);
  const routePolicy = ROUTE_POLICY[route] || 'disabled';

  if (profile === 'mobile') {
    return Object.freeze({
      enabled: false,
      mode: 'local-only',
      reason: 'mobile-profile',
      profile,
      paths: Object.freeze([]),
    });
  }

  if (source.overlayActive || source.reckoningActive || source.tourActive) {
    return Object.freeze({
      enabled: false,
      mode: 'suspended',
      reason: 'focus-overlay',
      profile,
      paths: Object.freeze([]),
    });
  }

  if (route === 'study' && source.activeStudySession) {
    return Object.freeze({
      enabled: false,
      mode: 'local-only',
      reason: 'active-study-focus',
      profile,
      paths: Object.freeze([]),
    });
  }

  if (routePolicy !== 'mapped') {
    return Object.freeze({
      enabled: false,
      mode: routePolicy === 'unmapped' ? 'unmapped' : 'disabled',
      reason: routePolicy === 'unmapped' ? 'route-not-yet-mapped' : 'route-policy',
      profile,
      paths: Object.freeze([]),
    });
  }

  if (maturity < EXPANSION_MATURITY.firstEscape) {
    return Object.freeze({
      enabled: false,
      mode: 'local-only',
      reason: 'maturity-gate',
      profile,
      paths: Object.freeze([]),
    });
  }

  const paths = getEligibleExpansionPaths({
    ...source,
    route,
    overallGrowthProgress: maturity,
    viewportWidth: source.viewportWidth,
  });

  return Object.freeze({
    enabled: paths.length > 0,
    mode: paths.length > 0 ? getRouteMap(route).mode : 'local-only',
    reason: paths.length > 0 ? 'eligible' : 'no-eligible-paths',
    profile,
    paths: Object.freeze(paths),
  });
}

module.exports = {
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
};
