'use strict';

const {getCapability}=require('../capability-registry');
const {TPF15,TPF16,markingContextAllowlist,validateCriterionJudgments,fail}=require('./contracts');

const CAPABILITIES=Object.freeze({
  mark:'teaching.assessment.constructed_response_rubric_marking',
  partial:'teaching.assessment.criterion_based_partial_credit_allocation',
  alternative:'teaching.assessment.alternative_valid_answer_recognition',
  moderate:'teaching.assessment.high_stakes_moderation_consistency_review',
  detect:'teaching.assessment.borderline_moderation_needed_detection',
  appeal:'teaching.assessment.appeal_re_evaluation',
});

function schema(id,family){return Object.freeze({
  id,version:'d20.v1',uncertainty_states:Object.freeze(['borderline','rubric_precision_gap','material_ambiguity','possible_rubric_defect','possible_item_defect','insufficient_marking_context','moderation_required']),review_needed_field:'review_state',
  validate:async(output)=>{
    if(!output||typeof output!=='object'||Array.isArray(output))return {ok:false,reason:'TEACHING_D20_AI_OUTPUT_INVALID'};
    if(String(output.family||family)!==family)return {ok:false,reason:'TEACHING_D20_PROMPT_FAMILY_MISMATCH'};
    const forbidden=['official_total','official_mark','official_grade','gradebook_write','course_score','topic_score','gpa','progression_outcome'];
    for(const k of forbidden)if(Object.prototype.hasOwnProperty.call(output,k))return {ok:false,reason:'TEACHING_D20_AI_AUTHORITY_EXCEEDED',details:{field:k}};
    return {ok:true,value:output};
  },
});}
function bindingFor(capability){if(capability.prompt_family_id==='TPF-15')return TPF15;if(capability.prompt_family_id==='TPF-16')return TPF16;throw fail('D20 capability prompt family is not TPF-15/TPF-16.','TEACHING_D20_PROMPT_BINDING_INVALID',500,{capability:capability.id,family:capability.prompt_family_id});}
function makeRequest({capabilityId,taskMode,studentId,resultId,stateVersion,academicInput,requestKey,reviewStage=null,authority='T4'}){
  const capability=getCapability(capabilityId),binding=bindingFor(capability),outputSchema=schema(`d20.${taskMode}`,binding.family);
  const safeContext=markingContextAllowlist(academicInput.marking_context||academicInput.context||{});
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
    academicInput:{...academicInput,marking_context:safeContext,prompt_contract:{family:binding.family,version:binding.version,sha256:binding.sha256},review_stage:reviewStage},
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

function validatedOutput(result,rubric,{family='TPF-15'}={}){const output=result?.validatedResult?.output||result?.output||null;if(!result?.accepted||!output)return null;return {output,judgments:validateCriterionJudgments(output,rubric,{requireFamily:family})};}

module.exports={CAPABILITIES,makeRequest,createD20Intelligence,validatedOutput};