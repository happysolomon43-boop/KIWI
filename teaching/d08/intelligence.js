'use strict';

const { PLAN_SCHEMA_VERSION, validateCoursePlanProposal } = require('./contracts');

function baseRequest({ capabilityId, course, taskMode, outputSchema, contextSpec, academicInput, provenanceRefs = [], authorityCeiling }) {
  return {
    trigger: { type: 'authenticated_input', ref: `course:${course.course_id}:${taskMode}`, source: 'teaching.d08', actor_id: course.student_id },
    capabilityId,
    stateReference: { aggregate_type: 'teaching_course', aggregate_id: course.course_id, state_version: String(course.state_version || 1) },
    preconditions: { lifecycle_state: course.lifecycle_state },
    provenanceRefs,
    resultContract: { output_schema_id: outputSchema.id, output_schema_version: outputSchema.version, validator_ids: ['schema', 'domain', 'provenance'], authority_ceiling: authorityCeiling },
    taskMode,
    directive: {
      bounded_actions: ['produce only the requested provisional Course Planning artifact'],
      allowed_operations: ['return schema-valid candidate output grounded in supplied references'],
      prohibited_operations: [
        'mutate authoritative Course, Coverage, Assessment, SKM, Gradebook, Progression or scheduling state',
        'waive unmapped required content',
        'treat student self-report as mastery evidence',
        'select a provider or model',
      ],
      evidence_purpose: taskMode,
      downstream_handoff: { type: 'validated_candidate', validator_ids: ['schema', 'domain', 'provenance'], commit_owner_boundary: 'Course Plan/Coverage' },
    },
    contextSpec,
    outputSchema,
    academicInput,
    commit: false,
  };
}

function coursePlanRequest({ course, audit, sources, vpkDecisions = [], intake = null, previousPlan = null }) {
  const sourceRefs = sources.map((source) => `source:${source.source_content_item_id}`);
  const vpkRefs = vpkDecisions.map((decision) => `vpk:${decision.vpk_decision_id}`);
  const outputSchema = {
    id: PLAN_SCHEMA_VERSION,
    version: '1',
    uncertainty_states: ['INSUFFICIENT_EVIDENCE', 'UNRESOLVED_SCOPE', 'REVIEW_NEEDED'],
    review_needed_field: 'review_needed',
    declared_fields: ['topics', 'learning_units', 'dependencies', 'source_mappings', 'assumed_prerequisites', 'excluded_sources', 'planning_summary'],
    validate: async (output) => validateCoursePlanProposal(output, { audit, sourceItems: sources, vpkDecisions }),
  };
  return {
    ...baseRequest({
      capabilityId: 'teaching.curriculum.course_plan_generation',
      course,
      taskMode: previousPlan ? 'course_plan_version_update' : 'course_plan_v1_generation',
      outputSchema,
      authorityCeiling: 'T3',
      contextSpec: {
        authoritative_refs: [
          { ref: `course:${course.course_id}` },
          { ref: `curriculum-audit:${audit.curriculum_audit_id}` },
          ...vpkRefs.map((ref) => ({ ref })),
          ...(previousPlan ? [{ ref: `course-plan:${previousPlan.course_plan_id}` }] : []),
        ],
        provenance_refs: sourceRefs.map((ref) => ({ ref })),
        untrusted_refs: intake ? [{ ref: `intake:${intake.intake_id}` }] : [],
        context_kind: 'course_plan',
        access_purpose: 'dependency_aware_scope_planning',
      },
      academicInput: {
        course_ref: course.course_id,
        curriculum_audit_ref: audit.curriculum_audit_id,
        source_refs: sourceRefs,
        vpk_refs: vpkRefs,
        prior_course_plan_ref: previousPlan?.course_plan_id || null,
        semester_scheduling_authority: 'OUT_OF_SCOPE_D09',
      },
      provenanceRefs: [`curriculum-audit:${audit.curriculum_audit_id}`, ...sourceRefs, ...vpkRefs, ...(intake ? [`intake:${intake.intake_id}`] : [])],
    }),
    schemaValidator: outputSchema.validate,
    domainValidator: outputSchema.validate,
    provenanceValidator: async (output) => {
      const result = validateCoursePlanProposal(output, { audit, sourceItems: sources, vpkDecisions });
      if (!result.ok) return result;
      const expected = new Set(sources.filter((source) => source.classification === 'ACADEMICALLY_MEANINGFUL').map((source) => String(source.source_ref)));
      const mapped = new Set(result.value.source_mappings.map((mapping) => mapping.source_ref));
      return { ok: [...expected].every((ref) => mapped.has(ref)), reason: 'COURSE_PLAN_SOURCE_PROVENANCE_INCOMPLETE', value: result.value };
    },
  };
}

function scopeImpactRequest({ course, scopeChange, currentPlan }) {
  const outputSchema = {
    id: 'd08.scope-change-impact', version: '1', uncertainty_states: ['REVIEW_NEEDED', 'INSUFFICIENT_EVIDENCE'], review_needed_field: 'review_needed',
    declared_fields: ['impact_summary', 'affected_learning_units', 'prerequisite_impacts', 'assessment_scope_impacts', 'pacing_risks', 'review_needed'],
    validate: async (output) => {
      if (!output || typeof output !== 'object' || Array.isArray(output)) return { ok: false, reason: 'SCOPE_CHANGE_IMPACT_SCHEMA_INVALID' };
      for (const field of ['affected_learning_units', 'prerequisite_impacts', 'assessment_scope_impacts', 'pacing_risks']) if (!Array.isArray(output[field])) return { ok: false, reason: `SCOPE_CHANGE_${field.toUpperCase()}_REQUIRED` };
      if (!String(output.impact_summary || '').trim()) return { ok: false, reason: 'SCOPE_CHANGE_IMPACT_SUMMARY_REQUIRED' };
      return { ok: true, value: output };
    },
  };
  return {
    ...baseRequest({
      capabilityId: 'teaching.curriculum.course_scope_change_impact_analysis', course, taskMode: 'course_scope_change_impact_analysis', outputSchema, authorityCeiling: 'T3',
      contextSpec: { authoritative_refs: [{ ref: `course:${course.course_id}` }, ...(currentPlan ? [{ ref: `course-plan:${currentPlan.course_plan_id}` }] : []), { ref: `scope-change:${scopeChange.scope_change_id}` }], context_kind: 'course_scope_change', access_purpose: 'bounded_plan_impact_analysis' },
      academicInput: { scope_change_ref: scopeChange.scope_change_id, deterministic_classification: scopeChange.change_classification, requires_plan_version: scopeChange.requires_plan_version },
      provenanceRefs: [`scope-change:${scopeChange.scope_change_id}`],
    }),
    schemaValidator: outputSchema.validate, domainValidator: outputSchema.validate, provenanceValidator: async () => ({ ok: true }),
  };
}

function coverageExplanationRequest({ course, coverageAudit }) {
  const outputSchema = {
    id: 'd08.coverage-explanation', version: '1', uncertainty_states: ['REVIEW_NEEDED'], review_needed_field: 'review_needed', declared_fields: ['headline', 'summary', 'next_step'],
    validate: async (output) => (!output || typeof output !== 'object' || !String(output.headline || '').trim() || !String(output.summary || '').trim()) ? { ok: false, reason: 'COVERAGE_EXPLANATION_SCHEMA_INVALID' } : { ok: true, value: output },
  };
  return {
    ...baseRequest({
      capabilityId: 'teaching.crosscutting.course_coverage_explanation', course, taskMode: 'student_facing_course_coverage_explanation', outputSchema, authorityCeiling: 'T1',
      contextSpec: { authoritative_refs: [{ ref: `coverage-audit:${coverageAudit.coverage_audit_id}` }], context_kind: 'coverage_explanation', access_purpose: 'presentation_only' },
      academicInput: { coverage_audit_ref: coverageAudit.coverage_audit_id, status: coverageAudit.status, machine_result: coverageAudit.machine_result },
      provenanceRefs: [`coverage-audit:${coverageAudit.coverage_audit_id}`],
    }),
    schemaValidator: outputSchema.validate, domainValidator: outputSchema.validate, provenanceValidator: async () => ({ ok: true }),
  };
}

function createD08Intelligence({ orchestrator } = {}) {
  if (!orchestrator || typeof orchestrator.execute !== 'function') throw new TypeError('D08 intelligence requires the Teaching Orchestrator.');
  return Object.freeze({
    generateCoursePlan: (input) => orchestrator.execute(coursePlanRequest(input)),
    analyzeScopeImpact: (input) => orchestrator.execute(scopeImpactRequest(input)),
    explainCoverage: (input) => orchestrator.execute(coverageExplanationRequest(input)),
  });
}

module.exports = { coursePlanRequest, scopeImpactRequest, coverageExplanationRequest, createD08Intelligence };
