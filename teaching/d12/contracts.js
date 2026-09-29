'use strict';

const RESPONSE_STATUSES = Object.freeze(new Set([
  'ok','insufficient_context','evaluation_contract_missing','item_validity_concern','modality_limit',
  'evidence_contaminated','prerequisite_investigation_needed','policy_block',
]));
const ITEM_VALIDITY = Object.freeze(new Set(['valid','concern','invalid','unknown']));
const FINAL_CORRECTNESS = Object.freeze(new Set(['correct','incorrect','partially_correct','no_response','not_applicable','indeterminate']));
const CONCEPTUAL_SUPPORT = Object.freeze(new Set(['strong','partial','weak','unsupported','not_observed','not_assessed','indeterminate']));
const REASONING_METHOD = Object.freeze(new Set(['valid','mostly_valid','partially_valid','invalid','not_shown','not_required','indeterminate']));
const COMPLETENESS = Object.freeze(new Set(['complete','partial','minimal','not_applicable','indeterminate']));
const EVIDENCE_SUFFICIENCY = Object.freeze(new Set(['sufficient_for_requested_inference','partially_sufficient','insufficient','no_evidence','contaminated','indeterminate']));
const EVALUATOR_CONFIDENCE = Object.freeze(new Set(['high','medium','low']));
const MISCONCEPTION_STATUS = Object.freeze(new Set(['none_supported','candidate','recurring_supported','indeterminate']));
const PREREQUISITE_STATUS = Object.freeze(new Set(['none_supported','candidate_failure','investigation_needed','indeterminate']));
const LEARNING_STAGES = Object.freeze(new Set(['demonstration','guided','independent_familiar','independent_varied','method_selection','delayed_retrieval','integration_transfer','unknown','not_applicable']));
const ASSISTANCE_LEVELS = Object.freeze(['none','attention','directional','conceptual','partial_step','strong_scaffold','worked_example','full_instruction']);
const ASSISTANCE_SET = Object.freeze(new Set(ASSISTANCE_LEVELS));
const PEDAGOGY_STATUSES = Object.freeze(new Set(['ok','insufficient_context','policy_block','source_conflict','validation_needed','replan_needed','diagnosis_required','modality_limit']));
const PEDAGOGY_ACTIONS = Object.freeze(new Set([
  'wait','probe','explain','hint','scaffold','worked_example','change_representation','guided_attempt',
  'independent_attempt','varied_independent_attempt','misconception_repair','micro_remediation','evidence_task',
  'review','break_recommendation','closure_recommendation','replan','other',
]));
const STRATEGY_CLASSES = Object.freeze(new Set(['probe','explanation','representation','hint','worked_example','decomposition','prerequisite_repair','practice','verification','other']));
const KNOWLEDGE_TYPES = Object.freeze(new Set(['factual','conceptual','procedural','analytical','interpretive','applied','communicative','experimental_practical','mixed']));
const STUDENT_ACTIONS = Object.freeze(new Set(['recall','explain','calculate','derive','compare','interpret','argue','create','debug','predict','classify','analyze_evidence','trace','prove','model','design','evaluate','communicate','observe','perform','other']));
const ANSWER_SPACES = Object.freeze(new Set(['single_objective','multiple_valid_approaches','open_interpretation','bounded_constructed','mixed']));
const REPRESENTATIONS = Object.freeze(new Set(['text','equation','diagram','graph','timeline','source','code','data','image','simulation','table','physical_performance','audio','map','other']));
const TEACHER_CORRECTION_RESULTS = Object.freeze(new Set(['not_applicable','teacher_correct','teacher_error_confirmed','unresolved']));
const EVIDENCE_USE_LIMITS = Object.freeze(new Set(['none','limited','do_not_use_negative_evidence','cannot_evaluate']));
const TARGET_EVIDENCE_CLAIMS = Object.freeze(new Set(['recall','reproduce','independent_performance','adapt_to_variation','select_method','retain_after_delay','integrate_or_transfer','other']));
const REUSE_POLICIES = Object.freeze(new Set(['exact_reuse_allowed','near_reuse_allowed','familiar_family_preferred','fresh_equivalent_required','materially_varied_required','unknown']));
const SUPPORT_STATES = Object.freeze(new Set([...ASSISTANCE_LEVELS,'unknown']));
const RESPONSE_ALIGNMENTS = Object.freeze(new Set(['direct','partially_aligned','off_target','not_applicable','indeterminate']));
const STAGE_SUPPORT_STATUSES = Object.freeze(new Set(['supported','not_established','indeterminate']));
const COPYABILITY_RISKS = Object.freeze(new Set(['low','medium','high','unknown']));
const METHOD_SELECTION_OBSERVED = Object.freeze(new Set(['yes','no','not_required','indeterminate']));
const COMPONENT_STATUSES = Object.freeze(new Set(['supported','partially_supported','missing','incorrect','indeterminate','not_applicable']));
const ERROR_TYPES = Object.freeze(new Set(['conceptual_error','procedural_slip','arithmetic_error','notation_error','unit_error','incomplete_reasoning','misunderstood_wording','off_target','unsupported_claim','other']));
const ERROR_SEVERITIES = Object.freeze(new Set(['local','material','blocking','uncertain']));
const HYPOTHESIS_CONFIDENCE = Object.freeze(new Set(['high','medium','low','not_applicable']));
const RESPONSE_ASSISTANCE_LEVELS = Object.freeze(new Set(['none','light','moderate','strong','answer_or_method_exposed','unknown']));
const INDEPENDENCE_INTERPRETATIONS = Object.freeze(new Set(['independent_supported','partially_assisted','heavily_assisted','contaminated','unknown']));
const SUPPORT_CONTEXT_TYPES = Object.freeze(new Set(['instructional_hint','scaffold','worked_example','answer_exposure','collaboration','allowed_tool','accessibility_accommodation','access_support','other']));
const SUPPORT_POLICY_STATUSES = Object.freeze(new Set(['allowed','disallowed','unknown','not_applicable']));
const SUPPORT_EFFECTS = Object.freeze(new Set(['none','minor','material','contaminating','unknown']));
const PEDAGOGY_ACTIVE_MODES = Object.freeze(new Set(['learning','guided_practice','independent_practice','homework','controlled_assessment','examination','other']));
const PEDAGOGY_DESIRED_STAGES = Object.freeze(new Set([...LEARNING_STAGES,'stabilize_current']));
const REUSE_INTENTS = Object.freeze(new Set(['deliberate_repetition','fluency','familiar_independent_check','fresh_equivalent','variation','method_selection','integration','retention','not_applicable']));
const CONTENT_VALIDATION = Object.freeze(new Set(['checked','validation_needed','not_applicable']));
const TEACHER_CORRECTION_STATUSES = Object.freeze(new Set(['ok','insufficient_context','directive_conflict','policy_block','source_conflict','validation_needed','correction_required','handoff_required']));

const SUBJECT_TEMPLATE_DEFAULTS = Object.freeze({
  mathematics: Object.freeze({ knowledge_type:'mixed', primary_student_actions:['calculate','derive','explain','prove'], answer_space:'multiple_valid_approaches', representations:['equation','graph','diagram','text'] }),
  science: Object.freeze({ knowledge_type:'mixed', primary_student_actions:['explain','predict','calculate','analyze_evidence','design'], answer_space:'multiple_valid_approaches', representations:['text','equation','diagram','graph','data','simulation'] }),
  humanities: Object.freeze({ knowledge_type:'interpretive', primary_student_actions:['interpret','argue','compare','analyze_evidence'], answer_space:'open_interpretation', representations:['text','source','timeline','image'] }),
  languages: Object.freeze({ knowledge_type:'communicative', primary_student_actions:['communicate','interpret','create','explain'], answer_space:'multiple_valid_approaches', representations:['text','audio','image'] }),
  computer_science: Object.freeze({ knowledge_type:'mixed', primary_student_actions:['create','debug','trace','explain'], answer_space:'multiple_valid_approaches', representations:['code','text','data','diagram'] }),
  geography: Object.freeze({ knowledge_type:'mixed', primary_student_actions:['interpret','compare','analyze_evidence','explain'], answer_space:'multiple_valid_approaches', representations:['map','graph','data','text','image'].filter((v)=>REPRESENTATIONS.has(v)) }),
  economics_business: Object.freeze({ knowledge_type:'applied', primary_student_actions:['calculate','analyze_evidence','explain','evaluate'], answer_space:'multiple_valid_approaches', representations:['text','equation','graph','data'] }),
  government_civics: Object.freeze({ knowledge_type:'interpretive', primary_student_actions:['explain','compare','argue','analyze_evidence'], answer_space:'open_interpretation', representations:['text','source','timeline','data'] }),
  accounting: Object.freeze({ knowledge_type:'procedural', primary_student_actions:['calculate','classify','explain'], answer_space:'single_objective', representations:['data','equation','text'] }),
  visual_practical: Object.freeze({ knowledge_type:'experimental_practical', primary_student_actions:['observe','design','perform','explain'], answer_space:'bounded_constructed', representations:['image','diagram','data','simulation','physical_performance'] }),
});

function fail(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requiredObject(value, code) { if (!isObject(value)) fail('Expected structured object.', code); return value; }
function requiredArray(value, code) { if (!Array.isArray(value)) fail('Expected array.', code); return value; }
function requiredString(value, code) { const out=String(value ?? '').trim(); if(!out) fail('Expected non-empty string.',code); return out; }
function enumValue(value, allowed, code) { const out=String(value ?? '').trim(); if(!allowed.has(out)) fail('Unsupported enum value.',code,{value:out}); return out; }

function recursivelyHasForbiddenAuthorityKey(value, path='') {
  if (Array.isArray(value)) {
    for (let i=0;i<value.length;i+=1) {
      const found=recursivelyHasForbiddenAuthorityKey(value[i],path+'['+i+']');
      if(found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  const forbidden = new Set([
    'official_mark','official_grade','grade','percentage','mastery_probability','mastery_state','knowledge_state',
    'durable_mastery','persistent_misconception','global_knowledge_state','student_intent','inferred_intent','emotion_state',
    'ability_label','progression_outcome','attendance_outcome',
  ]);
  for (const [key,child] of Object.entries(value)) {
    const here=path ? path+'.'+key : key;
    if(forbidden.has(key)) return here;
    const found=recursivelyHasForbiddenAuthorityKey(child,here);
    if(found) return found;
  }
  return null;
}

function validateDemandVector(value, code='TEACHING_D12_DEMAND_VECTOR_INVALID') {
  const obj=requiredObject(value,code);
  const dimensions={
    familiarity:new Set(['exact_reuse','near_reuse','familiar_family','fresh_equivalent','new_representation','new_context_same_construct','integrated','unknown']),
    method_cueing:new Set(['explicit','partial','none','not_applicable']),
    representation_demand:new Set(['same_representation','alternate_familiar_representation','new_legitimate_representation','cross_representation_connection','not_applicable']),
    integration_demand:new Set(['isolated_construct','multi_step_same_construct','combine_eligible_constructs','embedded_in_broader_problem','not_applicable']),
    retention_timing:new Set(['immediate','same_session_later','spaced','delayed','not_applicable']),
  };
  const out={};
  for(const [key,set] of Object.entries(dimensions)) out[key]=enumValue(obj[key],set,code);
  return Object.freeze(out);
}

function validateResponseEvaluation(output,{trustedPrerequisiteRefs=[],trustedPriorRecurrence=false}={}) {
  const out=requiredObject(output,'TEACHING_D12_RESPONSE_EVALUATION_SCHEMA_INVALID');
  const forbidden=recursivelyHasForbiddenAuthorityKey(out);
  if(forbidden) fail('Response evaluation exceeded D12 authority.','TEACHING_D12_RESPONSE_EVALUATION_AUTHORITY_EXCEEDED',{field:forbidden});
  enumValue(out.status,RESPONSE_STATUSES,'TEACHING_D12_RESPONSE_EVALUATION_STATUS_INVALID');
  requiredString(out.input_state_reference,'TEACHING_D12_RESPONSE_EVALUATION_STATE_REF_REQUIRED');
  requiredString(out.task_ref,'TEACHING_D12_RESPONSE_EVALUATION_TASK_REF_REQUIRED');
  const targets=requiredArray(out.target_competence_refs,'TEACHING_D12_RESPONSE_EVALUATION_TARGETS_INVALID');
  if(!targets.length) fail('At least one target competence is required.','TEACHING_D12_RESPONSE_EVALUATION_TARGET_REQUIRED');
  if(typeof out.review_required!=='boolean') fail('review_required boolean is required.','TEACHING_D12_RESPONSE_EVALUATION_REVIEW_FLAG_INVALID');
  requiredArray(out.review_reasons,'TEACHING_D12_RESPONSE_EVALUATION_REVIEW_REASONS_INVALID');

  const item=requiredObject(out.item_validity,'TEACHING_D12_RESPONSE_EVALUATION_ITEM_VALIDITY_INVALID');
  const itemStatus=enumValue(item.status,ITEM_VALIDITY,'TEACHING_D12_RESPONSE_EVALUATION_ITEM_VALIDITY_INVALID');
  requiredArray(item.issues,'TEACHING_D12_RESPONSE_EVALUATION_ITEM_ISSUES_INVALID');
  if(typeof item.student_penalty_protection_required!=='boolean') fail('Penalty protection flag required.','TEACHING_D12_RESPONSE_EVALUATION_PENALTY_FLAG_INVALID');
  enumValue(item.evidence_use_limit,EVIDENCE_USE_LIMITS,'TEACHING_D12_RESPONSE_EVALUATION_EVIDENCE_USE_LIMIT_INVALID');
  if(itemStatus==='invalid' && item.student_penalty_protection_required!==true) fail('Invalid item requires student penalty protection.','TEACHING_D12_RESPONSE_EVALUATION_INVALID_ITEM_PROTECTION_REQUIRED');

  const claim=requiredObject(out.evidence_claim_contract,'TEACHING_D12_RESPONSE_EVALUATION_CLAIM_INVALID');
  enumValue(claim.target_evidence_claim,TARGET_EVIDENCE_CLAIMS,'TEACHING_D12_RESPONSE_EVALUATION_CLAIM_TARGET_INVALID');
  validateDemandVector(claim.demand_vector,'TEACHING_D12_RESPONSE_EVALUATION_DEMAND_INVALID');
  requiredArray(claim.instructional_lineage_refs,'TEACHING_D12_RESPONSE_EVALUATION_LINEAGE_INVALID');
  enumValue(claim.reuse_policy,REUSE_POLICIES,'TEACHING_D12_RESPONSE_EVALUATION_REUSE_POLICY_INVALID');
  enumValue(claim.support_state,SUPPORT_STATES,'TEACHING_D12_RESPONSE_EVALUATION_SUPPORT_STATE_INVALID');
  requiredString(claim.inference_ceiling,'TEACHING_D12_RESPONSE_EVALUATION_INFERENCE_CEILING_REQUIRED');

  const assessment=requiredObject(out.response_assessment,'TEACHING_D12_RESPONSE_EVALUATION_ASSESSMENT_INVALID');
  enumValue(assessment.final_result_correctness,FINAL_CORRECTNESS,'TEACHING_D12_RESPONSE_EVALUATION_CORRECTNESS_INVALID');
  enumValue(assessment.conceptual_support,CONCEPTUAL_SUPPORT,'TEACHING_D12_RESPONSE_EVALUATION_CONCEPT_INVALID');
  enumValue(assessment.reasoning_or_method,REASONING_METHOD,'TEACHING_D12_RESPONSE_EVALUATION_REASONING_INVALID');
  enumValue(assessment.completeness,COMPLETENESS,'TEACHING_D12_RESPONSE_EVALUATION_COMPLETENESS_INVALID');
  enumValue(assessment.response_alignment,RESPONSE_ALIGNMENTS,'TEACHING_D12_RESPONSE_EVALUATION_ALIGNMENT_INVALID');
  enumValue(assessment.evidence_sufficiency,EVIDENCE_SUFFICIENCY,'TEACHING_D12_RESPONSE_EVALUATION_EVIDENCE_INVALID');
  enumValue(assessment.learning_stage_supported,LEARNING_STAGES,'TEACHING_D12_RESPONSE_EVALUATION_STAGE_INVALID');
  enumValue(assessment.learning_stage_support_status,STAGE_SUPPORT_STATUSES,'TEACHING_D12_RESPONSE_EVALUATION_STAGE_STATUS_INVALID');
  enumValue(assessment.copyability_risk,COPYABILITY_RISKS,'TEACHING_D12_RESPONSE_EVALUATION_COPYABILITY_INVALID');
  enumValue(assessment.method_selection_observed,METHOD_SELECTION_OBSERVED,'TEACHING_D12_RESPONSE_EVALUATION_METHOD_SELECTION_INVALID');
  enumValue(assessment.evaluator_confidence,EVALUATOR_CONFIDENCE,'TEACHING_D12_RESPONSE_EVALUATION_CONFIDENCE_INVALID');
  requiredString(assessment.evaluator_confidence_basis,'TEACHING_D12_RESPONSE_EVALUATION_CONFIDENCE_BASIS_REQUIRED');

  for(const component of requiredArray(out.component_analysis,'TEACHING_D12_RESPONSE_EVALUATION_COMPONENTS_INVALID')){
    const c=requiredObject(component,'TEACHING_D12_RESPONSE_EVALUATION_COMPONENT_INVALID');
    requiredString(c.component_or_criterion,'TEACHING_D12_RESPONSE_EVALUATION_COMPONENT_REF_REQUIRED');
    enumValue(c.status,COMPONENT_STATUSES,'TEACHING_D12_RESPONSE_EVALUATION_COMPONENT_STATUS_INVALID');
  }
  for(const errorItem of requiredArray(out.error_analysis,'TEACHING_D12_RESPONSE_EVALUATION_ERRORS_INVALID')){
    const e=requiredObject(errorItem,'TEACHING_D12_RESPONSE_EVALUATION_ERROR_INVALID');
    enumValue(e.type,ERROR_TYPES,'TEACHING_D12_RESPONSE_EVALUATION_ERROR_TYPE_INVALID');
    enumValue(e.severity_for_target_competence,ERROR_SEVERITIES,'TEACHING_D12_RESPONSE_EVALUATION_ERROR_SEVERITY_INVALID');
    enumValue(e.confidence,EVALUATOR_CONFIDENCE,'TEACHING_D12_RESPONSE_EVALUATION_ERROR_CONFIDENCE_INVALID');
  }

  const misconception=requiredObject(out.misconception,'TEACHING_D12_RESPONSE_EVALUATION_MISCONCEPTION_INVALID');
  const misconceptionStatus=enumValue(misconception.status,MISCONCEPTION_STATUS,'TEACHING_D12_RESPONSE_EVALUATION_MISCONCEPTION_INVALID');
  requiredArray(misconception.affected_competence_refs,'TEACHING_D12_RESPONSE_EVALUATION_MISCONCEPTION_TARGETS_INVALID');
  requiredArray(misconception.supporting_evidence_refs,'TEACHING_D12_RESPONSE_EVALUATION_MISCONCEPTION_EVIDENCE_INVALID');
  requiredArray(misconception.alternative_explanations,'TEACHING_D12_RESPONSE_EVALUATION_MISCONCEPTION_ALTERNATIVES_INVALID');
  enumValue(misconception.confidence,HYPOTHESIS_CONFIDENCE,'TEACHING_D12_RESPONSE_EVALUATION_MISCONCEPTION_CONFIDENCE_INVALID');
  if(['candidate','recurring_supported'].includes(misconceptionStatus) && !String(misconception.hypothesis||'').trim()) fail('Misconception candidate requires a specific hypothesis.','TEACHING_D12_RESPONSE_EVALUATION_MISCONCEPTION_HYPOTHESIS_REQUIRED');
  if(misconceptionStatus==='recurring_supported' && !trustedPriorRecurrence) fail('Recurring misconception requires trusted recurrence evidence.','TEACHING_D12_RESPONSE_EVALUATION_RECURRENCE_UNTRUSTED');

  const prerequisite=requiredObject(out.prerequisite,'TEACHING_D12_RESPONSE_EVALUATION_PREREQUISITE_INVALID');
  const prerequisiteStatus=enumValue(prerequisite.status,PREREQUISITE_STATUS,'TEACHING_D12_RESPONSE_EVALUATION_PREREQUISITE_INVALID');
  requiredArray(prerequisite.supporting_evidence_refs,'TEACHING_D12_RESPONSE_EVALUATION_PREREQUISITE_EVIDENCE_INVALID');
  requiredArray(prerequisite.alternative_explanations,'TEACHING_D12_RESPONSE_EVALUATION_PREREQUISITE_ALTERNATIVES_INVALID');
  enumValue(prerequisite.confidence,HYPOTHESIS_CONFIDENCE,'TEACHING_D12_RESPONSE_EVALUATION_PREREQUISITE_CONFIDENCE_INVALID');
  const prerequisiteRef=prerequisite.prerequisite_ref == null ? null : String(prerequisite.prerequisite_ref);
  if(prerequisiteRef && !new Set(trustedPrerequisiteRefs.map(String)).has(prerequisiteRef)) fail('Prerequisite reference was not supplied by trusted dependency context.','TEACHING_D12_RESPONSE_EVALUATION_PREREQUISITE_UNTRUSTED',{prerequisiteRef});
  if(prerequisiteStatus==='candidate_failure' && !prerequisiteRef) fail('Candidate prerequisite failure requires a trusted prerequisite ref.','TEACHING_D12_RESPONSE_EVALUATION_PREREQUISITE_REF_REQUIRED');

  const attempt=requiredObject(out.attempt_context,'TEACHING_D12_RESPONSE_EVALUATION_ATTEMPT_INVALID');
  if(!Number.isInteger(Number(attempt.attempt_count)) || Number(attempt.attempt_count)<0) fail('Attempt count must be non-negative integer.','TEACHING_D12_RESPONSE_EVALUATION_ATTEMPT_COUNT_INVALID');
  if(typeof attempt.self_correction_without_new_help!=='boolean'||typeof attempt.known_system_or_network_interruption!=='boolean') fail('Attempt context booleans are required.','TEACHING_D12_RESPONSE_EVALUATION_ATTEMPT_CONTEXT_INVALID');

  const assistance=requiredObject(out.assistance_and_independence,'TEACHING_D12_RESPONSE_EVALUATION_ASSISTANCE_INVALID');
  for(const entry of requiredArray(assistance.support_context,'TEACHING_D12_RESPONSE_EVALUATION_SUPPORT_CONTEXT_INVALID')){
    const support=requiredObject(entry,'TEACHING_D12_RESPONSE_EVALUATION_SUPPORT_ENTRY_INVALID');
    enumValue(support.type,SUPPORT_CONTEXT_TYPES,'TEACHING_D12_RESPONSE_EVALUATION_SUPPORT_TYPE_INVALID');
    enumValue(support.policy_status,SUPPORT_POLICY_STATUSES,'TEACHING_D12_RESPONSE_EVALUATION_SUPPORT_POLICY_INVALID');
    enumValue(support.effect_on_competence_inference,SUPPORT_EFFECTS,'TEACHING_D12_RESPONSE_EVALUATION_SUPPORT_EFFECT_INVALID');
  }
  enumValue(assistance.assistance_level,RESPONSE_ASSISTANCE_LEVELS,'TEACHING_D12_RESPONSE_EVALUATION_ASSISTANCE_LEVEL_INVALID');
  requiredArray(assistance.resource_context,'TEACHING_D12_RESPONSE_EVALUATION_RESOURCE_CONTEXT_INVALID');
  enumValue(assistance.independence_interpretation,INDEPENDENCE_INTERPRETATIONS,'TEACHING_D12_RESPONSE_EVALUATION_INDEPENDENCE_INVALID');
  requiredString(assistance.evidence_limit,'TEACHING_D12_RESPONSE_EVALUATION_EVIDENCE_LIMIT_REQUIRED');

  const reported=requiredObject(out.student_reported_confidence,'TEACHING_D12_RESPONSE_EVALUATION_STUDENT_CONFIDENCE_INVALID');
  if(typeof reported.provided!=='boolean') fail('Student-reported confidence provided flag required.','TEACHING_D12_RESPONSE_EVALUATION_STUDENT_CONFIDENCE_FLAG_INVALID');
  const next=requiredObject(out.next_evidence_need,'TEACHING_D12_RESPONSE_EVALUATION_NEXT_EVIDENCE_INVALID');
  if(typeof next.needed!=='boolean') fail('next_evidence_need.needed boolean is required.','TEACHING_D12_RESPONSE_EVALUATION_NEXT_EVIDENCE_FLAG_INVALID');
  if(next.required_demand_vector) validateDemandVector(next.required_demand_vector,'TEACHING_D12_RESPONSE_EVALUATION_NEXT_EVIDENCE_INVALID');
  requiredObject(out.handoff,'TEACHING_D12_RESPONSE_EVALUATION_HANDOFF_INVALID');
  requiredArray(out.uncertainties,'TEACHING_D12_RESPONSE_EVALUATION_UNCERTAINTIES_INVALID');

  if(item.student_penalty_protection_required && assessment.evidence_sufficiency==='sufficient_for_requested_inference' && assessment.final_result_correctness==='incorrect') fail('Protected invalid/system-owned item cannot supply unrestricted negative inference.','TEACHING_D12_RESPONSE_EVALUATION_PENALTY_PROTECTION_BREACH');
  return Object.freeze(out);
}

function assistanceRank(level) {
  const normalized=String(level ?? '').trim().toLowerCase();
  const rank=ASSISTANCE_LEVELS.indexOf(normalized);
  if(rank<0) fail('Unknown assistance level.','TEACHING_D12_ASSISTANCE_LEVEL_INVALID',{level});
  return rank;
}

function enforceAssistanceCeiling({currentLevel='none',proposedLevel='none',ceiling='none',helpRequestCount=0,accessSupport=false,allowedTool=false}={}) {
  const current=ASSISTANCE_LEVELS[assistanceRank(currentLevel)];
  const proposed=ASSISTANCE_LEVELS[assistanceRank(proposedLevel)];
  const max=ASSISTANCE_LEVELS[assistanceRank(ceiling)];
  if(assistanceRank(proposed)>assistanceRank(max)) fail('Proposed assistance exceeds Controller/policy ceiling.','TEACHING_D12_ASSISTANCE_CEILING_EXCEEDED',{proposed,ceiling:max});
  return Object.freeze({
    current_level:current,
    proposed_level:proposed,
    assistance_ceiling:max,
    repeated_help_requests:Number(helpRequestCount)||0,
    student_help_request_changed_ceiling:false,
    accessibility_or_access_support:Boolean(accessSupport),
    policy_permitted_tool:Boolean(allowedTool),
  });
}

function evidenceConsequenceForAssistance({assistanceLevel='none',answerOrEssentialMethodExposed=false}={}) {
  const level=ASSISTANCE_LEVELS[assistanceRank(assistanceLevel)];
  const rank=assistanceRank(level);
  const contaminated=Boolean(answerOrEssentialMethodExposed) || rank>=assistanceRank('worked_example');
  return Object.freeze({
    evidence_strength: contaminated ? 'CONTAMINATED' : rank===0 ? 'FULL' : rank<=2 ? 'LIMITED' : 'ASSISTED',
    independent_performance: contaminated ? false : rank===0 ? true : null,
    independence_consequence: contaminated ? 'current_item_no_longer_independent' : rank===0 ? 'none' : 'reduced_independence',
    current_item_evidence_status: contaminated ? 'contaminated_for_independent_evidence' : rank===0 ? 'unchanged' : 'reduced_independence',
    fresh_verification_needed: contaminated,
  });
}

function determineBoundedPedagogyFromEvaluation(evaluation,{failedStrategyClasses=[],currentAssistance='none',assistanceCeiling='none'}={}) {
  validateResponseEvaluation(evaluation,{trustedPriorRecurrence:evaluation?.misconception?.status==='recurring_supported',trustedPrerequisiteRefs:evaluation?.prerequisite?.prerequisite_ref?[evaluation.prerequisite.prerequisite_ref]:[]});
  const a=evaluation.response_assessment;
  const errors=evaluation.error_analysis || [];
  const hasProceduralSlip=errors.some((e)=>String(e.type)==='procedural_slip');
  const partial=a.final_result_correctness==='partially_correct' || a.completeness==='partial';
  const correctInsufficient=a.final_result_correctness==='correct' && ['insufficient','partially_sufficient','indeterminate'].includes(a.evidence_sufficiency);
  const prerequisite=evaluation.prerequisite?.status==='candidate_failure';
  const misconception=['candidate','recurring_supported'].includes(evaluation.misconception?.status);
  let recommendedAction='independent_attempt';
  let strategyClass='verification';
  if(evaluation.item_validity?.student_penalty_protection_required) { recommendedAction='evidence_task'; strategyClass='verification'; }
  else if(prerequisite) { recommendedAction='micro_remediation'; strategyClass='prerequisite_repair'; }
  else if(hasProceduralSlip) { recommendedAction='probe'; strategyClass='probe'; }
  else if(partial) { recommendedAction='probe'; strategyClass='decomposition'; }
  else if(correctInsufficient) { recommendedAction='probe'; strategyClass='probe'; }
  else if(misconception) { recommendedAction='misconception_repair'; strategyClass='representation'; }
  else if(a.final_result_correctness==='incorrect') { recommendedAction='hint'; strategyClass='hint'; }
  const failed=new Set((failedStrategyClasses||[]).map(String));
  if(failed.has(strategyClass)) {
    if(!failed.has('representation')) { recommendedAction='change_representation'; strategyClass='representation'; }
    else if(!failed.has('prerequisite_repair') && prerequisite) { recommendedAction='micro_remediation'; strategyClass='prerequisite_repair'; }
    else { recommendedAction='replan'; strategyClass='other'; }
  }
  const ceiling=enforceAssistanceCeiling({currentLevel:currentAssistance,proposedLevel:currentAssistance,ceiling:assistanceCeiling});
  return Object.freeze({recommended_action:recommendedAction,strategy_class:strategyClass,assistance:ceiling});
}

function validatePedagogyDecision(output,{decisionFrame=null}={}) {
  const out=requiredObject(output,'TEACHING_D12_PEDAGOGY_SCHEMA_INVALID');
  const forbidden=recursivelyHasForbiddenAuthorityKey(out);
  if(forbidden) fail('Pedagogy output exceeded D12 authority.','TEACHING_D12_PEDAGOGY_AUTHORITY_EXCEEDED',{field:forbidden});
  enumValue(out.status,PEDAGOGY_STATUSES,'TEACHING_D12_PEDAGOGY_STATUS_INVALID');
  requiredString(out.input_state_reference,'TEACHING_D12_PEDAGOGY_STATE_REF_REQUIRED');
  requiredString(out.capability_id,'TEACHING_D12_PEDAGOGY_CAPABILITY_REQUIRED');
  requiredString(out.task_mode,'TEACHING_D12_PEDAGOGY_TASK_MODE_REQUIRED');
  if(typeof out.review_required!=='boolean') fail('Pedagogy review_required boolean is required.','TEACHING_D12_PEDAGOGY_REVIEW_FLAG_INVALID');
  requiredArray(out.review_reasons,'TEACHING_D12_PEDAGOGY_REVIEW_REASONS_INVALID');

  const target=requiredObject(out.target,'TEACHING_D12_PEDAGOGY_TARGET_INVALID');
  requiredString(target.learning_unit_ref,'TEACHING_D12_PEDAGOGY_TARGET_REF_REQUIRED');
  requiredString(target.competence,'TEACHING_D12_PEDAGOGY_COMPETENCE_REQUIRED');
  enumValue(target.active_mode,PEDAGOGY_ACTIVE_MODES,'TEACHING_D12_PEDAGOGY_ACTIVE_MODE_INVALID');
  requiredArray(target.evidence_refs,'TEACHING_D12_PEDAGOGY_EVIDENCE_REFS_INVALID');

  const frame=requiredObject(out.decision_frame,'TEACHING_D12_PEDAGOGY_FRAME_INVALID');
  enumValue(frame.current_learning_stage,LEARNING_STAGES,'TEACHING_D12_PEDAGOGY_STAGE_INVALID');
  enumValue(frame.desired_next_stage,PEDAGOGY_DESIRED_STAGES,'TEACHING_D12_PEDAGOGY_DESIRED_STAGE_INVALID');
  enumValue(frame.assistance_ceiling,ASSISTANCE_SET,'TEACHING_D12_PEDAGOGY_ASSISTANCE_CEILING_INVALID');
  requiredArray(frame.recent_strategy_refs,'TEACHING_D12_PEDAGOGY_RECENT_STRATEGIES_INVALID');
  for(const strategyClass of requiredArray(frame.failed_strategy_classes,'TEACHING_D12_PEDAGOGY_FAILED_STRATEGIES_INVALID')) enumValue(strategyClass,STRATEGY_CLASSES,'TEACHING_D12_PEDAGOGY_FAILED_STRATEGY_INVALID');
  requiredString(frame.time_or_momentum_budget,'TEACHING_D12_PEDAGOGY_MOMENTUM_BUDGET_REQUIRED');
  requiredString(frame.evidence_goal,'TEACHING_D12_PEDAGOGY_EVIDENCE_GOAL_REQUIRED');
  validateDemandVector(frame.target_demand_vector,'TEACHING_D12_PEDAGOGY_DEMAND_INVALID');
  requiredArray(frame.instructional_lineage_refs,'TEACHING_D12_PEDAGOGY_LINEAGE_INVALID');

  const judgment=requiredObject(out.pedagogical_judgment,'TEACHING_D12_PEDAGOGY_JUDGMENT_INVALID');
  enumValue(judgment.recommended_action,PEDAGOGY_ACTIONS,'TEACHING_D12_PEDAGOGY_ACTION_INVALID');
  requiredString(judgment.why_this_action,'TEACHING_D12_PEDAGOGY_REASON_REQUIRED');
  requiredArray(judgment.alternatives_considered,'TEACHING_D12_PEDAGOGY_ALTERNATIVES_INVALID');
  enumValue(judgment.certainty,new Set(['high','medium','low']),'TEACHING_D12_PEDAGOGY_CERTAINTY_INVALID');

  const assistance=requiredObject(out.assistance,'TEACHING_D12_PEDAGOGY_ASSISTANCE_INVALID');
  const enforced=enforceAssistanceCeiling({currentLevel:assistance.current_level,proposedLevel:assistance.proposed_level,ceiling:frame.assistance_ceiling});
  requiredString(assistance.permission_basis,'TEACHING_D12_PEDAGOGY_PERMISSION_BASIS_REQUIRED');
  enumValue(assistance.independence_consequence,new Set(['none','reduced_independence','current_item_no_longer_independent']),'TEACHING_D12_PEDAGOGY_INDEPENDENCE_INVALID');
  if(typeof assistance.fresh_verification_needed!=='boolean') fail('fresh_verification_needed boolean is required.','TEACHING_D12_PEDAGOGY_FRESH_VERIFICATION_FLAG_INVALID');
  if(assistance.student_help_request_changed_ceiling!==false) fail('Help requests cannot raise assistance ceiling.','TEACHING_D12_PEDAGOGY_HELP_REQUEST_CEILING_BREACH');

  const progression=requiredObject(out.progression_design,'TEACHING_D12_PEDAGOGY_PROGRESSION_INVALID');
  if(typeof progression.support_removal_needed!=='boolean') fail('support_removal_needed boolean is required.','TEACHING_D12_PEDAGOGY_SUPPORT_REMOVAL_INVALID');
  validateDemandVector(progression.next_task_demand,'TEACHING_D12_PEDAGOGY_NEXT_DEMAND_INVALID');
  enumValue(progression.reuse_intent,REUSE_INTENTS,'TEACHING_D12_PEDAGOGY_REUSE_INTENT_INVALID');
  requiredArray(progression.instructional_lineage_refs,'TEACHING_D12_PEDAGOGY_PROGRESSION_LINEAGE_INVALID');
  enumValue(progression.copyability_risk,COPYABILITY_RISKS,'TEACHING_D12_PEDAGOGY_COPYABILITY_INVALID');

  const strategy=requiredObject(out.strategy,'TEACHING_D12_PEDAGOGY_STRATEGY_INVALID');
  requiredString(strategy.representation,'TEACHING_D12_PEDAGOGY_REPRESENTATION_REQUIRED');
  requiredString(strategy.instructional_move,'TEACHING_D12_PEDAGOGY_MOVE_REQUIRED');
  requiredString(strategy.success_signal,'TEACHING_D12_PEDAGOGY_SUCCESS_SIGNAL_REQUIRED');
  requiredString(strategy.failure_signal,'TEACHING_D12_PEDAGOGY_FAILURE_SIGNAL_REQUIRED');
  const strategyClass=enumValue(strategy.strategy_class,STRATEGY_CLASSES,'TEACHING_D12_PEDAGOGY_STRATEGY_CLASS_INVALID');
  if(typeof strategy.materially_differs_from_failed_strategy!=='boolean') fail('Strategy difference flag is required.','TEACHING_D12_PEDAGOGY_STRATEGY_DIFFERENCE_FLAG_INVALID');
  if(frame.failed_strategy_classes.map(String).includes(strategyClass) && strategy.materially_differs_from_failed_strategy!==true && out.status==='ok') fail('Repeated failed strategy must materially change or replan.','TEACHING_D12_PEDAGOGY_FAILED_STRATEGY_REPEATED');

  const artifact=requiredObject(out.artifact,'TEACHING_D12_PEDAGOGY_ARTIFACT_INVALID');
  enumValue(artifact.content_validation,CONTENT_VALIDATION,'TEACHING_D12_PEDAGOGY_CONTENT_VALIDATION_INVALID');
  const implications=requiredObject(out.state_implications,'TEACHING_D12_PEDAGOGY_STATE_IMPLICATIONS_INVALID');
  for(const key of ['blocked_proposal','replan_recommended','controller_action_required','durable_state_not_committed']) if(typeof implications[key]!=='boolean') fail('Pedagogy state implication booleans are required.','TEACHING_D12_PEDAGOGY_STATE_IMPLICATIONS_INVALID',{field:key});
  if(implications.durable_state_not_committed!==true) fail('D12 pedagogy cannot commit durable knowledge state.','TEACHING_D12_PEDAGOGY_DURABLE_STATE_FORBIDDEN');
  if(decisionFrame) {
    const expectedCeiling=String(decisionFrame.assistance_ceiling || decisionFrame.assistanceCeiling || '').toLowerCase();
    if(expectedCeiling && expectedCeiling!==enforced.assistance_ceiling) fail('Pedagogy output changed Controller assistance ceiling.','TEACHING_D12_PEDAGOGY_FRAME_CEILING_MISMATCH');
  }
  requiredArray(out.uncertainties,'TEACHING_D12_PEDAGOGY_UNCERTAINTIES_INVALID');
  requiredObject(out.handoff,'TEACHING_D12_PEDAGOGY_HANDOFF_INVALID');
  return Object.freeze(out);
}

function validatePedagogyProfile(output,{learningUnitRef=null}={}) {
  const out=requiredObject(output,'TEACHING_D12_PEDAGOGY_PROFILE_SCHEMA_INVALID');
  if(out.status && !new Set(['ok','review_needed','validation_needed','modality_limit']).has(String(out.status))) fail('Pedagogy profile status invalid.','TEACHING_D12_PEDAGOGY_PROFILE_STATUS_INVALID');
  const profile=requiredObject(out.profile || out,'TEACHING_D12_PEDAGOGY_PROFILE_INVALID');
  if(learningUnitRef && String(profile.learning_unit_ref || learningUnitRef)!==String(learningUnitRef)) fail('Pedagogy profile Learning Unit mismatch.','TEACHING_D12_PEDAGOGY_PROFILE_LU_MISMATCH');
  const knowledgeType=enumValue(profile.knowledge_type,KNOWLEDGE_TYPES,'TEACHING_D12_PEDAGOGY_PROFILE_KNOWLEDGE_TYPE_INVALID');
  const actions=requiredArray(profile.primary_student_actions,'TEACHING_D12_PEDAGOGY_PROFILE_ACTIONS_INVALID').map((v)=>enumValue(v,STUDENT_ACTIONS,'TEACHING_D12_PEDAGOGY_PROFILE_ACTION_INVALID'));
  if(!actions.length) fail('Pedagogy profile requires at least one student action.','TEACHING_D12_PEDAGOGY_PROFILE_ACTION_REQUIRED');
  const answerSpace=enumValue(profile.answer_space,ANSWER_SPACES,'TEACHING_D12_PEDAGOGY_PROFILE_ANSWER_SPACE_INVALID');
  const reps=requiredArray(profile.representations,'TEACHING_D12_PEDAGOGY_PROFILE_REPRESENTATIONS_INVALID').map((v)=>enumValue(v,REPRESENTATIONS,'TEACHING_D12_PEDAGOGY_PROFILE_REPRESENTATION_INVALID'));
  if(!reps.length) fail('Pedagogy profile requires at least one representation.','TEACHING_D12_PEDAGOGY_PROFILE_REPRESENTATION_REQUIRED');
  if(profile.subject_template_authoritative===true) fail('Subject template cannot be authoritative over Learning Unit profile.','TEACHING_D12_PEDAGOGY_PROFILE_TEMPLATE_AUTHORITY_FORBIDDEN');
  return Object.freeze({...out,profile:Object.freeze({...profile,knowledge_type:knowledgeType,primary_student_actions:Object.freeze(actions),answer_space:answerSpace,representations:Object.freeze(reps),subject_template_authoritative:false})});
}

function subjectTemplateFor(subjectFamily) {
  const key=String(subjectFamily || '').trim().toLowerCase().replace(/[\s/-]+/g,'_');
  const aliases={
    math:'mathematics', maths:'mathematics', physics:'science', chemistry:'science', biology:'science', sciences:'science',
    history:'humanities', literature:'humanities', english:'languages', language:'languages', cs:'computer_science', programming:'computer_science',
    economics:'economics_business', business:'economics_business', government:'government_civics', civics:'government_civics',
    practical:'visual_practical', art:'visual_practical', visual:'visual_practical',
  };
  const resolved=aliases[key] || key;
  const template=SUBJECT_TEMPLATE_DEFAULTS[resolved] || SUBJECT_TEMPLATE_DEFAULTS.humanities;
  return Object.freeze({...template,subject_family:resolved,authoritative:false,default_only:true});
}

function productiveStruggleDecision({elapsedSeconds=0,attemptCount=0,meaningfulProgress=false,repeatedSameError=false,responsePending=false,timeRemainingSeconds=null,assistanceCeiling='none'}={}) {
  assistanceRank(assistanceCeiling);
  const elapsed=Math.max(0,Number(elapsedSeconds)||0);
  const attempts=Math.max(0,Number(attemptCount)||0);
  const remaining=timeRemainingSeconds==null?null:Math.max(0,Number(timeRemainingSeconds)||0);
  if(responsePending && elapsed<45) return Object.freeze({decision:'wait',basis:'observable_pending_response_within_short_window'});
  if(meaningfulProgress && (remaining==null || remaining>90)) return Object.freeze({decision:'wait',basis:'observable_meaningful_progress'});
  if(repeatedSameError && attempts>=2) return Object.freeze({decision:'change_strategy',basis:'repeated_observable_error_after_multiple_attempts'});
  if(attempts===0 && elapsed<75) return Object.freeze({decision:'wait',basis:'initial_productive_struggle_window'});
  if(attempts<=1) return Object.freeze({decision:'probe',basis:'bounded_evidence_probe_before_more_assistance'});
  return Object.freeze({decision:assistanceRank(assistanceCeiling)>0?'hint':'probe',basis:'observable_stall_without_emotion_inference'});
}

function validateTeacherCorrection(output) {
  const out=requiredObject(output,'TEACHING_D12_TEACHER_CORRECTION_SCHEMA_INVALID');
  const forbidden=recursivelyHasForbiddenAuthorityKey(out);
  if(forbidden) fail('Teacher correction exceeded D12 authority.','TEACHING_D12_TEACHER_CORRECTION_AUTHORITY_EXCEEDED',{field:forbidden});
  enumValue(out.status,TEACHER_CORRECTION_STATUSES,'TEACHING_D12_TEACHER_CORRECTION_STATUS_INVALID');
  requiredString(out.input_state_reference,'TEACHING_D12_TEACHER_CORRECTION_STATE_REF_REQUIRED');
  requiredString(out.capability_id,'TEACHING_D12_TEACHER_CORRECTION_CAPABILITY_REQUIRED');
  if(String(out.capability_id)!=='teaching.lesson.teacher_self_correction_analysis') fail('Teacher correction capability mismatch.','TEACHING_D12_TEACHER_CORRECTION_CAPABILITY_MISMATCH');
  if(String(out.task_mode)!=='teacher_self_correction') fail('Teacher correction task mode mismatch.','TEACHING_D12_TEACHER_CORRECTION_TASK_MODE_MISMATCH');
  requiredObject(out.interaction,'TEACHING_D12_TEACHER_CORRECTION_INTERACTION_INVALID');
  requiredObject(out.grounding,'TEACHING_D12_TEACHER_CORRECTION_GROUNDING_INVALID');
  const correction=requiredObject(out.teacher_correction,'TEACHING_D12_TEACHER_CORRECTION_INVALID');
  if(typeof correction.challenge_received!=='boolean'||typeof correction.board_repair_needed!=='boolean'||typeof correction.affected_evidence_recheck_needed!=='boolean') fail('Teacher correction flags are required.','TEACHING_D12_TEACHER_CORRECTION_FLAGS_INVALID');
  const result=enumValue(correction.result,TEACHER_CORRECTION_RESULTS,'TEACHING_D12_TEACHER_CORRECTION_RESULT_INVALID');
  if(result==='teacher_error_confirmed' && !String(correction.correction_summary || '').trim()) fail('Confirmed teacher error requires correction summary.','TEACHING_D12_TEACHER_CORRECTION_SUMMARY_REQUIRED');
  requiredArray(out.uncertainties,'TEACHING_D12_TEACHER_CORRECTION_UNCERTAINTIES_INVALID');
  requiredObject(out.handoff,'TEACHING_D12_TEACHER_CORRECTION_HANDOFF_INVALID');
  return Object.freeze(out);
}

module.exports = {
  RESPONSE_STATUSES, ASSISTANCE_LEVELS, KNOWLEDGE_TYPES, STUDENT_ACTIONS, ANSWER_SPACES, REPRESENTATIONS,
  validateDemandVector, validateResponseEvaluation, enforceAssistanceCeiling, evidenceConsequenceForAssistance,
  determineBoundedPedagogyFromEvaluation, validatePedagogyDecision, validatePedagogyProfile, subjectTemplateFor,
  productiveStruggleDecision, validateTeacherCorrection, recursivelyHasForbiddenAuthorityKey,
};
