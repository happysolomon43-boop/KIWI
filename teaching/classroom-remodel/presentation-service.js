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
  try{output=await Promise.race([presenter.generate({studentId,classId,operationKey,directive,chapter:prepared.chapter,guide:prepared.guide,authority:expected.authority,policy:config,signal:abort.signal,timeoutMs:value(config,'generationTimeoutMs'),retryLimit:value(config,'generationRetryLimit'),budget:value(config,'generationBudget')}),expired]);}
  finally{clearTimeout(timer);}
  if(output?.held)return {accepted:false,reason:output.reason};
  return repository.acceptSequence({studentId,classId,operationKey,directive,output,expected,types,assets});
 }
 return Object.freeze({prepare,prepareSpan,
  snapshot:(user,id)=>repository.read(...owner(user,id),{snapshot:true}),
  conversation:(user,id,after)=>repository.read(...owner(user,id),{after}),
  lease:(user,id,body)=>repository.command(...owner(user,id),input(body,{lease:true})),
  control:(user,id,body)=>repository.command(...owner(user,id),input(body)),
  receipt:(user,id,body)=>repository.receipt(...owner(user,id),input(body,{receipt:true})),
 });
}
module.exports={createClassroomPresentationService};
