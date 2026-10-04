'use strict';

// D30 realizes the frozen Phase-16 family-specific evaluation obligations without
// copying or rewriting prompt prose. These focus areas are evaluation metadata,
// not prompt instructions and never grant academic authority.
const FAMILY_EVALUATION_FOCUS = Object.freeze({
  'TPF-01': ['self_report_provenance','intake_uncertainty','preference_vs_mastery','deadline_context'],
  'TPF-02': ['source_grounding','curriculum_structure','coverage_conflict','scope_uncertainty','cross_source_reconciliation'],
  'TPF-03': ['course_scope','coverage_constraints','diagnostic_dependency','plan_feasibility','scope_nonexpansion'],
  'TPF-04': ['diagnostic_evidence_need','verification_design','alternative_valid_evidence','authority_boundary'],
  'TPF-05': ['lesson_plan','homework_plan','live_replanning','time_constraint','planned_vs_actual','ppl_preparation'],
  'TPF-06': ['response_correctness','misconception_classification','partial_credit_evidence','alternative_valid_answer','uncertainty'],
  'TPF-07': ['bounded_strategy','practice_design','representation_change','remediation_choice','standard_preservation'],
  'TPF-08': ['teacher_realization','authorized_move_only','style_envelope','no_hidden_state_mutation','student_question'],
  'TPF-09': ['longitudinal_evidence','stage_separation','provenance','insufficient_evidence','noncollapse'],
  'TPF-10': ['hard_soft_constraints','schedule_infeasibility','workload','timezone','nonmutation'],
  'TPF-11': ['rule_alignment','capability_evidence','authenticity_uncertainty','verification_path','integrity_handoff'],
  'TPF-12': ['measurement_demand','blueprint_slots','coverage','eligibility_separation','ppl_assessment_planning'],
  'TPF-13': ['item_realization','variation_trace','construct_alignment','protected_content','equivalent_variant'],
  'TPF-14': ['independent_validation','control_repair','assessment_defect','whole_paper_review','source_conflict'],
  'TPF-15': ['rubric_criterion','immutable_rubric','alternative_valid_answer','marking_uncertainty','irrelevant_context_exclusion'],
  'TPF-16': ['blind_pass_a','comparison_pass_b','moderation_disagreement','appeal_isolation','independence'],
  'TPF-17': ['progression_conditions','recovery_plan','resit_repeat','pathway_specificity','non_authoritative_proposal'],
  'TPF-18': ['identity_directive','style_envelope_exactness','transition','no_academic_authority'],
  'TPF-19': ['truth_preserving_translation','fact_pack','uncertainty_preservation','protected_field_filtering','no_second_record'],
  'TPF-20': ['preclass_preparation','postclass_reconciliation','claim_provenance','card_coverage','planned_actual_divergence','protected_content'],
});

const SUBJECT_PROFILES = Object.freeze([
  'mathematics', 'biology', 'chemistry', 'physics', 'history', 'language',
  'computer_science', 'accounting', 'interpretive_open_answer', 'mixed_learning_unit',
]);

const BASE_CASE_CLASSES = Object.freeze([
  'golden', 'negative', 'counterfactual', 'uncertainty', 'injection', 'authority_attack',
  'source_conflict', 'cross_subject', 'metamorphic', 'regression',
]);

const TPF20_CASE_CLASSES = Object.freeze([
  'plan_actual_divergence', 'planned_card_change', 'final_card_change', 'relevant_cards',
  'unrelated_cards', 'conflicting_cards', 'newly_validated_cards', 'claim_provenance',
  'card_coverage', 'partial_class', 'missed_class', 'correction', 'unsupported_bridge',
  'protected_content', 'injection', 'stale_input', 'preclass_latency', 'reconciliation_latency',
  'stability', 'subject_knowledge_type_quality', 'academic_correctness', 'explanation_quality',
  'accessibility', 'end_to_end_publication_gate',
]);

const CROSS_FAMILY_WORKFLOWS = Object.freeze([
  Object.freeze({ id:'TEACHING_EVIDENCE_CHAIN', chain:['TPF-04','TPF-05','TPF-06','TPF-07','TPF-08','TPF-09'], terminalOwner:'evidence/domain owners' }),
  Object.freeze({ id:'ASSESSMENT_CONSTRUCTION_CHAIN', chain:['TPF-12','TPF-13','TPF-14','AUTHORITATIVE_PACKAGE_LOCK'], terminalOwner:'Assessment Package owner' }),
  Object.freeze({ id:'MARKING_REVIEW_CHAIN', chain:['TPF-15','DETERMINISTIC_AGGREGATION','TPF-16','GRADEBOOK_OWNER'], terminalOwner:'Gradebook' }),
  Object.freeze({ id:'INTEGRITY_HANDOFF', chain:['TPF-11','ASSESSMENT_INTEGRITY_HANDOFF'], terminalOwner:'Assessment integrity owner' }),
  Object.freeze({ id:'TEACHER_STYLE_CHAIN', chain:['TPF-18','TPF-08'], terminalOwner:'Teacher Identity / Classroom' }),
]);

function focusFor(familyId, index = 0) {
  const focus = FAMILY_EVALUATION_FOCUS[familyId];
  if (!focus) throw new Error(`Missing D30 family evaluation focus: ${familyId}`);
  return focus[index % focus.length];
}

module.exports = {
  FAMILY_EVALUATION_FOCUS,
  SUBJECT_PROFILES,
  BASE_CASE_CLASSES,
  TPF20_CASE_CLASSES,
  CROSS_FAMILY_WORKFLOWS,
  focusFor,
};