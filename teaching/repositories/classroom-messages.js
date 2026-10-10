'use strict';
const {hash}=require('../classroom-remodel/academic-artifacts');
const {failure}=require('../classroom-remodel/presentation-policy');
const {validateInput,assertPolicy,value,validateDisposition}=require('../classroom-remodel/message-contracts');
const {TEACHING_EVENTS:E}=require('../events/names');
const iso=d=>new Date(d).toISOString();
function createClassroomMessageRepository({presentationRepository,randomUUID,qualified=false}={}){
 if(typeof presentationRepository?.withAuthority!=='function'||typeof randomUUID!=='function')throw new TypeError('Existing presentation authority transaction required');
 const lock=presentationRepository.withAuthority;
 async function enabled(tx,a,d){return qualified&&require('../classroom-remodel/message-contracts').ready(d.policy)&&!!(await tx.query("select to_regclass('public.teaching_classroom_messages') ready")).rows[0].ready;}
 async function counts(tx,d){return Number((await tx.query('select count(*)::int n from public.teaching_classroom_allowance_charges where session_id=$1',[d.session_id])).rows[0].n);}
 async function event(tx,a,d,{role='system',type='notice',text,refs=[],eventId=null}){
  d.cursor=Number(d.cursor)+1;d.state_version=Number(d.state_version)+1;
  const id=eventId||randomUUID(),payload={id,sequence:d.cursor,role,type,text,source_refs:refs,status:role==='student'?'ACCEPTED':'RELEASED',occurred_at:iso(a.now)};
  await tx.query('insert into public.teaching_classroom_conversation(event_id,session_id,server_sequence,payload,occurred_at) values($1,$2,$3,$4::jsonb,$5)',[id,d.session_id,d.cursor,JSON.stringify(payload),a.now]);
  await presentationRepository.saveUsing(tx,d);return payload;
 }
 async function closeUsing(tx,a,d){
  const rows=(await tx.query("update public.teaching_classroom_message_queue set state='unresolved at closure',clarification_open=false,release_hold=false,lease_token=null,lease_expires_at=null,processing_state='HELD',updated_at=$2 where session_id=$1 and state not in ('answered','unresolved at closure') returning message_id",[d.session_id,a.now])).rows;
  if(rows.length)await event(tx,a,d,{text:'Class ended with accepted questions still unresolved. They remain saved; no next-Class answer has been scheduled.'});
 }
 async function projectUsing(tx,a,d,{restricted=false,reason=null}={}){
  if(!await enabled(tx,a,d))return {enabled:false,remaining:null,questions:[]};
  if(['CONTROLLER_CLOSED','AUTHORITATIVE_END'].includes(reason))await closeUsing(tx,a,d);
  const charged=await counts(tx,d),remaining=Math.max(0,value(d.policy,'conversationalAllowance')-charged);
  const rows=restricted?[]:(await tx.query(`select m.message_id,m.content,m.accepted_at,m.admitted_lane,m.reply_to,q.state,q.disposition,q.commitment_kind,q.commitment_anchor,q.committed_at,q.clarification_open,q.reply_event_id,q.processing_state from public.teaching_classroom_messages m join public.teaching_classroom_message_queue q using(message_id,session_id) where m.session_id=$1 order by m.accepted_at desc,m.message_id limit $2`,[d.session_id,value(d.policy,'deltaPageSize')])).rows;
  return {enabled:!reason&&!restricted,remaining,limit:value(d.policy,'conversationalAllowance'),policy_version:d.policy_version,max_bytes:value(d.policy,'messageMaxBytes'),draft_retention_ms:value(d.policy,'messageDraftRetentionMs'),questions:rows.map(r=>({id:r.message_id,text:r.content,state:r.state,lane:r.admitted_lane,reply_to:r.reply_to,reply_event_id:r.reply_event_id,clarification_requested:r.clarification_open,handling:r.processing_state==='HELD'?'pending owner decision':r.processing_state==='DONE'?'disposition committed':'pending disposition',commitment:r.committed_at?{kind:r.commitment_kind,anchor:r.commitment_anchor}:null,accepted_at:iso(r.accepted_at)}))};
 }
 async function admit(studentId,classId,body){const input=validateInput(body),digest=hash(input);return lock(studentId,classId,async(tx,a,d,reason)=>{
  const previous=(await tx.query('select * from public.teaching_classroom_messages where session_id=$1 and operation_key=$2',[d.session_id,input.operationKey])).rows[0];
  if(previous){if(previous.request_hash!==digest)throw failure('CLASSROOM_MESSAGE_IDEMPOTENCY_CONFLICT');return {...previous.receipt,replay:true,remaining:Math.max(0,value(d.policy,'conversationalAllowance')-await counts(tx,d))};}
  if(reason||require('../classroom-remodel/protected-activity').protectedMode(a))throw failure('CLASSROOM_MESSAGE_ADMISSION_RESTRICTED',403);
  if(input.sessionId!==d.session_id)throw failure('CLASSROOM_MESSAGE_SESSION_CONFLICT');
  if(!await enabled(tx,a,d))throw failure('CLASSROOM_MESSAGE_ROUTE_HELD',503);assertPolicy(d.policy);
  if(Buffer.byteLength(input.content,'utf8')>value(d.policy,'messageMaxBytes'))throw failure('CLASSROOM_MESSAGE_TOO_LARGE',422);
  const recent=Number((await tx.query('select count(*)::int n from public.teaching_classroom_messages where session_id=$1 and accepted_at>$2::timestamptz-($3::bigint*interval \'1 millisecond\')',[d.session_id,a.now,value(d.policy,'messageRateWindowMs')])).rows[0].n);
  if(recent>=value(d.policy,'messageRateLimit'))throw failure('CLASSROOM_MESSAGE_RATE_LIMIT',429);
  const chapter=(await tx.query('select payload from public.teaching_classroom_academic_private where artifact_version_id=$1',[a.classroom_chapter_artifact_id])).rows[0].payload;
  if(input.sourceRef)require('../classroom-remodel/contracts').resolveAnchor(input.sourceRef,chapter);
  let lane=input.intent;
  if(lane==='clarification'){
   if(!input.replyTo)throw failure('CLASSROOM_MESSAGE_CLARIFICATION_NOT_REQUESTED',422);
   const parent=(await tx.query("select * from public.teaching_classroom_message_queue where session_id=$1 and message_id=$2 and state='needing clarification' and clarification_open=true for update",[d.session_id,input.replyTo])).rows[0];
   if(!parent)throw failure('CLASSROOM_MESSAGE_CLARIFICATION_NOT_REQUESTED',422);
   await tx.query('update public.teaching_classroom_message_queue set clarification_open=false where message_id=$1',[parent.message_id]);
  }else if(input.replyTo)throw failure('CLASSROOM_MESSAGE_REPLY_LINK_INVALID',422);
  const charged=await counts(tx,d),charge=lane==='conversation';if(charge&&charged>=value(d.policy,'conversationalAllowance'))throw failure('CLASSROOM_MESSAGE_ALLOWANCE_EXHAUSTED',429);
  const id=randomUUID(),receipt={schema_version:'classroom-messages.v1',accepted:true,message_id:id,operation_key:input.operationKey,session_id:d.session_id,state:'waiting',remaining:value(d.policy,'conversationalAllowance')-charged-(charge?1:0),server_time:iso(a.now),charged:charge};
  await tx.query('insert into public.teaching_classroom_messages(message_id,session_id,student_id,class_id,operation_key,request_hash,content,client_intent,admitted_lane,source_ref,context_anchor,reply_to,accepted_at,receipt) values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9::jsonb,$10,$11,$12,$13::jsonb)',[id,d.session_id,studentId,classId,input.operationKey,digest,input.content,lane,JSON.stringify(input.sourceRef),d.resume_anchor,input.replyTo,a.now,JSON.stringify(receipt)]);
  if(charge)await tx.query('insert into public.teaching_classroom_allowance_charges(message_id,session_id,policy_version) values($1,$2,$3)',[id,d.session_id,d.policy_version]);
  const control=['technical_report','correction_report'].includes(lane);
  await tx.query("insert into public.teaching_classroom_message_queue(message_id,session_id,release_hold,processing_state,failure_code,next_attempt_at,resume_anchor) values($1,$2,$3,$4,$5,$6,$7)",[id,d.session_id,lane==='correction_report',control?'HELD':'PENDING',control?'CLASSROOM_MESSAGE_OWNER_DECISION_REQUIRED':null,control?null:a.now,d.resume_anchor]);
  await event(tx,a,d,{role:'student',type:'message',eventId:id,text:input.content,refs:input.sourceRef?[input.sourceRef]:[]});
  await presentationRepository.emitUsing(tx,a,d,E.CLASSROOM_MESSAGE_ACCEPTED,{message_id:id,lane});
  // Free support reports are never sent to the tutoring route. Correction reports
  // hold upcoming release until an authorized correction decision (Delivery 6).
  if(!control)await presentationRepository.emitUsing(tx,a,d,E.CLASSROOM_MESSAGE_ROUTING_DUE,{message_id:id},{dueAt:iso(a.now),key:'message-route:'+id+':0'});
  return receipt;
 });}
 async function claim(studentId,classId,messageId){return lock(studentId,classId,async(tx,a,d,reason)=>{
  if(reason)return {held:true,reason};assertPolicy(d.policy);
  const q=(await tx.query('select q.*,m.content,m.source_ref,m.context_anchor,m.admitted_lane,m.reply_to from public.teaching_classroom_message_queue q join public.teaching_classroom_messages m using(message_id,session_id) where q.session_id=$1 and q.message_id=$2 for update of q',[d.session_id,messageId])).rows[0];
  if(!q||['HELD','DONE'].includes(q.processing_state)||q.state==='answered'||q.state==='unresolved at closure')return {held:true,reason:'MESSAGE_NOT_ROUTABLE'};
  if(q.next_attempt_at&&new Date(q.next_attempt_at)>new Date(a.now)||q.lease_expires_at&&new Date(q.lease_expires_at)>new Date(a.now))return {held:true,reason:'MESSAGE_ROUTING_LEASE_HELD'};
  const token=randomUUID(),until=new Date(new Date(a.now).getTime()+value(d.policy,'messageWorkerLeaseMs'));
  await tx.query("update public.teaching_classroom_message_queue set processing_state='PROCESSING',lease_token=$2,lease_expires_at=$3,attempts=attempts+1,updated_at=$4 where message_id=$1",[messageId,token,until,a.now]);
  // Durable recovery is scheduled before provider execution; worker crashes do not lose work.
  await presentationRepository.emitUsing(tx,a,d,E.CLASSROOM_MESSAGE_ROUTING_DUE,{message_id:messageId},{dueAt:iso(until),key:'message-recover:'+messageId+':'+token});
  const inputs=await presentationRepository.preparationInputsUsing(tx,a);
  return {messageId,token,authority:presentationRepository.stamp(a),deliveryEpoch:Number(d.delivery_epoch),policy:d.policy,queue:q,chapter:inputs.chapter,guide:inputs.guide,resumeAnchor:d.resume_anchor,studentId,classId};
 });}
 async function acceptDisposition(studentId,classId,claim,output){return lock(studentId,classId,async(tx,a,d,reason)=>{
  const q=(await tx.query('select * from public.teaching_classroom_message_queue where session_id=$1 and message_id=$2 for update',[d.session_id,claim.messageId])).rows[0];
  if(!q||q.lease_token!==claim.token||new Date(q.lease_expires_at)<=new Date(a.now))throw failure('CLASSROOM_MESSAGE_LEASE_STALE');
  const stale=reason||hash(presentationRepository.stamp(a))!==hash(claim.authority)||Number(d.delivery_epoch)!==claim.deliveryEpoch;
  let checked,error;try{if(stale)throw failure('CLASSROOM_MESSAGE_PROPOSAL_STALE');checked=validateDisposition(output,{messageId:claim.messageId,chapter:claim.chapter});}catch(e){error=e;}
  await tx.query('insert into public.teaching_classroom_message_proposals(proposal_id,message_id,session_id,lease_token,proposal,accepted,reason) values($1,$2,$3,$4,$5::jsonb,$6,$7)',[randomUUID(),claim.messageId,d.session_id,claim.token,JSON.stringify(output),!error,error?.code||null]);
  if(error){await failUsing(tx,a,d,q,error.code);return {accepted:false,reason:error.code};}
  const x=checked.disposition;
  if(x.grouping_refs.length){
   const peers=(await tx.query("select message_id from public.teaching_classroom_message_queue where session_id=$1 and message_id=any($2::text[]) and state not in ('answered','unresolved at closure') and accepted_proposal is not null order by message_id for update",[d.session_id,x.grouping_refs])).rows;
   if(peers.length!==x.grouping_refs.length)throw failure('CLASSROOM_MESSAGE_GROUP_INVALID',422);
   // Grouping records lineage only. Every concern requires its own accepted
   // disposition and confirmed reply; a combined answer cannot erase a member.
  }
  const state=checked.kind==='follow_up_proposal'?'waiting':checked.kind==='immediate'?'ready':'waiting';
  await tx.query("update public.teaching_classroom_message_queue set state=$2,classification=$3,disposition=$4,group_id=$5,commitment_kind=$6,commitment_anchor=$7,committed_at=$8,accepted_proposal=$9::jsonb,processing_state='DONE',lease_token=null,lease_expires_at=null,failure_code=null,updated_at=$8 where message_id=$1",[claim.messageId,state,x.classification,x.disposition,x.grouping_refs[0]||null,checked.kind,checked.anchor,a.now,JSON.stringify(output)]);
  if(checked.kind==='immediate')await tx.query('update public.teaching_classroom_message_queue set release_hold=true where message_id=$1',[claim.messageId]);
  await event(tx,a,d,{text:checked.kind==='boundary'?'Your question is saved for a suitable teaching pause.':checked.kind==='unit'?'Your question is saved for its linked chapter unit.':checked.kind==='closure'?'Your question is saved for closure handling; it may remain unresolved if time runs out.':checked.kind==='follow_up_proposal'?'Your question remains saved for follow-up. No appointment or automatic answer is scheduled.':'Your question is ready for handling.'});
  await presentationRepository.emitUsing(tx,a,d,E.CLASSROOM_MESSAGE_DISPOSITION_COMMITTED,{message_id:claim.messageId,commitment_kind:checked.kind});
  return {accepted:true,disposition:checked};
 });}
 async function failUsing(tx,a,d,q,code){
  const retries=value(d.policy,'messageRoutingRetryLimit'),hold=q.attempts>retries||code==='CLASSROOM_MESSAGE_OWNER_DECISION_REQUIRED';
  const due=new Date(new Date(a.now).getTime()+value(d.policy,'messageRetryBackoffMs'));
  await tx.query("update public.teaching_classroom_message_queue set processing_state=$2,lease_token=null,lease_expires_at=null,next_attempt_at=$3,failure_code=$4,updated_at=$5 where message_id=$1",[q.message_id,hold?'HELD':'RETRY',hold?null:due,code,a.now]);
  if(!hold)await presentationRepository.emitUsing(tx,a,d,E.CLASSROOM_MESSAGE_ROUTING_DUE,{message_id:q.message_id},{dueAt:iso(due),key:'message-retry:'+q.message_id+':'+q.attempts});
 }
 async function failed(studentId,classId,claim,code){return lock(studentId,classId,async(tx,a,d)=>{const q=(await tx.query('select * from public.teaching_classroom_message_queue where session_id=$1 and message_id=$2 for update',[d.session_id,claim.messageId])).rows[0];if(q?.lease_token===claim.token)await failUsing(tx,a,d,q,code);return {pending:true};});}
 async function boundaryUsing(tx,a,d){
  if(!await enabled(tx,a,d))return null;
  const last=(await tx.query('select payload from public.teaching_classroom_portions where session_id=$1 and ordinal=$2 and confirmed_at is not null',[d.session_id,d.last_published])).rows[0];
  const next=(await tx.query("select payload from public.teaching_classroom_portions where session_id=$1 and status='PREPARED' order by ordinal limit 1",[d.session_id])).rows[0];
  const rows=(await tx.query("select q.*,m.accepted_at from public.teaching_classroom_message_queue q join public.teaching_classroom_messages m using(message_id,session_id) where q.session_id=$1 and q.state not in ('answered','unresolved at closure','needing clarification') and (q.release_hold=true or q.committed_at is not null) order by m.accepted_at,q.message_id for update of q",[d.session_id])).rows;
  for(const q of rows){
   const suitable=last?.payload.boundary==='suitable_teaching_pause'&&(!q.commitment_anchor||last.payload.resume_at===q.commitment_anchor||last.payload.source_refs.some(r=>r.anchor===q.commitment_anchor));
   const unit=next?.payload.source_refs.some(r=>r.anchor===q.commitment_anchor||r.anchor?.startsWith(q.commitment_anchor+'.'));
   const closure=new Date(a.end)-new Date(a.now)<=value(d.policy,'closureLeadMs');
   if(q.release_hold||q.state==='ready'||q.commitment_kind==='boundary'&&suitable||q.commitment_kind==='unit'&&unit||q.commitment_kind==='closure'&&closure){
    if(q.state!=='ready')await tx.query("update public.teaching_classroom_message_queue set state='ready',release_hold=true,resume_anchor=$3,updated_at=$2 where message_id=$1",[q.message_id,a.now,d.resume_anchor]);
    return q.reply_sequence_id?{sequenceId:q.reply_sequence_id,messageId:q.message_id}:{held:true,messageId:q.message_id};
   }
  }
  return null;
 }
 async function readyQuestion(studentId,classId){return lock(studentId,classId,async(tx,a,d,reason)=>{if(reason)return null;const next=await boundaryUsing(tx,a,d);if(!next||next.sequenceId)return null;return (await tx.query('select q.*,m.content,m.source_ref,m.context_anchor from public.teaching_classroom_message_queue q join public.teaching_classroom_messages m using(message_id,session_id) where q.message_id=$1 and q.session_id=$2 and (q.next_attempt_at is null or q.next_attempt_at<=clock_timestamp())',[next.messageId,d.session_id])).rows[0];});}
 async function replyFailed(studentId,classId,id,code){return lock(studentId,classId,async(tx,a,d)=>{const q=(await tx.query('select * from public.teaching_classroom_message_queue where session_id=$1 and message_id=$2 for update',[d.session_id,id])).rows[0];if(!q)return;const hold=Number(q.attempts)>value(d.policy,'messageRoutingRetryLimit'),due=new Date(new Date(a.now).getTime()+value(d.policy,'messageRetryBackoffMs'));await tx.query("update public.teaching_classroom_message_queue set attempts=attempts+1,processing_state=$2,next_attempt_at=$3,failure_code=$4 where message_id=$1",[id,hold?'HELD':'DONE',hold?null:due,code]);if(!hold)await presentationRepository.emitUsing(tx,a,d,E.CLASSROOM_MESSAGE_ROUTING_DUE,{message_id:id},{dueAt:iso(due),key:'message-answer-retry:'+id+':'+q.attempts});});}

 async function bindReplyUsing(tx,a,d,refs,sequenceId){
  for(const id of refs){const q=(await tx.query("select * from public.teaching_classroom_message_queue where session_id=$1 and message_id=$2 and state='ready' and release_hold=true for update",[d.session_id,id])).rows[0];if(!q||!q.accepted_proposal)throw failure('CLASSROOM_MESSAGE_REPLY_NOT_AUTHORIZED');await tx.query('update public.teaching_classroom_message_queue set reply_sequence_id=$2 where message_id=$1',[id,sequenceId]);}
 }
 async function replyConfirmedUsing(tx,a,d,p){
  if(!p.payload.messageRefs?.length)return;
  const remaining=(await tx.query("select 1 from public.teaching_classroom_portions where sequence_id=$1 and status in ('PREPARED','PUBLISHED') limit 1",[p.sequence_id])).rows.length;if(remaining)return;
  const ev=(await tx.query('select event_id from public.teaching_classroom_conversation where portion_id=$1',[p.portion_id])).rows[0];
  for(const id of p.payload.messageRefs){const q=(await tx.query('select * from public.teaching_classroom_message_queue where message_id=$1 and session_id=$2 and reply_sequence_id=$3 for update',[id,d.session_id,p.sequence_id])).rows[0];if(!q)throw failure('CLASSROOM_MESSAGE_REPLY_LINEAGE_CONFLICT');const clarifying=q.disposition==='request clarification';await tx.query("update public.teaching_classroom_message_queue set state=$2,clarification_open=$3,release_hold=false,reply_event_id=$4,updated_at=$5 where message_id=$1",[id,clarifying?'needing clarification':'answered',clarifying,ev.event_id,a.now]);}
 }
 return {replyFailed,admit,claim,acceptDisposition,failed,projectUsing,closeUsing,boundaryUsing,readyQuestion,bindReplyUsing,replyConfirmedUsing,event};
}
module.exports={createClassroomMessageRepository};
