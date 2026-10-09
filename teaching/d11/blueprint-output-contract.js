'use strict';

const {LEARNING_EVIDENCE_DESCRIPTORS,ASSISTANCE_LEVELS,OBJECTIVE_CRITICALITY}=require('./contracts');

// Mode-specific, immutable contract derived from TPF-05's canonical envelope.
// TPF-05 explicitly permits runtime mode-specific schema projection. This
// structure is appended AFTER the design-frozen prompt, never inserted inside it.
// It describes required values; it contains no student data or sample answers.
const D11_BLUEPRINT_OUTPUT_FORMAT=Object.freeze({
  authority:'D11_PROVISIONAL_LESSON_BLUEPRINT_V2',
  mode:'pre_class_lesson_blueprint_generation',
  priority:'This mode-specific output shape is the runtime output_schema; return it directly as a JSON object, not the general TPF-05 canonical envelope.',
  top_level_required:Object.freeze([
    'status','review_required','review_reasons','objectives','segments','adaptive_reserve_minutes',
    'stopping_conditions','prerequisite_checks','likely_misconceptions','examples','guided_work',
    'independent_evidence_opportunities','remediation_branches','homework_candidates','unresolved_items',
  ]),
  status_values:Object.freeze(['OK','REVIEW_NEEDED','INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT']),
  evidence_descriptor_enum:LEARNING_EVIDENCE_DESCRIPTORS,
  objective_criticality_enum:OBJECTIVE_CRITICALITY,
  assistance_level_enum:ASSISTANCE_LEVELS,
  enum_rules:'evidence_descriptor_targets[] and learning_evidence_descriptor MUST be from evidence_descriptor_enum, or null for the segment descriptor. These are planning evidence labels, not student-mastery states. Inventing labels such as PRACTICE, EXPLANATION, RECALL, DISCUSSION, or NONE is forbidden. Use [] or null when no supported evidence label applies.',
  objective_required:Object.freeze({
    id:'Unique, nonempty objective identifier within the output',
    learning_unit_ref:'Exact learning_unit_id from the current authoritative Course Plan (never an invented identifier)',
    label:'Concise instructional objective',
    criticality:'CORE | SECONDARY | ENRICHMENT; at least one CORE',
    minimum_safe_minutes:'Integer >= 0, <= 240',
    prerequisite_refs:'Array of evidence-linked prerequisite references, [] if none',
    evidence_descriptor_targets:'Array containing ONLY evidence_descriptor_enum values (exact spelling), [] if none. Never use unsupported labels.',
    independent_evidence_required:'Boolean, true for a CORE independent-use competence unless evidence says otherwise',
  }),
  segment_required:Object.freeze({
    id:'Unique nonempty segment identifier',
    kind:'OPENING | DIAGNOSTIC | INSTRUCTION | GUIDED_PRACTICE | INDEPENDENT_PRACTICE | REMEDIATION | CLOSURE or valid instructional kind',
    objective_refs:'Array of objective.id values defined above, not learning unit IDs',
    planned_minutes:'Positive integer from 1 to 240; required for EVERY segment',
    minimum_safe_minutes:'Integer from 0 to planned_minutes',
    criticality:'CORE | SECONDARY | ENRICHMENT',
    optional:'Boolean; never true for CORE segment',
    learning_evidence_descriptor:'One exact evidence_descriptor_enum value or null; NEVER invent a descriptor',
    assistance_level:'One exact assistance_level_enum value; assistance is a separate dimension from evidence labels',
    representation:'Short description or null',
    stopping_condition:'Bounded stopping rule or null',
  }),
  time_rules:'All fields ending in _minutes must be JSON integer numbers only (no strings, fractions, ranges, or units). Apply academic_input.lesson_time_budget EXACTLY: reserve min <= adaptive_reserve_minutes <= reserve max; sum(segments.planned_minutes) + adaptive_reserve_minutes <= scheduled_minutes; CORE minimum safe load + reserve <= scheduled_minutes. When late-start recovery reduces remaining time, use the supplied reduced time budget, NEVER original Class duration or overtime.',
  supporting_arrays:'stopping_conditions is an array of strings; prerequisite_checks, likely_misconceptions, examples, guided_work, independent_evidence_opportunities, remediation_branches, homework_candidates, unresolved_items are ARRAYS OF OBJECTS. Return [] where legitimately empty; do not omit the keys.',
  frozen_tpf05_projection:Object.freeze({
    'lesson_plan.phases':'segments, with each phase assigned an id, objective_refs and integer planned_minutes',
    'lesson_plan.time_budget.adaptive_reserve_minutes':'top-level adaptive_reserve_minutes integer',
    'objectives[].objective_ref':'objectives[].learning_unit_ref; also supply unique objectives[].id',
    'objectives[].classification':'objectives[].criticality (CORE, SECONDARY, ENRICHMENT)',
    'lesson_plan.stopping_rules':'top-level stopping_conditions',
    'homework.task_set':'top-level homework_candidates',
  }),
  integrity:'Do not invent Learning Unit refs, facts, mastery, attendance or source evidence. If a complete plan is impossible, return REVIEW_NEEDED with explicit review_reasons, but preserve required fields and do not fabricate a valid plan.',
});

function blueprintOutputContractForInvocation(invocation){
  return invocation?.prompt?.family_id==='TPF-05' &&
    invocation?.output_schema?.id==='d11.lesson-blueprint' &&
    invocation?.prompt?.task_mode==='pre_class_lesson_blueprint_generation'
      ? D11_BLUEPRINT_OUTPUT_FORMAT : null;
}
module.exports={D11_BLUEPRINT_OUTPUT_FORMAT,blueprintOutputContractForInvocation};
