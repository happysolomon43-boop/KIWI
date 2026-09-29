'use strict';

const { validateNormalizedEvidence, normalizeD12EvaluationBundle } = require('./contracts');
const { computeKnowledgeState, learningAnalysisProjection, SKM_ALGORITHM_VERSION } = require('./state-engine');

function fail(message,code,status=409,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;throw e;}
function asArray(v){return Array.isArray(v)?v:[];}

function createD13Service({repository,intelligence=null,randomUUID,clock=()=>new Date()}={}){
  if(!repository||typeof repository.loadKnowledgeSnapshot!=='function')throw new TypeError('D13 service requires repository.');
  if(typeof randomUUID!=='function')throw new TypeError('D13 service requires randomUUID().');

  async function recomputeAndCommit(studentId,learningUnitId,causeEvidenceEventId){
    for(let attempt=0;attempt<2;attempt+=1){
      const snapshot=await repository.loadKnowledgeSnapshot(studentId,learningUnitId);
      if(!snapshot)fail('Learning Unit not found.','TEACHING_D13_LEARNING_UNIT_NOT_FOUND',404);
      const computed=computeKnowledgeState(snapshot.evidence,{studentId,learningUnitId});
      try{
        return await repository.commitKnowledgeUpdate({studentId,learningUnitId,causeEvidenceEventId,computed,snapshot});
      }catch(error){
        if(error?.code==='TEACHING_D13_STALE_KNOWLEDGE_SNAPSHOT'&&attempt===0)continue;
        throw error;
      }
    }
    fail('Student Knowledge Model update could not obtain a current evidence snapshot.','TEACHING_D13_STALE_KNOWLEDGE_SNAPSHOT',409);
  }

  async function applyNormalizedEvidence(studentId,normalized,{idempotencyKey=null}={}){
    if(String(normalized.sourceOwner).toUpperCase().includes('GRADEBOOK')){
      fail('Gradebook facts cannot directly assign Student Knowledge Model state.','TEACHING_D13_GRADEBOOK_DIRECT_STATE_FORBIDDEN',422);
    }
    if(String(normalized.sourceOwner).toUpperCase().includes('PROGRESSION')){
      fail('Progression cannot directly assign Student Knowledge Model state.','TEACHING_D13_PROGRESSION_DIRECT_STATE_FORBIDDEN',422);
    }
    const saved=await repository.insertNormalizedEvidence({studentId,normalized,idempotencyKey});
    const results=[];
    for(const learningUnitId of normalized.learningUnitRefs){
      results.push(await recomputeAndCommit(studentId,learningUnitId,saved.evidence.evidence_event_id));
    }
    return Object.freeze({
      evidenceEventId:saved.evidence.evidence_event_id,
      idempotentEvidence:saved.idempotent,
      knowledgeUpdates:Object.freeze(results.map((r)=>Object.freeze({
        learningUnitId:r.state.learning_unit_id||null,
        version:Number(r.state.version_no||0),
        baseState:r.state.base_state||null,
        overlays:r.state.overlays||[],
        algorithmVersion:r.state.algorithm_version||SKM_ALGORITHM_VERSION,
        idempotent:Boolean(r.idempotent),
      }))),
      gradebookChanged:false,
      progressionDecided:false,
    });
  }

  async function ingestResponseEvaluation(studentId,evaluationId,{idempotencyKey=null}={}){
    const bundle=await repository.loadEvaluationBundle(studentId,evaluationId);
    if(!bundle)fail('Response evaluation not found.','TEACHING_D13_RESPONSE_EVALUATION_NOT_FOUND',404);
    if(bundle.evaluation.evaluation_state!=='VALIDATED'){
      return Object.freeze({accepted:true,noop:true,reason:'D13_REQUIRES_VALIDATED_D12_EVALUATION',evaluationState:bundle.evaluation.evaluation_state});
    }
    const normalized=normalizeD12EvaluationBundle(bundle);
    return applyNormalizedEvidence(studentId,normalized,{idempotencyKey:idempotencyKey||('d13-evaluation:'+evaluationId)});
  }

  async function handleResponseSubmittedEvent(event={}){
    const payload=event.payload||{};
    const studentId=String(event.actorId??event.actor_id??payload.student_id??'').trim();
    const responseId=String(payload.response_id??event.aggregateId??event.aggregate_id??'').trim();
    if(!studentId||!responseId)return Object.freeze({accepted:true,noop:true,reason:'D13_RESPONSE_EVENT_CONTEXT_MISSING'});
    const evaluation=await repository.latestEvaluationForResponse(studentId,responseId);
    if(!evaluation)return Object.freeze({accepted:true,noop:true,reason:'D13_RESPONSE_EVALUATION_ABSENT'});
    if(evaluation.evaluation_state!=='VALIDATED'){
      return Object.freeze({accepted:true,noop:true,reason:'D13_RESPONSE_EVALUATION_NOT_VALIDATED',evaluationState:evaluation.evaluation_state});
    }
    const result=await ingestResponseEvaluation(studentId,evaluation.evaluation_id,{idempotencyKey:'d13-response-event:'+String(event.eventId??event.event_id??responseId)});
    return Object.freeze({accepted:true,responseId,evaluationId:evaluation.evaluation_id,result});
  }

  async function ingestOwnerValidatedEvidence(input={}){
    const studentId=String(input.studentId||input.student_id||'').trim();
    if(!studentId)fail('studentId is required for owner-validated evidence.','TEACHING_D13_STUDENT_ID_REQUIRED',400);
    const normalized=validateNormalizedEvidence(input.evidence||input.normalizedEvidence||{});
    const owner=String(normalized.sourceOwner||'').toUpperCase();
    if(!owner||['CLIENT','BROWSER','STUDENT_UI'].includes(owner)){
      fail('Only trusted server-side evidence owners may use the D13 evidence seam.','TEACHING_D13_EVIDENCE_OWNER_UNTRUSTED',403);
    }
    return applyNormalizedEvidence(studentId,normalized,{idempotencyKey:input.idempotencyKey||input.idempotency_key||null});
  }

  function stateFromRow(row){
    if(!row)return null;
    return {
      base_state:row.base_state,
      overlays:row.overlays||[],
      dimensions:row.dimensions||{},
      certainty_band:row.certainty_band,
      certainty_basis:row.certainty_basis||{},
      retention_context:row.retention_context||{},
      strongest_supported_claim:row.strongest_supported_claim,
      contradiction_state:Boolean(row.contradiction_state),
      evidence_event_count:Number(row.evidence_event_count||0),
      evidence_cutoff_at:row.evidence_cutoff_at,
      path_to_success:row.path_to_success||{},
      confidence_calibration:row.confidence_calibration||{},
    };
  }
  function misconceptionFromRow(row){
    return {
      misconceptionRecordId:row.misconception_record_id,
      status:row.status,
      summary:row.hypothesis,
      affectedLearningUnitRefs:row.affected_learning_unit_refs||[],
      confidence:row.confidence,
    };
  }
  async function getLearningAnalysis(user,learningUnitId,{asOf=null}={}){
    const unit=await repository.getLearningUnit(user.id,learningUnitId);
    if(!unit)fail('Learning Unit not found.','TEACHING_D13_LEARNING_UNIT_NOT_FOUND',404);
    const [latest,history,misconceptions]=await Promise.all([
      repository.latestKnowledgeState(user.id,learningUnitId),
      repository.knowledgeHistory(user.id,learningUnitId,{limit:50}),
      repository.currentMisconceptions(user.id,learningUnitId),
    ]);
    const current=stateFromRow(latest);
    const historyStates=history.map(stateFromRow);
    const currentMisconceptions=misconceptions.filter((row)=>row.status!=='RESOLVED');
    const projection=learningAnalysisProjection(current,{history:historyStates,asOf:asOf||clock(),misconceptions:currentMisconceptions});
    return Object.freeze({
      learningUnitId,
      title:unit.title,
      analysis:projection,
      unresolvedMisconceptions:Object.freeze(currentMisconceptions.map(misconceptionFromRow)),
      stateRef:latest?'skm:'+learningUnitId+'@'+String(latest.version_no):null,
      algorithmVersion:latest?.algorithm_version||SKM_ALGORITHM_VERSION,
      gradebookChanged:false,
      progressionDecided:false,
      rawModelProbabilitiesIncluded:false,
      rawEvidenceWeightsIncluded:false,
      hiddenReasoningIncluded:false,
    });
  }

  async function getCourseLearningAnalysis(user,courseId,{asOf=null}={}){
    const rows=await repository.listCourseKnowledge(user.id,courseId);
    const misconceptions=await repository.listCourseCurrentMisconceptions(user.id,courseId);
    const byUnit=new Map();
    for(const row of misconceptions){
      if(row.status==='RESOLVED')continue;
      const refs=new Set([String(row.primary_learning_unit_id),...asArray(row.affected_learning_unit_refs).map(String)]);
      for(const ref of refs){
        if(!byUnit.has(ref))byUnit.set(ref,[]);
        byUnit.get(ref).push(row);
      }
    }
    const analyses=[];
    for(const row of rows){
      const state=row.version_no?stateFromRow(row):null;
      const projection=learningAnalysisProjection(state,{history:[],asOf:asOf||clock(),misconceptions:byUnit.get(String(row.learning_unit_id))||[]});
      analyses.push(Object.freeze({
        learningUnitId:row.learning_unit_id,
        title:row.title,
        analysis:projection,
        stateRef:row.version_no?'skm:'+row.learning_unit_id+'@'+String(row.version_no):null,
        algorithmVersion:row.algorithm_version||SKM_ALGORITHM_VERSION,
      }));
    }
    return Object.freeze({
      courseId,
      learningUnits:Object.freeze(analyses),
      rawModelProbabilitiesIncluded:false,
      rawEvidenceWeightsIncluded:false,
      hiddenReasoningIncluded:false,
      gradebookChanged:false,
      progressionDecided:false,
    });
  }

  async function analyzeEvidenceWithTpf09(user,learningUnitId,{taskMode='evidence_event_interpretation'}={}){
    const snapshot=await repository.loadKnowledgeSnapshot(user.id,learningUnitId);
    if(!snapshot)fail('Learning Unit not found.','TEACHING_D13_LEARNING_UNIT_NOT_FOUND',404);
    if(!intelligence)return Object.freeze({state:'ROUTE_HELD',routeQualification:'UNQUALIFIED_UNTIL_D30',durableStateCommitted:false});
    const common={
      studentId:user.id,courseId:snapshot.unit.course_id,learningUnitId,stateVersion:snapshot.stateVersion,
      evidenceRefs:snapshot.evidence.map((row)=>'evidence:'+row.evidence_event_id),
      academicInput:{evidence_events:snapshot.evidence,current_skm_state:stateFromRow(snapshot.latestState),official_gradebook_write_allowed:false},
      requestKey:'d13-analysis:'+learningUnitId+':'+snapshot.stateVersion+':'+taskMode,
    };
    const route={
      evidence_event_interpretation:'interpretEvidence',
      evidence_quality_analysis:'analyzeEvidenceQuality',
      learning_state_signal:'signalLearningState',
      misconception_record_synthesis:'synthesizeMisconception',
      confidence_calibration_analysis:'analyzeConfidence',
      path_to_success_extraction:'extractPathToSuccess',
      retention_check_recommendation:'recommendRetentionCheck',
      transfer_independence_analysis:'interpretTransfer',
      pre_class_synthesis:'synthesizeForPlanning',
      evidence_contradiction_analysis:'analyzeContradiction',
      assessment_result_learning_interpretation:'interpretAssessment',
    }[taskMode];
    if(!route||typeof intelligence[route]!=='function')fail('Unsupported D13 TPF-09 task mode.','TEACHING_D13_TPF09_TASK_MODE_UNSUPPORTED',400);
    const result=await intelligence[route](common);
    return Object.freeze({state:'ANALYZED',accepted:Boolean(result?.accepted),analysis:result?.validatedResult?.output||null,durableStateCommitted:false});
  }

  return Object.freeze({
    handleResponseSubmittedEvent,ingestResponseEvaluation,ingestOwnerValidatedEvidence,
    getLearningAnalysis,getCourseLearningAnalysis,analyzeEvidenceWithTpf09,
  });
}

module.exports={createD13Service};
