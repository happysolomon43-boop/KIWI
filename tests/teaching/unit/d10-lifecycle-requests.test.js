'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  assertCourseTransition,assertRequestTransition,admissionCountsState,requestDefinition,
  normalizeRequestedChange,ADMISSION_POLICY,DEFAULT_GRADING_POLICY,
}=require('../../../teaching/d10/contracts');
const {createD10LifecycleRequestRepository}=require('../../../teaching/repositories/d10-lifecycle-requests');

test('D10 Course lifecycle preserves recoverable Incomplete and forbids collapsed shortcuts',()=>{
  assert.deepEqual(assertCourseTransition('DRAFT','READY'),{from:'DRAFT',to:'READY'});
  assert.deepEqual(assertCourseTransition('FINALIZING','INCOMPLETE'),{from:'FINALIZING',to:'INCOMPLETE'});
  assert.deepEqual(assertCourseTransition('INCOMPLETE','FINALIZING'),{from:'INCOMPLETE',to:'FINALIZING'});
  assert.throws(()=>assertCourseTransition('ACTIVE','COMPLETED'),{code:'TEACHING_D10_COURSE_TRANSITION_INVALID'});
  assert.throws(()=>assertCourseTransition('INCOMPLETE','ARCHIVED'),{code:'TEACHING_D10_COURSE_TRANSITION_INVALID'});
});

test('D10 Request lifecycle requires decision and acceptance boundaries',()=>{
  assert.deepEqual(assertRequestTransition('DRAFT','SUBMITTED'),{from:'DRAFT',to:'SUBMITTED'});
  assert.deepEqual(assertRequestTransition('REVIEWING','ALTERNATIVE_PROPOSED'),{from:'REVIEWING',to:'ALTERNATIVE_PROPOSED'});
  assert.deepEqual(assertRequestTransition('ALTERNATIVE_PROPOSED','APPROVED_WITH_ADJUSTMENT'),{from:'ALTERNATIVE_PROPOSED',to:'APPROVED_WITH_ADJUSTMENT'});
  assert.throws(()=>assertRequestTransition('DRAFT','APPLIED'),{code:'TEACHING_D10_REQUEST_TRANSITION_INVALID'});
  assert.throws(()=>assertRequestTransition('ALTERNATIVE_PROPOSED','APPLIED'),{code:'TEACHING_D10_REQUEST_TRANSITION_INVALID'});
});

test('D10 four-Course admission is policy, not schema maximum, and closed Incomplete releases capacity',()=>{
  assert.equal(ADMISSION_POLICY.maximumConcurrentCourses,4);
  assert.equal(ADMISSION_POLICY.schemaMaximum,false);
  assert.equal(ADMISSION_POLICY.oneStudentIdentity,true);
  for(const state of ['READY','ACTIVE','PAUSED','INCOMPLETE']) assert.equal(admissionCountsState(state),true,state);
  for(const state of ['DRAFT','COMPLETED','ARCHIVED']) assert.equal(admissionCountsState(state),false,state);
  assert.equal(admissionCountsState('INCOMPLETE',{hasIncompleteClosure:true}),false);
});

test('D10 default grading declaration matches frozen starting weights without taking Gradebook authority',()=>{
  const total=Object.values(DEFAULT_GRADING_POLICY.categoryWeights).reduce((sum,value)=>sum+value,0);
  assert.ok(Math.abs(total-1)<1e-9);
  assert.equal(DEFAULT_GRADING_POLICY.categoryWeights.CLASSWORK,0.10);
  assert.equal(DEFAULT_GRADING_POLICY.categoryWeights.HOMEWORK,0.05);
  assert.equal(DEFAULT_GRADING_POLICY.categoryWeights.GRADED_IMPROMPTU,0.10);
  assert.equal(DEFAULT_GRADING_POLICY.categoryWeights.SCHEDULED_TESTS,0.15);
  assert.equal(DEFAULT_GRADING_POLICY.categoryWeights.MID_SEMESTER,0.20);
  assert.equal(DEFAULT_GRADING_POLICY.categoryWeights.FINAL_EXAMINATION,0.40);
  assert.equal(DEFAULT_GRADING_POLICY.rules.calculationOwner,'GRADEBOOK_D20');
});

test('D10 Reduced Load Week fails closed while release decision remains unresolved',()=>{
  assert.throws(()=>requestDefinition('REDUCED_LOAD_WEEK'),{code:'TEACHING_D10_REDUCED_LOAD_WEEK_NOT_RETAINED'});
});

test('D10 emergency absence requires no proof and cannot create automatic behavior penalty',()=>{
  const change=normalizeRequestedChange('EMERGENCY_ABSENCE',{classId:'class-1',note:'Emergency'});
  assert.equal(change.classId,'class-1');
  assert.equal(change.proofRequired,false);
  assert.equal(change.behaviorPenaltyAutomatic,false);
});

function requestRepositoryHarness({state='APPROVED',studentResponse=null,effectiveAt=null}={}){
  let sequence=0,targetCalls=0;
  let request={
    request_id:'r1',student_id:'u1',course_id:'c1',request_type:'COURSE_PAUSE',requester_type:'STUDENT',requester_id:'u1',
    target_owner:'course_lifecycle',target_type:'COURSE',target_ref:'c1',target_version_ref:'course-state:2',
    lifecycle_state:state,state_version:3,requested_change:{reason:'pause'},explanation:null,decision:{code:'APPROVED'},
    effective_at:effectiveAt,alternative_proposal:null,alternative_version:null,student_response:studentResponse,application_ref:null,
  };
  const applications=[];
  async function query(sql,params=[]){
    const compact=String(sql).replace(/\s+/g,' ').trim();
    if(compact.includes('select * from public.teaching_requests')&&compact.includes('for update')) return {rows:[{...request}]};
    if(compact.includes('select * from public.teaching_request_applications')) return {rows:applications.map((x)=>({...x}))};
    if(compact.startsWith('insert into public.teaching_request_applications')){
      const row={request_application_id:params[0],student_id:params[1],request_id:params[2],request_version:params[3],
        target_owner:params[4],target_ref:params[5],target_version_before:params[6],target_version_after:params[7],
        application_ref:params[8],applied_at:params[9],safe_metadata:JSON.parse(params[10])};
      applications.push(row);return {rows:[{...row}],rowCount:1};
    }
    if(compact.includes("update public.teaching_requests set lifecycle_state='APPLIED'")){
      request={...request,lifecycle_state:'APPLIED',state_version:request.state_version+1,application_ref:params[2],applied_at:params[3]};return {rows:[{...request}],rowCount:1};
    }
    if(compact.includes("update public.teaching_requests set lifecycle_state='CLOSED'")){
      request={...request,lifecycle_state:'CLOSED',state_version:request.state_version+1,close_reason:'APPLIED',closed_at:params[2]};return {rows:[{...request}],rowCount:1};
    }
    if(compact.startsWith('insert into public.teaching_request_history')) return {rows:[],rowCount:1};
    if(compact.startsWith('insert into public.teaching_academic_audit_log')) return {rows:[],rowCount:1};
    throw new Error('Unexpected SQL in D10 harness: '+compact);
  }
  const repository=createD10LifecycleRequestRepository({
    query,withTransaction:async(fn)=>fn({query}),randomUUID:()=> 'id-'+(++sequence),clock:()=>new Date('2026-09-29T07:00:00Z'),
  });
  return {
    repository,
    async apply(){
      return repository.applyRequest({
        studentId:'u1',requestId:'r1',expectedVersion:3,
        applyTargetUsing:async()=>{targetCalls+=1;return {targetVersionAfter:'course-state:3',safeMetadata:{owner:'course_lifecycle'}};},
      });
    },
    targetCalls:()=>targetCalls,
    applications:()=>applications,
  };
}

test('D10 approved Request applies authoritative target exactly once across replay',async()=>{
  const h=requestRepositoryHarness();
  const first=await h.apply();
  assert.equal(first.idempotent,false);
  assert.equal(first.request.lifecycle_state,'CLOSED');
  assert.equal(h.targetCalls(),1);
  assert.equal(h.applications().length,1);
  const second=await h.repository.applyRequest({
    studentId:'u1',requestId:'r1',
    applyTargetUsing:async()=>{throw new Error('target must not run on replay');},
  });
  assert.equal(second.idempotent,true);
  assert.equal(h.targetCalls(),1);
  assert.equal(h.applications().length,1);
});

test('D10 adjusted Request cannot mutate before explicit acceptance',async()=>{
  const h=requestRepositoryHarness({state:'APPROVED_WITH_ADJUSTMENT',studentResponse:null});
  await assert.rejects(()=>h.apply(),{code:'TEACHING_D10_ALTERNATIVE_ACCEPTANCE_REQUIRED'});
  assert.equal(h.targetCalls(),0);
  assert.equal(h.applications().length,0);
});

test('D10 server time blocks early effective-time mutation',async()=>{
  const h=requestRepositoryHarness({effectiveAt:'2026-09-29T09:00:00Z'});
  await assert.rejects(()=>h.apply(),{code:'TEACHING_D10_REQUEST_NOT_EFFECTIVE_YET'});
  assert.equal(h.targetCalls(),0);
});

test('D10 source keeps lifecycle, overlay and progression axes separate and future owners as handoffs',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'../../../migrations/20260929_teaching_d10_course_lifecycle_requests.sql'),'utf8');
  const service=fs.readFileSync(path.join(__dirname,'../../../teaching/d10/service.js'),'utf8');
  assert.match(migration,/status_overlays text\[\]/);
  assert.match(migration,/progression_outcome text/);
  assert.match(service,/ownerHandoffPending/);
  assert.match(service,/learningRecoveryHandoffRequired:true/);
  assert.doesNotMatch(service,/@google\/generative-ai|anthropic|gemini-|openai/i);
});
