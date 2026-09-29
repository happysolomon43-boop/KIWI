'use strict';

const { getCapability } = require('../capability-registry');
const { validateTpf09Interpretation } = require('./contracts');

const ALLOWED_D13_CAPABILITIES = Object.freeze(new Set([
  'teaching.evidence.evidence_event_interpretation',
  'teaching.evidence.evidence_quality_weighting_proposal',
  'teaching.evidence.fragile_detection',
  'teaching.evidence.regressed_detection',
  'teaching.evidence.misconception_record_synthesis',
  'teaching.evidence.confidence_calibration_interpretation',
  'teaching.evidence.path_to_success_memory_extraction',
  'teaching.evidence.transfer_evidence_interpretation',
  'teaching.evidence.independence_evidence_interpretation',
  'teaching.evidence.pre_class_skm_synthesis_for_planning',
  'teaching.evidence.assessment_result_learning_interpretation',
  'teaching.evidence.learning_evidence_contradiction_detection',
]));

function outputSchema(id) {
  const validate=async(output)=>{
    try { return {ok:true,value:validateTpf09Interpretation(output)}; }
    catch(error) { return {ok:false,reason:error.code||'TEACHING_D13_TPF09_INVALID',message:error.message}; }
  };
  return Object.freeze({
    id,
    version:'1',
    uncertainty_states:Object.freeze(['insufficient_evidence','unresolved_conflict','review_needed']),
    declared_fields:Object.freeze([
      'status','capability_id','task_mode','evidence_findings','contradictions','misconception_findings',
      'confidence_findings','instructional_memory_findings','review_required','review_reasons','uncertainties','handoff',
    ]),
    validate,
  });
}

function assertCapability(capabilityId) {
  if (!ALLOWED_D13_CAPABILITIES.has(capabilityId)) {
    const error=new Error('Capability is outside D13 TPF-09 runtime scope.');
    error.code='TEACHING_D13_CAPABILITY_NOT_ALLOWED';
    error.status=422;
    throw error;
  }
  const capability=getCapability(capabilityId);
  if (String(capability.primary_prompt_family||capability.prompt_family_id||'TPF-09')!=='TPF-09') {
    const error=new Error('D13 capability does not resolve to TPF-09.');
    error.code='TEACHING_D13_PROMPT_FAMILY_MISMATCH';
    error.status=422;
    throw error;
  }
  if (!['T2','T3'].includes(String(capability.authority_ceiling))) {
    const error=new Error('D13 model-backed capability exceeds the permitted evidence-analysis authority.');
    error.code='TEACHING_D13_CAPABILITY_AUTHORITY_INVALID';
    error.status=422;
    throw error;
  }
  return capability;
}

function evidenceInterpretationRequest({
  capabilityId='teaching.evidence.evidence_event_interpretation',
  taskMode='evidence_event_interpretation',
  studentId,
  courseId,
  learningUnitId,
  stateVersion='0',
  normalizedEvidence,
  currentProjection=null,
  evidenceSnapshot=[],
  provenanceRefs=[],
  requestKey,
}={}) {
  const capability=assertCapability(capabilityId);
  if (!studentId || !courseId || !learningUnitId || !normalizedEvidence) throw new TypeError('D13 evidence interpretation request is incomplete.');
  const schema=outputSchema('d13.tpf09-evidence-interpretation');
  const key=String(requestKey||`d13:${capabilityId}:${learningUnitId}:${normalizedEvidence.source_evaluation_id||normalizedEvidence.task_ref}`);
  const validate=schema.validate;
  return {
    trigger:{type:'workflow_continuation',ref:`learning-unit:${learningUnitId}:${taskMode}`,source:'teaching.d13',actor_id:String(studentId)},
    capabilityId,
    declaredAuthorityLevel:String(capability.authority_ceiling),
    idempotencyKey:key,
    correlationId:key,
    stateReference:{aggregate_type:'teaching_student_knowledge_state',aggregate_id:String(learningUnitId),state_version:String(stateVersion||0)},
    preconditions:{
      student_id:String(studentId),course_id:String(courseId),learning_unit_id:String(learningUnitId),
      skm_state_version:String(stateVersion||0),algorithm_owner:'Student Knowledge Model',
    },
    provenanceRefs:[...new Set([`course:${courseId}`,`learning-unit:${learningUnitId}`,...provenanceRefs.map(String)])],
    resultContract:{
      output_schema_id:schema.id,output_schema_version:schema.version,
      validator_ids:['schema','authority','provenance','current-state'],
    },
    taskMode,
    directive:{
      bounded_actions:['interpret supplied validated evidence and surface uncertainty/contradiction/instructional-memory findings'],
      allowed_operations:['return a provisional TPF-09 evidence analysis only'],
      prohibited_operations:[
        'set durable knowledge state','set mastery probability','write Gradebook','finalize progression',
        'change attendance','change schedule','infer identity, motivation, intent, emotion, or ability',
        'turn missing work into failure evidence','treat accommodations as negative ability evidence','select provider/model',
      ],
      downstream_handoff:{
        type:'validated_evidence_analysis',
        commit_owner_boundary:'Student Knowledge Model',
        model_result_is_not_owner_commit:true,
      },
    },
    contextSpec:{
      authoritative_refs:[
        {ref:`course:${courseId}`},{ref:`learning-unit:${learningUnitId}`},
        ...(normalizedEvidence.source_evaluation_id?[{ref:`response-evaluation:${normalizedEvidence.source_evaluation_id}`}]:[]),
      ],
      provenance_refs:provenanceRefs.map((ref)=>({ref:String(ref)})),
      untrusted_refs:[],
      context_kind:'student_knowledge_evidence_analysis',
      access_purpose:'bounded evidence interpretation under TPF-09',
    },
    outputSchema:schema,
    academicInput:{
      normalized_evidence:normalizedEvidence,
      current_skm_projection:currentProjection,
      evidence_snapshot:evidenceSnapshot,
      owner_rules:{
        deterministic_state_machine_owns_state:true,
        gradebook_truth_separate:true,
        progression_truth_separate:true,
        time_does_not_decay_knowledge_by_decree:true,
        accommodations_are_not_negative_evidence:true,
        system_failure_is_not_negative_student_evidence:true,
      },
    },
    schemaValidator:validate,
    domainValidator:validate,
    provenanceValidator:async(output)=>({
      ok:String(output?.capability_id||capabilityId)===String(capabilityId) || output?.capability_id==null,
      reason:'TEACHING_D13_TPF09_PROVENANCE_INVALID',
    }),
    commit:false,
  };
}

function preClassSynthesisRequest({
  studentId,courseId,learningUnitIds=[],stateVersionRef='0',knowledgeSignals=[],misconceptionSignals=[],requestKey,
}={}) {
  const capabilityId='teaching.evidence.pre_class_skm_synthesis_for_planning';
  const capability=assertCapability(capabilityId);
  const schema=outputSchema('d13.tpf09-preclass-synthesis');
  const validate=schema.validate;
  const key=String(requestKey||`d13:preclass:${courseId}:${stateVersionRef}`);
  return {
    trigger:{type:'background_analysis',ref:`course:${courseId}:preclass-skm-synthesis`,source:'teaching.d13',actor_id:String(studentId)},
    capabilityId,declaredAuthorityLevel:String(capability.authority_ceiling),idempotencyKey:key,correlationId:key,
    stateReference:{aggregate_type:'teaching_student_knowledge_course_projection',aggregate_id:String(courseId),state_version:String(stateVersionRef)},
    preconditions:{student_id:String(studentId),course_id:String(courseId),skm_state_version_ref:String(stateVersionRef)},
    provenanceRefs:[`course:${courseId}`,...learningUnitIds.map((id)=>`learning-unit:${id}`)],
    resultContract:{output_schema_id:schema.id,output_schema_version:schema.version,validator_ids:['schema','authority','provenance','current-state']},
    taskMode:'pre_class_skm_synthesis_for_planning',
    directive:{
      bounded_actions:['summarize owner-supplied SKM signals for the Lesson Planner without inventing new knowledge facts'],
      allowed_operations:['identify instructional priorities, verification needs, fragile/blocked/recurring misconception signals'],
      prohibited_operations:['mutate SKM','mutate Lesson Blueprint','change standards','write grades','finalize progression','select provider/model'],
      downstream_handoff:{type:'lesson_planner_context',commit_owner_boundary:'Lesson Planner/Controller',model_result_is_not_owner_commit:true},
    },
    contextSpec:{
      authoritative_refs:[{ref:`course:${courseId}`}],
      provenance_refs:learningUnitIds.map((id)=>({ref:`learning-unit:${id}`})),
      untrusted_refs:[],context_kind:'pre_class_skm_synthesis',access_purpose:'bounded lesson-planning context synthesis',
    },
    outputSchema:schema,
    academicInput:{
      knowledge_signals:knowledgeSignals,
      misconception_signals:misconceptionSignals,
      learning_unit_refs:learningUnitIds,
      raw_weights_forbidden:true,
      gradebook_truth_not_supplied:true,
    },
    schemaValidator:validate,domainValidator:validate,provenanceValidator:async()=>({ok:true}),commit:false,
  };
}

function createD13Intelligence({orchestrator}={}) {
  if (!orchestrator || typeof orchestrator.execute!=='function') throw new TypeError('D13 intelligence requires the Teaching Orchestrator.');
  return Object.freeze({
    interpretEvidence:(args)=>orchestrator.execute(evidenceInterpretationRequest(args)),
    synthesizePreClass:(args)=>orchestrator.execute(preClassSynthesisRequest(args)),
  });
}

module.exports={
  ALLOWED_D13_CAPABILITIES,evidenceInterpretationRequest,preClassSynthesisRequest,createD13Intelligence,
};
