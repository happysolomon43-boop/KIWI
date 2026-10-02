'use strict';

const {getCapability}=require('../capability-registry');
const {PROMPT_BINDINGS,fail}=require('./contracts');

const CAPABILITIES=Object.freeze({
  plan:'teaching.assessment.assessment_blueprint_generation',
  marks:'teaching.assessment.dynamic_mark_allocation_proposal',
  diagnostic:'teaching.assessment.diagnostic_assessment_generation',
  classwork:'teaching.assessment.classwork_assessment_generation',
  scheduled:'teaching.assessment.scheduled_test_generation',
  mid:'teaching.assessment.mid_semester_assessment_generation',
  final:'teaching.assessment.final_examination_generation',
  distractor:'teaching.assessment.misconception_based_distractor_generation',
  constructed:'teaching.assessment.constructed_response_item_generation',
  rubric:'teaching.assessment.rubric_mark_scheme_generation',
  validate:'teaching.assessment.question_validation',
  solution:'teaching.assessment.independent_solution_verification',
  key:'teaching.assessment.objective_answer_key_verification',
  code:'teaching.assessment.code_item_test_case_validation',
  rubricReview:'teaching.assessment.interpretive_rubric_defensibility_review',
  whole:'teaching.assessment.high_stakes_whole_package_review',
  variant:'teaching.assessment.equivalent_assessment_variant_generation',
  difficulty:'teaching.assessment.predicted_item_difficulty_estimation',
  clarification:'teaching.assessment.assessment_clarification_classification',
  fault:'teaching.assessment.faulty_question_defect_review',
  challenge:'teaching.assessment.student_question_challenge_review',
  dependency:'teaching.assessment.out_of_scope_untaught_dependency_detection',
  repair:'teaching.assessment.invalid_assessment_repair_proposal',
});

function schema(id,fields){return Object.freeze({id,version:'d17.v1',uncertainty_states:Object.freeze(['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED']),review_needed_field:'review_required',declared_fields:Object.freeze(fields),validate:async(output)=>{if(!output||typeof output!=='object'||Array.isArray(output))return {ok:false,reason:'TEACHING_D17_AI_OUTPUT_INVALID'};for(const forbidden of ['official_mark','official_grade','gradebook_write','progression_outcome','misconduct_verdict','cheating_probability','guilt_probability','assessment_eligibility_override','package_locked'])if(Object.prototype.hasOwnProperty.call(output,forbidden))return {ok:false,reason:'TEACHING_D17_AI_AUTHORITY_EXCEEDED',details:{field:forbidden}};return {ok:true,value:output};}});}
function bindingFor(capability){const family=capability.prompt_family_id;if(family==='TPF-12')return PROMPT_BINDINGS.planning;if(family==='TPF-13')return PROMPT_BINDINGS.generation;if(family==='TPF-14')return PROMPT_BINDINGS.validation;throw fail('Assessment capability is not bound to a D17 prompt family.','TEACHING_D17_PROMPT_BINDING_INVALID',500,{capability:capability.capability_id,family});}
function request({capabilityId,taskMode,studentId,assessmentId,stateVersion,academicInput,requestKey,fields,authority='T3',validationRole=null}){
  const capability=getCapability(capabilityId),binding=bindingFor(capability),outputSchema=schema(`d17.${taskMode}`,fields);
  return {
    trigger:{type:'workflow_continuation',ref:`assessment:${assessmentId}:${taskMode}`,source:'teaching.d17',actor_id:studentId},
    capabilityId,declaredAuthorityLevel:authority,idempotencyKey:String(requestKey),correlationId:String(requestKey),
    stateReference:{aggregate_type:'ASSESSMENT',aggregate_id:String(assessmentId),state_version:String(stateVersion??'0')},
    preconditions:{assessment_owner_required:true,eligibility_t0_precedence:true,gradebook_write_allowed:false,package_lock_t0_only:true,generator_validator_independence:true},
    provenanceRefs:academicInput.provenance_refs||[],
    resultContract:{output_schema_id:outputSchema.id,output_schema_version:outputSchema.version,validator_ids:['schema','domain','provenance','current-state']},
    taskMode,
    directive:{bounded_actions:['return only a provisional Assessment artifact within supplied eligibility, Blueprint and policy constraints'],allowed_operations:['structured provisional output','explicit uncertainty/review-needed'],prohibited_operations:['expand Assessment Eligibility','inspect raw Subject scope to expand graded scope','lock an Assessment Package','mutate an active Attempt','write Gradebook truth','select provider/model','infer misconduct from telemetry','reveal protected candidate material outside validation'],evidence_purpose:taskMode,downstream_handoff:{type:validationRole||'provisional_assessment_artifact',validator_ids:['schema','domain','provenance','current-state'],commit_owner_boundary:capability.authoritative_owner_boundary}},
    contextSpec:{authoritative_refs:(academicInput.provenance_refs||[]).map(ref=>({ref})),provenance_refs:[],untrusted_refs:[],context_kind:'d17_assessment',access_purpose:taskMode,forbidden_context:['irrelevant_attendance','teacher_personality','previous_gpa','unrelated_marks','behavior_history']},
    academicInput:{...academicInput,prompt_contract:{family:binding.family,version:binding.version},eligibility_is_authoritative:true},
    outputSchema,schemaValidator:outputSchema.validate,domainValidator:outputSchema.validate,provenanceValidator:async()=>({ok:true}),commit:false,capabilityPromptFamily:binding.family,
  };
}
function generationCapability(type){switch(String(type||'').toUpperCase()){case'DIAGNOSTIC':return CAPABILITIES.diagnostic;case'CLASSWORK':return CAPABILITIES.classwork;case'MID_SEMESTER':return CAPABILITIES.mid;case'FINAL_EXAMINATION':return CAPABILITIES.final;default:return CAPABILITIES.scheduled;}}
function createD17Intelligence({orchestrator}={}){if(!orchestrator||typeof orchestrator.execute!=='function')throw new TypeError('D17 intelligence requires the Teaching Orchestrator.');const run=(args)=>orchestrator.execute(request(args));return Object.freeze({
  planBlueprint:(a)=>run({...a,capabilityId:CAPABILITIES.plan,taskMode:'assessment_blueprint_generation',fields:['status','review_required','blueprint','unresolved_items']}),
  generateCandidate:(a)=>run({...a,capabilityId:generationCapability(a.academicInput?.assessment_type),taskMode:'assessment_item_generation',fields:['status','review_required','candidate','variation_trace','unresolved_items'],validationRole:'candidate_only'}),
  generateVariant:(a)=>run({...a,capabilityId:CAPABILITIES.variant,taskMode:'equivalent_assessment_variant_generation',fields:['status','review_required','candidate','equivalence_trace','unresolved_items'],validationRole:'candidate_only'}),
  validateItem:(a)=>run({...a,capabilityId:CAPABILITIES.validate,taskMode:'independent_item_validation',fields:['status','review_required','verdict','findings','repair_directive','unresolved_items'],validationRole:'independent_validation'}),
  verifySolution:(a)=>run({...a,capabilityId:CAPABILITIES.solution,taskMode:'independent_solution_verification',fields:['status','review_required','verdict','solution_check','findings','unresolved_items'],validationRole:'independent_validation'}),
  verifyObjectiveKey:(a)=>run({...a,capabilityId:CAPABILITIES.key,taskMode:'objective_answer_key_verification',fields:['status','review_required','verdict','key_check','findings','unresolved_items'],validationRole:'independent_validation'}),
  reviewInterpretiveRubric:(a)=>run({...a,capabilityId:CAPABILITIES.rubricReview,taskMode:'interpretive_rubric_defensibility_review',fields:['status','review_required','verdict','acceptable_alternatives','findings','unresolved_items'],validationRole:'independent_validation'}),
  validateWholePackage:(a)=>run({...a,capabilityId:CAPABILITIES.whole,taskMode:'high_stakes_whole_package_review',fields:['status','review_required','verdict','coverage_findings','response_form_findings','timing_findings','leakage_findings','unresolved_items'],validationRole:'whole_package_validation'}),
  detectUntaughtDependency:(a)=>run({...a,capabilityId:CAPABILITIES.dependency,taskMode:'out_of_scope_untaught_dependency_detection',fields:['status','review_required','detected','dependencies','findings','unresolved_items'],validationRole:'independent_validation'}),
  reviewChallenge:(a)=>run({...a,capabilityId:CAPABILITIES.challenge,taskMode:'student_question_challenge_review',fields:['status','review_required','verdict','findings','repair_directive','unresolved_items'],validationRole:'post_attempt_review'}),
  reviewFault:(a)=>run({...a,capabilityId:CAPABILITIES.fault,taskMode:'faulty_question_defect_review',fields:['status','review_required','verdict','defect_class','findings','repair_directive','unresolved_items'],validationRole:'post_attempt_review'}),
  classifyClarification:(a)=>run({...a,capabilityId:CAPABILITIES.clarification,taskMode:'assessment_clarification_classification',authority:'T2',fields:['status','review_required','classification','safe_response','unresolved_items'],validationRole:'controller_advice'}),
});}

module.exports={CAPABILITIES,request,generationCapability,createD17Intelligence};