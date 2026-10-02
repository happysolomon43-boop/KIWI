'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  profile,departureDecision,sessionConsequence,verificationRouteDecision,
  deriveAssignmentSessionProfile,studentSafeSessionProjection,
}=require('../../../services/integrity/contracts');
const {createIntegrityService}=require('../../../services/integrity/service');

const raw=(kind,extra={})=>({kind,observedAt:'2026-10-02T00:00:00.000Z',clientEventId:`evt-${kind}`,...extra});

test('controlled session warns on first confirmed prohibited departure and locks on second',()=>{
  const p=profile('SCHEDULED_TEST');
  const first=departureDecision({sessionProfile:p,rawEvent:raw('VISIBILITY_HIDDEN')});
  assert.equal(first.counts,true);
  assert.deepEqual(sessionConsequence({sessionProfile:p,confirmedDepartureCount:1}),{action:'WARN',outcome:'FIRST_PROHIBITED_DEPARTURE_WARNING'});
  assert.deepEqual(sessionConsequence({sessionProfile:p,confirmedDepartureCount:2}),{action:'LOCK',outcome:'LOCKED_FOR_REVIEW'});
});

test('network loss and duplicate departure signals never count as new prohibited departures',()=>{
  const p=profile('CONTROLLED_TAKE_HOME');
  assert.equal(departureDecision({sessionProfile:p,rawEvent:raw('NETWORK_LOST')}).counts,false);
  assert.equal(departureDecision({sessionProfile:p,rawEvent:raw('PAGEHIDE'),duplicate:true}).counts,false);
});

test('high-stakes exam second departure invalidates while scheduled test routes to review',()=>{
  assert.equal(sessionConsequence({sessionProfile:profile('HIGH_STAKES_EXAM'),confirmedDepartureCount:2}).outcome,'ATTEMPT_INVALIDATED_RULE_BREACH');
  assert.equal(sessionConsequence({sessionProfile:profile('SCHEDULED_TEST'),confirmedDepartureCount:2}).outcome,'LOCKED_FOR_REVIEW');
});

test('formal assessment authenticity verification is always post-attempt',()=>{
  assert.equal(verificationRouteDecision({activeFormalAssessment:true,systemHealthy:true,highConsequence:true}),'VERIFY_POST_ATTEMPT');
});

test('assignment profile derives controlled take-home only from graded closed-book independent work',()=>{
  assert.equal(deriveAssignmentSessionProfile({assistance_mode:'CLOSED_BOOK_INDEPENDENT',work_stake:'GRADED'}),'CONTROLLED_TAKE_HOME');
  assert.equal(deriveAssignmentSessionProfile({assistance_mode:'OPEN_LEARNING_ASSISTANCE',work_stake:'GRADED'}),'OPEN_WORK');
});

test('student session projection never exposes guilt or cheating probability',()=>{
  const value=studentSafeSessionProjection({integrity_session_id:'s1',owner_type:'KIWI_EXAM',owner_ref:'e1',profile:'SCHEDULED_TEST',status:'LOCKED',confirmed_departure_count:2,policy_version:'v1'});
  assert.equal(value.rawTelemetryHidden,true);
  assert.equal(value.misconductVerdict,null);
  assert.equal(value.cheatingProbability,null);
});

function baseRepository(overrides={}){
  return {
    createSession:async()=>({session:{},idempotent:false}),
    requireSession:async()=>null,
    recentDeparture:async()=>null,
    recordEvent:async()=>null,
    applySessionConsequence:async()=>null,
    findOpenVerificationSession:async()=>null,
    createVerificationSession:async()=>null,
    getVerificationSession:async()=>null,
    getVerificationItem:async()=>null,
    appendVerificationResponse:async()=>({response:{},idempotent:false}),
    completeVerificationSession:async()=>null,
    gateByAssignment:async()=>null,
    updateGate:async()=>null,
    createVerificationItem:async()=>null,
    startVerificationItem:async()=>null,
    ...overrides,
  };
}

test('scheduled-test lock creates a governed post-attempt verification handoff',async()=>{
  let created=null;
  const repository=baseRepository({
    requireSession:async()=>({integrity_session_id:'is1',owner_type:'KIWI_EXAM',owner_ref:'exam1',profile:'SCHEDULED_TEST',status:'ACTIVE',confirmed_departure_count:1,policy_version:'v1'}),
    recordEvent:async()=>({session:{integrity_session_id:'is1',owner_type:'KIWI_EXAM',owner_ref:'exam1',profile:'SCHEDULED_TEST',status:'ACTIVE',confirmed_departure_count:2,policy_version:'v1'},event:{normalized_kind:'CONFIRMED_PROHIBITED_DEPARTURE',counts_as_departure:true},effectiveDecision:{counts:true},idempotent:false}),
    applySessionConsequence:async()=>({integrity_session_id:'is1',owner_type:'KIWI_EXAM',owner_ref:'exam1',profile:'SCHEDULED_TEST',status:'LOCKED',confirmed_departure_count:2,policy_version:'v1',lock_outcome:'LOCKED_FOR_REVIEW'}),
    createVerificationSession:async(input)=>{created=input;return {verification_session_id:'v-post'};},
  });
  const service=createIntegrityService({repository,randomUUID:()=> 'r1'});
  const result=await service.recordEvent({id:'u1'},'is1',raw('PAGEHIDE'));
  assert.equal(result.action,'LOCK');
  assert.equal(result.verificationPending,true);
  assert.equal(result.verificationSessionId,'v-post');
  assert.equal(created.route,'VERIFY_POST_ATTEMPT');
  assert.equal(created.ownerType,'KIWI_EXAM');
});

test('failed Homework verification generates a fresh second check instead of declaring misconduct',async()=>{
  const updates=[];
  const repository=baseRepository({
    getVerificationSession:async()=>({verification_session_id:'vs1',owner_type:'TEACHING_ASSIGNMENT',owner_ref:'a1',source_ref:'receipt1',status:'ACTIVE',question_count:1,max_questions:3,target_capabilities:['cap1']}),
    getVerificationItem:async()=>({verification_item_id:'i1',verification_session_id:'vs1',sequence_no:1,prompt_payload:{prompt:'first'},target_capability:'cap1',expires_at:new Date(Date.now()+60000).toISOString()}),
    gateByAssignment:async()=>({submission_gate_id:'g1',verification_route:'VERIFY_NOW',reason_codes:[],verification_session_id:'vs1'}),
    createVerificationItem:async(input)=>({verification_item_id:'i2',verification_session_id:'vs1',sequence_no:input.sequenceNo,timing_class:input.timingClass,duration_seconds:input.durationSeconds,prompt_payload:input.promptPayload,target_capability:input.targetCapability}),
    startVerificationItem:async(_u,_i)=>({verification_item_id:'i2',verification_session_id:'vs1',sequence_no:2,timing_class:'SHORT_EXPLANATION',duration_seconds:30,prompt_payload:{prompt:'fresh second'},target_capability:'cap1',started_at:new Date().toISOString(),expires_at:new Date(Date.now()+30000).toISOString()}),
    updateGate:async(input)=>{updates.push(input);return input;},
  });
  const d16Repository={
    requireAssignment:async()=>({assignment_id:'a1',state_version:7,title:'Work',instructions:'Do it',purpose:'INDEPENDENT_EVIDENCE',response_kind:'GENERAL',learning_unit_refs:['cap1']}),
    latestSubmissionById:async()=>({assignment_submission_id:'receipt1',response_payload:{text:'original'}}),
  };
  const d16Intelligence={
    evaluateHomework:async()=>({accepted:true,validatedResult:{output:{criterion_results:[{id:'independent_capability_confirmation',satisfied:false}],learning_evidence:{}}}}),
    generateVerificationTask:async()=>({accepted:true,validatedResult:{output:{verification_task:{prompt:'fresh second',response_kind:'SHORT_TEXT'},target_capability:'cap1',allowed_resources:[]}}}),
  };
  const service=createIntegrityService({repository,d16Repository,d16Intelligence,randomUUID:()=> 'r2'});
  const result=await service.submitVerificationResponse({id:'u1'},'vs1','i1',{response:{text:'answer'},idempotencyKey:'resp1'});
  assert.equal(result.status,'ACTIVE');
  assert.equal(result.questionNumber,2);
  assert.equal(result.studentMayLeave,false);
  assert.equal(result.priorMisconductProven,false);
  assert.ok(updates.some((entry)=>entry.state==='VERIFICATION_ACTIVE'));
});

test('third failed Homework verification resolves as review-needed, not misconduct',async()=>{
  let completion=null,gateUpdate=null;
  const repository=baseRepository({
    getVerificationSession:async()=>({verification_session_id:'vs3',owner_type:'TEACHING_ASSIGNMENT',owner_ref:'a1',source_ref:'receipt1',status:'ACTIVE',question_count:3,max_questions:3,target_capabilities:['cap1']}),
    getVerificationItem:async()=>({verification_item_id:'i3',verification_session_id:'vs3',sequence_no:3,prompt_payload:{prompt:'third'},target_capability:'cap1',expires_at:new Date(Date.now()+60000).toISOString()}),
    gateByAssignment:async()=>({submission_gate_id:'g3',verification_route:'VERIFY_NOW',reason_codes:[],verification_session_id:'vs3'}),
    completeVerificationSession:async(input)=>{completion=input;return input;},
    updateGate:async(input)=>{gateUpdate=input;return input;},
  });
  const d16Intelligence={evaluateHomework:async()=>({accepted:true,validatedResult:{output:{criterion_results:[{satisfied:false}],learning_evidence:{}}}})};
  const service=createIntegrityService({repository,d16Repository:{},d16Intelligence,randomUUID:()=> 'r3'});
  const result=await service.submitVerificationResponse({id:'u1'},'vs3','i3',{response:{text:'answer'},idempotencyKey:'resp3'});
  assert.equal(result.status,'REVIEW_NEEDED');
  assert.equal(result.capabilityEvidence,'UNRESOLVED');
  assert.equal(result.priorMisconductProven,false);
  assert.equal(completion.status,'REVIEW_NEEDED');
  assert.equal(gateUpdate.state,'UNRESOLVED');
});

test('amendment source keeps Exam lock server-side and removes first-pagehide auto-forfeit',()=>{
  const root=path.resolve(__dirname,'../../..');
  const backend=fs.readFileSync(path.join(root,'index.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const repo=fs.readFileSync(path.join(root,'services/integrity/repository.js'),'utf8');
  assert.match(backend,/function respondToLockedExamMutation/);
  assert.match(backend,/EXAM_INTEGRITY_SESSION_LOCKED/);
  assert.match(backend,/EXAM_INTEGRITY_ATTEMPT_INVALIDATED/);
  assert.match(repo,/verification_pending=\(\$5 in \('LOCKED_FOR_REVIEW','POST_ATTEMPT_VERIFICATION_REQUIRED'\)\)/);
  assert.match(repo,/where\.push\(`route=\$\$\{params\.length\}`\)/);
  assert.match(html,/Integrity Session Guard owns exam integrity activation/);
  assert.match(html,/kiwi:exam-ended/);
  assert.doesNotMatch(html,/_startExamIntegrityGuard/);
  assert.doesNotMatch(html,/_renderIntegrityExamLock/);
  assert.doesNotMatch(html,/KIWIIntegritySessionGuard\.activate/);
  assert.doesNotMatch(html,/KIWIIntegritySessionGuard\.deactivate/);
  assert.doesNotMatch(html,/pagehide — fires after the user confirms leaving[\s\S]{0,900}\/forfeit/);
});
