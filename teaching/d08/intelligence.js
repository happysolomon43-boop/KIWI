'use strict';

const {
  validateTpf03CoursePlanOutput,
  validateTpf03ScopeImpactOutput,
} = require('./canonical-plan');

function base({ capabilityId, course, taskMode, outputSchema, contextSpec, academicInput, provenanceRefs = [] }) {
  return {
    trigger: { type: 'authenticated_input', ref: `course:${course.course_id}:${taskMode}`, source: 'teaching.d08', actor_id: course.student_id },
    capabilityId,
    stateReference: { aggregate_type: 'teaching_course', aggregate_id: course.course_id, state_version: String(course.state_version) },
    preconditions: { lifecycle_state: course.lifecycle_state, subject_snapshot_ref: course.subject_snapshot_ref || null },
    provenanceRefs,
    resultContract: { output_schema_id: outputSchema.id, output_schema_version: outputSchema.version, validator_ids: ['schema','domain','provenance'] },
    taskMode,
    directive: {
      bounded_actions: ['produce the requested provisional TPF-03 planning artifact from supplied authoritative inputs'],
      allowed_operations: ['return schema-valid provisional planning output'],
      prohibited_operations: ['mutate authoritative state','claim authoritative Coverage','activate or complete a Course','change Assessment Eligibility','select provider or model'],
      evidence_purpose: taskMode,
      downstream_handoff: { type: 'validated_candidate', validator_ids: ['schema','domain','provenance'], commit_owner_boundary: 'Course Plan/Coverage domain service' },
    },
    contextSpec,
    outputSchema,
    academicInput,
    commit: false,
  };
}

function canonicalOutputSchema(id, validator) {
  return {
    id,
    version: '1',
    uncertainty_states: ['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED'],
    review_needed_field: 'review_required',
    declared_fields: [
      'status','input_state_reference','review_required','review_reasons','plan_basis','planning_principles_applied',
      'course_sequence','prerequisite_repairs','assessment_window_proposals','coverage_treatment_map','infeasibility_or_pressure',
      'unresolved_items','student_facing_plan_summary_candidate','scope_change_impact',
    ],
    validate: validator,
  };
}

function coursePlanRequest({ course, audit, diagnosticPlan = null, vpkDecisions = [], sources = [], previousPlanContext = null }) {
  const validate = async (out) => validateTpf03CoursePlanOutput(out, { course });
  const outputSchema = canonicalOutputSchema('tpf03.course-plan-scope-planning', validate);
  const sourceRefs = sources.map((source) => `source:${source.source_content_item_id}`);
  const request = base({
    capabilityId: 'teaching.curriculum.course_plan_generation',
    course,
    taskMode: 'course_plan_generation',
    outputSchema,
    contextSpec: {
      authoritative_refs: [
        { ref: `course:${course.course_id}` },
        { ref: `curriculum-audit:${audit.curriculum_audit_id}` },
        ...(diagnosticPlan ? [{ ref: `diagnostic-plan:${diagnosticPlan.diagnostic_plan_id}` }] : []),
        ...vpkDecisions.map((decision) => ({ ref: `vpk:${decision.vpk_decision_id}` })),
      ],
      provenance_refs: sources.filter((source) => source.source_kind !== 'STUDENT_SUPPLEMENT').map((source) => ({ ref: `source:${source.source_content_item_id}` })),
      untrusted_refs: sources.filter((source) => source.source_kind === 'STUDENT_SUPPLEMENT').map((source) => ({ ref: `source:${source.source_content_item_id}` })),
      context_kind: 'course_plan_generation',
      access_purpose: 'bounded_course_plan_proposal',
    },
    academicInput: {
      state_reference: { aggregate_type: 'teaching_course', aggregate_id: course.course_id, state_version: String(course.state_version) },
      course_scope_version: course.subject_snapshot_ref,
      curriculum_artifact_ref: `curriculum-audit:${audit.curriculum_audit_id}`,
      diagnostic_plan_ref: diagnosticPlan?.diagnostic_plan_id || null,
      vpk_decision_refs: vpkDecisions.map((decision) => decision.vpk_decision_id),
      source_refs: sourceRefs,
      previous_plan_context: previousPlanContext,
      authoritative_coverage_rule: 'official reconciliation occurs downstream; output may claim planned_only only',
    },
    provenanceRefs: [`curriculum-audit:${audit.curriculum_audit_id}`, ...sourceRefs, ...vpkDecisions.map((decision) => `vpk:${decision.vpk_decision_id}`)],
  });
  return {
    ...request,
    declaredAuthorityLevel: 'T3',
    schemaValidator: validate,
    domainValidator: async (out) => {
      const result = validateTpf03CoursePlanOutput(out, { course });
      if (!result.ok) return result;
      if (result.blocksFinalPlan) return { ok: false, reason: 'TEACHING_D08_TPF03_PLAN_BLOCKED' };
      return result;
    },
    provenanceValidator: async (out) => {
      const knownUnits = new Set((audit.audit_output?.learning_units || []).map((unit) => String(unit.id)));
      const used = (out.course_sequence || []).flatMap((group) => group.learning_units || []).map((unit) => String(unit.learning_unit_ref));
      return { ok: used.every((ref) => knownUnits.has(ref)), reason: 'TEACHING_D08_TPF03_UNIT_PROVENANCE_INVALID' };
    },
  };
}

function scopeChangeImpactRequest({ course, plan, candidate }) {
  const validate = async (out) => validateTpf03ScopeImpactOutput(out, { course, plan, scopeChangeId: candidate.scope_change_id });
  const outputSchema = canonicalOutputSchema('tpf03.scope-change-impact', validate);
  const request = base({
    capabilityId: 'teaching.curriculum.course_scope_change_impact_analysis',
    course,
    taskMode: 'scope_change_impact_analysis',
    outputSchema,
    contextSpec: {
      authoritative_refs: [
        { ref: `course:${course.course_id}` },
        { ref: `course-plan:${plan.course_plan_id}` },
        { ref: `scope-change:${candidate.scope_change_id}` },
      ],
      provenance_refs: [],
      untrusted_refs: [],
      context_kind: 'course_scope_change_impact',
      access_purpose: 'bounded_scope_change_proposal',
    },
    academicInput: {
      state_reference: { aggregate_type: 'teaching_course', aggregate_id: course.course_id, state_version: String(course.state_version) },
      current_plan_version: `course-plan:${plan.course_plan_id}:v${plan.version_no}`,
      scope_change_ref: candidate.scope_change_id,
      added_source_refs: candidate.added_source_refs || [],
      removed_source_refs: candidate.removed_source_refs || [],
      changed_source_refs: candidate.changed_source_refs || [],
      history_must_remain_immutable: true,
    },
    provenanceRefs: [`course-plan:${plan.course_plan_id}`, `scope-change:${candidate.scope_change_id}`],
  });
  return {
    ...request,
    declaredAuthorityLevel: 'T3',
    schemaValidator: validate,
    domainValidator: validate,
    provenanceValidator: async (out) => ({ ok: out?.scope_change_impact?.history_must_remain_immutable === true, reason: 'TEACHING_D08_SCOPE_HISTORY_INVARIANT' }),
  };
}

function createD08Intelligence({ orchestrator } = {}) {
  if (!orchestrator || typeof orchestrator.execute !== 'function') throw new TypeError('D08 intelligence requires the Teaching Orchestrator.');
  return Object.freeze({
    generateCoursePlan: (args) => orchestrator.execute(coursePlanRequest(args)),
    analyzeScopeChange: (args) => orchestrator.execute(scopeChangeImpactRequest(args)),
  });
}

module.exports = { coursePlanRequest, scopeChangeImpactRequest, createD08Intelligence };
