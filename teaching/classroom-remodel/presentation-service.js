'use strict';
const {failure,value}=require('./presentation-policy');
function createClassroomPresentationService({repository,policyReader,openingDirectiveReader,presenter=null}={}){
 if(!repository)throw new TypeError('Presentation repository required');
 function owner(user,classId){if(!user?.id||typeof classId!=='string'||!classId.trim())throw failure('CLASSROOM_OWNER_REQUIRED',401);return [user.id,classId];}
 function input(body,{receipt=false,lease=false}={}){
  const allowed=['schemaVersion','sessionId','operationKey','expectedControllerVersion','expectedDeliveryVersion','deliveryEpoch','controlEpoch','clientId','leaseToken',...(receipt?['portionId','renderState','active','representationReady','readyAssetIds']:['intent','pace'])];
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw failure('CLASSROOM_COMMAND_INVALID',422);
  for(const key of ['schemaVersion','sessionId','operationKey','clientId'])if(typeof body[key]!=='string'||!body[key].trim())throw failure('CLASSROOM_COMMAND_INVALID',422);
  for(const key of ['expectedControllerVersion','expectedDeliveryVersion','deliveryEpoch','controlEpoch'])if(!Number.isSafeInteger(body[key])||body[key]<0)throw failure('CLASSROOM_COMMAND_INVALID',422);
  if(body.leaseToken!==undefined&&typeof body.leaseToken!=='string')throw failure('CLASSROOM_COMMAND_INVALID',422);
  if(body.schemaVersion!=='classroom-domain.v1')throw failure('CLASSROOM_CLIENT_SCHEMA_INCOMPATIBLE',422);
  if(receipt){if(typeof body.portionId!=='string'||!Array.isArray(body.readyAssetIds)||body.readyAssetIds.some(v=>typeof v!=='string'))throw failure('CLASSROOM_COMMAND_INVALID',422);}
  else if(!(lease?['claim','renew','takeover']:['pause','resume','pace']).includes(body.intent))throw failure('CLASSROOM_CONTROL_UNAVAILABLE',422);
  if((receipt||!lease||body.intent==='renew')&&(typeof body.leaseToken!=='string'||!body.leaseToken))throw failure('CLASSROOM_CLIENT_LEASE_STALE');
  const intent=receipt?'render_receipt':lease?{claim:'lease_claim',renew:'lease_renew',takeover:'lease_takeover'}[body.intent]:body.intent;
  require('./domain-contracts').validateCommand({operation_id:body.operationKey,idempotency_key:body.operationKey,session_id:body.sessionId,intent,target_ref:null,expected_controller_version:body.expectedControllerVersion,expected_delivery_version:body.expectedDeliveryVersion,expected_delivery_epoch:body.deliveryEpoch,expected_control_epoch:body.controlEpoch,schema_version:body.schemaVersion});
  return body;
 }
 async function prepare({studentId,classId,pace}){
  if(typeof policyReader!=='function'||typeof openingDirectiveReader!=='function')throw failure('CLASSROOM_APPROVED_PRESENTATION_CONFIG_MISSING',503);
  const policy=await policyReader({studentId,classId});await repository.initialize({studentId,classId,policy,pace});
  const expected=await repository.capture(studentId,classId);if(expected.held)return expected;
  const prepared=await repository.preparationInputs(studentId,classId);if(prepared.held)return prepared;
  const directive=await openingDirectiveReader({studentId,classId,binding:expected.binding,chapter:prepared.chapter,guide:prepared.guide});
  return repository.acceptSequence({studentId,classId,operationKey:'opening:'+expected.binding.opening_artifact_id+':'+expected.deliveryEpoch,output:prepared.opening,directive,expected,types:['text']});
 }
 // Only a trusted coordinator calls this method. No public request supplies a directive.
 // Generation happens after capture and before acceptance, outside all DB transactions.
 async function prepareSpan({studentId,classId,operationKey,directive,types,assets}){
  if(typeof presenter?.generate!=='function')return {accepted:false,reason:'CLASSROOM_PRESENTER_ROUTE_HELD'};
  const expected=await repository.capture(studentId,classId);if(expected.held)return expected;
  const config=expected.policy;if(!require('./state-policy').capabilityReadiness(config,'generation').ready)throw failure('CLASSROOM_GENERATION_POLICY_MISSING',503);
  const prepared=await repository.preparationInputs(studentId,classId);if(prepared.held)return prepared;
  const abort=new AbortController();let timer;
  const expired=new Promise(resolve=>{timer=setTimeout(()=>{abort.abort();resolve({held:true,reason:'CLASSROOM_GENERATION_OUTCOME_UNKNOWN'});},value(config,'generationTimeoutMs'));});
  let output;
  try{output=await Promise.race([presenter.generate({studentId,classId,operationKey,directive,chapter:prepared.chapter,guide:prepared.guide,authority:expected.authority,expected,types,assets,policy:config,signal:abort.signal,timeoutMs:value(config,'generationTimeoutMs'),retryLimit:value(config,'generationRetryLimit'),budget:value(config,'generationBudget')}),expired]);}
  finally{clearTimeout(timer);}
  if(output?.held)return {accepted:false,reason:output.reason};
  return repository.acceptSequence({studentId,classId,operationKey,directive,output,expected,types,assets});
 }
 function mutate(method,user,id,body,options){const checked=input(body,options);const owned=owner(user,id);return (async()=>{const result=await repository[method](...owned,checked);if(!result.serverTime)return result;
  const receipt=require('./domain-contracts').validateReceipt({operation_id:checked.operationKey,idempotency_key:checked.operationKey,session_id:result.sessionId,accepted:result.accepted,applied:result.applied,outcome:result.accepted?(result.replay?'already_applied':'applied'):'dependency_hold',controller_version:result.controllerVersion,delivery_version:result.deliveryVersion,delivery_epoch:result.deliveryEpoch,control_epoch:result.controlEpoch,server_time:result.serverTime,reconciliation_required:!result.accepted});return {...result,wire_schema_version:'classroom-presentation-wire.v1',receipt};})();}
 return Object.freeze({prepare,prepareSpan,
  snapshot:(user,id)=>repository.read(...owner(user,id),{snapshot:true}),
  conversation:(user,id,after)=>repository.read(...owner(user,id),{after}),
  lease:(user,id,body)=>mutate('command',user,id,body,{lease:true}),
  control:(user,id,body)=>mutate('command',user,id,body,{}),
  receipt:(user,id,body)=>mutate('receipt',user,id,body,{receipt:true}),
 });
}
module.exports={createClassroomPresentationService};
