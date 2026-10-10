'use strict';
const {TEACHING_EVENTS}=require('../events/names');
const {hash}=require('../classroom-remodel/academic-artifacts');
const {failure}=require('../classroom-remodel/presentation-policy');
const {protectedMode}=require('../classroom-remodel/protected-activity');
const {closureRecord}=require('../classroom-remodel/closure-record');

function createClassroomContinuityRepository({query,withTransaction,randomUUID,presentationRepository}={}) {
 for(const fn of [query,withTransaction,randomUUID])if(typeof fn!=='function')throw new TypeError('Continuity requires durable database dependencies');
 async function owner(tx,studentId,classId) {
  const row=(await tx.query('select c.class_id,c.course_id,s.class_session_id,s.lifecycle_state,s.started_at,s.instructional_substate,s.resume_instructional_substate,s.progress_state from public.teaching_classes c left join public.teaching_class_sessions s on s.class_id=c.class_id and s.student_id=c.student_id where c.student_id=$1 and c.class_id=$2',[studentId,classId])).rows[0];
  if(!row)throw failure('CLASSROOM_HISTORY_NOT_OWNED',404);
  if(protectedMode(row))throw failure('CLASSROOM_HISTORY_PROTECTED_ACTIVITY',409);
  return row;
 }
 async function captureUsing(tx,a,d,progress={}) {
  const portions=(await tx.query("select p.portion_id,p.public_payload,p.status,p.board_item_ids,c.server_sequence from public.teaching_classroom_portions p join public.teaching_classroom_conversation c using(portion_id,session_id) where p.session_id=$1 order by c.server_sequence",[d.session_id])).rows;
  const questions=(await tx.query("select message_id,state,(select x->>'difficulty_resolution' from jsonb_array_elements(coalesce(accepted_proposal->'artifacts'->'message_dispositions','[]'::jsonb)) x where x->>'message_ref'=q.message_id limit 1) difficulty_resolution,case when state='answered' then 'delivered_confirmed' when reply_event_id is null then 'not_delivered' else 'delivery_requested' end reply_delivery_status from public.teaching_classroom_message_queue q where session_id=$1 order by message_id",[d.session_id])).rows;
  const windows=(await tx.query('select task_id,window_id,state,opened_at,deadline_at,system_reason from public.teaching_classroom_task_windows where session_id=$1 order by window_id',[d.session_id])).rows;
  const admissions=(await tx.query('select admission_id,response_id,task_id,accepted_at,exposure_snapshot from public.teaching_classroom_task_admissions where session_id=$1 order by accepted_at,admission_id',[d.session_id])).rows;
  const exposures=(await tx.query('select exposure_id,task_id,exposure_payload,occurred_at from public.teaching_classroom_task_exposure where session_id=$1 order by occurred_at,exposure_id',[d.session_id])).rows;
  const evaluations=(await tx.query(`select j.admission_id,j.state,j.evaluation_id,j.completed_after_closure,exists(select 1 from public.teaching_classroom_task_turns t where t.task_id=a.task_id and t.session_id=a.session_id and t.kind='feedback' and t.state='CONFIRMED') feedback_delivered_in_class from public.teaching_classroom_task_evaluation_jobs j join public.teaching_classroom_task_admissions a using(admission_id) join public.teaching_class_sessions s on s.class_session_id=a.session_id left join public.teaching_response_evaluations e using(evaluation_id) where a.session_id=$1 order by a.accepted_at,j.admission_id`,[d.session_id])).rows;
  const corrections=(await tx.query("select revision_id,original_portion_id,state from public.teaching_classroom_revisions where session_id=$1 and kind='correction' order by created_at,revision_id",[d.session_id])).rows;
  const followUps=(await tx.query('select link_id,message_id,source_session_id,target_session_id,state,reply_portion_id,resolved_at from public.teaching_classroom_follow_up_links where student_id=$1 and (source_session_id=$2 or target_session_id=$2) order by link_id',[a.student_id,d.session_id])).rows;
  const chapter=(await tx.query('select p.payload from public.teaching_classroom_academic_artifacts a join public.teaching_classroom_academic_private p using(artifact_version_id) where a.artifact_version_id=$1 and a.student_id=$2',[a.binding.chapter_artifact_id,a.student_id] )).rows[0]?.payload;
  return closureRecord({chapter,followUps,binding:a.binding,delivery:d,portions,questions,windows,admissions,exposures,evaluations,corrections,progress});
 }
 async function closeUsing(tx,{studentId,classId,session,progress,endedAt}) {
  if(session.classroom_engine!=='CLASSROOM_V1')return null;
  const a=await presentationRepository.authorityUsing(tx,studentId,classId);
  const d=(await tx.query('select * from public.teaching_classroom_delivery where session_id=$1 and student_id=$2 for update',[session.class_session_id,studentId])).rows[0];
  if(!d)throw failure('CLASSROOM_CLOSURE_DELIVERY_MISSING');
  a.now=endedAt;
  // Reconcile in the D11 closure transaction, before its CLASS_ENDED outbox.
  // Accepted responses and evaluation jobs are preserved for immutable-context work.
  await presentationRepository.closeUsing(tx,a,d);
  await presentationRepository.emitUsing(tx,a,d,TEACHING_EVENTS.CLASSROOM_CLOSURE_RECONCILIATION_DUE,{}, {dueAt:new Date(endedAt).toISOString(),key:'classroom-closure-reconcile:'+d.session_id});
  return captureUsing(tx,a,d,progress);
 }
 async function history(studentId,classId,{limit=3}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>3)throw failure('CLASSROOM_HISTORY_LIMIT_INVALID',422);
  return withTransaction(async tx=>{
   const current=await owner(tx,studentId,classId);
   const earlier=(await tx.query('select count(*)::int n from public.teaching_classes where student_id=$1 and course_id=$2 and class_id<>$3 and scheduled_start_at<(select scheduled_start_at from public.teaching_classes where class_id=$3 and student_id=$1)',[studentId,current.course_id,classId])).rows[0].n;
   const rows=(await tx.query(`select s.class_session_id,s.class_id,s.started_at,s.ended_at,s.classroom_engine,f.closure_fact_id,f.controller_version,f.fact_pack,rr.record_id,rr.content_hash,rr.record,rr.created_at record_created_at,
    (select count(*)::int from public.teaching_classroom_conversation c where c.session_id=s.class_session_id) conversation_count
    from public.teaching_class_sessions s left join public.teaching_class_closure_facts f on f.class_session_id=s.class_session_id and f.student_id=s.student_id
    left join lateral(select record_id,content_hash,record,created_at from public.teaching_classroom_reconciliation_versions where session_id=s.class_session_id and student_id=s.student_id order by version_no desc limit 1) rr on true
    where s.student_id=$1 and s.course_id=$2 and s.class_id<>$3 and s.lifecycle_state='CLOSED' and s.ended_at is not null and s.ended_at<=coalesce($4::timestamptz,clock_timestamp())
    order by s.ended_at desc,s.class_session_id desc limit $5`,[studentId,current.course_id,classId,current.started_at,limit+1])).rows;
   const records=rows.slice(0,limit).map(r=>({session_id:r.class_session_id,class_id:r.class_id,ended_at:r.ended_at,closure_ref:r.closure_fact_id?`class-closure:${r.closure_fact_id}@${r.controller_version}`:null,state:!r.closure_fact_id?'RECORDS_UNAVAILABLE':r.classroom_engine==='CLASSROOM_V1'?'EXACT_RECORDS_AVAILABLE':'LEGACY_RECORDS_AVAILABLE',record_ref:r.record_id?`classroom-record:${r.record_id}@${r.content_hash}`:null,record_created_at:r.record_created_at||null,classroom:r.record||r.fact_pack?.classroom||null,conversation_count:r.conversation_count}));
   return {schema_version:'classroom-history.v1',state:!rows.length?(earlier===0?'CONFIRMED_FIRST_CLASS':'RECORDS_UNAVAILABLE'):records.some(r=>r.state==='RECORDS_UNAVAILABLE')?'RECORDS_UNAVAILABLE':rows.length<3?'FEWER_THAN_THREE':'RECORDS_AVAILABLE',records,has_older:rows.length>limit,horizon_is_retention_policy:false};
  });
 }
 async function exactRecord(studentId,classId,{sessionId,after=0,limit=100}={}) {
  if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)throw failure('CLASSROOM_HISTORY_PAGE_INVALID',422);
  return withTransaction(async tx=>{
   const current=await owner(tx,studentId,classId);
   const session=(await tx.query("select class_id,ended_at from public.teaching_class_sessions where student_id=$1 and course_id=$2 and class_session_id=$3 and lifecycle_state='CLOSED' and ended_at<=coalesce($4::timestamptz,clock_timestamp())",[studentId,current.course_id,sessionId,current.started_at])).rows[0];
   if(!session||session.class_id===classId)throw failure('CLASSROOM_HISTORY_NOT_OWNED',404);
   const events=(await tx.query('select server_sequence,payload from public.teaching_classroom_conversation where session_id=$1 and server_sequence>$2 order by server_sequence limit $3',[sessionId,after,limit+1])).rows;
   const page=events.slice(0,limit);return {session_id:sessionId,events:page.map(e=>e.payload),cursor:Number(page.at(-1)?.server_sequence||after),has_more:events.length>limit,semantics:'RELEASED_PUBLIC_RECORDS_ONLY'};
  });
 }
 async function linkQuestion({studentId,classId,sourceSessionId,messageId,operationKey}={}) {
  if(!operationKey||!messageId||!sourceSessionId)throw failure('CLASSROOM_CONTINUITY_LINK_INVALID',422);
  return presentationRepository.withAuthority(studentId,classId,async(tx,a,d,reason)=>{
   if(reason)throw failure('CLASSROOM_CONTINUITY_TARGET_RESTRICTED');
   const source=(await tx.query("select q.message_id from public.teaching_classroom_message_queue q join public.teaching_class_sessions s on s.class_session_id=q.session_id join public.teaching_classes c on c.class_id=s.class_id and c.student_id=s.student_id where s.student_id=$1 and s.course_id=$2 and s.class_session_id=$3 and s.lifecycle_state='CLOSED' and s.ended_at<= $5 and q.message_id=$4 and q.state='unresolved at closure' for update of q",[studentId,a.course_id,sourceSessionId,messageId,a.started_at])).rows[0];
   if(!source)throw failure('CLASSROOM_CONTINUITY_SOURCE_NOT_OWNED');
   const digest=hash({sourceSessionId,messageId,targetSessionId:d.session_id});
   const prior=(await tx.query('select * from public.teaching_classroom_follow_up_links where target_session_id=$1 and operation_key=$2',[d.session_id,operationKey])).rows[0];
   if(prior){if(prior.request_hash!==digest)throw failure('CLASSROOM_CONTINUITY_IDEMPOTENCY_CONFLICT');return {linkId:prior.link_id,replay:true,answered:prior.state==='RESOLVED'};}
   const existing=(await tx.query('select link_id,state from public.teaching_classroom_follow_up_links where source_session_id=$1 and message_id=$2 and target_session_id=$3',[sourceSessionId,messageId,d.session_id])).rows[0];if(existing)return {linkId:existing.link_id,replay:true,answered:existing.state==='RESOLVED'};
   const id=randomUUID();await tx.query('insert into public.teaching_classroom_follow_up_links(link_id,student_id,source_session_id,message_id,target_session_id,operation_key,request_hash) values($1,$2,$3,$4,$5,$6,$7)',[id,studentId,sourceSessionId,messageId,d.session_id,operationKey,digest]);
   return {linkId:id,answered:false,scheduled:false};
  });
 }
 async function resolveQuestion({studentId,classId,linkId,replyPortionId,receipt}={}) {
  return presentationRepository.withAuthority(studentId,classId,async(tx,a,d,reason)=>{
   if(reason)throw failure('CLASSROOM_CONTINUITY_TARGET_RESTRICTED');
   const row=(await tx.query('select * from public.teaching_classroom_follow_up_links where student_id=$1 and target_session_id=$2 and link_id=$3 for update',[studentId,d.session_id,linkId])).rows[0];
   if(!row)throw failure('CLASSROOM_CONTINUITY_LINK_NOT_OWNED',404);
   const digest=hash({linkId,replyPortionId,messageId:row.message_id});
   if(!receipt?.accepted||!receipt.independent||!receipt.ownerRef||!receipt.executionId||receipt.contentHash!==digest||receipt.authorityHash!==hash(presentationRepository.stamp(a)))throw failure('CLASSROOM_CONTINUITY_COVERAGE_REVIEW_REQUIRED');
   if(row.state==='RESOLVED'){if(row.reply_portion_id!==replyPortionId)throw failure('CLASSROOM_CONTINUITY_RESOLUTION_CONFLICT');return {resolved:true,replay:true};}
   const portion=(await tx.query("select portion_id from public.teaching_classroom_portions where session_id=$1 and portion_id=$2 and status='CONFIRMED'",[d.session_id,replyPortionId])).rows[0];
   if(!portion)throw failure('CLASSROOM_CONTINUITY_REPLY_NOT_CONFIRMED');
   await tx.query("update public.teaching_classroom_follow_up_links set state='RESOLVED',reply_portion_id=$2,receipt=$3::jsonb,resolved_at=clock_timestamp() where link_id=$1",[linkId,replyPortionId,JSON.stringify(receipt)]);
   return {resolved:true,difficultyResolved:false,oldClassReopened:false};
  });
 }
 async function latestRecordUsing(tx,studentId,classId) {
   const current=await owner(tx,studentId,classId);if(current.lifecycle_state!=='CLOSED')throw failure('CLASSROOM_RECONCILIATION_REQUIRES_CLOSURE');
   const a=await presentationRepository.authorityUsing(tx,studentId,classId),d=(await tx.query('select * from public.teaching_classroom_delivery where session_id=$1 and student_id=$2 for update',[current.class_session_id,studentId])).rows[0];
   const record=await captureUsing(tx,a,d,a.progress_state),digest=hash(record);
   const existing=(await tx.query('select * from public.teaching_classroom_reconciliation_versions where session_id=$1 and content_hash=$2',[d.session_id,digest])).rows[0];if(existing)return existing;
   const version=Number((await tx.query('select coalesce(max(version_no),0)+1 n from public.teaching_classroom_reconciliation_versions where session_id=$1',[d.session_id])).rows[0].n);
   return (await tx.query('insert into public.teaching_classroom_reconciliation_versions(record_id,student_id,session_id,version_no,content_hash,record) values($1,$2,$3,$4,$5,$6::jsonb) returning *',[randomUUID(),studentId,d.session_id,version,digest,JSON.stringify(record)])).rows[0];
 }
 async function latestRecord(studentId,classId){return withTransaction(tx=>latestRecordUsing(tx,studentId,classId));}
 async function lockUsing(tx,studentId,classId){const row=(await tx.query('select classroom_engine from public.teaching_class_sessions where student_id=$1 and class_id=$2',[studentId,classId])).rows[0];if(row?.classroom_engine==='CLASSROOM_V1')await presentationRepository.authorityUsing(tx,studentId,classId);}
 return {lockUsing,closeUsing,captureUsing,history,exactRecord,linkQuestion,resolveQuestion,latestRecord,latestRecordUsing};
}
module.exports={createClassroomContinuityRepository};
