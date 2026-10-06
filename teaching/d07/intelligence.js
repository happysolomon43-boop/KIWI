'use strict';
const { validateCurriculumAuditSchema, validateCurriculumAuditDomain, normalizeIntakeExtraction } = require('./contracts');
const { getCapability } = require('../capability-registry');
const {
  TPF02_OUTPUT_SCHEMA_ID,
  TPF02_OUTPUT_SCHEMA_VERSION,
  TPF02_MAX_OUTPUT_TOKENS,
  TPF02_TOP_LEVEL_FIELDS,
  buildTpf02AcademicInput,
  validateTpf02Schema,
  validateTpf02Domain,
} = require('./tpf02-direct');

function base({capabilityId,course,stateVersion,taskMode,outputSchema,contextSpec,academicInput,provenanceRefs=[]}){
  return {
    trigger:{type:'authenticated_input',ref:`course:${course.course_id}:${taskMode}`,source:'teaching.d07',actor_id:course.student_id},
    capabilityId,
    stateReference:{aggregate_type:'teaching_course',aggregate_id:course.course_id,state_version:String(stateVersion||course.state_version)},
    preconditions:{lifecycle_state:course.lifecycle_state},
    provenanceRefs,
    resultContract:{output_schema_id:outputSchema.id,output_schema_version:outputSchema.version,validator_ids:['schema','domain','provenance']},
    taskMode,
    directive:{
      bounded_actions:['analyze supplied D07 data'],
      allowed_operations:['return schema-valid candidate output'],
      prohibited_operations:['mutate authoritative state','certify mastery from self-report','omit source items','select provider or model'],
      evidence_purpose:taskMode,
      downstream_handoff:{type:'validated_candidate',validator_ids:['schema','domain','provenance'],commit_owner_boundary:getCapability(capabilityId).authoritative_owner_boundary},
    },
    contextSpec,
    outputSchema,
    academicInput,
    commit:false,
  };
}

function intakeRequest({course,intake}){
  const outputSchema={id:'d07.student-intake-extraction',version:'1',uncertainty_states:['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED'],review_needed_field:'uncertainty',declared_fields:['interaction_preferences','academic_self_report','goals','deadlines','planning_hypotheses','diagnostic_targets','uncertainty','provenance'],validate:async out=>normalizeIntakeExtraction(out,intake.intake_id)};
  return {...base({capabilityId:'teaching.curriculum.intake_signal_extraction',course,taskMode:'student_intake_signal_extraction',outputSchema,contextSpec:{untrusted_refs:[{ref:`intake:${intake.intake_id}`}],context_kind:'course_intake',access_purpose:'planning_hypothesis_extraction'},academicInput:{intake_ref:intake.intake_id},provenanceRefs:[`intake:${intake.intake_id}`]}),schemaValidator:outputSchema.validate,domainValidator:async value=>({ok:value?.provenance?.evidence_status==='NON_EVIDENCE_PLANNING_HYPOTHESIS',value,reason:'INTAKE_MUST_REMAIN_NON_EVIDENCE'}),provenanceValidator:async value=>({ok:value?.provenance?.intake_id===intake.intake_id,reason:'INTAKE_PROVENANCE_INVALID'})};
}

function curriculumAuditRequest({course,sources}){
  const academicInput=buildTpf02AcademicInput({course,sources});
  const sourceRefs=academicInput.source_items.map((item)=>item.source_item_ref);
  const outputSchema={
    id:TPF02_OUTPUT_SCHEMA_ID,
    version:TPF02_OUTPUT_SCHEMA_VERSION,
    uncertainty_states:['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED','unresolved','blocked_insufficient_sources','blocked_authority_conflict'],
    review_needed_field:'review_required',
    declared_fields:[...TPF02_TOP_LEVEL_FIELDS],
    validate:validateTpf02Schema,
  };
  const untrusted=new Set(['PRIMARY_STUDY_NOTE','STUDENT_SUPPLEMENT']);
  const request=base({
    capabilityId:'teaching.curriculum.deep_curriculum_audit',
    course,
    taskMode:'DEEP_AUDIT',
    outputSchema,
    contextSpec:{
      authoritative_refs:[{ref:`course:${course.course_id}`}],
      provenance_refs:sources.filter(s=>!untrusted.has(s.source_kind)).map(s=>({ref:`source:${s.source_content_item_id}`})),
      untrusted_refs:sources.filter(s=>untrusted.has(s.source_kind)).map(s=>({ref:`source:${s.source_content_item_id}`})),
      context_kind:'curriculum_audit',
      access_purpose:'source_accounting',
    },
    academicInput,
    provenanceRefs:sourceRefs,
  });
  const validationContext={
    inputStateReference:academicInput.input_state_reference,
    trustedScopeVersion:academicInput.audit_scope.trusted_scope_version,
    sourceItems:academicInput.source_items,
  };
  return {
    ...request,
    modelContentMode:'TPF02_DIRECT',
    generation:Object.freeze({maxOutputTokens:TPF02_MAX_OUTPUT_TOKENS,structuredOutput:Object.freeze({mimeType:'application/json'})}),
    validationContext,
    schemaValidator:validateTpf02Schema,
    domainValidator:async out=>validateTpf02Domain(out,validationContext),
    provenanceValidator:async out=>{
      const refs=new Set(out?.source_inventory?.map((item)=>String(item.source_item_ref))||[]);
      return {ok:sourceRefs.length===refs.size&&sourceRefs.every((ref)=>refs.has(ref)),reason:'CURRICULUM_SOURCE_PROVENANCE_INCOMPLETE'};
    },
  };
}

function diagnosticRequest({course,requirement,audit}){
  const outputSchema={id:'d07.targeted-diagnostic',version:'1',uncertainty_states:['INSUFFICIENT_EVIDENCE','REVIEW_NEEDED'],review_needed_field:'review_needed',declared_fields:['purpose','targets','opportunities','critical_criteria','non_graded'],validate:async out=>{if(!out||out.non_graded!==true||!Array.isArray(out.targets)||!Array.isArray(out.opportunities)||out.opportunities.length<2)return {ok:false,reason:'TARGETED_DIAGNOSTIC_SCHEMA_INVALID'};const allowed=new Set(requirement.targets);if(out.targets.some(x=>!allowed.has(String(x))))return {ok:false,reason:'DIAGNOSTIC_TARGET_OUT_OF_SCOPE'};return {ok:true,value:out};}};
  return {...base({capabilityId:'teaching.curriculum.targeted_placement_prior_knowledge_diagnostic_design',course,taskMode:'targeted_placement_diagnostic_design',outputSchema,contextSpec:{authoritative_refs:[{ref:`course:${course.course_id}`},{ref:`curriculum-audit:${audit.curriculum_audit_id}`}],context_kind:'diagnostic_design',access_purpose:'prior_knowledge_verification'},academicInput:{target_refs:requirement.targets,non_graded:true},provenanceRefs:[`curriculum-audit:${audit.curriculum_audit_id}`]}),schemaValidator:outputSchema.validate,domainValidator:outputSchema.validate,provenanceValidator:async out=>({ok:out.targets.every(x=>requirement.targets.includes(String(x))),reason:'DIAGNOSTIC_PROVENANCE_INVALID'})};
}

function vpkInterpretationRequest({course,target,evidenceRefs=[]}){
  const refs=evidenceRefs.map(String);
  const outputSchema={id:'d07.validated-prior-knowledge-interpretation',version:'1',uncertainty_states:['INSUFFICIENT_EVIDENCE','CONTRADICTORY_EVIDENCE','REVIEW_NEEDED'],review_needed_field:'review_needed',declared_fields:['target_ref','evidence_summary','critical_criteria_support','contradiction_state','planning_recommendation','uncertainty'],validate:async out=>{if(!out||String(out.target_ref)!==String(target.targetRef)||!Array.isArray(out.evidence_summary)||!Array.isArray(out.critical_criteria_support))return {ok:false,reason:'VPK_INTERPRETATION_SCHEMA_INVALID'};if(Object.hasOwn(out,'decision_status')||Object.hasOwn(out,'assessment_eligible')||Object.hasOwn(out,'certified'))return {ok:false,reason:'VPK_INTERPRETATION_MUST_NOT_CERTIFY'};return {ok:true,value:out};}};
  return {...base({capabilityId:'teaching.curriculum.validated_prior_knowledge_interpretation',course,taskMode:'validated_prior_knowledge_evidence_interpretation',outputSchema,contextSpec:{authoritative_refs:[{ref:`course:${course.course_id}`},...refs.map(ref=>({ref:`evidence:${ref}`}))],context_kind:'validated_prior_knowledge',access_purpose:'bounded_evidence_interpretation'},academicInput:{target_kind:target.targetKind,target_ref:target.targetRef,evidence_refs:refs},provenanceRefs:refs.map(ref=>`evidence:${ref}`)}),schemaValidator:outputSchema.validate,domainValidator:outputSchema.validate,provenanceValidator:async out=>({ok:String(out.target_ref)===String(target.targetRef),reason:'VPK_INTERPRETATION_PROVENANCE_INVALID'})};
}

function createD07Intelligence({orchestrator}={}){
  if(!orchestrator||typeof orchestrator.execute!=='function')throw new TypeError('D07 intelligence requires the Teaching Orchestrator.');
  return Object.freeze({extractIntake:args=>orchestrator.execute(intakeRequest(args)),runCurriculumAudit:args=>orchestrator.execute(curriculumAuditRequest(args)),designDiagnostic:args=>orchestrator.execute(diagnosticRequest(args)),interpretPriorKnowledge:args=>orchestrator.execute(vpkInterpretationRequest(args))});
}

module.exports={intakeRequest,curriculumAuditRequest,diagnosticRequest,vpkInterpretationRequest,createD07Intelligence,validateCurriculumAuditSchema,validateCurriculumAuditDomain};
