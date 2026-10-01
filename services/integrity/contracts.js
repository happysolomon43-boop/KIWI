'use strict';

const POLICY_VERSION = 'integrity-session-guard.v1';
const SUBMISSION_GATE_POLICY_VERSION = 'submission-verification-gate.v1';

const SESSION_PROFILES = Object.freeze({
  LEARNING: Object.freeze({controlled:false,warnAt:null,lockAt:null,lockOutcome:null}),
  OPEN_WORK: Object.freeze({controlled:false,warnAt:null,lockAt:null,lockOutcome:null}),
  INDEPENDENT_WORK: Object.freeze({controlled:true,warnAt:1,lockAt:2,lockOutcome:'POST_ATTEMPT_VERIFICATION_REQUIRED'}),
  CONTROLLED_TAKE_HOME: Object.freeze({controlled:true,warnAt:1,lockAt:2,lockOutcome:'LOCKED_FOR_REVIEW'}),
  SCHEDULED_TEST: Object.freeze({controlled:true,warnAt:1,lockAt:2,lockOutcome:'LOCKED_FOR_REVIEW'}),
  HIGH_STAKES_EXAM: Object.freeze({controlled:true,warnAt:1,lockAt:2,lockOutcome:'ATTEMPT_INVALIDATED_RULE_BREACH'}),
});

const VERIFICATION_ROUTES = Object.freeze([
  'NO_VERIFICATION',
  'VERIFY_NOW',
  'VERIFY_NEXT_CLASS',
  'VERIFY_WITH_FRESH_EQUIVALENT_WORK',
  'VERIFY_POST_ATTEMPT',
  'SYSTEM_DEFERRED',
]);

const TIMER_CLASSES = Object.freeze({
  MICRO_RECOGNITION: 15,
  SHORT_EXPLANATION: 30,
  ONE_STEP_CALCULATION: 45,
  TINY_CONSTRUCTED_RESPONSE: 90,
  CODE_WALKTHROUGH: 120,
});

const RAW_EVENT_KINDS = Object.freeze(new Set([
  'VISIBILITY_HIDDEN','VISIBILITY_VISIBLE','WINDOW_BLUR','WINDOW_FOCUS','PAGEHIDE','PAGESHOW',
  'FULLSCREEN_EXIT','FULLSCREEN_ENTER','NETWORK_LOST','NETWORK_RESTORED','HEARTBEAT','NAVIGATION_AWAY',
  'APP_BACKGROUNDED','APP_FOREGROUNDED','DEVICE_TRANSFER','PASTE_EVENT',
]));

function fail(message,code,status=400,details=null){
  const error=new Error(message);error.code=code;error.status=status;if(details)error.details=details;return error;
}
function profile(name){const key=String(name||'LEARNING').toUpperCase();const value=SESSION_PROFILES[key];if(!value)throw fail('Unknown controlled-session profile.','KIWI_INTEGRITY_PROFILE_INVALID',400,{profile:key});return Object.freeze({name:key,...value,policyVersion:POLICY_VERSION});}
function timingClass(name){const key=String(name||'SHORT_EXPLANATION').toUpperCase();const seconds=TIMER_CLASSES[key];if(!seconds)throw fail('Unknown verification timing class.','KIWI_VERIFICATION_TIMER_CLASS_INVALID',400);return Object.freeze({timingClass:key,seconds});}
function normalizeRawEvent(input={}){
  const kind=String(input.kind||'').toUpperCase();if(!RAW_EVENT_KINDS.has(kind))throw fail('Unsupported integrity session event.','KIWI_INTEGRITY_EVENT_INVALID',400,{kind});
  const observedAt=new Date(input.observedAt||Date.now());if(!Number.isFinite(observedAt.getTime()))throw fail('Invalid integrity event time.','KIWI_INTEGRITY_EVENT_TIME_INVALID',400);
  let category='CONTEXT';
  if(['VISIBILITY_HIDDEN','PAGEHIDE','NAVIGATION_AWAY','APP_BACKGROUNDED'].includes(kind))category='DEPARTURE_SIGNAL';
  else if(kind==='FULLSCREEN_EXIT')category='FULLSCREEN_SIGNAL';
  else if(['VISIBILITY_VISIBLE','PAGESHOW','APP_FOREGROUNDED'].includes(kind))category='RETURN_SIGNAL';
  else if(kind==='NETWORK_LOST')category='NETWORK_INTERRUPTION';
  else if(kind==='NETWORK_RESTORED')category='NETWORK_RECOVERY';
  else if(kind==='DEVICE_TRANSFER')category='DEVICE_TRANSFER';
  else if(kind==='PASTE_EVENT')category='CONTEXTUAL_PASTE';
  return Object.freeze({kind,category,observedAt:observedAt.toISOString(),durationMs:Math.max(0,Number(input.durationMs)||0),clientEventId:input.clientEventId?String(input.clientEventId):null,metadata:Object.freeze(input.metadata&&typeof input.metadata==='object'?{...input.metadata}:{})});
}
function departureDecision({sessionProfile,rawEvent,permitted=false,kiwiCaused=false,duplicate=false}={}){
  const p=typeof sessionProfile==='string'?profile(sessionProfile):sessionProfile;
  const e=normalizeRawEvent(rawEvent);
  if(duplicate)return Object.freeze({normalizedKind:'DUPLICATE_NOOP',counts:false,confirmedProhibited:false,reason:'DEDUPLICATED'});
  if(!p?.controlled)return Object.freeze({normalizedKind:e.category==='DEPARTURE_SIGNAL'?'OBSERVED_DEPARTURE':'CONTEXT_EVENT',counts:false,confirmedProhibited:false,reason:'SESSION_NOT_CONTROLLED'});
  if(kiwiCaused)return Object.freeze({normalizedKind:'SYSTEM_PROTECTED_INTERRUPTION',counts:false,confirmedProhibited:false,reason:'KIWI_CAUSED'});
  if(permitted)return Object.freeze({normalizedKind:'PERMITTED_DEPARTURE',counts:false,confirmedProhibited:false,reason:'PERMITTED_BY_POLICY'});
  if(e.category==='DEPARTURE_SIGNAL'||e.category==='FULLSCREEN_SIGNAL')return Object.freeze({normalizedKind:'CONFIRMED_PROHIBITED_DEPARTURE',counts:true,confirmedProhibited:true,reason:'CONTROLLED_SURFACE_LEFT'});
  if(e.category==='NETWORK_INTERRUPTION')return Object.freeze({normalizedKind:'NETWORK_INTERRUPTION',counts:false,confirmedProhibited:false,reason:'NETWORK_IS_NOT_RULE_BREACH'});
  return Object.freeze({normalizedKind:'CONTEXT_EVENT',counts:false,confirmedProhibited:false,reason:'NON_DEPARTURE_CONTEXT'});
}
function sessionConsequence({sessionProfile,confirmedDepartureCount=0}={}){
  const p=typeof sessionProfile==='string'?profile(sessionProfile):sessionProfile,count=Math.max(0,Number(confirmedDepartureCount)||0);
  if(!p.controlled)return Object.freeze({action:'CONTINUE',outcome:null});
  if(p.lockAt&&count>=p.lockAt)return Object.freeze({action:'LOCK',outcome:p.lockOutcome});
  if(p.warnAt&&count>=p.warnAt)return Object.freeze({action:'WARN',outcome:'FIRST_PROHIBITED_DEPARTURE_WARNING'});
  return Object.freeze({action:'CONTINUE',outcome:null});
}
function verificationRouteDecision({workStake='OPTIONAL',purpose='PRACTICE',assistanceMode='OPEN_LEARNING_ASSISTANCE',capabilityEvidence='NOT_REVIEWED',ruleAlignment='NOT_REVIEWED',confirmedDepartures=0,recurringUncertainty=false,highConsequence=false,activeFormalAssessment=false,systemHealthy=true}={}){
  if(!systemHealthy)return 'SYSTEM_DEFERRED';
  if(activeFormalAssessment)return 'VERIFY_POST_ATTEMPT';
  const unresolved=['UNRESOLVED','COMPROMISED','INVALID'].includes(String(capabilityEvidence).toUpperCase());
  const ruleConcern=['MISALIGNED','UNRESOLVED'].includes(String(ruleAlignment).toUpperCase())||Number(confirmedDepartures)>0;
  if(!unresolved&&!ruleConcern)return 'NO_VERIFICATION';
  if(recurringUncertainty)return 'VERIFY_NEXT_CLASS';
  const stake=String(workStake).toUpperCase(),purposeKey=String(purpose).toUpperCase(),mode=String(assistanceMode).toUpperCase();
  if(highConsequence)return 'VERIFY_NOW';
  if(stake==='GRADED'&&['CLOSED_BOOK_INDEPENDENT','REFERENCE_ONLY','HINT_ONLY'].includes(mode))return 'VERIFY_NOW';
  if(stake==='REMEDIATION'||stake==='PREPARATION')return 'VERIFY_NEXT_CLASS';
  if(stake==='OPTIONAL'&&['PRACTICE','RETRIEVAL','READING'].includes(purposeKey))return 'NO_VERIFICATION';
  if(mode==='CLOSED_BOOK_INDEPENDENT')return 'VERIFY_WITH_FRESH_EQUIVALENT_WORK';
  return 'NO_VERIFICATION';
}
function deriveAssignmentSessionProfile(assignment={}){
  const mode=String(assignment.assistance_mode||assignment.assistanceMode||'OPEN_LEARNING_ASSISTANCE').toUpperCase();
  const stake=String(assignment.work_stake||assignment.workStake||'OPTIONAL').toUpperCase();
  if(mode==='FORMAL_ASSESSMENT')return 'HIGH_STAKES_EXAM';
  if(mode==='CLOSED_BOOK_INDEPENDENT'&&stake==='GRADED')return 'CONTROLLED_TAKE_HOME';
  if(mode==='CLOSED_BOOK_INDEPENDENT')return 'INDEPENDENT_WORK';
  return 'OPEN_WORK';
}
function studentSafeSessionProjection(row={}){return Object.freeze({sessionId:row.integrity_session_id||row.sessionId,ownerType:row.owner_type||row.ownerType,ownerRef:row.owner_ref||row.ownerRef,profile:row.profile,status:row.status,confirmedDepartureCount:Number(row.confirmed_departure_count||0),warningIssuedAt:row.warning_issued_at||null,lockedAt:row.locked_at||null,lockOutcome:row.lock_outcome||null,policyVersion:row.policy_version||POLICY_VERSION,serverNow:new Date().toISOString(),rawTelemetryHidden:true,misconductVerdict:null,cheatingProbability:null});}
module.exports={POLICY_VERSION,SUBMISSION_GATE_POLICY_VERSION,SESSION_PROFILES,VERIFICATION_ROUTES,TIMER_CLASSES,profile,timingClass,normalizeRawEvent,departureDecision,sessionConsequence,verificationRouteDecision,deriveAssignmentSessionProfile,studentSafeSessionProjection,fail};
