'use strict';

const { TEACHING_EVENTS } = require('../events/names');
const { EVENT_CATEGORIES } = require('../runtime/constants');

function createD12ResponsePedagogyRepository({query,withTransaction,randomUUID,d11Repository,outboxStore=null,clock=()=>new Date()}={}) {
  if(typeof query!=='function') throw new TypeError('D12 repository requires query().');
  if(typeof withTransaction!=='function') throw new TypeError('D12 repository requires withTransaction().');
  if(typeof randomUUID!=='function') throw new TypeError('D12 repository requires randomUUID().');
  if(!d11Repository||typeof d11Repository.getClassContext!=='function') throw new TypeError('D12 repository requires D11 Controller repository.');
  const q=(runner,text,params=[])=>runner&&typeof runner.query==='function'?runner.query(text,params):query(text,params);

  async function assertReady(){
    const {rows}=await query(
      "select to_regclass('public.teaching_response_evaluations') response_evaluations,"+
      " to_regclass('public.teaching_pedagogy_decisions') pedagogy_decisions,"+
      " to_regclass('public.teaching_learning_unit_pedagogy_profiles') pedagogy_profiles,"+
      " to_regclass('public.teaching_teacher_corrections') teacher_corrections,"+
      " to_regclass('public.teaching_evidence_recheck_handoffs') evidence_recheck_handoffs"
    );
    const row=rows?.[0]||{};
    if(Object.values(row).some((v)=>v==null)){
      const error=new Error('Teaching D12 persistence is not installed.');
      error.code='TEACHING_D12_SCHEMA_MISSING';
      throw error;
    }
    return true;
  }

  async function getClassContext(studentId,classId,runner=null){
    return d11Repository.getClassContext(studentId,classId,runner);
  }

  async function getLearningUnit(studentId,learningUnitId,runner=null){
    const {rows}=await q(runner,"select * from public.teaching_learning_units where student_id=$1 and learning_unit_id=$2 limit 1",[studentId,learningUnitId]);
    return rows?.[0]||null;
  }

  async function getSubject(studentId,subjectId,runner=null){
    const {rows}=await q(runner,"select id,name from public.subjects where user_id=$1 and id=$2 limit 1",[studentId,subjectId]);
    return rows?.[0]||null;
  }

  async function createResponse({studentId,classId,learningUnitId,responseKind,responsePayload,assistanceContext={},provenance={},submittedAt=null,idempotencyKey,expectedControllerVersion=null,boardItemId=null}={}){
    return withTransaction(async(tx)=>{
      if(idempotencyKey){
        const prior=await tx.query("select * from public.teaching_student_responses where student_id=$1 and idempotency_key=$2 limit 1",[studentId,idempotencyKey]);
        if(prior.rows?.[0]) return Object.freeze({response:prior.rows[0],idempotent:true});
      }
      const context=await d11Repository.getClassContext(studentId,classId,tx);
      if(!context?.session){const e=new Error('Active Teaching Controller session is required.');e.code='TEACHING_D12_CONTROLLER_SESSION_REQUIRED';e.status=409;throw e;}
      if(context.session.lifecycle_state==='CLOSED'){const e=new Error('Closed Class cannot accept new D12 responses.');e.code='TEACHING_D12_CLASS_CLOSED';e.status=409;throw e;}
      if(expectedControllerVersion!=null&&Number(context.session.state_version)!==Number(expectedControllerVersion)){const e=new Error('Controller version changed before response capture.');e.code='TEACHING_D12_STALE_CONTROLLER_VERSION';e.status=409;throw e;}
      const unit=await getLearningUnit(studentId,learningUnitId,tx);
      if(!unit||String(unit.course_plan_id)!==String(context.plan?.course_plan_id)){const e=new Error('Response Learning Unit is not in the current Course Plan.');e.code='TEACHING_D12_LEARNING_UNIT_NOT_CURRENT';e.status=409;throw e;}
      if(boardItemId){
        const board=await tx.query(
          "select bi.board_item_id,s.class_session_id from public.teaching_board_items bi join public.teaching_board_scenes s on s.board_scene_id=bi.board_scene_id where bi.board_item_id=$1 limit 1",
          [boardItemId]
        );
        if(!board.rows?.[0]||String(board.rows[0].class_session_id)!==String(context.session.class_session_id)){
          const e=new Error('Board item does not belong to the current Class session.');e.code='TEACHING_D12_BOARD_ITEM_SESSION_MISMATCH';e.status=409;throw e;
        }
      }
      const id=randomUUID();
      const serverSubmittedAt=submittedAt||clock();
      const inserted=await tx.query(
        "insert into public.teaching_student_responses(response_id,student_id,class_session_id,board_item_id,response_kind,response_payload,submitted_at,assistance_context,provenance,learning_unit_id,controller_version,idempotency_key)"+
        " values($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,$12) returning *",
        [id,studentId,context.session.class_session_id,boardItemId,responseKind,JSON.stringify(responsePayload||{}),serverSubmittedAt,JSON.stringify(assistanceContext||{}),JSON.stringify(provenance||{}),learningUnitId,Number(context.session.state_version),idempotencyKey||null]
      );
      if(outboxStore&&typeof outboxStore.appendUsing==='function'){
        const occurred=clock().toISOString();
        const eventId='d12-response-submitted:'+id;
        await outboxStore.appendUsing(tx.query.bind(tx),{
          eventId,schemaVersion:1,eventType:TEACHING_EVENTS.STUDENT_RESPONSE_SUBMITTED,
          eventCategory:EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,triggerType:'committed_domain_event',
          source:'teaching.d12',origin:'d12',actorId:studentId,
          aggregateType:'teaching_student_response',aggregateId:id,aggregateVersion:1,
          occurredAt:occurred,effectiveAt:occurred,dueAt:null,
          correlationId:eventId,causationId:null,idempotencyKey:eventId,
          payload:{student_id:studentId,class_id:classId,class_session_id:context.session.class_session_id,response_id:id,learning_unit_id:learningUnitId,controller_version:Number(context.session.state_version)},
          auditRefs:[],provenanceRefs:['class:'+classId,'class-session:'+context.session.class_session_id,'learning-unit:'+learningUnitId],
        });
      }
      return Object.freeze({response:inserted.rows[0],idempotent:false});
    });
  }

  async function getResponse(studentId,responseId,runner=null){
    const {rows}=await q(runner,"select * from public.teaching_student_responses where student_id=$1 and response_id=$2 limit 1",[studentId,responseId]);
    return rows?.[0]||null;
  }

  async function listEvaluationsForResponse(studentId,responseId,runner=null){
    const {rows}=await q(runner,"select * from public.teaching_response_evaluations where student_id=$1 and response_id=$2 order by evaluation_version desc",[studentId,responseId]);
    return rows||[];
  }

  async function latestEvaluation(studentId,responseId,runner=null){
    const rows=await listEvaluationsForResponse(studentId,responseId,runner);
    return rows[0]||null;
  }

  async function recentLearningUnitEvaluations(studentId,learningUnitId,limit=8,runner=null){
    const {rows}=await q(runner,"select * from public.teaching_response_evaluations where student_id=$1 and learning_unit_id=$2 and evaluation_state='VALIDATED' order by created_at desc limit $3",[studentId,learningUnitId,Math.max(1,Math.min(Number(limit)||8,25))]);
    return rows||[];
  }

  async function saveEvaluation({studentId,classId,response,learningUnit,context,state='VALIDATED',payload={},capabilityId='teaching.lesson.response_correctness_quality_evaluation',promptFamilyId='TPF-06',promptFamilyVersion='1.3',contractVersion='d12.response-evaluation.v1',provenanceRefs=[],idempotencyKey,executionId=null,evaluatorConfidence=null,evidenceStrength='UNKNOWN',assistanceState=null,exposureState=null,candidateMisconception=null,prerequisiteHypothesis=null}={}){
    return withTransaction(async(tx)=>{
      if(idempotencyKey){
        const prior=await tx.query("select * from public.teaching_response_evaluations where student_id=$1 and idempotency_key=$2 limit 1",[studentId,idempotencyKey]);
        if(prior.rows?.[0]) return prior.rows[0];
      }
      const live=await d11Repository.getClassContext(studentId,classId,tx);
      if(!live?.session||String(live.session.class_session_id)!==String(response.class_session_id)){const e=new Error('Response Class session is no longer current.');e.code='TEACHING_D12_STALE_RESPONSE_SESSION';e.status=409;throw e;}
      if(Number(live.session.state_version)!==Number(context.session.state_version)){const e=new Error('Controller version changed before evaluation commit.');e.code='TEACHING_D12_STALE_EVALUATION_RESULT';e.status=409;throw e;}
      const versions=await tx.query("select coalesce(max(evaluation_version),0)+1 next_version from public.teaching_response_evaluations where student_id=$1 and response_id=$2",[studentId,response.response_id]);
      const a=payload?.response_assessment||{};
      const inserted=await tx.query(
        "insert into public.teaching_response_evaluations(evaluation_id,student_id,response_id,class_id,class_session_id,learning_unit_id,controller_version,evaluation_version,evaluation_state,capability_id,prompt_family_id,prompt_family_version,contract_version,evaluation_payload,evaluator_confidence,evidence_strength,assistance_state,exposure_state,candidate_misconception,prerequisite_hypothesis,provenance_refs,idempotency_key,execution_id)"+
        " values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22,$23) returning *",
        [randomUUID(),studentId,response.response_id,classId,response.class_session_id,learningUnit.learning_unit_id,Number(context.session.state_version),Number(versions.rows[0].next_version),state,capabilityId,promptFamilyId,promptFamilyVersion,contractVersion,JSON.stringify(payload||{}),evaluatorConfidence||a.evaluator_confidence||null,evidenceStrength,JSON.stringify(assistanceState||payload?.assistance_and_independence||{}),JSON.stringify(exposureState||{}),candidateMisconception?JSON.stringify(candidateMisconception):(payload?.misconception?JSON.stringify(payload.misconception):null),prerequisiteHypothesis?JSON.stringify(prerequisiteHypothesis):(payload?.prerequisite?JSON.stringify(payload.prerequisite):null),JSON.stringify(provenanceRefs||[]),idempotencyKey,executionId]
      );
      return inserted.rows[0];
    });
  }

  async function saveRouteHeldEvaluation({studentId,classId,response,learningUnit,context,idempotencyKey,reason='UNQUALIFIED_UNTIL_D30'}={}){
    return saveEvaluation({studentId,classId,response,learningUnit,context,state:'ROUTE_HELD',payload:{route_qualification:reason,provisional_model_output_absent:true,one_response_durable_state_forbidden:true},provenanceRefs:['response:'+response.response_id,'learning-unit:'+learningUnit.learning_unit_id],idempotencyKey,executionId:null});
  }

  async function savePedagogyDecision({studentId,classId,context,learningUnit,evaluation=null,capabilityId,taskMode,state,payload,assistanceCeiling,assistanceLevel,strategyClass=null,blockedProposal=false,replanRecommended=false,provenanceRefs=[],idempotencyKey,executionId=null}={}){
    return withTransaction(async(tx)=>{
      if(idempotencyKey){const prior=await tx.query("select * from public.teaching_pedagogy_decisions where student_id=$1 and idempotency_key=$2 limit 1",[studentId,idempotencyKey]);if(prior.rows?.[0]) return prior.rows[0];}
      const live=await d11Repository.getClassContext(studentId,classId,tx);
      if(!live?.session||Number(live.session.state_version)!==Number(context.session.state_version)){const e=new Error('Controller changed before pedagogy decision commit.');e.code='TEACHING_D12_STALE_PEDAGOGY_RESULT';e.status=409;throw e;}
      const inserted=await tx.query(
        "insert into public.teaching_pedagogy_decisions(pedagogy_decision_id,student_id,response_evaluation_id,class_id,class_session_id,learning_unit_id,controller_version,capability_id,prompt_family_id,prompt_family_version,task_mode,decision_state,assistance_ceiling,assistance_level,decision_payload,strategy_class,blocked_proposal,replan_recommended,durable_state_committed,provenance_refs,idempotency_key,execution_id)"+
        " values($1,$2,$3,$4,$5,$6,$7,$8,'TPF-07','1.2',$9,$10,$11,$12,$13::jsonb,$14,$15,$16,false,$17::jsonb,$18,$19) returning *",
        [randomUUID(),studentId,evaluation?.evaluation_id||null,classId,context.session.class_session_id,learningUnit.learning_unit_id,Number(context.session.state_version),capabilityId,taskMode,state,assistanceCeiling,assistanceLevel,JSON.stringify(payload||{}),strategyClass,Boolean(blockedProposal),Boolean(replanRecommended),JSON.stringify(provenanceRefs||[]),idempotencyKey,executionId]
      );
      return inserted.rows[0];
    });
  }

  async function latestPedagogyDecision(studentId,responseEvaluationId){
    const {rows}=await query("select * from public.teaching_pedagogy_decisions where student_id=$1 and response_evaluation_id=$2 order by created_at desc limit 1",[studentId,responseEvaluationId]);
    return rows?.[0]||null;
  }

  async function recentPedagogyDecisions(studentId,learningUnitId,limit=8,runner=null){
    const {rows}=await q(runner,"select * from public.teaching_pedagogy_decisions where student_id=$1 and learning_unit_id=$2 order by created_at desc limit $3",[studentId,learningUnitId,Math.max(1,Math.min(Number(limit)||8,25))]);
    return rows||[];
  }

  async function latestPedagogyProfile(studentId,learningUnitId,runner=null){
    const {rows}=await q(runner,"select * from public.teaching_learning_unit_pedagogy_profiles where student_id=$1 and learning_unit_id=$2 order by profile_version desc limit 1",[studentId,learningUnitId]);
    return rows?.[0]||null;
  }

  async function savePedagogyProfile({studentId,learningUnit,profile,capabilityId='teaching.pedagogy.pedagogical_profile_classification',promptFamilyId='TPF-07',promptFamilyVersion='1.2',contractVersion='d12.pedagogy-profile.v1',provenanceRefs=[],idempotencyKey,executionId=null,state='VALIDATED'}={}){
    return withTransaction(async(tx)=>{
      if(idempotencyKey){const prior=await tx.query("select * from public.teaching_learning_unit_pedagogy_profiles where student_id=$1 and idempotency_key=$2 limit 1",[studentId,idempotencyKey]);if(prior.rows?.[0]) return prior.rows[0];}
      const versions=await tx.query("select coalesce(max(profile_version),0)+1 next_version from public.teaching_learning_unit_pedagogy_profiles where student_id=$1 and learning_unit_id=$2",[studentId,learningUnit.learning_unit_id]);
      const p=profile.profile||profile;
      const inserted=await tx.query(
        "insert into public.teaching_learning_unit_pedagogy_profiles(pedagogy_profile_id,student_id,learning_unit_id,course_plan_id,profile_version,profile_state,knowledge_type,primary_student_actions,answer_space,representations,profile_payload,subject_template_authoritative,capability_id,prompt_family_id,prompt_family_version,contract_version,provenance_refs,idempotency_key,execution_id)"+
        " values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,false,$12,$13,$14,$15,$16::jsonb,$17,$18) returning *",
        [randomUUID(),studentId,learningUnit.learning_unit_id,learningUnit.course_plan_id,Number(versions.rows[0].next_version),state,p.knowledge_type,JSON.stringify(p.primary_student_actions||[]),p.answer_space,JSON.stringify(p.representations||[]),JSON.stringify(profile||{}),capabilityId,promptFamilyId,promptFamilyVersion,contractVersion,JSON.stringify(provenanceRefs||[]),idempotencyKey,executionId]
      );
      return inserted.rows[0];
    });
  }

  async function saveTeacherCorrection({studentId,classId,context,sourceEvaluation=null,state,payload,evidenceRecheckRequired=false,provenanceRefs=[],idempotencyKey,executionId=null}={}){
    return withTransaction(async(tx)=>{
      if(idempotencyKey){const prior=await tx.query("select * from public.teaching_teacher_corrections where student_id=$1 and idempotency_key=$2 limit 1",[studentId,idempotencyKey]);if(prior.rows?.[0]) return prior.rows[0];}
      const live=await d11Repository.getClassContext(studentId,classId,tx);
      if(!live?.session||Number(live.session.state_version)!==Number(context.session.state_version)){const e=new Error('Controller changed before teacher-correction commit.');e.code='TEACHING_D12_STALE_TEACHER_CORRECTION';e.status=409;throw e;}
      const inserted=await tx.query(
        "insert into public.teaching_teacher_corrections(teacher_correction_id,student_id,class_id,class_session_id,source_response_evaluation_id,controller_version,correction_state,correction_payload,evidence_recheck_required,provenance_refs,idempotency_key,execution_id) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12) returning *",
        [randomUUID(),studentId,classId,context.session.class_session_id,sourceEvaluation?.evaluation_id||null,Number(context.session.state_version),state,JSON.stringify(payload||{}),Boolean(evidenceRecheckRequired),JSON.stringify(provenanceRefs||[]),idempotencyKey,executionId]
      );
      return inserted.rows[0];
    });
  }

  async function createEvidenceRecheckHandoff({studentId,classId,context,teacherCorrection,sourceEvaluation=null,targetOwner='SKM/Evidence',payload={},provenanceRefs=[],idempotencyKey}={}){
    return withTransaction(async(tx)=>{
      if(idempotencyKey){const prior=await tx.query("select * from public.teaching_evidence_recheck_handoffs where student_id=$1 and idempotency_key=$2 limit 1",[studentId,idempotencyKey]);if(prior.rows?.[0]) return prior.rows[0];}
      const inserted=await tx.query(
        "insert into public.teaching_evidence_recheck_handoffs(evidence_recheck_handoff_id,student_id,teacher_correction_id,class_id,class_session_id,source_response_evaluation_id,target_owner,handoff_state,handoff_payload,provenance_refs,idempotency_key) values($1,$2,$3,$4,$5,$6,$7,'PENDING_OWNER',$8::jsonb,$9::jsonb,$10) returning *",
        [randomUUID(),studentId,teacherCorrection.teacher_correction_id,classId,context.session.class_session_id,sourceEvaluation?.evaluation_id||null,targetOwner,JSON.stringify(payload||{}),JSON.stringify(provenanceRefs||[]),idempotencyKey]
      );
      return inserted.rows[0];
    });
  }

  async function getEvaluation(studentId,evaluationId){
    const {rows}=await query("select * from public.teaching_response_evaluations where student_id=$1 and evaluation_id=$2 limit 1",[studentId,evaluationId]);
    return rows?.[0]||null;
  }

  async function getTeacherCorrection(studentId,correctionId){
    const {rows}=await query("select * from public.teaching_teacher_corrections where student_id=$1 and teacher_correction_id=$2 limit 1",[studentId,correctionId]);
    return rows?.[0]||null;
  }

  async function getCourseSourceItems(studentId,courseId,sourceRefs=[]){
    const refs=[...new Set((sourceRefs||[]).map(String).filter(Boolean))];
    if(!refs.length) return [];
    const {rows}=await query("select source_content_item_id,source_kind,source_ref,source_version_ref,locator,content_hash,content_summary,classification from public.teaching_source_content_items where student_id=$1 and course_id=$2 and (source_content_item_id=any($3::text[]) or source_ref=any($3::text[])) order by source_content_item_id",[studentId,courseId,refs]);
    return rows||[];
  }

  return Object.freeze({
    assertReady,getClassContext,getLearningUnit,getSubject,createResponse,getResponse,listEvaluationsForResponse,latestEvaluation,
    recentLearningUnitEvaluations,saveEvaluation,saveRouteHeldEvaluation,savePedagogyDecision,latestPedagogyDecision,latestPedagogyProfile,
    savePedagogyProfile,saveTeacherCorrection,createEvidenceRecheckHandoff,getEvaluation,getTeacherCorrection,getCourseSourceItems,recentPedagogyDecisions,
  });
}

module.exports={createD12ResponsePedagogyRepository};
