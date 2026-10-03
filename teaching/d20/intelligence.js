'use strict';

const {getCapability}=require('../capability-registry');
const {TPF15,TPF16,markingContextAllowlist,validateCriterionJudgments,assertNoForbiddenContext,fail}=require('./contracts');

const CAPABILITIES=Object.freeze({
  mark:'teaching.assessment.constructed_response_rubric_marking',
  partial:'teaching.assessment.criterion_based_partial_credit_allocation',
  alternative:'teaching.assessment.alternative_valid_answer_recognition',
  moderate:'teaching.assessment.high_stakes_moderation_consistency_review',
  detect:'teaching.assessment.borderline_moderation_needed_detection',
  appeal:'teaching.assessment.appeal_re_evaluation',
});

const COMMON_INPUT_KEYS=Object.freeze(new Set([
  'marking_context','context','rubric_ref','item_ref','submission_ref','directive','review_ref','review_scope',
  'blind_first_policy','normalized_appeal_artifact','frozen_pass_a','original_marking',
  'review_direction_policy','deterministic_comparison','raw_appeal_text_for_audit_only','raw_appeal_text'
]));
const BLIND_PASS_A_FORBIDDEN=Object.freeze(new Set([
  'original_marking','review_direction_policy','raw_appeal_text','raw_appeal_text_for_audit_only',
  'grade_consequence','grade_boundary_position','prior_marker_rationale','current_course_total','frozen_pass_a'
]));

function reject(reason,details=null){return {ok:false,reason,details:details||undefined};}
function accepted(output){return {ok:true,value:output};}
function bool(value){return value===true;}
function stableCriterionIds(values){return [...new Set((Array.isArray(values)?values:[]).map(value=>String(value||'')).filter(Boolean))].sort();}
function expectedReviewCriterionIds(input={}){
  const direct=stableCriterionIds(input?.review_scope?.criterion_ids);if(direct.length)return direct;
  const original=Array.isArray(input?.original_marking?.criterion_judgments)?input.original_marking.criterion_judgments:[];if(original.length)return stableCriterionIds(original.map(row=>row?.criterion_id));
  const frozen=Array.isArray(input?.frozen_pass_a?.criterion_judgments)?input.frozen_pass_a.criterion_judgments:[];return stableCriterionIds(frozen.map(row=>row?.criterion_id));
}
function validateExactReviewScope(output,reviewStage,expectedCriterionIds=[]){
  const expected=stableCriterionIds(expectedCriterionIds);if(!expected.length)return null;
  const field=reviewStage==='independent_pass_a'?'criterion_independent_judgments':'criterion_reviews',rows=Array.isArray(output?.[field])?output[field]:[],actual=stableCriterionIds(rows.map(row=>row?.criterion_id));
  if(JSON.stringify(actual)!==JSON.stringify(expected))return reject('TEACHING_D20_REVIEW_SCOPE_MISMATCH',{reviewStage,expectedCriterionIds:expected,actualCriterionIds:actual});
  return null;
}

function validateTpf15Controls(output){
  const handoff=output?.aggregation_handoff;
  if(!handoff||typeof handoff!=='object')return reject('TEACHING_D20_TPF15_AGGREGATION_HANDOFF_REQUIRED');
  if(!bool(handoff.deterministic_aggregation_required))return reject('TEACHING_D20_TPF15_DETERMINISTIC_AGGREGATION_REQUIRED');
  if(!bool(handoff.official_total_not_committed))return reject('TEACHING_D20_TPF15_OFFICIAL_TOTAL_EXTERNAL_REQUIRED');
  if(!bool(handoff.rounding_external))return reject('TEACHING_D20_TPF15_ROUNDING_EXTERNAL_REQUIRED');
  if(!bool(handoff.gradebook_commit_external))return reject('TEACHING_D20_TPF15_GRADEBOOK_EXTERNAL_REQUIRED');
  return null;
}

function validatePassAControls(output){
  const controls=output?.artifact_controls;
  if(!controls||typeof controls!=='object')return reject('TEACHING_D20_TPF16_PASS_A_CONTROLS_REQUIRED');
  const hidden=['original_credit_seen','overall_result_seen','raw_appeal_text_seen','review_direction_policy_seen','downstream_consequence_seen'];
  for(const key of hidden){if(controls[key]!==false)return reject('TEACHING_D20_TPF16_PASS_A_BLINDNESS_BREACH',{field:key,value:controls[key]});}
  if(controls.freeze_before_comparison_required!==true)return reject('TEACHING_D20_TPF16_PASS_A_FREEZE_REQUIRED');
  if(!Array.isArray(output?.criterion_independent_judgments))return reject('TEACHING_D20_TPF16_PASS_A_CRITERIA_REQUIRED');
  return null;
}

function validatePassBControls(output){
  const blind=output?.blind_first;
  if(!blind||typeof blind!=='object')return reject('TEACHING_D20_TPF16_PASS_B_BLIND_FIRST_REQUIRED');
  if(blind.attempted!==true||blind.achieved!==true)return reject('TEACHING_D20_TPF16_PASS_B_BLIND_FIRST_NOT_ACHIEVED');
  if(blind.pass_a_frozen_before_comparison!==true)return reject('TEACHING_D20_TPF16_PASS_B_PASS_A_NOT_FROZEN');
  if(!String(blind.independent_pass_a_ref||'').trim())return reject('TEACHING_D20_TPF16_PASS_B_PASS_A_REF_REQUIRED');
  const outcome=output?.review_outcome;
  if(!outcome||typeof outcome!=='object')return reject('TEACHING_D20_TPF16_REVIEW_OUTCOME_REQUIRED');
  if(outcome.official_mark_not_committed!==true)return reject('TEACHING_D20_TPF16_OFFICIAL_MARK_EXTERNAL_REQUIRED');
  if(outcome.deterministic_reaggregation_required_if_changed!==true)return reject('TEACHING_D20_TPF16_DETERMINISTIC_REAGGREGATION_REQUIRED');
  if(outcome.gradebook_commit_external!==true)return reject('TEACHING_D20_TPF16_GRADEBOOK_EXTERNAL_REQUIRED');
  if(outcome.audit_history_preserve_original!==true)return reject('TEACHING_D20_TPF16_ORIGINAL_AUDIT_REQUIRED');
  return null;
}

function schema(id,family,{taskMode=null,reviewStage=null,expectedCriterionIds=[]}={}){return Object.freeze({
  id,version:'d20.v1',uncertainty_states:Object.freeze(['borderline','rubric_precision_gap','material_ambiguity','possible_rubric_defect','possible_item_defect','insufficient_marking_context','moderation_required']),review_needed_field:'review_state',
  validate:async(output)=>{
    if(!output||typeof output!=='object'||Array.isArray(output))return reject('TEACHING_D20_AI_OUTPUT_INVALID');
    if(String(output.family||family)!==family)return reject('TEACHING_D20_PROMPT_FAMILY_MISMATCH');
    const forbidden=['official_total','official_mark','official_grade','gradebook_write','course_score','topic_score','gpa','progression_outcome','finalize_assessment','rounding_result','category_weight'];
    for(const k of forbidden)if(Object.prototype.hasOwnProperty.call(output,k))return reject('TEACHING_D20_AI_AUTHORITY_EXCEEDED',{field:k});
    if(family==='TPF-15'){
      const controlFailure=validateTpf15Controls(output);if(controlFailure)return controlFailure;
      if(!Array.isArray(output.criterion_judgments))return reject('TEACHING_D20_TPF15_CRITERIA_REQUIRED');
    }
    if(family==='TPF-16'&&reviewStage==='independent_pass_a'){
      const controlFailure=validatePassAControls(output);if(controlFailure)return controlFailure;
      if(String(output.review_stage||'')!=='independent_pass_a')return reject('TEACHING_D20_TPF16_PASS_A_STAGE_MISMATCH');
      const scopeFailure=validateExactReviewScope(output,reviewStage,expectedCriterionIds);if(scopeFailure)return scopeFailure;
    }
    if(family==='TPF-16'&&reviewStage==='comparison_pass_b'){
      const controlFailure=validatePassBControls(output);if(controlFailure)return controlFailure;
      if(String(output.review_stage||'')!=='comparison_pass_b')return reject('TEACHING_D20_TPF16_PASS_B_STAGE_MISMATCH');
      if(!Array.isArray(output.criterion_reviews))return reject('TEACHING_D20_TPF16_PASS_B_CRITERIA_REQUIRED');
      const scopeFailure=validateExactReviewScope(output,reviewStage,expectedCriterionIds);if(scopeFailure)return scopeFailure;
    }
    if(family==='TPF-16'&&taskMode==='borderline_moderation_needed_detection'&&output.full_remark_not_performed!==true)return reject('TEACHING_D20_TPF16_DETECTION_FULL_REMARK_FORBIDDEN');
    return accepted(output);
  },
});}
function bindingFor(capability){if(capability.prompt_family_id==='TPF-15')return TPF15;if(capability.prompt_family_id==='TPF-16')return TPF16;throw fail('D20 capability prompt family is not TPF-15/TPF-16.','TEACHING_D20_PROMPT_BINDING_INVALID',500,{capability:capability.id,family:capability.prompt_family_id});}

function sanitizeAcademicInput(input,reviewStage){
  const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  assertNoForbiddenContext(source,'academicInput');
  if(reviewStage==='independent_pass_a'){
    for(const key of BLIND_PASS_A_FORBIDDEN){
      if(Object.prototype.hasOwnProperty.call(source,key))fail('Blind independent Pass A received prohibited prior-judgment context.','TEACHING_D20_BLIND_PASS_A_CONTEXT_FORBIDDEN',400,{field:key});
    }
  }
  const out={};
  for(const [key,value] of Object.entries(source)){
    if(!COMMON_INPUT_KEYS.has(key))fail('D20 model input contains a field outside the formal marking allowlist.','TEACHING_D20_T4_INPUT_FIELD_FORBIDDEN',400,{field:key,reviewStage});
    if(key==='raw_appeal_text_for_audit_only'||key==='raw_appeal_text'||key==='context')continue;
    out[key]=value;
  }
  out.marking_context=markingContextAllowlist(source.marking_context||source.context||{});
  return Object.freeze(out);
}

function makeRequest({capabilityId,taskMode,studentId,resultId,stateVersion,academicInput={},requestKey,reviewStage=null,authority='T4'}){
  const capability=getCapability(capabilityId),binding=bindingFor(capability),safeInput=sanitizeAcademicInput(academicInput,reviewStage),safeContext=safeInput.marking_context,expectedCriterionIds=expectedReviewCriterionIds(safeInput),outputSchema=schema(`d20.${taskMode}`,binding.family,{taskMode,reviewStage,expectedCriterionIds});
  return {
    trigger:{type:'workflow_continuation',ref:`assessment-result:${resultId}:${taskMode}:${reviewStage||'single'}`,source:'teaching.d20',actor_id:studentId},
    capabilityId,declaredAuthorityLevel:authority,idempotencyKey:String(requestKey),correlationId:String(requestKey),
    stateReference:{aggregate_type:'ASSESSMENT_RESULT',aggregate_id:String(resultId),state_version:String(stateVersion??'0')},
    preconditions:{gradebook_owner_external:true,locked_rubric_required:true,authoritative_final_response_required:true,deterministic_aggregation_required:true,blind_first_structural_two_stage_required:binding.family==='TPF-16'},
    provenanceRefs:safeContext.provenance_refs||[],
    resultContract:{output_schema_id:outputSchema.id,output_schema_version:outputSchema.version,validator_ids:['schema','domain','provenance','current-state']},
    taskMode,
    directive:{bounded_actions:['criterion-level academic judgment against the supplied immutable rubric only'],allowed_operations:['criterion judgment','explicit uncertainty','bounded evidence references','moderation/defect handoff'],prohibited_operations:['compute official total','apply rounding or category weights','write Gradebook truth','finalize Assessment result','inspect attendance/personality/GPA/history','select provider/model','invent rubric rules','average marker disagreement'],evidence_purpose:taskMode,downstream_handoff:{type:'d20_deterministic_aggregation_and_owner_commit',validator_ids:['schema','domain','provenance','current-state'],commit_owner_boundary:capability.authoritative_owner_boundary}},
    contextSpec:{authoritative_refs:(safeContext.provenance_refs||[]).map(ref=>({ref})),provenance_refs:[],untrusted_refs:[],context_kind:'d20_formal_marking',access_purpose:taskMode,forbidden_context:['student_identity','demographics','attendance','teacher_personality','previous_gpa','peer_performance','effort_history','current_course_total','grade_boundary_position','integrity_telemetry','unrelated_grades']},
    academicInput:{...safeInput,prompt_contract:{family:binding.family,version:binding.version,sha256:binding.sha256},review_stage:reviewStage},
    outputSchema,schemaValidator:outputSchema.validate,domainValidator:outputSchema.validate,provenanceValidator:async()=>({ok:true}),commit:false,capabilityPromptFamily:binding.family,
  };
}

function createD20Intelligence({orchestrator}={}){
  if(!orchestrator||typeof orchestrator.execute!=='function')throw new TypeError('D20 intelligence requires the Teaching Orchestrator.');
  const run=(args)=>orchestrator.execute(makeRequest(args));
  return Object.freeze({
    markConstructed:(a)=>run({...a,capabilityId:CAPABILITIES.mark,taskMode:'constructed_response_marking'}),
    allocatePartialCredit:(a)=>run({...a,capabilityId:CAPABILITIES.partial,taskMode:'criterion_partial_credit_review'}),
    reviewAlternative:(a)=>run({...a,capabilityId:CAPABILITIES.alternative,taskMode:'alternative_valid_answer_review'}),
    detectModeration:(a)=>run({...a,capabilityId:CAPABILITIES.detect,taskMode:'borderline_moderation_needed_detection',reviewStage:'detection',authority:'T2'}),
    moderatePassA:(a)=>run({...a,capabilityId:CAPABILITIES.moderate,taskMode:'high_stakes_moderation_consistency_review',reviewStage:'independent_pass_a'}),
    moderatePassB:(a)=>run({...a,capabilityId:CAPABILITIES.moderate,taskMode:'high_stakes_moderation_consistency_review',reviewStage:'comparison_pass_b'}),
    appealPassA:(a)=>run({...a,capabilityId:CAPABILITIES.appeal,taskMode:'appeal_re_evaluation',reviewStage:'independent_pass_a'}),
    appealPassB:(a)=>run({...a,capabilityId:CAPABILITIES.appeal,taskMode:'appeal_re_evaluation',reviewStage:'comparison_pass_b'}),
  });
}

function reviewIssueState(issue){const key=String(issue||'none');if(key==='none')return 'ordinary';if(key==='rubric_precision_unresolved')return 'rubric_precision_gap';if(key==='possible_item_or_rubric_defect')return 'possible_rubric_defect';if(key==='response_capture_issue'||key==='insufficient_context')return 'insufficient_marking_context';return 'moderation_required';}
function normalizePassAJudgments(output){return (output?.criterion_independent_judgments||[]).map(j=>{const max=Number(j.criterion_max_marks),credit=j.independent_credit==null?null:Number(j.independent_credit);let satisfaction='unable_to_judge';if(credit!=null&&Number.isFinite(max)){satisfaction=credit===0?'none':credit===max?'full':'partial';}return {criterion_id:j.criterion_id,criterion_max_marks:j.criterion_max_marks,proposed_credit:j.independent_credit,proposed_band_id:j.independent_band_id||null,supported_credit_range:j.supported_credit_range||null,satisfaction,evidence_refs:j.response_evidence_refs||[],evidence_summary:j.rubric_grounded_basis||'',review_state:reviewIssueState(j.review_issue),confidence:j.confidence||'low',alternative_valid_route_used:Boolean(j.alternative_valid_route_recognized),follow_through_applied:j.follow_through_review==='correct',defect_flags:['possible_item_or_rubric_defect','response_capture_issue'].includes(String(j.review_issue))?[{type:String(j.review_issue),reason:j.rubric_grounded_basis||'Independent review issue',affected_criterion_ids:[String(j.criterion_id)]}]:[]};});}

function validatedOutput(result,rubric,{family='TPF-15'}={}){
  const output=result?.validatedResult?.output||result?.output||null;if(!result?.accepted||!output)return null;
  if(family==='TPF-15')return {output,judgments:validateCriterionJudgments(output,rubric,{requireFamily:'TPF-15'})};
  if(family==='TPF-16'&&String(output.review_stage)==='independent_pass_a'){
    const synthetic={family:'TPF-16',review_state:'ordinary',criterion_judgments:normalizePassAJudgments(output)};
    return {output,judgments:validateCriterionJudgments(synthetic,rubric,{requireFamily:'TPF-16'})};
  }
  return {output,judgments:[]};
}

module.exports={CAPABILITIES,makeRequest,sanitizeAcademicInput,createD20Intelligence,validatedOutput,validateTpf15Controls,validatePassAControls,validatePassBControls,validateExactReviewScope,expectedReviewCriterionIds,normalizePassAJudgments};
