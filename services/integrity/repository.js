'use strict';

const {fail}=require('./contracts');

function createIntegrityRepository({query,withTransaction,randomUUID}={}){
  if(typeof query!=='function'||typeof withTransaction!=='function'||typeof randomUUID!=='function')throw new TypeError('Integrity repository requires query, withTransaction and randomUUID.');
  const q=(runner,sql,params=[])=>runner?(typeof runner==='function'?runner(sql,params):runner.query(sql,params)):query(sql,params);
  const json=(value)=>JSON.stringify(value??null);

  async function assertReady(){
    const {rows}=await query("select to_regclass('public.kiwi_integrity_sessions') sessions,to_regclass('public.kiwi_integrity_session_events') events,to_regclass('public.teaching_submission_verification_gates') gates,to_regclass('public.kiwi_verification_sessions') verification_sessions,to_regclass('public.kiwi_verification_items') verification_items,to_regclass('public.kiwi_verification_responses') verification_responses");
    if(Object.values(rows?.[0]||{}).some((value)=>value==null))throw fail('KIWI Integrity Session Guard schema is not ready.','KIWI_INTEGRITY_SCHEMA_NOT_READY',503);
    return true;
  }

  async function resolveOwner(userId,ownerType,ownerRef,runner=null){
    if(ownerType==='TEACHING_ASSIGNMENT'){
      const {rows}=await q(runner,'select * from public.teaching_assignments where student_id=$1 and assignment_id=$2 limit 1',[userId,ownerRef]);
      if(!rows?.[0])throw fail('Assignment not found for integrity session.','KIWI_INTEGRITY_OWNER_NOT_FOUND',404);
      return {kind:'TEACHING_ASSIGNMENT',row:rows[0]};
    }
    if(ownerType==='KIWI_EXAM'){
      const {rows}=await q(runner,'select * from public.exam_sessions where user_id=$1 and id=$2 limit 1',[userId,ownerRef]);
      if(!rows?.[0])throw fail('Exam session not found for integrity session.','KIWI_INTEGRITY_OWNER_NOT_FOUND',404);
      return {kind:'KIWI_EXAM',row:rows[0]};
    }
    if(ownerType==='TEACHING_ASSESSMENT_ATTEMPT'){
      const {rows}=await q(runner,'select a.*,d.assessment_type from public.teaching_assessment_attempts a join public.teaching_assessments d on d.assessment_id=a.assessment_id where a.student_id=$1 and a.assessment_attempt_id=$2 limit 1',[userId,ownerRef]);
      if(!rows?.[0])throw fail('Teaching Assessment Attempt not found for integrity session.','KIWI_INTEGRITY_OWNER_NOT_FOUND',404);
      return {kind:'TEACHING_ASSESSMENT_ATTEMPT',row:rows[0]};
    }
    throw fail('Unsupported integrity owner type.','KIWI_INTEGRITY_OWNER_INVALID',400);
  }

  async function getSession(userId,sessionId,runner=null,lock=false){const {rows}=await q(runner,`select * from public.kiwi_integrity_sessions where user_id=$1 and integrity_session_id=$2 ${lock?'for update':''}`,[userId,sessionId]);return rows?.[0]||null;}
  async function requireSession(userId,sessionId,runner=null,lock=false){const row=await getSession(userId,sessionId,runner,lock);if(!row)throw fail('Integrity session not found.','KIWI_INTEGRITY_SESSION_NOT_FOUND',404);return row;}
  async function findOwnerSession(userId,ownerType,ownerRef,runner=null){const {rows}=await q(runner,"select * from public.kiwi_integrity_sessions where user_id=$1 and owner_type=$2 and owner_ref=$3 and status<>'CLOSED' order by created_at desc limit 1",[userId,ownerType,ownerRef]);return rows?.[0]||null;}
  async function createSession({userId,ownerType,ownerRef,profile,policyVersion,currentDeviceRef=null}){
    return withTransaction(async(tx)=>{
      await resolveOwner(userId,ownerType,ownerRef,tx);
      const existing=await findOwnerSession(userId,ownerType,ownerRef,tx);if(existing)return {session:existing,idempotent:true};
      const {rows}=await q(tx,"insert into public.kiwi_integrity_sessions(integrity_session_id,user_id,owner_type,owner_ref,profile,policy_version,status,current_device_ref) values($1,$2,$3,$4,$5,$6,'ACTIVE',$7) returning *",[randomUUID(),userId,ownerType,ownerRef,profile,policyVersion,currentDeviceRef]);
      return {session:rows[0],idempotent:false};
    });
  }
  async function recentDeparture(userId,sessionId,runner=null){const {rows}=await q(runner,"select * from public.kiwi_integrity_session_events where user_id=$1 and integrity_session_id=$2 and normalized_kind in ('CONFIRMED_PROHIBITED_DEPARTURE','OBSERVED_DEPARTURE','PERMITTED_DEPARTURE','SYSTEM_PROTECTED_INTERRUPTION') order by accepted_at desc limit 1",[userId,sessionId]);return rows?.[0]||null;}
  async function eventByClientId(userId,sessionId,clientEventId,runner=null){if(!clientEventId)return null;const {rows}=await q(runner,'select * from public.kiwi_integrity_session_events where user_id=$1 and integrity_session_id=$2 and client_event_id=$3 limit 1',[userId,sessionId,clientEventId]);return rows?.[0]||null;}
  async function recordEvent({userId,sessionId,raw,decision,permitted=false,kiwiCaused=false}){
    return withTransaction(async(tx)=>{
      let session=await requireSession(userId,sessionId,tx,true);
      const prior=await eventByClientId(userId,sessionId,raw.clientEventId,tx);if(prior)return {session,event:prior,idempotent:true};
      let effectiveDecision=decision;
      if(decision.counts){
        const recent=await q(tx,"select integrity_event_id from public.kiwi_integrity_session_events where user_id=$1 and integrity_session_id=$2 and counts_as_departure=true and accepted_at>=now()-interval '1500 milliseconds' order by accepted_at desc limit 1",[userId,sessionId]);
        if(recent.rows?.[0])effectiveDecision={normalizedKind:'DUPLICATE_NOOP',counts:false,confirmedProhibited:false,reason:'SERVER_DEDUPLICATED'};
      }
      const {rows}=await q(tx,"insert into public.kiwi_integrity_session_events(integrity_event_id,integrity_session_id,user_id,client_event_id,raw_kind,normalized_kind,counts_as_departure,permitted,kiwi_caused,observed_at,duration_ms,safe_metadata,policy_version) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) returning *",[randomUUID(),sessionId,userId,raw.clientEventId,raw.kind,effectiveDecision.normalizedKind,Boolean(effectiveDecision.counts),Boolean(permitted),Boolean(kiwiCaused),raw.observedAt,raw.durationMs,json(raw.metadata),session.policy_version]);
      if(effectiveDecision.counts){const updated=await q(tx,"update public.kiwi_integrity_sessions set confirmed_departure_count=confirmed_departure_count+1,state_version=state_version+1,updated_at=now() where user_id=$1 and integrity_session_id=$2 returning *",[userId,sessionId]);session=updated.rows[0];}
      return {session,event:rows[0],effectiveDecision,idempotent:false};
    });
  }
  async function applySessionConsequence({userId,sessionId,action,outcome}){
    return withTransaction(async(tx)=>{
      let session=await requireSession(userId,sessionId,tx,true),appliedAction=null;
      if(action==='WARN'&&!session.warning_issued_at&&!['LOCKED','CLOSED'].includes(session.status)){
        const {rows}=await q(tx,"update public.kiwi_integrity_sessions set status='WARNING',warning_issued_at=now(),state_version=state_version+1,updated_at=now() where user_id=$1 and integrity_session_id=$2 returning *",[userId,sessionId]);session=rows[0];appliedAction='WARN';
      }
      if(action==='LOCK'&&!['LOCKED','CLOSED'].includes(session.status)){
        const {rows}=await q(tx,"update public.kiwi_integrity_sessions set status='LOCKED',locked_at=now(),lock_outcome=$3,state_version=state_version+1,updated_at=now() where user_id=$1 and integrity_session_id=$2 returning *",[userId,sessionId,outcome]);session=rows[0];appliedAction='LOCK';
      }
      if(session.owner_type==='KIWI_EXAM'&&appliedAction){
        if(appliedAction==='WARN')await q(tx,"update public.exam_sessions set integrity_policy_version=$3,integrity_session_state='WARNING',integrity_departure_count=$4,integrity_warning_at=coalesce(integrity_warning_at,now()),updated_at=now() where user_id=$1 and id=$2",[userId,session.owner_ref,session.policy_version,session.confirmed_departure_count]);
        else await q(tx,"update public.exam_sessions set integrity_policy_version=$3,integrity_session_state='LOCKED',integrity_departure_count=$4,integrity_locked_at=coalesce(integrity_locked_at,now()),integrity_lock_reason=$5,verification_pending=($5 in ('LOCKED_FOR_REVIEW','POST_ATTEMPT_VERIFICATION_REQUIRED')),status=case when $5='ATTEMPT_INVALIDATED_RULE_BREACH' then 'invalidated' else status end,updated_at=now() where user_id=$1 and id=$2",[userId,session.owner_ref,session.policy_version,session.confirmed_departure_count,outcome]);
      }
      return session;
    });
  }
  async function closeSession(userId,sessionId){
    return withTransaction(async(tx)=>{
      const session=await requireSession(userId,sessionId,tx,true);
      if(['LOCKED','CLOSED'].includes(session.status))return session;
      const {rows}=await q(tx,"update public.kiwi_integrity_sessions set status='CLOSED',closed_at=coalesce(closed_at,now()),state_version=state_version+1,updated_at=now() where user_id=$1 and integrity_session_id=$2 returning *",[userId,sessionId]);
      return rows?.[0]||session;
    });
  }
  async function listSafeEvents(userId,sessionId){const {rows=[]}=await query('select normalized_kind,counts_as_departure,permitted,kiwi_caused,accepted_at from public.kiwi_integrity_session_events where user_id=$1 and integrity_session_id=$2 order by accepted_at',[userId,sessionId]);return rows;}

  async function createGate({userId,assignmentId,receiptSubmissionId,correctionOfSubmissionId=null,policyVersion,acceptedEventAt,blockingDeadlineAt=null,idempotencyKey}){const prior=await query('select * from public.teaching_submission_verification_gates where user_id=$1 and idempotency_key=$2 limit 1',[userId,idempotencyKey]);if(prior.rows?.[0])return {gate:prior.rows[0],idempotent:true};const {rows}=await query("insert into public.teaching_submission_verification_gates(submission_gate_id,user_id,assignment_id,receipt_submission_id,correction_of_submission_id,policy_version,state,verification_route,accepted_event_at,blocking_deadline_at,idempotency_key) values($1,$2,$3,$4,$5,$6,'RECEIVED','NO_VERIFICATION',$7,$8,$9) returning *",[randomUUID(),userId,assignmentId,receiptSubmissionId,correctionOfSubmissionId,policyVersion,acceptedEventAt,blockingDeadlineAt,idempotencyKey]);return {gate:rows[0],idempotent:false};}
  async function getGate(userId,gateId,runner=null,lock=false){const {rows}=await q(runner,`select * from public.teaching_submission_verification_gates where user_id=$1 and submission_gate_id=$2 ${lock?'for update':''}`,[userId,gateId]);return rows?.[0]||null;}
  async function gateByAssignment(userId,assignmentId){const {rows}=await query('select * from public.teaching_submission_verification_gates where user_id=$1 and assignment_id=$2 order by created_at desc limit 1',[userId,assignmentId]);return rows?.[0]||null;}
  async function updateGate({userId,gateId,state,route,reasonCodes=[],systemDeferredReason=null,verificationSessionId=null,finalSubmissionId=null,finalizedAt=null}){const {rows}=await query('update public.teaching_submission_verification_gates set state=$3,verification_route=$4,reason_codes=$5::jsonb,system_deferred_reason=$6,verification_session_id=coalesce($7,verification_session_id),final_submission_id=coalesce($8,final_submission_id),finalized_at=coalesce($9,finalized_at),state_version=state_version+1,updated_at=now() where user_id=$1 and submission_gate_id=$2 returning *',[userId,gateId,state,route,json(reasonCodes),systemDeferredReason,verificationSessionId,finalSubmissionId,finalizedAt]);if(!rows?.[0])throw fail('Submission gate not found.','KIWI_SUBMISSION_GATE_NOT_FOUND',404);return rows[0];}

  async function createVerificationSession({userId,ownerType,ownerRef,sourceRef=null,route,targetCapabilities=[],maxQuestions=3,policyVersion,integritySessionId=null}){const {rows}=await query("insert into public.kiwi_verification_sessions(verification_session_id,user_id,owner_type,owner_ref,source_ref,route,status,target_capabilities,max_questions,policy_version,integrity_session_id) values($1,$2,$3,$4,$5,$6,'PENDING_ITEM',$7::jsonb,$8,$9,$10) returning *",[randomUUID(),userId,ownerType,ownerRef,sourceRef,route,json(targetCapabilities),Math.max(1,Math.min(Number(maxQuestions)||3,3)),policyVersion,integritySessionId]);return rows[0];}
  async function getVerificationSession(userId,sessionId,runner=null,lock=false){const {rows}=await q(runner,`select * from public.kiwi_verification_sessions where user_id=$1 and verification_session_id=$2 ${lock?'for update':''}`,[userId,sessionId]);return rows?.[0]||null;}
  async function findOpenVerificationSession(userId,ownerType,ownerRef,route=null,runner=null){const params=[userId,ownerType,ownerRef],where=["user_id=$1","owner_type=$2","owner_ref=$3","status in ('PENDING_ITEM','ACTIVE')"];if(route){params.push(route);where.push(`route=$${params.length}`);}const {rows}=await q(runner,`select * from public.kiwi_verification_sessions where ${where.join(' and ')} order by created_at desc limit 1`,params);return rows?.[0]||null;}
  async function latestVerificationItem(userId,verificationSessionId){const {rows}=await query('select * from public.kiwi_verification_items where user_id=$1 and verification_session_id=$2 order by sequence_no desc limit 1',[userId,verificationSessionId]);return rows?.[0]||null;}
  async function createVerificationItem({userId,verificationSessionId,sequenceNo,timingClass,durationSeconds,promptPayload,protectedValidationPayload={},targetCapability=null}){
    return withTransaction(async(tx)=>{
      const session=await getVerificationSession(userId,verificationSessionId,tx,true);if(!session)throw fail('Verification session not found.','KIWI_VERIFICATION_SESSION_NOT_FOUND',404);if(Number(session.question_count)>=Number(session.max_questions))throw fail('Verification question limit reached.','KIWI_VERIFICATION_QUESTION_LIMIT',409);
      const {rows}=await q(tx,'insert into public.kiwi_verification_items(verification_item_id,verification_session_id,user_id,sequence_no,timing_class,duration_seconds,prompt_payload,protected_validation_payload,target_capability) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) returning *',[randomUUID(),verificationSessionId,userId,sequenceNo,timingClass,durationSeconds,json(promptPayload),json(protectedValidationPayload),targetCapability]);
      await q(tx,"update public.kiwi_verification_sessions set status='ACTIVE',question_count=greatest(question_count,$3),started_at=coalesce(started_at,now()),updated_at=now() where user_id=$1 and verification_session_id=$2",[userId,verificationSessionId,sequenceNo]);
      return rows[0];
    });
  }
  async function startVerificationItem(userId,itemId){const {rows}=await query("update public.kiwi_verification_items set started_at=coalesce(started_at,now()),expires_at=coalesce(expires_at,now()+(duration_seconds||' seconds')::interval) where user_id=$1 and verification_item_id=$2 returning *",[userId,itemId]);return rows?.[0]||null;}
  async function getVerificationItem(userId,itemId){const {rows}=await query('select * from public.kiwi_verification_items where user_id=$1 and verification_item_id=$2 limit 1',[userId,itemId]);return rows?.[0]||null;}
  async function appendVerificationResponse({userId,verificationSessionId,itemId,responsePayload,acceptedEventAt,evaluationState='PENDING',evidencePayload={},idempotencyKey}){const prior=await query('select * from public.kiwi_verification_responses where user_id=$1 and idempotency_key=$2 limit 1',[userId,idempotencyKey]);if(prior.rows?.[0])return {response:prior.rows[0],idempotent:true};const item=await getVerificationItem(userId,itemId);if(!item||item.verification_session_id!==verificationSessionId)throw fail('Verification item not found.','KIWI_VERIFICATION_ITEM_NOT_FOUND',404);const expired=Boolean(item.expires_at&&new Date(acceptedEventAt).getTime()>new Date(item.expires_at).getTime());const {rows}=await query('insert into public.kiwi_verification_responses(verification_response_id,verification_session_id,verification_item_id,user_id,response_payload,accepted_event_at,expired_before_acceptance,evaluation_state,evidence_payload,idempotency_key) values($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10) returning *',[randomUUID(),verificationSessionId,itemId,userId,json(responsePayload),acceptedEventAt,expired,evaluationState,json(evidencePayload),idempotencyKey]);return {response:rows[0],idempotent:false};}
  async function completeVerificationSession({userId,sessionId,status}){const allowed=new Set(['PASSED','FAILED','REFUSED','REVIEW_NEEDED','EXPIRED','SYSTEM_DEFERRED']);if(!allowed.has(status))throw fail('Invalid verification completion state.','KIWI_VERIFICATION_STATE_INVALID',400);const {rows}=await query('update public.kiwi_verification_sessions set status=$3,completed_at=coalesce(completed_at,now()),updated_at=now() where user_id=$1 and verification_session_id=$2 returning *',[userId,sessionId,status]);return rows?.[0]||null;}
  async function examOwnerSnapshot(userId,examSessionId){const {rows}=await query('select * from public.exam_sessions where user_id=$1 and id=$2 limit 1',[userId,examSessionId]);return rows?.[0]||null;}

  return Object.freeze({assertReady,resolveOwner,getSession,requireSession,findOwnerSession,createSession,recentDeparture,eventByClientId,recordEvent,applySessionConsequence,closeSession,listSafeEvents,createGate,getGate,gateByAssignment,updateGate,createVerificationSession,getVerificationSession,findOpenVerificationSession,latestVerificationItem,createVerificationItem,startVerificationItem,getVerificationItem,appendVerificationResponse,completeVerificationSession,examOwnerSnapshot});
}

module.exports={createIntegrityRepository};
