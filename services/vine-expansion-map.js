'use strict';

const expansion = require('../public/tree/vine-expansion-map.json');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

deepFreeze(expansion);

const VINE_EXPANSION_MAP_VERSION = expansion.version;
const VIEWPORT_BREAKPOINTS = expansion.viewportBreakpoints;
const EXPANSION_MATURITY = expansion.expansionMaturity;
const SHELL_ANCHORS = expansion.shellAnchors;
const GLOBAL_SUSPEND_SELECTORS = expansion.globalSuspendSelectors;
const GLOBAL_FORBIDDEN_SELECTORS = expansion.globalForbiddenSelectors;
const EXTERNAL_VINE_STYLE = expansion.externalVineStyle;
const ROUTE_EXPANSION_MAP = expansion.routeExpansionMap;
const ROUTE_POLICY = expansion.routePolicy;

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
