'use strict';

const { getCapability } = require('../capability-registry');
const { TPF08,TPF18,validateStyleEnvelope,assertNoAcademicTruthMutation,STYLE_FIELDS } = require('./contracts');

const CAPABILITIES=Object.freeze({
  identity:'teaching.pedagogy.teacher_identity_profile_generation_assignment',
  transition:'teaching.pedagogy.teacher_change_transition_generation',
  outsideClass:'teaching.pedagogy.outside_class_teacher_q_a',
  style:'teaching.pedagogy.teacher_interaction_style_adaptation',
  praise:'teaching.pedagogy.specific_evidence_based_praise_generation',
  accountability:'teaching.pedagogy.challenge_accountability_communication',
  register:'teaching.pedagogy.context_sensitive_humor_register_choice',
});

function schema(id,declaredFields,validate){return Object.freeze({id,version:'1',declared_fields:Object.freeze(declaredFields),validate});}
function validateIdentityOutput(output,{expectedRef=null,taskMode='GENERATE_IDENTITY_CANDIDATE'}={}){
  if(!output||typeof output!=='object'||Array.isArray(output))return {ok:false,reason:'TEACHING_D22_TPF18_OUTPUT_INVALID'};
  try{assertNoAcademicTruthMutation(output);}catch(error){return {ok:false,reason:error.code||'TEACHING_D22_ACADEMIC_AUTHORITY_EXCEEDED'};}
  if(output.prompt_family!=='TPF-18'||output.prompt_version!=='1.0'||output.task_mode!==taskMode)return {ok:false,reason:'TEACHING_D22_TPF18_BINDING_MISMATCH'};
  if(!['CANDIDATE_READY','HANDOFF_REQUIRED','INSUFFICIENT_AUTHORITY','INVALID_INPUT'].includes(String(output.status)))return {ok:false,reason:'TEACHING_D22_TPF18_STATUS_INVALID'};
  if(output.status==='CANDIDATE_READY'){
    const candidate=output.teacher_identity_candidate;if(!candidate||typeof candidate!=='object')return {ok:false,reason:'TEACHING_D22_TPF18_CANDIDATE_REQUIRED'};
    try{validateStyleEnvelope(candidate.style_envelope);}catch(error){return {ok:false,reason:error.code||'TEACHING_D22_STYLE_ENVELOPE_INVALID'};}
    if(expectedRef&&String(candidate.style_envelope.teacher_identity_ref)!==String(expectedRef))return {ok:false,reason:'TEACHING_D22_TPF18_IDENTITY_REF_MISMATCH'};
    const checks=output.compatibility_checks||{};
    if(checks.matches_tpf08_style_envelope!==true||checks.subject_stereotype_used!==false||checks.sensitive_attribute_used!==false||checks.academic_rule_dependency_detected!==false||checks.cartoon_extremity_detected!==false||checks.false_human_biography_detected!==false||checks.familiarity_inferred_without_authority!==false||checks.presentation_metadata_policy_violation!==false)return {ok:false,reason:'TEACHING_D22_TPF18_COMPATIBILITY_CHECK_FAILED'};
  }
  return {ok:true,value:output};
}
function validateInteractionOutput(output){
  if(!output||typeof output!=='object'||Array.isArray(output))return {ok:false,reason:'TEACHING_D22_TPF08_OUTPUT_INVALID'};
  try{assertNoAcademicTruthMutation(output);}catch(error){return {ok:false,reason:error.code||'TEACHING_D22_ACADEMIC_AUTHORITY_EXCEEDED'};}
  return {ok:true,value:output};
}

function identityRequest({studentId,course,teacherIdentityRef,taskMode='GENERATE_IDENTITY_CANDIDATE',broadStylePreference=null,preferenceTraitTargets={},approvedProfilePool=[],existingIdentity=null,approvedTeacherChangeRequestRef=null,authoritativeFamiliarityLevel='new',requestKey}){
  const capability=getCapability(CAPABILITIES.identity);const validate=async(out)=>validateIdentityOutput(out,{expectedRef:teacherIdentityRef,taskMode});
  const outputSchema=schema('d22.teacher-identity-candidate',['prompt_family','prompt_version','task_mode','status','teacher_identity_candidate','transition','compatibility_checks','handoff'],validate);
  return {
    trigger:{type:'workflow_continuation',ref:`d22:${course.course_id}:identity`,source:'teaching.d22',actor_id:studentId},
    capabilityId:CAPABILITIES.identity,declaredAuthorityLevel:capability.authority_ceiling,idempotencyKey:String(requestKey),correlationId:String(requestKey),
    stateReference:{aggregate_type:'COURSE',aggregate_id:String(course.course_id),state_version:String(course.state_version||0)},
    preconditions:{teacher_identity_owner_external:true,request_owner_external:true,academic_truth_owners_external:true},
    provenanceRefs:[`course:${course.course_id}`],
    resultContract:{output_schema_id:outputSchema.id,output_schema_version:'1',validator_ids:['schema','domain','authority']},
    taskMode:'teacher_identity_candidate',
    directive:{
      task_mode:taskMode,course_ref:String(course.course_id),course_state:String(course.lifecycle_state||'draft').toLowerCase(),identity_action:taskMode==='INITIALIZE_APPROVED_TEACHER_CHANGE'?'replace':'create',
      allowed_identity_influences:['KIWI_DEFAULTS','EXPLICIT_BROAD_STYLE_PREFERENCE','APPROVED_PROFILE_POOL','PERSISTED_IDENTITY_STATE','PRODUCT_PRESENTATION_POLICY'],
      broad_style_preference:broadStylePreference,preference_trait_targets:preferenceTraitTargets,
      style_constraints:{warmth:['low','moderate','high'],directness:['low','moderate','high'],formality:['low','moderate','high'],expressiveness:['low','moderate','high'],humor_frequency:['none','low','moderate'],encouragement_intensity:['low','moderate','high'],challenge_style:['gentle','balanced','direct'],accountability_style:['soft','balanced','firm'],conversationality:['low','moderate','high']},
      allowed_presentation_fields:['display_name','avatar_ref','voice_ref','gender_presentation'],approved_profile_pool:approvedProfilePool,existing_teacher_identity_ref:existingIdentity?.teacher_identity_id||null,approved_teacher_change_request_ref:approvedTeacherChangeRequestRef,continuity_requirement:'preserve_all_academic_state',transition_visibility:'student_facing',authoritative_familiarity_level:authoritativeFamiliarityLevel,transition_message_voice:taskMode==='INITIALIZE_APPROVED_TEACHER_CHANGE'?'NEW_TEACHER':'NONE',display_name_policy:'APPROVED_POOL_ONLY',
    },
    contextSpec:{authoritative_refs:[{ref:`course:${course.course_id}`}],provenance_refs:[],untrusted_refs:[],context_kind:'teacher_identity_generation',access_purpose:'bounded_identity_candidate',forbidden_context:['grades','student_performance','detailed_skm_history','integrity_history','sensitive_demographics','private_intake_content','subject_as_personality_input']},
    academicInput:{teacher_identity_ref:teacherIdentityRef,existing_identity:existingIdentity,prompt_contract:{family:TPF18.family,version:TPF18.version,sha256:TPF18.sha256},required_tpf08_style_fields:STYLE_FIELDS},
    outputSchema,schemaValidator:validate,domainValidator:validate,provenanceValidator:async()=>({ok:true}),commit:false,capabilityPromptFamily:'TPF-18',
  };
}

function interactionRequest({capabilityId,taskMode,studentId,course,teacherStyleEnvelope,studentInteractionProfile,interactionDirective,input={},requestKey}){
  const capability=getCapability(capabilityId);validateStyleEnvelope(teacherStyleEnvelope);const validate=async(out)=>validateInteractionOutput(out);
  const outputSchema=schema(`d22.${taskMode}`,['status','interaction','style_realization','policy_alignment','content_integrity','handoff'],validate);
  return {
    trigger:{type:'student_action',ref:`d22:${course.course_id}:${taskMode}`,source:'teaching.d22',actor_id:studentId},capabilityId,declaredAuthorityLevel:capability.authority_ceiling,idempotencyKey:String(requestKey),correlationId:String(requestKey),stateReference:{aggregate_type:'COURSE',aggregate_id:String(course.course_id),state_version:String(course.state_version||0)},preconditions:{academic_decision_already_owned_elsewhere:true,teacher_identity_presentation_only:true},provenanceRefs:[`course:${course.course_id}`],resultContract:{output_schema_id:outputSchema.id,output_schema_version:'1',validator_ids:['schema','domain','authority']},taskMode,
    directive:{...interactionDirective,teacher_style_envelope:teacherStyleEnvelope,student_interaction_profile:studentInteractionProfile,bounded_actions:['realize only the supplied legitimate interaction move'],allowed_operations:['presentation','explanation wording','bounded Course Q&A when authorized'],prohibited_operations:['change pedagogy owner decision','change marks','change standards','change assessment conditions','change attendance','change deadlines','change progression','select provider/model'],downstream_handoff:{type:'presentation_only',commit_owner_boundary:capability.authoritative_owner_boundary}},
    contextSpec:{authoritative_refs:[{ref:`course:${course.course_id}`}],provenance_refs:[],untrusted_refs:[],context_kind:'teacher_interaction',access_purpose:taskMode,forbidden_context:['hidden_chain_of_thought','unrelated_student_history','personality_as_academic_authority']},academicInput:{...input,prompt_contract:{family:TPF08.family,version:TPF08.version,sha256:TPF08.sha256}},outputSchema,schemaValidator:validate,domainValidator:validate,provenanceValidator:async()=>({ok:true}),commit:false,capabilityPromptFamily:'TPF-08',
  };
}

function createD22Intelligence({orchestrator}={}){
  if(!orchestrator||typeof orchestrator.execute!=='function')return null;
  return Object.freeze({
    CAPABILITIES,
    generateIdentity:(args)=>orchestrator.execute(identityRequest(args)),
    transitionTeacher:(args)=>orchestrator.execute(identityRequest({...args,taskMode:'INITIALIZE_APPROVED_TEACHER_CHANGE'})),
    outsideClassQuestion:(args)=>orchestrator.execute(interactionRequest({...args,capabilityId:CAPABILITIES.outsideClass,taskMode:'outside_class_teacher_q_a'})),
    adaptStyle:(args)=>orchestrator.execute(interactionRequest({...args,capabilityId:CAPABILITIES.style,taskMode:'teacher_interaction_style_adaptation'})),
    praise:(args)=>orchestrator.execute(interactionRequest({...args,capabilityId:CAPABILITIES.praise,taskMode:'specific_evidence_based_praise'})),
    accountability:(args)=>orchestrator.execute(interactionRequest({...args,capabilityId:CAPABILITIES.accountability,taskMode:'challenge_accountability_communication'})),
    chooseRegister:(args)=>orchestrator.execute(interactionRequest({...args,capabilityId:CAPABILITIES.register,taskMode:'context_sensitive_humor_register_choice'})),
  });
}

module.exports={CAPABILITIES,identityRequest,interactionRequest,validateIdentityOutput,validateInteractionOutput,createD22Intelligence};
