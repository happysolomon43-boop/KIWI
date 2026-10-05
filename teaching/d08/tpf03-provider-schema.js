'use strict';

const STRING_ARRAY = Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) });

const LEARNING_UNIT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    learning_unit_ref: Object.freeze({ type: 'string' }),
    required_scope: Object.freeze({ type: 'boolean' }),
    initial_instruction_status: Object.freeze({
      type: 'string',
      enum: Object.freeze([
        'teach_full',
        'teach_compressed',
        'validated_prior_knowledge_no_initial_instruction',
        'unresolved',
      ]),
    }),
    initial_treatment_basis: Object.freeze({ type: 'string' }),
    prerequisite_repair_refs: STRING_ARRAY,
    follow_up_treatments: Object.freeze({
      type: 'array',
      items: Object.freeze({
        type: 'string',
        enum: Object.freeze(['review_retrieval', 'mixed_practice', 'synthesis', 'transfer_check', 'none']),
      }),
    }),
    prerequisite_refs: STRING_ARRAY,
    instructional_emphasis: Object.freeze({ type: 'string', enum: Object.freeze(['high', 'medium', 'low']) }),
    emphasis_basis: Object.freeze({ type: 'string' }),
    evidence_goal: Object.freeze({ type: 'string' }),
    review_or_retention_notes: Object.freeze({ type: 'string' }),
    student_intake_accommodation_notes: Object.freeze({ type: 'string' }),
  }),
  required: Object.freeze([
    'learning_unit_ref',
    'required_scope',
    'initial_instruction_status',
    'initial_treatment_basis',
    'prerequisite_repair_refs',
    'follow_up_treatments',
    'prerequisite_refs',
    'instructional_emphasis',
    'emphasis_basis',
    'evidence_goal',
  ]),
});

const PREREQUISITE_REPAIR_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    prerequisite_ref: Object.freeze({ type: 'string' }),
    blocks_units: STRING_ARRAY,
    repair_goal: Object.freeze({ type: 'string' }),
    why_required: Object.freeze({ type: 'string' }),
  }),
  required: Object.freeze(['prerequisite_ref', 'blocks_units', 'repair_goal', 'why_required']),
});

const ASSESSMENT_WINDOW_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    purpose: Object.freeze({
      type: 'string',
      enum: Object.freeze(['diagnostic', 'classwork', 'test', 'midterm', 'final', 'other']),
    }),
    academic_position: Object.freeze({ type: 'string' }),
    scope_principle: Object.freeze({ type: 'string' }),
    scheduling_is_tentative: Object.freeze({ type: 'boolean' }),
  }),
  required: Object.freeze(['purpose', 'academic_position', 'scope_principle', 'scheduling_is_tentative']),
});

const INFEASIBILITY_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    issue: Object.freeze({ type: 'string' }),
    conflicting_requirements: STRING_ARRAY,
    cannot_be_solved_by: STRING_ARRAY,
    requires_downstream_decision: Object.freeze({
      type: 'string',
      enum: Object.freeze(['scheduling', 'deadline', 'scope_authority', 'other']),
    }),
  }),
  required: Object.freeze([
    'issue',
    'conflicting_requirements',
    'cannot_be_solved_by',
    'requires_downstream_decision',
  ]),
});

const UNRESOLVED_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    issue: Object.freeze({ type: 'string' }),
    required_input_or_authority: Object.freeze({ type: 'string' }),
    blocks_final_plan: Object.freeze({ type: 'boolean' }),
  }),
  required: Object.freeze(['issue', 'required_input_or_authority', 'blocks_final_plan']),
});

const TPF03_COURSE_PLAN_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    status: Object.freeze({
      type: 'string',
      enum: Object.freeze([
        'ok',
        'unresolved_inputs',
        'academically_infeasible_under_constraints',
        'requires_scope_review',
      ]),
    }),
    input_state_reference: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        aggregate_type: Object.freeze({ type: 'string' }),
        aggregate_id: Object.freeze({ type: 'string' }),
        state_version: Object.freeze({ type: 'string' }),
      }),
      required: Object.freeze(['aggregate_type', 'aggregate_id', 'state_version']),
    }),
    review_required: Object.freeze({ type: 'boolean' }),
    review_reasons: STRING_ARRAY,
    plan_basis: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        course_scope_version: Object.freeze({ type: 'string' }),
        curriculum_artifact_version: Object.freeze({ type: 'string' }),
        evidence_state_version: Object.freeze({ type: 'string' }),
        policy_refs: STRING_ARRAY,
        capacity_or_deadline_facts_used: STRING_ARRAY,
      }),
    }),
    planning_principles_applied: STRING_ARRAY,
    course_sequence: Object.freeze({
      type: 'array',
      items: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          sequence_group: Object.freeze({ type: 'integer' }),
          topic_or_phase: Object.freeze({ type: 'string' }),
          learning_units: Object.freeze({ type: 'array', items: LEARNING_UNIT_SCHEMA }),
        }),
        required: Object.freeze(['sequence_group', 'topic_or_phase', 'learning_units']),
      }),
    }),
    prerequisite_repairs: Object.freeze({ type: 'array', items: PREREQUISITE_REPAIR_SCHEMA }),
    assessment_window_proposals: Object.freeze({ type: 'array', items: ASSESSMENT_WINDOW_SCHEMA }),
    coverage_treatment_map: Object.freeze({
      type: 'array',
      items: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          required_source_or_unit_ref: Object.freeze({ type: 'string' }),
          planned_treatment_refs: STRING_ARRAY,
          mapping_completeness_proposal: Object.freeze({
            type: 'string',
            enum: Object.freeze(['full', 'partial', 'unresolved']),
          }),
          coverage_status_claimed: Object.freeze({ type: 'string', enum: Object.freeze(['planned_only']) }),
        }),
        required: Object.freeze([
          'required_source_or_unit_ref',
          'planned_treatment_refs',
          'mapping_completeness_proposal',
          'coverage_status_claimed',
        ]),
      }),
    }),
    infeasibility_or_pressure: Object.freeze({ type: 'array', items: INFEASIBILITY_SCHEMA }),
    unresolved_items: Object.freeze({ type: 'array', items: UNRESOLVED_ITEM_SCHEMA }),
    student_facing_plan_summary_candidate: Object.freeze({ type: 'string' }),
  }),
  required: Object.freeze([
    'status',
    'input_state_reference',
    'review_required',
    'review_reasons',
    'plan_basis',
    'planning_principles_applied',
    'course_sequence',
    'prerequisite_repairs',
    'assessment_window_proposals',
    'coverage_treatment_map',
    'infeasibility_or_pressure',
    'unresolved_items',
  ]),
  propertyOrdering: Object.freeze([
    'status',
    'input_state_reference',
    'review_required',
    'review_reasons',
    'plan_basis',
    'planning_principles_applied',
    'course_sequence',
    'prerequisite_repairs',
    'assessment_window_proposals',
    'coverage_treatment_map',
    'infeasibility_or_pressure',
    'unresolved_items',
    'student_facing_plan_summary_candidate',
  ]),
});

module.exports = { TPF03_COURSE_PLAN_RESPONSE_SCHEMA };
