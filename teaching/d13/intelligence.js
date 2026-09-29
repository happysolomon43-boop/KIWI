'use strict';

const { getCapability } = require('../capability-registry');
const { validateTpf09Output } = require('./contracts');

function stateReference({studentId,learningUnitId,stateVersion=0}){
  return Object.freeze({aggregate_type:'teaching_student_knowledge_state',aggregate_id:`${studentId}:${learningUnitId}`,state_version:String(stateVersion)});
}
function stateRefString({studentId,learningUnitId,stateVersion=0}){return `skm:${studentId}:${learningUnitId}@${stateVersion}`;}
function schema(id,stateRef){
  return Object.freeze({
    id,version:'1',
    uncertainty_states:Object.freeze(['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED']),
    declared_fields:Object.freeze(['status','input_state_reference','analysis_scope','evidence_interpretation','learning_findings','misconceptions','confidence_calibration','path_to_success','invalidations_or_rechecks','contradictions','next_evidence_needs','planning_summary','official_record_boundaries','review_required','review_reasons','uncertainties','handoff']),
    validate:async(out)=>{
      try{return {ok:true,value:validateTpf09Output(out,{inputStateReference:stateRef})};}
      catch(error){return {ok:false,reason:error.code||'TEACHING_D13_TPF09_INVALID',message:error.message};}
    },
  });
}
function baseRequest({capabilityId,taskMode,studentId,courseId,learningUnitId,stateVersion,evidenceRefs=[],academicInput,requestKey}){
  const cap=getCapability(capabilityId);
  const ref=stateRefString({studentId,learningUnitId,stateVersion});
  const outputSchema=schema('d13.tpf09-evidence-analysis',ref);
  const validate=outputSchema.validate;
  const key=String(requestKey||['d13',studentId,learningUnitId,taskMode,stateVersion].join(':'));
  return {
    trigger:{type:'workflow_continuation',ref:`learning-unit:${learningUnitId}:${taskMode}`,source:'teaching.d13',actor_id:studentId},
    capabilityId,
    promptFamilyRef:'TPF-09',
    declaredAuthorityLevel:cap.authority_ceiling,
    idempotencyKey:key,correlationId:key,
    stateReference:stateReference({studentId,learningUnitId,stateVersion}),
    preconditions:{student_id:studentId,course_id:courseId,learning_unit_id:learningUnitId,skm_state_version:String(stateVersion)},
    provenanceRefs:evidenceRefs,
    resultContract:{output_schema_id:outputSchema.id,output_schema_version:outputSchema.version,validator_ids:['schema','domain','authority','current-state']},
    taskMode,
    directive:{
      bounded_actions:['interpret supplied evidence only','preserve uncertainty and contradictions','return planning/evidence signals only'],
      allowed_operations:['classify evidence quality','identify provisional misconception/confidence/path signals','summarize bounded planning context'],
      prohibited_operations:['set durable knowledge state','create mastery probability','write Gradebook','finalize progression','change Course scope or eligibility','select provider/model','infer permanent ability/personality','store hidden chain-of-thought'],
      downstream_handoff:{type:'validated_interpretation',commit_owner_boundary:cap.authoritative_owner_boundary,deterministic_state_engine_required:true},
    },
    contextSpec:{
      authoritative_refs:[{ref:`course:${courseId}`},{ref:`learning-unit:${learningUnitId}`},{ref}],
      provenance_refs:evidenceRefs.map(x=>({ref:x})),untrusted_refs:[],
      context_kind:'student_knowledge_evidence',access_purpose:'bounded_evidence_interpretation_for_skm_owner',
    },
    outputSchema,academicInput,
    schemaValidator:validate,domainValidator:validate,provenanceValidator:async()=>({ok:true}),commit:false,
  };
}

function evidenceInterpretationRequest(args){
  return baseRequest({...args,capabilityId:'teaching.evidence.evidence_event_interpretation',taskMode:'evidence_event_interpretation'});
}
function misconceptionSynthesisRequest(args){
  return baseRequest({...args,capabilityId:'teaching.evidence.misconception_record_synthesis',taskMode:'misconception_record_synthesis'});
}
function preClassSynthesisRequest(args){
  return baseRequest({...args,capabilityId:'teaching.evidence.pre_class_skm_synthesis_for_planning',taskMode:'pre_class_skm_synthesis'});
}
function contradictionAnalysisRequest(args){
  return baseRequest({...args,capabilityId:'teaching.evidence.learning_evidence_contradiction_detection',taskMode:'evidence_contradiction_analysis'});
}
function transferInterpretationRequest(args){
  return baseRequest({...args,capabilityId:'teaching.evidence.transfer_evidence_interpretation',taskMode:'transfer_independence_analysis'});
}

function createD13Intelligence({orchestrator}={}){
  if(!orchestrator||typeof orchestrator.execute!=='function')throw new TypeError('D13 intelligence requires the Teaching Orchestrator.');
  return Object.freeze({
    interpretEvidence:(args)=>orchestrator.execute(evidenceInterpretationRequest(args)),
    synthesizeMisconception:(args)=>orchestrator.execute(misconceptionSynthesisRequest(args)),
    synthesizeForPlanning:(args)=>orchestrator.execute(preClassSynthesisRequest(args)),
    analyzeContradiction:(args)=>orchestrator.execute(contradictionAnalysisRequest(args)),
    interpretTransfer:(args)=>orchestrator.execute(transferInterpretationRequest(args)),
  });
}

module.exports={
  stateReference,stateRefString,evidenceInterpretationRequest,misconceptionSynthesisRequest,preClassSynthesisRequest,contradictionAnalysisRequest,transferInterpretationRequest,createD13Intelligence,
};
