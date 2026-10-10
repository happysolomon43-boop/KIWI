'use strict';
const {failure,value}=require('./presentation-policy');
const {hash}=require('./academic-artifacts');
const contracts=require('./task-contracts');
// Internal evaluation worker. Public response/help controls remain gated until
// the entire action, feedback, assistance and correction path is qualified.
function createClassroomTaskService({repository,coordinator,reviewer,presentationRepository,presentationService,turnProvider,turnReviewer}={}){
 if(!repository)throw new TypeError('Durable task repository required');
 async function process({studentId,classId,admissionId}){
  const claim=await repository.claimEvaluation(studentId,classId,admissionId);
  if(claim.held)return claim;
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('CLASSROOM_TASK_EVALUATION_TIMEOUT',503));},value(claim.context.policy,'generationTimeoutMs'));});
  try{
   if(typeof coordinator?.interpret!=='function'||typeof reviewer?.accept!=='function')throw failure('CLASSROOM_TASK_EVALUATION_ROUTE_HELD',503);
   const run=async()=>{
    const output=await coordinator.interpret({studentId,classId,admissionId,token:claim.token,immutableContext:claim.context,exposure:claim.exposure,signal:controller.signal});
    const adapted=contracts.interpretation(output,{task:claim.context.task,exposure:claim.exposure,responseId:claim.context.response.response_id,demand:claim.context.design.artifacts.checks[0].task_demand,stateReference:claim.context.design.input_state_reference});
    const receipt=await reviewer.accept({studentId,classId,admissionId,context:claim.context,canonicalOutput:output,evaluation:adapted.evaluation,evidenceBounds:adapted.evidenceBounds,contextHash:hash(claim.context),outputHash:hash(adapted.evaluation),signal:controller.signal});
    if(controller.signal.aborted)throw failure('CLASSROOM_TASK_EVALUATION_TIMEOUT',503);
    return repository.commitEvaluation(studentId,classId,claim,output,receipt);
   };
   return await Promise.race([run(),deadline]);
  }catch(error){await repository.failEvaluation(studentId,classId,claim,error.code||'CLASSROOM_TASK_EVALUATION_FAILED');return {pending:true,reason:error.code||'CLASSROOM_TASK_EVALUATION_FAILED'};}
  finally{clearTimeout(timer);}
 }
 async function prepareHandling({studentId,classId,taskId,requestId}){
  const ready=await repository.handlingContext(studentId,classId,{taskId,requestId});if(ready.held)return ready;
  if(!requestId&&!ready.job)return {held:true};
  if(typeof turnProvider?.generate!=='function'||typeof turnReviewer?.accept!=='function')throw failure('CLASSROOM_TASK_HANDLING_ROUTE_HELD',503);
  const operationKey=requestId?'task-support:'+requestId:'task-feedback:'+ready.job.admission_id;
  const kind=requestId?(ready.request.kind==='help'?'assistance':'clarification'):'feedback';
  const acceptedEvaluation=ready.job?{receipt_id:hash(ready.job.acceptance_receipt),task_ref:ready.task.id,criterion_ref:'criterion:'+ready.task.private.criterion_ref.id+'@'+ready.task.private.criterion_ref.version,source_version:ready.job.context_snapshot.sources.chapter.version,assistance_version:hash(ready.job.context_snapshot.exposure||ready.job.context_snapshot.response.assistance_context),state_reference:ready.job.context_snapshot.design.input_state_reference,accepted:true}:null;
  // Presenter receives public task and selected findings only. Private criteria,
  // expected answers and full evaluation stay with the evaluator/reviewer.
  const generated=await turnProvider.generate({studentId,classId,kind,operationKey,publicTask:ready.publicTask,assistanceCeiling:ready.task.assistance_ceiling,request:ready.request?{kind:ready.request.kind,text:ready.request.text}:null,selectedAction:ready.job?.selected_action||null,feedbackPoints:ready.job?.context_snapshot?ready.job.selected_action?.feedback_points||[]:[],acceptedEvaluation,chapter:ready.sources.chapter,expected:ready.expected,policy:ready.policy});
  const receipt=await turnReviewer.accept({studentId,classId,kind,task:ready.task,generated,expected:ready.expected,evaluationId:ready.job?.evaluation_id||null,acceptedEvaluation});
  await repository.acceptTurn({studentId,classId,taskId:ready.task.id,operationKey,kind,output:generated.output,directive:generated.directive,assistanceLevel:generated.assistanceLevel,receipt,expected:ready.expected});
  return pump({studentId,classId});
 }
 async function pump({studentId,classId}){
  const turn=await repository.pendingTurn(studentId,classId);if(!turn)return {held:true};
  const expected=await presentationRepository.capture(studentId,classId);if(expected.held)return expected;
  return presentationRepository.acceptSequence({studentId,classId,operationKey:'task-turn:'+turn.turn_id,output:turn.output,directive:turn.directive,expected,types:['text'],classroomTaskId:turn.task_id});
 }
 const owner=(user,id)=>{if(!user?.id||typeof id!=='string'||!id.trim())throw failure('CLASSROOM_OWNER_REQUIRED',401);return [user.id,id];};
 return Object.freeze({process,prepareHandling,pump,submit:(user,id,body)=>repository.submit(...owner(user,id),body),extend:(user,id,body)=>repository.extend(...owner(user,id),body),support:(user,id,body)=>repository.support(...owner(user,id),body)});
}
module.exports={createClassroomTaskService};
