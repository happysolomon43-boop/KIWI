'use strict';

const { getCapability } = require('../capability-registry');
const { getPromptFamily } = require('./prompt-catalog');

const QUALIFICATION_STATUS = Object.freeze({
  UNQUALIFIED: 'UNQUALIFIED',
  QUALIFIED: 'QUALIFIED',
  BLOCKED: 'BLOCKED',
});

const PREPARATION_ROUTE_POSTURES = Object.freeze([
  'economy_maintenance',
  'bounded_interpretive',
  'strong_design',
  'independent_validation',
  'final_reconciliation',
]);

const MATURITY_GATES = Object.freeze({
  Skeleton: Object.freeze(['economy_maintenance', 'bounded_interpretive', 'strong_design']),
  Structured: Object.freeze(['bounded_interpretive', 'strong_design', 'independent_validation', 'final_reconciliation']),
  Candidate: Object.freeze(['strong_design', 'independent_validation', 'final_reconciliation']),
  'Pre-Lock Ready': Object.freeze(['final_reconciliation']),
});

const CRITICALITY_ORDER = Object.freeze(['C1', 'C2', 'C3', 'C4']);

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertCriticality(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!CRITICALITY_ORDER.includes(normalized)) {
    fail(`Unsupported Teaching prompt criticality: ${value}`, 'TEACHING_CRITICALITY_INVALID');
  }
  return normalized;
}

function assertPreparationRoutePosture(value) {
  const normalized = String(value || '').trim();
  if (!PREPARATION_ROUTE_POSTURES.includes(normalized)) {
    fail(`Unsupported Teaching preparation route posture: ${value}`, 'TEACHING_ROUTE_POSTURE_INVALID');
  }
  return normalized;
}

function stricterCriticality(defaultCriticality, capabilityOverride = null) {
  const base = assertCriticality(defaultCriticality);
  if (capabilityOverride == null) return base;
  const override = assertCriticality(capabilityOverride);
  if (CRITICALITY_ORDER.indexOf(override) < CRITICALITY_ORDER.indexOf(base)) {
    fail(
      `Capability-specific criticality may be stricter than ${base}, never weaker.`,
      'TEACHING_CRITICALITY_DOWNGRADE_FORBIDDEN'
    );
  }
  return override;
}

function createUnqualifiedRouteManifest() {
  const byFamily = {};
  for (let number = 1; number <= 19; number += 1) {
    const familyId = `TPF-${String(number).padStart(2, '0')}`;
    const family = getPromptFamily(familyId);
    byFamily[familyId] = Object.freeze({
      familyId,
      familyVersion: family.version,
      defaultCriticality: family.criticality,
      candidateRuntimeClass: 'CENTRAL_KIWI_AI_ORCHESTRATOR',
      reasoningIntent: 'FAMILY_CONTRACT_DEFINED',
      qualityFloor: family.criticality,
      allowedPrimaryRoutes: Object.freeze([]),
      allowedFallbackRoutes: Object.freeze([]),
      degradationPermission: 'DISALLOWED_UNTIL_INDEPENDENTLY_QUALIFIED',
      qualificationStatus: QUALIFICATION_STATUS.UNQUALIFIED,
      qualificationGate: 'D30',
      productionAuthorizationGate: 'D31',
      humanAcademicReviewRequired: family.criticality === 'C4',
      humanAcademicReviewSatisfied: false,
      productionAuthorized: false,
    });
  }
  return Object.freeze(byFamily);
}

const ROUTE_MANIFEST_VERSION = 'D03-v1';
const ROUTE_MANIFEST = createUnqualifiedRouteManifest();

function resolveRouteControl(capabilityId, {
  capabilityCriticalityOverride = null,
  preparationRoutePosture = null,
} = {}) {
  const capability = getCapability(capabilityId);
  if (capability.authority_ceiling === 'T0') {
    return Object.freeze({
      manifestVersion: ROUTE_MANIFEST_VERSION,
      capabilityId: capability.id,
      familyId: null,
      execution: 'DETERMINISTIC_ONLY',
      qualificationStatus: 'NOT_APPLICABLE',
      productionAuthorized: true,
      preparationRoutePosture: preparationRoutePosture == null
        ? null
        : assertPreparationRoutePosture(preparationRoutePosture),
    });
  }

  const route = ROUTE_MANIFEST[capability.prompt_family_id];
  const criticality = stricterCriticality(route.defaultCriticality, capabilityCriticalityOverride);
  return Object.freeze({
    ...route,
    manifestVersion: ROUTE_MANIFEST_VERSION,
    capabilityId: capability.id,
    authorityCeiling: capability.authority_ceiling,
    authoritativeOwnerBoundary: capability.authoritative_owner_boundary,
    effectiveCriticality: criticality,
    preparationRoutePosture: preparationRoutePosture == null
      ? null
      : assertPreparationRoutePosture(preparationRoutePosture),
  });
}

function assertRouteQualified(route) {
  if (!route || route.qualificationStatus !== QUALIFICATION_STATUS.QUALIFIED) {
    fail(
      'Teaching model route is not production-qualified. D30 empirical qualification remains mandatory.',
      'TEACHING_ROUTE_UNQUALIFIED'
    );
  }
  if (route.productionAuthorized !== true) {
    fail('Teaching route is not authorized for production execution.', 'TEACHING_ROUTE_PRODUCTION_HOLD');
  }
  return true;
}

function assertMaturityGateRoute({ targetMaturity, routePosture } = {}) {
  const posture = assertPreparationRoutePosture(routePosture);
  const allowed = MATURITY_GATES[targetMaturity];
  if (!allowed) {
    fail(`Unknown PPL maturity gate: ${targetMaturity}`, 'TEACHING_PPL_MATURITY_INVALID');
  }
  if (!allowed.includes(posture)) {
    fail(
      `${posture} cannot advance the ${targetMaturity} maturity gate.`,
      'TEACHING_PPL_ROUTE_TOO_WEAK_FOR_GATE'
    );
  }
  return true;
}

function assertFallbackIndependentlyQualified(fallbackRoute) {
  if (!fallbackRoute || fallbackRoute.qualificationStatus !== QUALIFICATION_STATUS.QUALIFIED) {
    fail(
      'Fallback route must be independently qualified for this capability/stage.',
      'TEACHING_FALLBACK_UNQUALIFIED'
    );
  }
  return true;
}

function assertStrongReviewEvidence({
  routePosture,
  primaryAuthoritativeEvidenceRefs = [],
  priorSummaryOnly = false,
} = {}) {
  const posture = assertPreparationRoutePosture(routePosture);
  if (!['strong_design', 'final_reconciliation', 'independent_validation'].includes(posture)) {
    return Object.freeze({ mayOverturnPriorProposal: false, primaryEvidenceRequired: false });
  }
  if (priorSummaryOnly || !Array.isArray(primaryAuthoritativeEvidenceRefs) || primaryAuthoritativeEvidenceRefs.length === 0) {
    fail(
      'Strong/independent/final preparation review requires primary authoritative evidence, not only a prior cheap-route summary.',
      'TEACHING_PPL_PRIMARY_EVIDENCE_REQUIRED'
    );
  }
  return Object.freeze({ mayOverturnPriorProposal: true, primaryEvidenceRequired: true });
}

module.exports = {
  QUALIFICATION_STATUS,
  PREPARATION_ROUTE_POSTURES,
  MATURITY_GATES,
  CRITICALITY_ORDER,
  ROUTE_MANIFEST_VERSION,
  ROUTE_MANIFEST,
  assertCriticality,
  assertPreparationRoutePosture,
  stricterCriticality,
  resolveRouteControl,
  assertRouteQualified,
  assertMaturityGateRoute,
  assertFallbackIndependentlyQualified,
  assertStrongReviewEvidence,
};
