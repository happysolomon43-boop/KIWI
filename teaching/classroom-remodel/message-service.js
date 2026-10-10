'use strict';
const {failure,value}=require('./presentation-policy');
const {bindDirective}=require('./contracts');
function createClassroomMessageService({repository,presentationRepository,presentationService,coordinator=null,directiveReader=null}={}){
 if(!repository||!presentationRepository)throw new TypeError('Durable message and presentation repositories required');
 const owner=(user,id)=>{if(!user?.id||typeof id!=='string'||!id.trim())throw failure('CLASSROOM_OWNER_REQUIRED',401);return [user.id,id];};
 async function process({studentId,classId,messageId}){
  const claim=await repository.claim(studentId,classId,messageId);
  if(!claim.held){
   try{
    if(typeof coordinator?.route!=='function')throw failure('CLASSROOM_MESSAGE_ROUTING_HELD',503);
    const abort=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(failure('CLASSROOM_MESSAGE_ROUTING_TIMEOUT',503));},value(claim.policy,'generationTimeoutMs'));});
    try{const output=await Promise.race([coordinator.route({...claim,signal:abort.signal}),timeout]);if(!coordinator.acceptsUsingSink)await repository.acceptDisposition(studentId,classId,claim,output);}
    finally{clearTimeout(timer);}
   }catch(e){await repository.failed(studentId,classId,claim,e.code||'CLASSROOM_MESSAGE_ROUTING_FAILED');}
  }
  return pump({studentId,classId});
 }
 async function pump({studentId,classId}){
  const q=await repository.readyQuestion(studentId,classId);if(!q)return {pending:true};
  if(!q.accepted_proposal||q.processing_state==='HELD')return {pending:true,reason:'CLASSROOM_MESSAGE_OWNER_DECISION_REQUIRED'};
  const selected=q.accepted_proposal.next_action;
  if(!selected||selected.action==='wait')return {pending:true};
  try{
   if(typeof directiveReader!=='function'||typeof presentationService?.prepareSpan!=='function')throw failure('CLASSROOM_MESSAGE_DIRECTIVE_HELD',503);
   const expected=await presentationRepository.capture(studentId,classId);if(expected.held)return expected;
   // Trusted adopted policy supplies the entire Directive. Model guidance is
   // input to that reader, never timing/permission authority in its own right.
   const binding=await directiveReader({studentId,classId,question:q,proposal:q.accepted_proposal,expected});
   if(binding.task_ref!==null||binding.response_window!==null||binding.accepted_evaluation!==null||(q.disposition==='request clarification'?!['none','explanation','reasoning'].includes(binding.expected_student_action):binding.expected_student_action!=='none')||binding.evidence_intent!=='instruction_only'||binding.resume_at!==q.resume_anchor)throw failure('CLASSROOM_MESSAGE_DIRECTIVE_CONFLICT');
   const bound=bindDirective(selected,binding);if(!bound.directive)throw failure('CLASSROOM_MESSAGE_ACTION_UNAVAILABLE');
   const result=await presentationService.prepareSpan({studentId,classId,operationKey:'message-reply:'+q.message_id+':'+expected.deliveryEpoch,directive:bound.directive,types:['text'],assets:[],messageRefs:[q.message_id],messageToken:q.lease_token});
   if(result.accepted!==true)throw failure(result.reason||'CLASSROOM_MESSAGE_REPLY_HELD',503);
   return result;
  }catch(e){await repository.replyFailed(studentId,classId,q.message_id,e.code||'CLASSROOM_MESSAGE_REPLY_HELD',q.lease_token);return {pending:true};}
 }
 return Object.freeze({admit:(user,id,input)=>repository.admit(...owner(user,id),input),questions:async(user,id)=>(await presentationRepository.read(...owner(user,id),{snapshot:true})).messages,process,pump});
}
module.exports={createClassroomMessageService};
