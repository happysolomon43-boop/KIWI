'use strict';

const { getCapability } = require('../capability-registry');
const { validateTPF09Output } = require('./contracts');

function stateReference({studentId,learningUnitId,stateVersion=0}){
  return Object.freeze({
    aggregate_type:'teaching_student_knowledge_state',
    aggregate_id:String(studentId)+':'+String(learningUnitId),
    state_version:String(stateVersion),
  });
}
function stateRefString({studentId,learningUnitId,stateVersion=0}){
  return 'skm:'+String(studentId)+':'+String(learningUnitId)+'@'+String(stateVersion);
}
function schema(id,{stateRef,taskMode,learningUnitRefs}){
  const validate=async(out)=>{
    try{return {ok:true,value:validateTPF09Output(out,{expectedStateReference:stateRef,taskMode,learningUnitRefs})};}
    catch(error){return {ok:false,reason:error.code||'TEACHING_D13_TPF09_INVALID',message:error.message};}
  };
  return Object.freeze({
    id,version:'1',
    uncertainty_states:Object.freeze(['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED']),
    review_needed_field:'review_required',
    declared_fields:Object.freeze([
      'status','input_state_reference','analysis_scope','review_required','review_reasons',
      'evidence_interpretation','learning_findings','misconceptions','confidence_calibration',
      'path_to_success','evidence_limit_or_invalidation_flags','contradictions','next_evidence_needs',
      'planning_summary','official_record_boundaries','uncertainties','handoff',
    ]),
    validate,
  });
}
function baseRequest({
  capabilityId,taskMode,studentId,courseId,learningUnitId,stateVersion=0,
  evidenceRefs=[],academicInput={},requestKey=null,
}={}){
  const cap=getCapability(capabilityId);
  const ref=stateRefString({studentId,learningUnitId,stateVersion});
  const outputSchema=schema('d13.tpf09-evidence-analysis',{stateRef:ref,taskMode,learningUnitRefs:[learningUnitId]});
  const key=String(requestKey||['d13',studentId,learningUnitId,taskMode,stateVersion].join(':'));
  return {
    trigger:{type:'workflow_continuation',ref:'learning-unit:'+learningUnitId+':'+taskMode,source:'teaching.d13',actor_id:studentId},
    capabilityId,
    declaredAuthorityLevel:cap.authority_ceiling,
    idempotencyKey:key,
    correlationId:key,
    stateReference:stateReference({studentId,learningUnitId,stateVersion}),
    preconditions:{student_id:studentId,course_id:courseId,learning_unit_id:learningUnitId,skm_state_version:String(stateVersion)},
    provenanceRefs:evidenceRefs,
    resultContract:{output_schema_id:outputSchema.id,output_schema_version:outputSchema.version,validator_ids:['schema','domain','authority','current-state']},
    taskMode,
    directive:{
      bounded_actions:['interpret supplied validated evidence only','preserve uncertainty and contradictions','return evidence/planning signals only'],
      allowed_operations:['classify evidence quality','identify provisional state/misconception/confidence/path signals','summarize bounded planning context'],
      prohibited_operations:[
        'set durable Student Knowledge Model state','create mastery probability or percentage','write Gradebook',
        'finalize progression','change Course scope or Assessment Eligibility','select provider/model',
        'infer permanent ability/personality/motivation','expose hidden chain-of-thought',
      ],
      downstream_handoff:{type:'validated_interpretation',commit_owner_boundary:cap.authoritative_owner_boundary,deterministic_state_engine_required:true},
    },
    contextSpec:{
      authoritative_refs:[{ref:'course:'+courseId},{ref:'learning-unit:'+learningUnitId},{ref}],
      provenance_refs:evidenceRefs.map((x)=>({ref:x})),
      untrusted_refs:[],
      context_kind:'student_knowledge_evidence',
      access_purpose:'bounded_evidence_interpretation_for_skm_owner',
    },
    outputSchema,
    academicInput:{
      ...academicInput,
      deterministic_state_engine_owns_commit:true,
      gradebook_is_read_only_context:true,
      progression_is_not_decided_here:true,
    },
    schemaValidator:outputSchema.validate,
    domainValidator:outputSchema.validate,
    provenanceValidator:async()=>({ok:true}),
    commit:false,
  };
}

function evidenceInterpretationRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.evidence_event_interpretation',taskMode:'evidence_event_interpretation'});}
function evidenceQualityRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.evidence_quality_weighting_proposal',taskMode:'evidence_quality_analysis'});}
function learningStateSignalRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.fragile_detection',taskMode:'learning_state_signal'});}
function misconceptionSynthesisRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.misconception_record_synthesis',taskMode:'misconception_record_synthesis'});}
function confidenceCalibrationRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.confidence_calibration_interpretation',taskMode:'confidence_calibration_analysis'});}
function pathToSuccessRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.path_to_success_memory_extraction',taskMode:'path_to_success_extraction'});}
function retentionRecommendationRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.retention_check_scheduling_recommendation',taskMode:'retention_check_recommendation'});}
function transferInterpretationRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.transfer_evidence_interpretation',taskMode:'transfer_independence_analysis'});}
function preClassSynthesisRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.pre_class_skm_synthesis_for_planning',taskMode:'pre_class_synthesis'});}
function contradictionAnalysisRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.learning_evidence_contradiction_detection',taskMode:'evidence_contradiction_analysis'});}
function assessmentInterpretationRequest(args){return baseRequest({...args,capabilityId:'teaching.evidence.assessment_result_learning_interpretation',taskMode:'assessment_result_learning_interpretation'});}

function createD13Intelligence({orchestrator}={}){
  if(!orchestrator||typeof orchestrator.execute!=='function')throw new TypeError('D13 intelligence requires the Teaching Orchestrator.');
  return Object.freeze({
    interpretEvidence:(args)=>orchestrator.execute(evidenceInterpretationRequest(args)),
    analyzeEvidenceQuality:(args)=>orchestrator.execute(evidenceQualityRequest(args)),
    signalLearningState:(args)=>orchestrator.execute(learningStateSignalRequest(args)),
    synthesizeMisconception:(args)=>orchestrator.execute(misconceptionSynthesisRequest(args)),
    analyzeConfidence:(args)=>orchestrator.execute(confidenceCalibrationRequest(args)),
    extractPathToSuccess:(args)=>orchestrator.execute(pathToSuccessRequest(args)),
    recommendRetentionCheck:(args)=>orchestrator.execute(retentionRecommendationRequest(args)),
    interpretTransfer:(args)=>orchestrator.execute(transferInterpretationRequest(args)),
    synthesizeForPlanning:(args)=>orchestrator.execute(preClassSynthesisRequest(args)),
    analyzeContradiction:(args)=>orchestrator.execute(contradictionAnalysisRequest(args)),
    interpretAssessment:(args)=>orchestrator.execute(assessmentInterpretationRequest(args)),
  });
}

module.exports={
  stateReference,stateRefString,
  evidenceInterpretationRequest,evidenceQualityRequest,learningStateSignalRequest,misconceptionSynthesisRequest,
  confidenceCalibrationRequest,pathToSuccessRequest,retentionRecommendationRequest,transferInterpretationRequest,
  preClassSynthesisRequest,contradictionAnalysisRequest,assessmentInterpretationRequest,createD13Intelligence,
};
