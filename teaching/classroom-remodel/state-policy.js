'use strict';
const {INSTRUCTIONAL_SUBSTATES,CONTROLLER_LIFECYCLE}=require('../d11/contracts');
const {ASSISTANCE_LEVELS}=require('../d12/contracts');
const VERSION='classroom-state-policy.v1';
const DELIVERY_STATES=Object.freeze(['READY','PREPARING','PRESENTING','PAUSE_PENDING','PAUSED','WAITING_FOR_RESPONSE','WAITING_FOR_INTERPRETATION','HANDLING_MESSAGE','RECOVERING','CLOSING','COMPLETED']);
function fail(code){const e=new Error(code);e.code=code;throw e;}
function assertCompositeState(s){
 if(!s||!DELIVERY_STATES.includes(s.deliveryState))fail('CLASSROOM_DELIVERY_STATE_INVALID');
 if(s.historical===true){if(s.deliveryState!=='COMPLETED'||s.windowState==='OPEN')fail('CLASSROOM_HISTORY_LIVE_EFFECT_FORBIDDEN');return s;}
 if(!s.controllerId||!INSTRUCTIONAL_SUBSTATES.includes(s.academicState)||!Object.values(CONTROLLER_LIFECYCLE).includes(s.lifecycle))fail('CLASSROOM_CONTROLLER_REQUIRED');
 if(s.lifecycle==='CLOSED'&&(s.deliveryState!=='COMPLETED'||['OPEN','PENDING_DELIVERY'].includes(s.windowState)))fail('CLASSROOM_CLOSED_LIVE_STATE');
 if(s.deliveryState==='COMPLETED'&&s.lifecycle!=='CLOSED')fail('CLASSROOM_COMPLETION_NOT_CONFIRMED');
 if(['ASSESSMENT','CLASSWORK','BREAK','INTERRUPTED'].includes(s.academicState)&&['PRESENTING','PAUSE_PENDING','HANDLING_MESSAGE','WAITING_FOR_RESPONSE'].includes(s.deliveryState))fail('CLASSROOM_PROTECTED_OR_INTERRUPTED_RELEASE');
 if(s.lifecycle==='INTERRUPTED'&&s.deliveryState!=='RECOVERING'&&s.deliveryState!=='CLOSING')fail('CLASSROOM_INTERRUPTED_RELEASE');
 if(s.windowState==='OPEN'&&!['WAITING_FOR_RESPONSE','PAUSED','RECOVERING','CLOSING'].includes(s.deliveryState))fail('CLASSROOM_OPEN_WINDOW_PROGRESSION');
 if(s.deliveryState==='WAITING_FOR_RESPONSE'&&s.windowState!=='OPEN')fail('CLASSROOM_RESPONSE_WINDOW_REQUIRED');
 if(s.deliveryState==='WAITING_FOR_INTERPRETATION'&&s.windowState!=='RESPONSE_ACCEPTED')fail('CLASSROOM_ACCEPTED_RESPONSE_REQUIRED');
 return s;
}
// Detailed assistance is always retained. No reverse conversion invents an exact
// eight-level value from D11's coarser historic representation.
const D11_CEILING_MAP=Object.freeze({NONE:'none',LIGHT:'directional',GUIDED:'partial_step',MODELED:'worked_example'});
function assertAssistance({d11Ceiling,detailedCeiling,proposed}){
 if(!Object.hasOwn(D11_CEILING_MAP,d11Ceiling)||!ASSISTANCE_LEVELS.includes(detailedCeiling)||!ASSISTANCE_LEVELS.includes(proposed))fail('CLASSROOM_ASSISTANCE_UNKNOWN');
 const rank=x=>ASSISTANCE_LEVELS.indexOf(x);
 if(rank(detailedCeiling)>rank(D11_CEILING_MAP[d11Ceiling])||rank(proposed)>rank(detailedCeiling))fail('CLASSROOM_ASSISTANCE_CEILING_EXCEEDED');
 return {d11Ceiling,detailedCeiling,proposed,mappingVersion:VERSION};
}
const DEFINITIONS=Object.freeze({
 paceProfiles:{owner:'D14 delivery',kind:'profiles',activation:'presentation'},
 bufferPortions:{owner:'D14 delivery',kind:'positiveInteger',activation:'presentation'},bufferBytes:{owner:'D14 delivery',kind:'positiveInteger',activation:'presentation'},bufferSourceHorizon:{owner:'D14 delivery',kind:'positiveInteger',activation:'presentation'},
 messageDraftRetentionMs:{owner:'Privacy/domain policy',kind:'positiveInteger',activation:'messages'},messageRateWindowMs:{owner:'D14 admission',kind:'positiveInteger',activation:'messages'},messageWorkerLeaseMs:{owner:'D14 reliability',kind:'positiveInteger',activation:'messages'},messageRetryBackoffMs:{owner:'Orchestrator',kind:'positiveInteger',activation:'messages'},messageRoutingRetryLimit:{owner:'Orchestrator',kind:'nonnegativeInteger',activation:'messages'},
 conversationalAllowance:{owner:'Teaching policy',kind:'nonnegativeInteger',activation:'messages'},messageMaxBytes:{owner:'D14 admission',kind:'positiveInteger',activation:'messages'},messageRateLimit:{owner:'D14 admission',kind:'positiveInteger',activation:'messages'},refundPolicy:{owner:'Teaching policy',kind:'refund',activation:'messages'},
 taskDurations:{owner:'D11/D12 task policy',kind:'durations',activation:'tasks'},extensionLimitMs:{owner:'D11 task policy',kind:'nonnegativeInteger',activation:'tasks'},extensionCount:{owner:'D11 task policy',kind:'nonnegativeInteger',activation:'tasks'},graceMs:{owner:'D11 admission',kind:'nonnegativeInteger',activation:'tasks'},lateSubmissionPolicy:{owner:'D12 admission',kind:'late',activation:'tasks'},
 clientLeaseMs:{owner:'D14 reliability',kind:'positiveInteger',activation:'presentation'},clientRenewalMs:{owner:'D14 reliability',kind:'positiveInteger',activation:'presentation'},takeoverPolicy:{owner:'D14 reliability',kind:'takeover',activation:'presentation'},
 closureLeadMs:{owner:'D11',kind:'nonnegativeInteger',activation:'presentation'},generationTimeoutMs:{owner:'Orchestrator',kind:'positiveInteger',activation:'generation'},generationRetryLimit:{owner:'Orchestrator',kind:'nonnegativeInteger',activation:'generation'},generationBudget:{owner:'Orchestrator',kind:'positiveInteger',activation:'generation'},
 historyRetention:{owner:'Privacy/domain policy',kind:'retention',activation:'history'},summaryVersion:{owner:'D11 continuity',kind:'nonempty',activation:'history'},
 reconnectBackoffMs:{owner:'D14 transport',kind:'positiveInteger',activation:'transport'},deltaPageSize:{owner:'D14 transport',kind:'positiveInteger',activation:'transport'},cursorRetentionMs:{owner:'D14 transport',kind:'positiveInteger',activation:'transport'},
 cohort:{owner:'D31 release',kind:'nonempty',activation:'session'},rollbackEngineVersion:{owner:'D31 release',kind:'nonempty',activation:'session'},
});
function valid(kind,value){
 if(kind==='positiveInteger')return Number.isSafeInteger(value)&&value>0;
 if(kind==='nonnegativeInteger')return Number.isSafeInteger(value)&&value>=0;
 if(kind==='nonempty')return typeof value==='string'&&value.trim().length>0;
 if(kind==='refund')return ['none','audited_policy_exception'].includes(value);
 if(kind==='late')return ['reject','separate_authorized_review'].includes(value);
 if(kind==='takeover')return value==='explicit_epoch_takeover';
 if(kind==='retention')return value&&Number.isSafeInteger(value.archiveDays)&&value.archiveDays>0&&value.recentExactClassHorizon===3;
 if(kind==='durations')return value&&Object.keys(value).length>0&&Object.values(value).every(v=>Number.isSafeInteger(v)&&v>0);
 if(kind==='profiles')return value&&Object.keys(value).length>0&&Object.values(value).every(p=>p&&Number.isSafeInteger(p.minimumDwellMs)&&p.minimumDwellMs>0&&Number.isSafeInteger(p.maximumDwellMs)&&p.maximumDwellMs>=p.minimumDwellMs&&p.contentTypeWeights&&Object.keys(p.contentTypeWeights).length>0&&Object.values(p.contentTypeWeights).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0));
 return false;
}
function validatePolicy(policy){
 if(!policy||typeof policy.version!=='string'||!policy.version.trim()||!policy.fields||Array.isArray(policy.fields))fail('CLASSROOM_POLICY_VERSION_REQUIRED');
 for(const [key,record]of Object.entries(policy.fields)){
  const def=DEFINITIONS[key];if(!def)fail('CLASSROOM_POLICY_FIELD_UNKNOWN');
  if(record===null)continue;
  if(!record||record.owner!==def.owner||!record.authoritySource||!record.adoptedVersion||!['future_sessions','mandatory_restriction'].includes(record.effectiveRule)||!valid(def.kind,record.value))fail('CLASSROOM_POLICY_ADOPTION_INVALID');
 }
 const renewal=policy.fields.clientRenewalMs?.value,lease=policy.fields.clientLeaseMs?.value;
 if(renewal!=null&&lease!=null&&renewal>=lease)fail('CLASSROOM_POLICY_RENEWAL_AFTER_EXPIRY');
 return policy;
}
function capabilityReadiness(policy,capability){validatePolicy(policy);const required=Object.entries(DEFINITIONS).filter(([,d])=>d.activation===capability).map(([k])=>k);if(!required.length)fail('CLASSROOM_POLICY_CAPABILITY_UNKNOWN');const missing=required.filter(k=>policy.fields[k]==null);return {ready:!missing.length,missing,policyVersion:policy.version};}
function permittedCommands(s,{qualifiedActions=[]}={}){
 assertCompositeState(s);if(s.historical||s.lifecycle==='CLOSED')return [];
 const candidates=['technical_report','leave'];
 if(!['CLASSWORK','ASSESSMENT','BREAK','INTERRUPTED'].includes(s.academicState)&&s.lifecycle==='ACTIVE'){
  if(['PRESENTING','PAUSE_PENDING','PREPARING','WAITING_FOR_RESPONSE'].includes(s.deliveryState))candidates.push('pause');
  if(s.deliveryState==='PAUSED'&&s.windowState!=='OPEN')candidates.push('resume');
  if(['PRESENTING','PAUSED','PREPARING'].includes(s.deliveryState))candidates.push('pace');
  candidates.push('correction_report');
  if(s.windowState==='OPEN')candidates.push('task_response','task_clarification','extension');
  if(s.conversationalRemaining>0)candidates.push('message');
 }
 return candidates.filter(c=>qualifiedActions.includes(c));
}
module.exports={VERSION,DELIVERY_STATES,D11_CEILING_MAP,DEFINITIONS,assertCompositeState,assertAssistance,validatePolicy,capabilityReadiness,permittedCommands};
