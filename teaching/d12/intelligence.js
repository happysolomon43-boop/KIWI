'use strict';

const { getCapability } = require('../capability-registry');
const {
  validateResponseEvaluation,
  validatePedagogyDecision,
  validatePedagogyProfile,
  validateTeacherCorrection,
} = require('./contracts');

function ownerFor(capabilityId) { return getCapability(capabilityId).authoritative_owner_boundary; }
function schema(id,declaredFields,validate) {
  return Object.freeze({
    id,version:'1',uncertainty_states:Object.freeze(['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED']),
    review_needed_field:'review_required',declared_fields:Object.freeze(declaredFields),validate,
  });
}

function stateRefString(context){ return 'class-session:'+context.session.class_session_id+'@'+String(context.session.state_version); }

function stateRef(context) {
  return Object.freeze({
    aggregate_type:'teaching_class_controller',
    aggregate_id:context.classRow.class_id,
    state_version:String(context.session?.state_version ?? context.classRow.schedule_version),
  });
}

function preconditions(context) {
  return Object.freeze({
    course_lifecycle_state:context.classRow.course_lifecycle_state,
    course_state_version:String(context.classRow.course_state_version),
    class_schedule_version:String(context.classRow.schedule_version),
    course_plan_id:context.plan?.course_plan_id || null,
    course_plan_version:context.plan?.version_no == null ? null : String(context.plan.version_no),
    controller_version:context.session?.state_version == null ? null : String(context.session.state_version),
  });
}

function baseRequest({capabilityId,taskMode,context,academicInput,outputSchema,provenanceRefs=[],requestKey,contextKind,accessPurpose,declaredAuthorityLevel,validators,directive,commit=false}) {
  const key=String(requestKey || ['d12',context.classRow.class_id,taskMode,context.session?.state_version ?? context.classRow.schedule_version].join(':'));
  return {
    trigger:{type:'workflow_continuation',ref:'class:'+context.classRow.class_id+':'+taskMode,source:'teaching.d12',actor_id:context.classRow.student_id},
    capabilityId,declaredAuthorityLevel,idempotencyKey:key,correlationId:key,
    stateReference:stateRef(context),preconditions:preconditions(context),provenanceRefs,
    resultContract:{output_schema_id:outputSchema.id,output_schema_version:outputSchema.version,validator_ids:['schema','domain','provenance','current-state']},
    taskMode,
    directive:directive || {
      bounded_actions:['produce only the requested provisional D12 response/pedagogy artifact from supplied authoritative context'],
      allowed_operations:['return schema-valid bounded interpretation/recommendation only'],
      prohibited_operations:['mutate Controller state','set durable mastery or SKM state','create persistent misconception truth','award marks','infer intent/emotion/guessing','select provider/model'],
      downstream_handoff:{type:'validated_candidate',validator_ids:['schema','domain','provenance','current-state'],commit_owner_boundary:ownerFor(capabilityId)},
    },
    contextSpec:{
      authoritative_refs:[{ref:'class:'+context.classRow.class_id},{ref:'class-session:'+context.session.class_session_id},{ref:'course-plan:'+context.plan.course_plan_id}],
      provenance_refs:provenanceRefs.map((ref)=>({ref})),untrusted_refs:[],context_kind:contextKind,access_purpose:accessPurpose,
    },
    outputSchema,academicInput,schemaValidator:validators.schema,domainValidator:validators.domain,provenanceValidator:validators.provenance,commit,
  };
}

function responseEvaluationRequest({context,response,learningUnit,taskContract={},priorEvaluations=[],requestKey=null}) {
  const trustedPrerequisiteRefs=(context.learningUnitDependencies || [])
    .filter((d)=>String(d.learning_unit_id)===String(learningUnit.learning_unit_id))
    .map((d)=>String(d.prerequisite_learning_unit_id));
  const trustedPriorRecurrence=priorEvaluations.some((row)=>{
    const m=row?.evaluation_payload?.misconception;
    return m && ['candidate','recurring_supported'].includes(String(m.status)) && String(row.learning_unit_id)===String(learningUnit.learning_unit_id);
  });
  const validate=async(out)=>{
    try {
      const value=validateResponseEvaluation(out,{trustedPrerequisiteRefs,trustedPriorRecurrence});
      if(String(value.input_state_reference)!==stateRefString(context)) return {ok:false,reason:'TEACHING_D12_RESPONSE_EVALUATION_STATE_REF_MISMATCH'};
      if(String(value.task_ref)!=='response:'+String(response.response_id)) return {ok:false,reason:'TEACHING_D12_RESPONSE_EVALUATION_TASK_REF_MISMATCH'};
      const expected=taskContract||{};const actual=value.evidence_claim_contract||{};
      for(const key of ['target_evidence_claim','reuse_policy','support_state','inference_ceiling']) if(String(actual[key]??'')!==String(expected[key]??'')) return {ok:false,reason:'TEACHING_D12_RESPONSE_EVALUATION_CLAIM_CONTRACT_MISMATCH'};
      for(const key of ['familiarity','method_cueing','representation_demand','integration_demand','retention_timing']) if(String(actual.demand_vector?.[key]??'')!==String(expected.demand_vector?.[key]??'')) return {ok:false,reason:'TEACHING_D12_RESPONSE_EVALUATION_DEMAND_CONTRACT_MISMATCH'};
      return {ok:true,value};
    } catch(error){return {ok:false,reason:error.code||'TEACHING_D12_RESPONSE_EVALUATION_INVALID',message:error.message};}
  };
  const outputSchema=schema('d12.response-evaluation',[
    'status','input_state_reference','task_ref','target_competence_refs','review_required','review_reasons','item_validity',
    'evidence_claim_contract','response_assessment','component_analysis','error_analysis','misconception','prerequisite','attempt_context',
    'assistance_and_independence','student_reported_confidence','next_evidence_need','handoff','uncertainties',
  ],validate);
  const refs=['response:'+response.response_id,'learning-unit:'+learningUnit.learning_unit_id,'class-session:'+context.session.class_session_id];
  return baseRequest({
    capabilityId:'teaching.lesson.response_correctness_quality_evaluation',taskMode:'response_diagnosis',context,
    academicInput:{
      response:{response_id:response.response_id,response_kind:response.response_kind,response_payload:response.response_payload,submitted_at:response.submitted_at,assistance_context:response.assistance_context || {}},
      target_learning_unit:{learning_unit_id:learningUnit.learning_unit_id,title:learningUnit.title,intended_competence:learningUnit.intended_competence,exit_conditions:learningUnit.exit_conditions,metadata:learningUnit.metadata || {}},
      trusted_prerequisites:trustedPrerequisiteRefs,
      task_contract:taskContract,
      assistance_and_exposure:response.assistance_context || {},
      trusted_prior_recurrence:trustedPriorRecurrence,
      prior_evaluation_refs:priorEvaluations.map((row)=>'response-evaluation:'+row.evaluation_id),
      one_response_durable_state_forbidden:true,
      mind_reading_forbidden:true,
    },
    outputSchema,provenanceRefs:refs,requestKey,contextKind:'current_response_evaluation',accessPurpose:'bounded_current_response_interpretation',
    declaredAuthorityLevel:'T2',validators:{schema:validate,domain:validate,provenance:async(out)=>({ok:Array.isArray(out.target_competence_refs)&&out.target_competence_refs.map(String).includes(String(learningUnit.learning_unit_id)),reason:'TEACHING_D12_RESPONSE_EVALUATION_PROVENANCE_INVALID'})},
  });
}

function pedagogyRequest({context,evaluation,learningUnit,decisionFrame,taskMode='next_action_recommendation',capabilityId='teaching.lesson.next_pedagogical_action_recommendation',requestKey=null}) {
  const validate=async(out)=>{
    try{
      const value=validatePedagogyDecision(out,{decisionFrame});
      if(String(value.input_state_reference)!==stateRefString(context)) return {ok:false,reason:'TEACHING_D12_PEDAGOGY_STATE_REF_MISMATCH'};
      if(String(value.capability_id)!==String(capabilityId)||String(value.task_mode)!==String(taskMode)) return {ok:false,reason:'TEACHING_D12_PEDAGOGY_CAPABILITY_MODE_MISMATCH'};
      if(String(value.decision_frame.current_learning_stage)!==String(decisionFrame.current_learning_stage)) return {ok:false,reason:'TEACHING_D12_PEDAGOGY_FRAME_STAGE_MISMATCH'};
      return {ok:true,value};
    }
    catch(error){return {ok:false,reason:error.code||'TEACHING_D12_PEDAGOGY_INVALID',message:error.message};}
  };
  const outputSchema=schema('d12.pedagogy-decision',[
    'status','input_state_reference','capability_id','task_mode','review_required','review_reasons','target','decision_frame',
    'pedagogical_judgment','assistance','progression_design','strategy','artifact','state_implications','uncertainties','handoff',
  ],validate);
  const refs=['response-evaluation:'+evaluation.evaluation_id,'learning-unit:'+learningUnit.learning_unit_id,'class-session:'+context.session.class_session_id];
  return baseRequest({
    capabilityId,taskMode,context,
    academicInput:{
      validated_response_evaluation:evaluation.evaluation_payload,
      response_evaluation_ref:'response-evaluation:'+evaluation.evaluation_id,
      learning_unit:{learning_unit_id:learningUnit.learning_unit_id,title:learningUnit.title,intended_competence:learningUnit.intended_competence,exit_conditions:learningUnit.exit_conditions,metadata:learningUnit.metadata || {}},
      pedagogy_decision_frame:decisionFrame,
      durable_skm_state_available:false,
      one_response_durable_state_forbidden:true,
    },
    outputSchema,provenanceRefs:refs,requestKey,contextKind:'response_dependent_pedagogy',accessPurpose:'bounded_next_instructional_strategy',
    declaredAuthorityLevel:getCapability(capabilityId).authority_ceiling,
    validators:{schema:validate,domain:validate,provenance:async(out)=>({ok:String(out?.target?.learning_unit_ref||'')===String(learningUnit.learning_unit_id),reason:'TEACHING_D12_PEDAGOGY_PROVENANCE_INVALID'})},
  });
}

function profileClassificationRequest({context,learningUnit,subjectTemplate,requestKey=null}) {
  const validate=async(out)=>{
    try{return {ok:true,value:validatePedagogyProfile(out,{learningUnitRef:learningUnit.learning_unit_id})};}
    catch(error){return {ok:false,reason:error.code||'TEACHING_D12_PEDAGOGY_PROFILE_INVALID',message:error.message};}
  };
  const outputSchema=schema('d12.learning-unit-pedagogy-profile',[
    'status','review_required','review_reasons','profile','uncertainties',
  ],validate);
  const refs=['learning-unit:'+learningUnit.learning_unit_id,'course-plan:'+context.plan.course_plan_id];
  return baseRequest({
    capabilityId:'teaching.pedagogy.pedagogical_profile_classification',taskMode:'pedagogical_profile_classification',context,
    academicInput:{
      learning_unit:{learning_unit_id:learningUnit.learning_unit_id,title:learningUnit.title,intended_competence:learningUnit.intended_competence,exit_conditions:learningUnit.exit_conditions,criticality:learningUnit.criticality,foundational:learningUnit.foundational,metadata:learningUnit.metadata||{}},
      subject_template_default:subjectTemplate,
      subject_template_is_default_only:true,
      required_profile_fields:['knowledge_type','primary_student_actions','answer_space','representations'],
    },
    outputSchema,provenanceRefs:refs,requestKey,contextKind:'learning_unit_pedagogy_profile',accessPurpose:'bounded_pedagogical_metadata_classification',declaredAuthorityLevel:'T2',
    validators:{schema:validate,domain:validate,provenance:async()=>({ok:true})},
  });
}

function teacherCorrectionRequest({context,challengedClaim,authoritativeSources=[],sourceEvaluation=null,requestKey=null}) {
  const validate=async(out)=>{
    try{
      const value=validateTeacherCorrection(out);
      if(String(value.input_state_reference)!==stateRefString(context)) return {ok:false,reason:'TEACHING_D12_TEACHER_CORRECTION_STATE_REF_MISMATCH'};
      return {ok:true,value};
    }
    catch(error){return {ok:false,reason:error.code||'TEACHING_D12_TEACHER_CORRECTION_INVALID',message:error.message};}
  };
  const outputSchema=schema('d12.teacher-self-correction',[
    'status','input_state_reference','capability_id','task_mode','interaction','style_realization','board','policy_alignment','assistance_and_evidence','content_integrity','grounding','teacher_correction','trajectory','uncertainties','handoff',
  ],validate);
  const refs=['class-session:'+context.session.class_session_id,...authoritativeSources.map((s)=>String(s.ref||s))];
  if(sourceEvaluation?.evaluation_id) refs.push('response-evaluation:'+sourceEvaluation.evaluation_id);
  return baseRequest({
    capabilityId:'teaching.lesson.teacher_self_correction_analysis',taskMode:'teacher_self_correction',context,
    academicInput:{challenged_teacher_claim:challengedClaim,authoritative_sources:authoritativeSources,source_response_evaluation:sourceEvaluation?.evaluation_payload||null,correction_must_assess_evidence_contamination:true},
    outputSchema,provenanceRefs:refs,requestKey,contextKind:'teacher_self_correction',accessPurpose:'bounded_content_integrity_recheck',declaredAuthorityLevel:'T2',
    validators:{schema:validate,domain:validate,provenance:async()=>({ok:true})},
  });
}

function freshVerificationRequest({context,evaluation,learningUnit,verificationDirective,candidatePool=[],requestKey=null}) {
  const validate=async(out)=>{
    if(!out||typeof out!=='object'||Array.isArray(out)) return {ok:false,reason:'TEACHING_D12_FRESH_VERIFICATION_SCHEMA_INVALID'};
    if(!['ok','insufficient_context','scope_unresolved','modality_limit','further_verification_needed'].includes(String(out.status))) return {ok:false,reason:'TEACHING_D12_FRESH_VERIFICATION_STATUS_INVALID'};
    const directive=out.verification_directive||{};
    if(String(directive.reuse_policy||'')!=='fresh_equivalent_required' && String(directive.reuse_policy||'')!=='materially_varied_required') return {ok:false,reason:'TEACHING_D12_FRESH_VERIFICATION_REUSE_INVALID'};
    if(out.durable_state_committed===true||out.mastery_state!=null||out.official_mark!=null) return {ok:false,reason:'TEACHING_D12_FRESH_VERIFICATION_AUTHORITY_EXCEEDED'};
    if(String(out.input_state_reference)!==stateRefString(context)) return {ok:false,reason:'TEACHING_D12_FRESH_VERIFICATION_STATE_REF_MISMATCH'};
    return {ok:true,value:out};
  };
  const outputSchema=schema('d12.fresh-verification',[
    'status','input_state_reference','decision_question','verification_directive','review_required','review_reasons','verification_plan','selection','uncertainties','handoff',
  ],validate);
  const refs=['response-evaluation:'+evaluation.evaluation_id,'learning-unit:'+learningUnit.learning_unit_id];
  return baseRequest({
    capabilityId:'teaching.lesson.fresh_verification_task_selection_after_answer_exposure',taskMode:'fresh_verification_after_exposure',context,
    academicInput:{validated_response_evaluation:evaluation.evaluation_payload,learning_unit:{learning_unit_id:learningUnit.learning_unit_id,intended_competence:learningUnit.intended_competence},verification_directive:verificationDirective,candidate_task_pool:candidatePool,original_task_contaminated:true},
    outputSchema,provenanceRefs:refs,requestKey,contextKind:'fresh_verification_after_exposure',accessPurpose:'select_or_specify_uncontaminated_equivalent_verification',declaredAuthorityLevel:'T3',
    validators:{schema:validate,domain:validate,provenance:async()=>({ok:true})},
  });
}

function createD12Intelligence({orchestrator}={}) {
  if(!orchestrator||typeof orchestrator.execute!=='function') throw new TypeError('D12 intelligence requires the Teaching Orchestrator.');
  return Object.freeze({
    evaluateResponse:(args)=>orchestrator.execute(responseEvaluationRequest(args)),
    recommendPedagogy:(args)=>orchestrator.execute(pedagogyRequest(args)),
    classifyPedagogyProfile:(args)=>orchestrator.execute(profileClassificationRequest(args)),
    analyzeTeacherCorrection:(args)=>orchestrator.execute(teacherCorrectionRequest(args)),
    selectFreshVerification:(args)=>orchestrator.execute(freshVerificationRequest(args)),
  });
}

module.exports={
  responseEvaluationRequest,pedagogyRequest,profileClassificationRequest,teacherCorrectionRequest,freshVerificationRequest,createD12Intelligence,
};
