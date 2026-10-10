'use strict';
const {failure,value}=require('./presentation-policy');
const {hash}=require('./academic-artifacts');
const contracts=require('./task-contracts');
// Internal evaluation worker. Public response/help controls remain gated until
// the entire action, feedback, assistance and correction path is qualified.
function createClassroomTaskService({repository,coordinator,reviewer,presentationRepository,presentationService,turnProvider,turnReviewer,revisionRepository,adjustmentProvider}={}){
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
  if(typeof turnProvider?.generate!=='function'||typeof turnReviewer?.accept!=='function'||typeof turnReviewer?.select!=='function')throw failure('CLASSROOM_TASK_HANDLING_ROUTE_HELD',503);
  const operationKey=(requestId?'task-support:'+requestId:'task-feedback:'+ready.job.admission_id)+':epoch:'+ready.expected.deliveryEpoch;
  const previous=await repository.loadTurn(studentId,classId,operationKey);if(previous)return previous.state==='PREPARED'?pump({studentId,classId}):{accepted:true,replay:true,turnId:previous.turn_id};
  const kind=requestId?(ready.request.kind==='help'?'assistance':'clarification'):'feedback';
  const acceptedEvaluation=ready.job?{receipt_id:hash(ready.job.acceptance_receipt),task_ref:ready.task.id,criterion_ref:'criterion:'+ready.task.private.criterion_ref.id+'@'+ready.task.private.criterion_ref.version,source_version:ready.job.context_snapshot.sources.chapter.version,assistance_version:hash(ready.job.context_snapshot.exposure||ready.job.context_snapshot.response.assistance_context),state_reference:ready.job.context_snapshot.design.input_state_reference,accepted:true}:null;
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('CLASSROOM_TASK_HANDLING_TIMEOUT',503));},value(ready.policy,'generationTimeoutMs'));});
  const run=async()=>{
   // The independent owner selects public-safe findings before Presenter sees them.
   // Full evaluation and private criteria remain on this side of the boundary.
   const selection=await turnReviewer.select({studentId,classId,kind,task:ready.task,job:ready.job,request:ready.request,expected:ready.expected,signal:controller.signal});
   const publicContent=selection?.publicContent,selectionReceipt=selection?.receipt;
   if(!publicContent||!Array.isArray(publicContent.feedbackPoints)||!selectionReceipt?.accepted||!selectionReceipt.independent||!selectionReceipt.ownerRef||!selectionReceipt.executionId||selectionReceipt.contentHash!==hash(publicContent)||selectionReceipt.authorityHash!==hash(ready.expected.authority)||selectionReceipt.taskId!==ready.task.id||selectionReceipt.evaluationId!==(ready.job?.evaluation_id||null))throw failure('CLASSROOM_TASK_PUBLIC_SELECTION_REQUIRED',503);
   const selected=ready.job?.selected_action;
   const selectedAction=selected?Object.fromEntries(['action','task_ref','assistance_ceiling','current_assistance_state','inference_ceiling','new_task_required','reason'].filter(k=>k in selected).map(k=>[k,selected[k]])):null;
   const generated=await turnProvider.generate({studentId,classId,kind,operationKey,publicTask:ready.publicTask,assistanceCeiling:ready.task.assistance_ceiling,request:ready.request?{kind:ready.request.kind,text:ready.request.text}:null,selectedAction,feedbackPoints:publicContent.feedbackPoints,acceptedEvaluation,chapter:ready.sources.chapter,expected:ready.expected,policy:ready.policy,signal:controller.signal});
   const receipt=await turnReviewer.accept({studentId,classId,kind,task:ready.task,generated,publicSelection:selection,expected:ready.expected,evaluationId:ready.job?.evaluation_id||null,acceptedEvaluation,signal:controller.signal});
   if(controller.signal.aborted)throw failure('CLASSROOM_TASK_HANDLING_TIMEOUT',503);
   await repository.acceptTurn({studentId,classId,taskId:ready.task.id,operationKey,kind,output:generated.output,directive:generated.directive,assistanceLevel:generated.assistanceLevel,receipt:{...receipt,publicSelectionReceipt:selectionReceipt},expected:ready.expected});
  };
  try{await Promise.race([run(),timeout]);}finally{clearTimeout(timer);}

  return pump({studentId,classId});
 }
 async function adjust({studentId,classId,turnId}){
  const ready=await repository.actionContext(studentId,classId,turnId);if(ready.held)return ready;
  const action=ready.turn.selected_action,operationKey='task-adjustment:'+turnId;
  if(action.action==='request replanning'){
   if(!revisionRepository||typeof adjustmentProvider?.replan!=='function')throw failure('CLASSROOM_REPLAN_OWNER_ROUTE_HELD',503);
   const actual=await revisionRepository.context(studentId,classId);if(actual.held)return actual;
   const prepared=await adjustmentProvider.replan({studentId,classId,operationKey,actual,acceptedAction:action,policy:ready.policy});
   const applied=await revisionRepository.replan({studentId,classId,operationKey,...prepared,expected:actual.expected,work:actual.work});
   return repository.completeAction(studentId,classId,turnId,{action:action.action,revisionId:applied.revisionId});
  }
  if(!action.new_task_required)return repository.completeAction(studentId,classId,turnId,{action:action.action,handling:'Accepted instruction realized in the confirmed feedback turn'});
  if(typeof coordinator?.design!=='function'||typeof reviewer?.acceptDesign!=='function'||typeof turnReviewer?.acceptQuestion!=='function')throw failure('CLASSROOM_TASK_ADJUSTMENT_ROUTE_HELD',503);
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('CLASSROOM_TASK_HANDLING_TIMEOUT',503));},value(ready.policy,'generationTimeoutMs'));});
  const run=async()=>{
   const proposal=await coordinator.design({studentId,classId,operationKey,acceptedAction:action,priorTask:ready.priorTask,admission:ready.admission,chapter:ready.sources.chapter,expected:ready.expected,policy:ready.policy,signal:controller.signal});
   const validation=await reviewer.acceptDesign({studentId,classId,proposal,priorTask:ready.priorTask,admission:ready.admission,expected:ready.expected,signal:controller.signal});
   const candidate=proposal.artifacts?.checks?.[0];
   if(!validation?.independent||validation.variationOfTaskId!==ready.priorTask.id||validation.constructPreserved!==true||validation.cosmeticOnly!==false||!validation.variationReviewRef||candidate?.student_facing?.question?.trim()===ready.priorTask.public_question.text.trim()||candidate?.target_objective!==ready.priorTask.target_ref.id)throw failure('CLASSROOM_FRESH_VARIATION_NOT_VALIDATED',503);
   if(controller.signal.aborted)throw failure('CLASSROOM_TASK_HANDLING_TIMEOUT',503);
   const designed=await repository.design({studentId,classId,operationKey,proposal,validation,targetRef:ready.priorTask.target_ref,expected:ready.expected});
   const expected=await presentationRepository.capture(studentId,classId);if(expected.held)return expected;
   const generated=await turnProvider.generate({studentId,classId,kind:'question',operationKey:operationKey+':question',publicTask:require('./domain-contracts').projectTask(designed.task),assistanceCeiling:designed.task.assistance_ceiling,request:null,selectedAction:action,feedbackPoints:[],acceptedEvaluation:null,chapter:ready.sources.chapter,expected,policy:ready.policy,signal:controller.signal});
   const accepted=await turnReviewer.acceptQuestion({studentId,classId,task:designed.task,generated,expected,signal:controller.signal});
   if(!accepted?.accepted||!accepted.independent||!accepted.ownerRef||!accepted.executionId||accepted.taskId!==designed.task.id||accepted.contentHash!==hash({output:generated.output,directive:generated.directive})||accepted.authorityHash!==hash(expected.authority))throw failure('CLASSROOM_TASK_QUESTION_REVIEW_REQUIRED',503);
   if(controller.signal.aborted)throw failure('CLASSROOM_TASK_HANDLING_TIMEOUT',503);
   const prepared=await presentationRepository.acceptSequence({studentId,classId,operationKey:operationKey+':question',output:generated.output,directive:generated.directive,expected,types:generated.types||['text'],assets:generated.assets||[],classroomTaskId:designed.task.id});if(!prepared.accepted)throw failure(prepared.reason||'CLASSROOM_TASK_QUESTION_STALE',409);
   return repository.completeAction(studentId,classId,turnId,{action:action.action,taskId:designed.task.id,variationReviewRef:validation.variationReviewRef,questionReview:accepted});
  };
  try{return await Promise.race([run(),timeout]);}finally{clearTimeout(timer);}
 }
 async function pump({studentId,classId}){
  const turn=await repository.pendingTurn(studentId,classId);if(!turn)return {held:true};
  const expected=await presentationRepository.capture(studentId,classId);if(expected.held)return expected;
  return presentationRepository.acceptSequence({studentId,classId,operationKey:'task-turn:'+turn.turn_id,output:turn.output,directive:turn.directive,expected,types:['text'],classroomTaskId:turn.task_id});
 }
 const owner=(user,id)=>{if(!user?.id||typeof id!=='string'||!id.trim())throw failure('CLASSROOM_OWNER_REQUIRED',401);return [user.id,id];};
 return Object.freeze({process,prepareHandling,adjust,pump,submit:(user,id,body)=>repository.submit(...owner(user,id),body),extend:(user,id,body)=>repository.extend(...owner(user,id),body),support:(user,id,body)=>repository.support(...owner(user,id),body)});
}
module.exports={createClassroomTaskService};
