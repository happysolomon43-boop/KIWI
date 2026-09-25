'use strict';

const {
  PREPARATION_ROUTE_POSTURES,
  assertCriticality,
  assertPreparationRoutePosture,
  assertMaturityGateRoute,
} = require('./route-control');

const PREPARATION_PROFILE_VERSION = '1.0';
const WORKSPACE_LIFECYCLE_STATES = Object.freeze([
  'Active',
  'Finalization Due',
  'Finalized / Handed Off',
  'Superseded',
  'Cancelled',
]);
const MATURITY_STAGES = Object.freeze([
  'Skeleton',
  'Structured',
  'Candidate',
  'Pre-Lock Ready',
]);

const ELIGIBLE_TARGET_KINDS = Object.freeze([
  'formal_assessment',
  'next_class',
  'recovery_programme',
  'resit_preparation',
  'multi_course_schedule',
  'course_transition',
  'completion_finalization_readiness',
]);

const NORMALLY_INELIGIBLE_TARGET_KINDS = Object.freeze([
  'live_student_response_evaluation',
  'ordinary_teacher_reply',
  'deterministic_marking_calculation',
  'attendance_outcome',
  'atomic_assessment_submission_expiry',
  'grade_calculation',
  'simple_translation_explanation',
]);

function fail(message, code = 'TEACHING_PPL_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function nonEmpty(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) fail(`PPL ${field} is required.`);
  return normalized;
}

function assertBudgetDescriptor(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`Preparation Profile ${field} must be an object.`);
  }
  if (value.mode !== 'CONFIGURED_EXTERNALLY' || !String(value.policy_ref || '').trim()) {
    fail(
      `Preparation Profile ${field} must bind a configured external policy_ref; D03 does not invent numeric budgets.`
    );
  }
  return Object.freeze({
    mode: 'CONFIGURED_EXTERNALLY',
    policy_ref: String(value.policy_ref).trim(),
  });
}

function definePreparationProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    fail('Preparation Profile must be an object.');
  }
  const targetKinds = Array.isArray(profile.eligible_target_kinds)
    ? [...new Set(profile.eligible_target_kinds.map((v) => nonEmpty(v, 'eligible_target_kinds')))]
    : [];
  if (!targetKinds.length) fail('Preparation Profile requires eligible_target_kinds.');
  for (const targetKind of targetKinds) {
    if (!ELIGIBLE_TARGET_KINDS.includes(targetKind)) {
      fail(`Unsupported PPL eligible target kind: ${targetKind}`);
    }
  }

  const routeRequirements = profile.route_posture_requirements;
  if (!routeRequirements || typeof routeRequirements !== 'object' || Array.isArray(routeRequirements)) {
    fail('Preparation Profile requires route_posture_requirements.');
  }
  const normalizedRoutes = {};
  for (const [stage, posture] of Object.entries(routeRequirements)) {
    if (!MATURITY_STAGES.includes(stage)) fail(`Unknown profile maturity stage: ${stage}`);
    normalizedRoutes[stage] = assertPreparationRoutePosture(posture);
    assertMaturityGateRoute({ targetMaturity: stage, routePosture: normalizedRoutes[stage] });
  }

  const independent = Array.isArray(profile.required_independent_review_stages)
    ? profile.required_independent_review_stages.map((v) => nonEmpty(v, 'required_independent_review_stages'))
    : [];

  return Object.freeze({
    profile_id: nonEmpty(profile.profile_id, 'profile_id'),
    version: nonEmpty(profile.version || PREPARATION_PROFILE_VERSION, 'version'),
    status: profile.status || 'UNQUALIFIED_CONFIGURATION_TEMPLATE',
    eligible_target_kinds: Object.freeze(targetKinds),
    consequence_criticality: assertCriticality(
      nonEmpty(profile.consequence_criticality, 'consequence_criticality')
    ),
    lead_time_policy: Object.freeze({ ...profile.lead_time_policy }),
    input_volatility_policy: Object.freeze({ ...profile.input_volatility_policy }),
    review_budget: assertBudgetDescriptor(profile.review_budget, 'review_budget'),
    candidate_budget: assertBudgetDescriptor(profile.candidate_budget, 'candidate_budget'),
    required_independent_review_stages: Object.freeze(independent),
    freeze_rules: Object.freeze({ ...profile.freeze_rules }),
    route_posture_requirements: Object.freeze(normalizedRoutes),
    provider_model_names_allowed: false,
  });
}

const PREPARATION_PROFILE_TEMPLATES = Object.freeze({
  formal_assessment: definePreparationProfile({
    profile_id: 'teaching.preparation.formal_assessment',
    version: PREPARATION_PROFILE_VERSION,
    eligible_target_kinds: ['formal_assessment'],
    consequence_criticality: 'C4',
    lead_time_policy: { mode: 'AUTHORITATIVE_TARGET_WINDOW' },
    input_volatility_policy: { mode: 'EVENT_DRIVEN_MATERIAL_REVIEW' },
    review_budget: { mode: 'CONFIGURED_EXTERNALLY', policy_ref: 'teaching.preparation.review_budget.formal_assessment' },
    candidate_budget: { mode: 'CONFIGURED_EXTERNALLY', policy_ref: 'teaching.preparation.candidate_budget.formal_assessment' },
    required_independent_review_stages: ['independent_validation', 'whole_artifact_review', 'final_revalidation'],
    freeze_rules: {
      finalization_gate_required: true,
      deadline_cannot_override_not_ready: true,
      immutable_after_lock_or_exposure: true,
    },
    route_posture_requirements: {
      Skeleton: 'bounded_interpretive',
      Structured: 'strong_design',
      Candidate: 'independent_validation',
      'Pre-Lock Ready': 'final_reconciliation',
    },
  }),
  next_class: definePreparationProfile({
    profile_id: 'teaching.preparation.next_class',
    version: PREPARATION_PROFILE_VERSION,
    eligible_target_kinds: ['next_class'],
    consequence_criticality: 'C3',
    lead_time_policy: { mode: 'AUTHORITATIVE_TARGET_WINDOW' },
    input_volatility_policy: { mode: 'EVENT_DRIVEN_MATERIAL_REVIEW' },
    review_budget: { mode: 'CONFIGURED_EXTERNALLY', policy_ref: 'teaching.preparation.review_budget.next_class' },
    candidate_budget: { mode: 'CONFIGURED_EXTERNALLY', policy_ref: 'teaching.preparation.candidate_budget.next_class' },
    required_independent_review_stages: [],
    freeze_rules: {
      finalization_gate_required: true,
      live_replanning_remains_separate: true,
    },
    route_posture_requirements: {
      Skeleton: 'economy_maintenance',
      Structured: 'bounded_interpretive',
      Candidate: 'strong_design',
      'Pre-Lock Ready': 'final_reconciliation',
    },
  }),
  recovery_resit: definePreparationProfile({
    profile_id: 'teaching.preparation.recovery_resit',
    version: PREPARATION_PROFILE_VERSION,
    eligible_target_kinds: ['recovery_programme', 'resit_preparation'],
    consequence_criticality: 'C3',
    lead_time_policy: { mode: 'AUTHORITATIVE_TARGET_WINDOW' },
    input_volatility_policy: { mode: 'EVENT_DRIVEN_MATERIAL_REVIEW' },
    review_budget: { mode: 'CONFIGURED_EXTERNALLY', policy_ref: 'teaching.preparation.review_budget.recovery_resit' },
    candidate_budget: { mode: 'CONFIGURED_EXTERNALLY', policy_ref: 'teaching.preparation.candidate_budget.recovery_resit' },
    required_independent_review_stages: ['final_revalidation'],
    freeze_rules: {
      progression_truth_remains_external: true,
      finalization_gate_required: true,
    },
    route_posture_requirements: {
      Skeleton: 'economy_maintenance',
      Structured: 'bounded_interpretive',
      Candidate: 'strong_design',
      'Pre-Lock Ready': 'final_reconciliation',
    },
  }),
  scheduling_horizon: definePreparationProfile({
    profile_id: 'teaching.preparation.scheduling_horizon',
    version: PREPARATION_PROFILE_VERSION,
    eligible_target_kinds: ['multi_course_schedule', 'course_transition', 'completion_finalization_readiness'],
    consequence_criticality: 'C3',
    lead_time_policy: { mode: 'AUTHORITATIVE_TARGET_WINDOW' },
    input_volatility_policy: { mode: 'EVENT_DRIVEN_MATERIAL_REVIEW' },
    review_budget: { mode: 'CONFIGURED_EXTERNALLY', policy_ref: 'teaching.preparation.review_budget.scheduling_horizon' },
    candidate_budget: { mode: 'CONFIGURED_EXTERNALLY', policy_ref: 'teaching.preparation.candidate_budget.scheduling_horizon' },
    required_independent_review_stages: [],
    freeze_rules: {
      scheduler_feasibility_remains_authoritative: true,
      visible_commit_changes_rarer_than_internal_planning_changes: true,
    },
    route_posture_requirements: {
      Skeleton: 'economy_maintenance',
      Structured: 'bounded_interpretive',
      Candidate: 'strong_design',
      'Pre-Lock Ready': 'final_reconciliation',
    },
  }),
});

function validatePreparationMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('PPL metadata must be an object.');
  }

  const stage = nonEmpty(metadata.stage, 'stage');
  const maturity = nonEmpty(metadata.maturity, 'maturity');
  const maturityTarget = nonEmpty(metadata.maturity_target, 'maturity_target');

  if (!WORKSPACE_LIFECYCLE_STATES.includes(stage)) fail(`Unsupported PPL workspace stage: ${stage}`);
  if (!MATURITY_STAGES.includes(maturity)) fail(`Unsupported PPL maturity: ${maturity}`);
  if (!MATURITY_STAGES.includes(maturityTarget)) fail(`Unsupported PPL maturity_target: ${maturityTarget}`);

  const findingRefs = metadata.finding_refs == null ? [] : metadata.finding_refs;
  if (!Array.isArray(findingRefs)) fail('PPL finding_refs must be an array.');

  const authoritativeBundle = metadata.authoritative_input_bundle;
  if (!authoritativeBundle || typeof authoritativeBundle !== 'object' || Array.isArray(authoritativeBundle)) {
    fail('PPL authoritative_input_bundle must be a structured object.');
  }

  const materialDelta = metadata.material_delta;
  if (!materialDelta || typeof materialDelta !== 'object' || Array.isArray(materialDelta)) {
    fail('PPL material_delta must be a structured object.');
  }

  return Object.freeze({
    workspace_ref: nonEmpty(metadata.workspace_ref, 'workspace_ref'),
    workspace_version: nonEmpty(metadata.workspace_version, 'workspace_version'),
    stage,
    maturity,
    previous_artifact: metadata.previous_artifact == null ? null : metadata.previous_artifact,
    authoritative_input_bundle: Object.freeze({ ...authoritativeBundle }),
    material_delta: Object.freeze({ ...materialDelta }),
    finding_refs: Object.freeze(findingRefs.map((v) => nonEmpty(v, 'finding_refs'))),
    review_purpose: nonEmpty(metadata.review_purpose, 'review_purpose'),
    maturity_target: maturityTarget,
    protection_class: nonEmpty(metadata.protection_class, 'protection_class'),
    route_posture: assertPreparationRoutePosture(metadata.route_posture),
    idempotency_key: nonEmpty(metadata.idempotency_key, 'idempotency_key'),
    correlation_id: nonEmpty(metadata.correlation_id, 'correlation_id'),
  });
}

module.exports = {
  PREPARATION_PROFILE_VERSION,
  WORKSPACE_LIFECYCLE_STATES,
  MATURITY_STAGES,
  ELIGIBLE_TARGET_KINDS,
  NORMALLY_INELIGIBLE_TARGET_KINDS,
  PREPARATION_PROFILE_TEMPLATES,
  definePreparationProfile,
  validatePreparationMetadata,
  PREPARATION_ROUTE_POSTURES,
};
