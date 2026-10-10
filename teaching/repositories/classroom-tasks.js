'use strict';
const {TEACHING_EVENTS}=require('../events/names');
const {hash}=require('../classroom-remodel/academic-artifacts');
const {failure,value}=require('../classroom-remodel/presentation-policy');
const c=require('../classroom-remodel/task-contracts'),d=require('../classroom-remodel/domain-contracts');
const iso=v=>new Date(v).toISOString();
function createClassroomTaskRepository({presentationRepository,d12Repository,randomUUID,qualified=false}={}){
 if(!presentationRepository?.withAuthority||!d12Repository||!randomUUID)throw new TypeError('Existing D11/D12/presentation transaction required');
 const lock=presentationRepository.withAuthority;
 async function enabled(tx,a,delivery){if(!qualified)return false;try{c.policy(delivery.policy);}catch{return false;}return !!(await tx.query("select to_regclass('public.teaching_classroom_tasks') ready")).rows[0].ready;}
 async function current(tx,sessionId){return (await tx.query('select t.*,w.* from public.teaching_classroom_tasks t join public.teaching_classroom_task_windows w using(task_id,session_id) where t.session_id=$1 and w.handling_complete=false order by t.created_at desc limit 1 for update of w',[sessionId])).rows[0]||null;}
 function task(row){return {...row.task_payload,window:{...row.task_payload.window,id:row.window_id,version:Number(row.version_no),state:row.state,opened_at:row.opened_at?iso(row.opened_at):null,deadline_at:row.deadline_at?iso(row.deadline_at):null,duration_ms:Number(row.duration_ms),extension_count:Number(row.extension_count),class_end_at:iso(row.class_end_at),activation_receipt_id:row.activation_receipt_id}};}
 async function changed(tx,a,delivery){delivery.state_version=Number(delivery.state_version)+1;await presentationRepository.saveUsing(tx,delivery);}
 async function saveWindow(tx,row,w){await tx.query('update public.teaching_classroom_task_windows set state=$2,version_no=$3,opened_at=$4,deadline_at=$5,extension_count=$6,activation_receipt_id=$7,system_reason=$8,updated_at=clock_timestamp() where window_id=$1',[row.window_id,w.state,w.version,w.opened_at,w.deadline_at,w.extension_count,w.activation_receipt_id,w.reason||null]);}
 async function reconcileUsing(tx,a,delivery,reason){if(!await enabled(tx,a,delivery))return null;const row=await current(tx,delivery.session_id);if(!row)return null;
  if(reason&&['PENDING_DELIVERY','OPEN'].includes(row.state)){const state=['AUTHORITATIVE_END','CONTROLLER_CLOSED'].includes(reason)?'CLOSED_BY_CLASS':'CANCELLED_SYSTEM';await tx.query('update public.teaching_classroom_task_windows set state=$2,handling_complete=true,system_reason=$3,version_no=version_no+1 where window_id=$1',[row.window_id,state,reason]);await changed(tx,a,delivery);return null;}
  if(row.state==='OPEN'&&new Date(a.now)>new Date(new Date(row.deadline_at).getTime()+value(delivery.policy,'graceMs'))){await tx.query("update public.teaching_classroom_task_windows set state='EXPIRED_NO_RESPONSE',handling_complete=true,system_reason='NO_RESPONSE_RECEIVED',version_no=version_no+1 where window_id=$1",[row.window_id]);if(delivery.delivery_state==='WAITING_FOR_RESPONSE')delivery.delivery_state='READY';await changed(tx,a,delivery);return null;}
  return row;
 }
 async function design({studentId,classId,operationKey,proposal,expected,validation,targetRef}){return lock(studentId,classId,async(tx,a,delivery,reason)=>{
  if(reason||!await enabled(tx,a,delivery))throw failure('CLASSROOM_TASK_ROUTE_HELD',503);
  const prior=(await tx.query('select * from public.teaching_classroom_tasks where session_id=$1 and operation_key=$2',[delivery.session_id,operationKey])).rows[0];if(prior){if(prior.content_hash!==hash(proposal))throw failure('CLASSROOM_TASK_IDEMPOTENCY_CONFLICT');return {accepted:true,task:prior.task_payload,replay:true};}
  if(hash(expected.authority)!==hash(presentationRepository.stamp(a))||expected.deliveryEpoch!==Number(delivery.delivery_epoch))throw failure('CLASSROOM_TASK_DESIGN_STALE');
  if(await reconcileUsing(tx,a,delivery,reason))throw failure('CLASSROOM_TASK_ALREADY_BLOCKING');
  const input=await presentationRepository.preparationInputsUsing(tx,a),unit=await d12Repository.getLearningUnit(studentId,targetRef.id,tx);if(!unit||unit.course_plan_id!==a.course_plan_id)throw failure('CLASSROOM_TASK_TARGET_NOT_OWNED');
  const validated=c.check(proposal,{chapter:input.chapter,targetRef,validation,policy:delivery.policy,sessionId:delivery.session_id,classEnd:iso(a.end),taskId:randomUUID(),windowId:randomUUID(),criterionId:randomUUID()});
  const t=validated.task;await tx.query('insert into public.teaching_classroom_tasks(task_id,session_id,student_id,class_id,operation_key,task_version,task_payload,design_proposal,validation_receipt,authority,content_hash) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11)',[t.id,delivery.session_id,studentId,classId,operationKey,t.version,JSON.stringify(t),JSON.stringify(proposal),JSON.stringify(validation),JSON.stringify(presentationRepository.stamp(a)),hash(proposal)]);
  await tx.query('insert into public.teaching_classroom_task_windows(window_id,task_id,session_id,duration_ms,class_end_at) values($1,$2,$3,$4,$5)',[t.window.id,t.id,delivery.session_id,t.window.duration_ms,a.end]);await changed(tx,a,delivery);return {accepted:true,task:t};
 });}
 async function authorizeSequenceUsing(tx,a,delivery,taskId,directive,sequenceId,output){const row=await current(tx,delivery.session_id);if(!row||row.task_id!==taskId||!['PENDING_DELIVERY','OPEN','RESPONSE_ACCEPTED'].includes(row.state))throw failure('CLASSROOM_TASK_SEQUENCE_UNAUTHORIZED');
  if(row.state!=='PENDING_DELIVERY'||output.interaction.portions.some(p=>p.publication_dependencies.length||!['none','student_response'].includes(p.wait_requirement)))throw failure('CLASSROOM_TASK_CONTINUATION_ROUTE_HELD');
  if(row.state==='PENDING_DELIVERY'&&!output.interaction.portions.map(p=>p.teacher_message).join('\n').includes(row.task_payload.public_question.text))throw failure('CLASSROOM_TASK_QUESTION_CHANGED');
  if(directive.task_ref!==taskId||directive.assistance_ceiling!==row.task_payload.assistance_ceiling)throw failure('CLASSROOM_TASK_DIRECTIVE_CONFLICT');
  if(row.state==='PENDING_DELIVERY'){if(row.sequence_id&&row.sequence_id!==sequenceId)throw failure('CLASSROOM_TASK_SEQUENCE_ALREADY_BOUND');await tx.query('update public.teaching_classroom_task_windows set sequence_id=$2 where window_id=$1',[row.window_id,sequenceId]);}
 }
 async function releaseUsing(tx,a,delivery){const row=await reconcileUsing(tx,a,delivery,null);if(!row)return null;return row.state==='PENDING_DELIVERY'&&row.sequence_id?{sequenceId:row.sequence_id,taskId:row.task_id}:{held:true,taskId:row.task_id};}
 async function confirmedUsing(tx,a,delivery,portion,receiptId){if(!portion.payload.classroomTaskId)return;const row=await current(tx,delivery.session_id);if(!row||row.task_id!==portion.payload.classroomTaskId)return;
  if((await tx.query("select 1 from public.teaching_classroom_portions where sequence_id=$1 and status<>'CONFIRMED' limit 1",[portion.sequence_id])).rows.length)return;
  if(row.state==='PENDING_DELIVERY'){const w=c.openWindow(task(row),{now:iso(a.now),classEnd:iso(a.end),receiptId});await saveWindow(tx,row,w);if(w.state==='OPEN'){delivery.delivery_state='WAITING_FOR_RESPONSE';delivery.next_release_at=null;await presentationRepository.emitUsing(tx,a,delivery,TEACHING_EVENTS.CLASSROOM_TASK_WINDOW_EXPIRY_DUE,{task_id:row.task_id,window_id:row.window_id,window_version:w.version},{dueAt:iso(new Date(Date.parse(w.deadline_at)+value(delivery.policy,'graceMs'))),key:'task-expiry:'+row.window_id+':'+w.version});}else await tx.query('update public.teaching_classroom_task_windows set handling_complete=true where window_id=$1',[row.window_id]);await changed(tx,a,delivery);}
 }
 async function projectUsing(tx,a,delivery,reason){if(!await enabled(tx,a,delivery))return {enabled:false,task:null};const row=await reconcileUsing(tx,a,delivery,reason);return {enabled:!reason,task:row&&row.state!=='PENDING_DELIVERY'?task(row):null,max_bytes:value(delivery.policy,'taskResponseMaxBytes'),draft_retention_ms:value(delivery.policy,'taskDraftRetentionMs')};}
 async function submit(studentId,classId,body){const input=c.submission(body),digest=hash(input);return lock(studentId,classId,async(tx,a,delivery,reason)=>{
  const old=(await tx.query('select * from public.teaching_classroom_task_operations where session_id=$1 and operation_key=$2',[delivery.session_id,input.operationKey])).rows[0];if(old){if(old.request_hash!==digest)throw failure('CLASSROOM_TASK_IDEMPOTENCY_CONFLICT');return {...old.outcome,replay:true};}
  if(reason||!await enabled(tx,a,delivery))throw failure('CLASSROOM_TASK_RESPONSE_RESTRICTED',403);
  const row=await reconcileUsing(tx,a,delivery,reason);if(!row||row.state!=='OPEN'||row.task_id!==input.taskId||row.task_version!==input.taskVersion||row.window_id!==input.windowId||Number(row.version_no)!==input.windowVersion||delivery.session_id!==input.sessionId)throw failure('CLASSROOM_TASK_WINDOW_CONFLICT');
  if(Buffer.byteLength(input.text,'utf8')>value(delivery.policy,'taskResponseMaxBytes'))throw failure('CLASSROOM_TASK_RESPONSE_TOO_LARGE',422);
  const t=task(row),exposures=(await tx.query('select exposure_payload from public.teaching_classroom_task_exposure where task_id=$1 order by occurred_at',[t.id])).rows.map(r=>r.exposure_payload);
  const exposure={released_assistance_level:'none',answer_or_method_exposed:true,uncertain_exposure:true,chapter_accessible:true,events:exposures,policy_version:delivery.policy_version};
  // Accessible complete chapters may contain worked answers. Independence is
  // unknown unless an accepted exposure/variation owner proves otherwise.
  const capture=await d12Repository.captureClassroomTaskUsing(tx,{studentId,classId,task:t,delivery,authority:a,text:input.text,operationKey:input.operationKey,exposure});
  const id=randomUUID(),receipt={accepted:true,response_id:capture.response_id,admission_id:id,task_id:t.id,window_id:row.window_id,received_at:iso(a.now),charged:false};
  const snapshot={task:t,design:row.design_proposal,validation:row.validation_receipt,authority:row.authority,policy:delivery.policy,response:capture,source_hash:row.content_hash};
  await tx.query('insert into public.teaching_classroom_task_admissions(admission_id,response_id,task_id,session_id,accepted_at,context_snapshot,exposure_snapshot,receipt) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)',[id,capture.response_id,t.id,delivery.session_id,a.now,JSON.stringify(snapshot),JSON.stringify(exposure),JSON.stringify(receipt)]);
  await tx.query("update public.teaching_classroom_task_windows set state='RESPONSE_ACCEPTED',version_no=version_no+1 where window_id=$1",[row.window_id]);await tx.query('insert into public.teaching_classroom_task_evaluation_jobs(admission_id) values($1)',[id]);await tx.query('insert into public.teaching_classroom_task_operations(session_id,operation_key,request_hash,outcome) values($1,$2,$3,$4::jsonb)',[delivery.session_id,input.operationKey,digest,JSON.stringify(receipt)]);
  delivery.cursor=Number(delivery.cursor)+1;await tx.query('insert into public.teaching_classroom_conversation(event_id,session_id,server_sequence,payload,occurred_at) values($1,$2,$3,$4::jsonb,$5)',[capture.response_id,delivery.session_id,delivery.cursor,JSON.stringify({id:capture.response_id,sequence:delivery.cursor,role:'student',type:'response',text:input.text,source_refs:[{kind:'task',id:t.id,version:t.version,anchor:null}],status:'ACCEPTED',occurred_at:iso(a.now)}),a.now]);
  delivery.delivery_state='WAITING_FOR_INTERPRETATION';await changed(tx,a,delivery);await presentationRepository.emitUsing(tx,a,delivery,TEACHING_EVENTS.CLASSROOM_TASK_EVALUATION_DUE,{admission_id:id},{dueAt:iso(a.now),key:'task-eval:'+id+':0'});return receipt;
 });}
 async function extend(studentId,classId,body){const input=c.extension(body);return lock(studentId,classId,async(tx,a,delivery,reason)=>{
  const old=(await tx.query('select request_hash,outcome from public.teaching_classroom_task_operations where session_id=$1 and operation_key=$2',[delivery.session_id,input.operationKey])).rows[0],digest=hash(input);if(old){if(old.request_hash!==digest)throw failure('CLASSROOM_TASK_IDEMPOTENCY_CONFLICT');return {...old.outcome,replay:true};}
  if(reason||!await enabled(tx,a,delivery))throw failure('CLASSROOM_TASK_EXTENSION_RESTRICTED');
  const row=await reconcileUsing(tx,a,delivery,reason);if(!row||row.task_id!==input.taskId||Number(row.version_no)!==input.windowVersion||row.window_id!==input.windowId||delivery.session_id!==input.sessionId)throw failure('CLASSROOM_TASK_WINDOW_CONFLICT');
  const w=c.extendWindow(task(row).window,delivery.policy,{now:iso(a.now),classEnd:iso(a.end)});await saveWindow(tx,row,w);const receipt={accepted:true,window:w,charged:false};await tx.query('insert into public.teaching_classroom_task_operations(session_id,operation_key,request_hash,outcome) values($1,$2,$3,$4::jsonb)',[delivery.session_id,input.operationKey,digest,JSON.stringify(receipt)]);await changed(tx,a,delivery);await presentationRepository.emitUsing(tx,a,delivery,TEACHING_EVENTS.CLASSROOM_TASK_WINDOW_EXPIRY_DUE,{task_id:row.task_id,window_id:row.window_id,window_version:w.version},{dueAt:iso(new Date(Date.parse(w.deadline_at)+value(delivery.policy,'graceMs'))),key:'task-expiry:'+row.window_id+':'+w.version});return receipt;
 });}
 async function claimEvaluation(studentId,classId,admissionId){return lock(studentId,classId,async(tx,a,delivery)=>{
  if(!await enabled(tx,a,delivery))return {held:true,reason:'CLASSROOM_TASK_ROUTE_HELD'};
  const row=(await tx.query('select j.*,a.context_snapshot,a.exposure_snapshot from public.teaching_classroom_task_evaluation_jobs j join public.teaching_classroom_task_admissions a using(admission_id) where admission_id=$1 and a.session_id=$2 for update of j',[admissionId,delivery.session_id])).rows[0];
  if(!row||['HELD','COMPLETED'].includes(row.state)||row.lease_expires_at&&new Date(row.lease_expires_at)>a.now||row.next_attempt_at&&new Date(row.next_attempt_at)>a.now)return {held:true};
  const token=randomUUID(),policy=row.context_snapshot.policy;
  const expires=iso(new Date(a.now.getTime()+value(policy,'taskWorkerLeaseMs')));
  await tx.query("update public.teaching_classroom_task_evaluation_jobs set state='PROCESSING',attempts=attempts+1,lease_token=$2,lease_expires_at=$3,next_attempt_at=null where admission_id=$1",[admissionId,token,expires]);
  await presentationRepository.emitUsing(tx,a,delivery,TEACHING_EVENTS.CLASSROOM_TASK_EVALUATION_DUE,{admission_id:admissionId},{dueAt:expires,key:'task-eval-recovery:'+admissionId+':'+token});
  return {admissionId,token,context:row.context_snapshot,exposure:row.exposure_snapshot};
 });}
 async function commitEvaluation(studentId,classId,claim,output,receipt){return lock(studentId,classId,async(tx,a,delivery,reason)=>{
  const row=(await tx.query('select * from public.teaching_classroom_task_evaluation_jobs where admission_id=$1 for update',[claim.admissionId])).rows[0];
  const admission=(await tx.query('select * from public.teaching_classroom_task_admissions where admission_id=$1 and session_id=$2',[claim.admissionId,delivery.session_id])).rows[0];
  if(!row||!admission||row.state!=='PROCESSING'||row.lease_token!==claim.token||new Date(row.lease_expires_at)<=a.now)throw failure('CLASSROOM_TASK_EVALUATION_LEASE_STALE');
  const interpreted=c.interpretation(output,{task:admission.context_snapshot.task,exposure:admission.exposure_snapshot,responseId:admission.response_id,demand:admission.context_snapshot.design.artifacts.checks[0].task_demand,stateReference:admission.context_snapshot.design.input_state_reference});
  const evaluation=await d12Repository.saveClassroomTaskEvaluationUsing(tx,{admissionId:claim.admissionId,payload:interpreted.evaluation,evidenceBounds:interpreted.evidenceBounds,executionId:receipt?.executionId,acceptanceReceipt:receipt});
  await tx.query("update public.teaching_classroom_task_evaluation_jobs set state='COMPLETED',lease_token=null,lease_expires_at=null,evaluation_id=$2,acceptance_receipt=$3::jsonb,selected_action=$4::jsonb where admission_id=$1",[claim.admissionId,evaluation.evaluation_id,JSON.stringify(receipt),JSON.stringify({proposal:interpreted.nextAction,evidenceBounds:interpreted.evidenceBounds,authorizedForPublication:false})]);
  // A completed interpretation alone does not release feedback or unrelated teaching.
  // The separate accepted action/Presenter gate must confirm handling completion.
  return {accepted:true,evaluationId:evaluation.evaluation_id,afterClosure:!!reason,livePublication:false,officialOutcome:false};
 });}
 async function failEvaluation(studentId,classId,claim,code){return lock(studentId,classId,async(tx,a,delivery)=>{
  const row=(await tx.query('select j.*,a.context_snapshot from public.teaching_classroom_task_evaluation_jobs j join public.teaching_classroom_task_admissions a using(admission_id) where admission_id=$1 and a.session_id=$2 for update of j',[claim.admissionId,delivery.session_id])).rows[0];
  if(!row||row.state!=='PROCESSING'||row.lease_token!==claim.token)return {stale:true};
  const policy=row.context_snapshot.policy,retry=Number(row.attempts)<=value(policy,'taskEvaluationRetryLimit');
  const due=iso(new Date(a.now.getTime()+value(policy,'taskEvaluationRetryBackoffMs')));
  await tx.query('update public.teaching_classroom_task_evaluation_jobs set state=$2,lease_token=null,lease_expires_at=null,next_attempt_at=$3,failure_code=$4 where admission_id=$1',[claim.admissionId,retry?'RETRY':'HELD',retry?due:null,code]);
  if(retry)await presentationRepository.emitUsing(tx,a,delivery,TEACHING_EVENTS.CLASSROOM_TASK_EVALUATION_DUE,{admission_id:claim.admissionId},{dueAt:due,key:'task-eval-retry:'+claim.admissionId+':'+row.attempts});
  return {held:!retry,retry};
 });}
 return {enabled,design,submit,extend,claimEvaluation,commitEvaluation,failEvaluation,projectUsing,reconcileUsing,releaseUsing,authorizeSequenceUsing,confirmedUsing};
}
module.exports={createClassroomTaskRepository};
