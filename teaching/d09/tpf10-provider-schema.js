'use strict';

const STRING_ARRAY = Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) });
const STRING = Object.freeze({ type: 'string' });
const NULLABLE_STRING = Object.freeze({ type: 'string', nullable: true });
const BOOLEAN = Object.freeze({ type: 'boolean' });
const TRUE = Object.freeze({ type: 'boolean', enum: Object.freeze([true]) });
const FALSE = Object.freeze({ type: 'boolean', enum: Object.freeze([false]) });

const LOAD_ESTIMATE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    scope_ref: STRING,
    effort_range: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        min: Object.freeze({ type: 'number' }),
        max: Object.freeze({ type: 'number' }),
        unit: Object.freeze({ type: 'string', enum: Object.freeze(['minutes']) }),
      }),
      required: Object.freeze(['min', 'max', 'unit']),
    }),
    estimate_basis: STRING_ARRAY,
    uncertainty: Object.freeze({ type: 'string', enum: Object.freeze(['low', 'medium', 'high']) }),
  }),
  required: Object.freeze(['scope_ref', 'effort_range', 'estimate_basis', 'uncertainty']),
});

const TPF10_INSTRUCTIONAL_LOAD_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    status: Object.freeze({
      type: 'string',
      enum: Object.freeze(['ok','insufficient_context','state_conflict','deterministic_feasibility_required','impossible_or_overcommitted','policy_block','review_required']),
    }),
    input_state_reference: STRING,
    capability_id: Object.freeze({ type: 'string', enum: Object.freeze(['teaching.scheduling.instructional_load_estimation']) }),
    task_mode: Object.freeze({ type: 'string', enum: Object.freeze(['instructional_load_estimation']) }),
    review_required: BOOLEAN,
    review_reasons: STRING_ARRAY,
    planning_scope: Object.freeze({
      type: 'object',
      properties: Object.freeze({ semester_ref:NULLABLE_STRING,course_refs:STRING_ARRAY,time_horizon:STRING,timezone:STRING,authoritative_schedule_ref:NULLABLE_STRING }),
      required: Object.freeze(['semester_ref','course_refs','time_horizon','timezone','authoritative_schedule_ref']),
    }),
    constraints: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        hard_constraints_used:Object.freeze({type:'array',items:Object.freeze({type:'object',properties:Object.freeze({ref:STRING,effect:STRING}),required:Object.freeze(['ref','effect'])})}),
        soft_preferences_used:Object.freeze({type:'array',items:Object.freeze({type:'object',properties:Object.freeze({ref:STRING,effect:STRING}),required:Object.freeze(['ref','effect'])})}),
        hard_deadlines:Object.freeze({type:'array',items:Object.freeze({type:'object',properties:Object.freeze({ref:STRING,timestamp_or_window:STRING}),required:Object.freeze(['ref','timestamp_or_window'])})}),
        protected_periods:Object.freeze({type:'array',items:Object.freeze({type:'object',properties:Object.freeze({ref:STRING}),required:Object.freeze(['ref'])})}),
        assumptions:STRING_ARRAY,
      }),
      required:Object.freeze(['hard_constraints_used','soft_preferences_used','hard_deadlines','protected_periods','assumptions']),
    }),
    capacity_analysis: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        instructional_load_estimates:Object.freeze({type:'array',items:LOAD_ESTIMATE_SCHEMA}),
        recovery_headroom:Object.freeze({type:'object',properties:Object.freeze({authoritative_status:Object.freeze({type:'string',enum:Object.freeze(['healthy','limited','critical','unavailable','not_supplied'])}),model_interpretation:STRING,invented_numeric_headroom:FALSE}),required:Object.freeze(['authoritative_status','model_interpretation','invented_numeric_headroom'])}),
        schedule_debt:Object.freeze({type:'object',properties:Object.freeze({authoritative_debt_ref:NULLABLE_STRING,supported_causes:STRING_ARRAY,uncertain_causes:STRING_ARRAY,academic_effect:STRING}),required:Object.freeze(['authoritative_debt_ref','supported_causes','uncertain_causes','academic_effect'])}),
        global_workload_risks:STRING_ARRAY,
      }),
      required:Object.freeze(['instructional_load_estimates','recovery_headroom','schedule_debt','global_workload_risks']),
    }),
    proposal: Object.freeze({
      type:'object',
      properties:Object.freeze({
        proposal_type:Object.freeze({type:'string',enum:Object.freeze(['timetable','recovery','workload_allocation','request_alternative','participation_check','no_change','none'])}),
        options:Object.freeze({type:'array',items:Object.freeze({type:'object',properties:Object.freeze({option_id:STRING,description:STRING,uses_existing_commitments:BOOLEAN,hard_constraints_respected:BOOLEAN,soft_preferences_satisfied:STRING_ARRAY,soft_preferences_traded_off:Object.freeze({type:'array',items:Object.freeze({type:'object',properties:Object.freeze({ref:STRING,reason:STRING}),required:Object.freeze(['ref','reason'])})}),required_academic_elements_preserved:BOOLEAN,recovery_headroom_effect:Object.freeze({type:'string',enum:Object.freeze(['improves','preserves','consumes','unknown'])}),routine_use_of_reserved_recovery_capacity:BOOLEAN,student_decision_required:BOOLEAN,request_approval_required:BOOLEAN,scheduler_validation_required:BOOLEAN,tradeoffs:STRING_ARRAY,risk_if_rejected_or_declined:NULLABLE_STRING}),required:Object.freeze(['option_id','description','uses_existing_commitments','hard_constraints_respected','soft_preferences_satisfied','soft_preferences_traded_off','required_academic_elements_preserved','recovery_headroom_effect','routine_use_of_reserved_recovery_capacity','student_decision_required','request_approval_required','scheduler_validation_required','tradeoffs','risk_if_rejected_or_declined'])})}),
        preferred_for_validation_option_id:NULLABLE_STRING,
        preference_basis:STRING_ARRAY,
        selection_rule:STRING,
      }),
      required:Object.freeze(['proposal_type','options','preferred_for_validation_option_id','preference_basis','selection_rule']),
    }),
    inactivity_interpretation:Object.freeze({type:'object',properties:Object.freeze({check_in_warranted:BOOLEAN,supported_reason:NULLABLE_STRING,misconduct_inference_made:FALSE,attendance_outcome_made:FALSE}),required:Object.freeze(['check_in_warranted','supported_reason','misconduct_inference_made','attendance_outcome_made'])}),
    validation_and_handoff:Object.freeze({type:'object',properties:Object.freeze({deterministic_scheduler_validation_required:TRUE,request_system_required:BOOLEAN,course_planner_review_required:BOOLEAN,lesson_planner_review_required:BOOLEAN,diagnostic_reentry_recommended:BOOLEAN,unresolved_dependencies:STRING_ARRAY}),required:Object.freeze(['deterministic_scheduler_validation_required','request_system_required','course_planner_review_required','lesson_planner_review_required','diagnostic_reentry_recommended','unresolved_dependencies'])}),
    confidence:Object.freeze({type:'string',enum:Object.freeze(['low','medium','high'])}),
  }),
  required:Object.freeze(['status','input_state_reference','capability_id','task_mode','review_required','review_reasons','planning_scope','constraints','capacity_analysis','proposal','inactivity_interpretation','validation_and_handoff','confidence']),
});

module.exports = { TPF10_INSTRUCTIONAL_LOAD_RESPONSE_SCHEMA };
