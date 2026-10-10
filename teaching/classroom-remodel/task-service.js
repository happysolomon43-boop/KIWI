'use strict';
const {failure,value}=require('./presentation-policy');
const {hash}=require('./academic-artifacts');
const contracts=require('./task-contracts');
// Internal evaluation worker. Public response/help controls remain gated until
// the entire action, feedback, assistance and correction path is qualified.
function createClassroomTaskService({repository,coordinator,reviewer}={}){
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
 return Object.freeze({process});
}
module.exports={createClassroomTaskService};
