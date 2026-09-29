'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  assertCourseTransition,assertRequestTransition,admissionCountsState,requestDefinition,
  DEFAULT_GRADING_POLICY,ADMISSION_POLICY,
}=require('../../../teaching/d10/contracts');
const {createD10Service}=require('../../../teaching/d10/service');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');

function facts(state='READY'){
  return {
    course:{course_id:'c1',title:'Math',lifecycle_state:state,state_version:2,status_overlays:[],progression_outcome:null,subject_snapshot_ref:'snap'},
    semester:{semester_id:'s1',name:'Term',starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-12-01T00:00:00Z',timezone:'UTC',state_version:1},
    plan:{course_plan_id:'p1',version_no:1,scope_version_no:1,plan_state:'REVIEW_READY',source_snapshot_ref:'snap'},
    coverageAudit:{coverage_audit_id:'ca1',outcome:'PASS'},
    diagnostic:{resolved:true},
    coverage:{allowed:true,blockers:[]},
    timetable:{timetable_version_id:'tt1',version_no:1,timetable_state:'PROPOSED'},
    feasibility:{outcome:'FEASIBLE',evaluated_at:'2026-09-29T07:00:00Z',reasons:[],alternatives:[],headroom_policy_version:'recovery-headroom.v1'},
    gradingPolicy:{grading_policy_id:'gp1',version_no:1,policy_kind:'KIWI_DEFAULT',policy_version_ref:'kiwi-default-grading.v1',category_weights:DEFAULT_GRADING_POLICY.categoryWeights,locked_at:null},
    teacherAssignment:{teacher_assignment_id:'ta1',version_no:1,teacher_identity_id:'teacher1',display_name:'KIWI Teacher',style_envelope_version:'d10-deterministic-shell.v1',teacher_active:true},
    admission:{policy:{policy_version:'four-course-launch.v1',maximum_concurrent_courses:4},counted:[],allowed:true},
    blockers:[],
  };
}

test('D10 canonical Course lifecycle accepts only defined transitions and keeps Incomplete recoverable',()=>{
  assert.deepEqual(assertCourseTransition('DRAFT','READY'),{from:'DRAFT',to:'READY'});
  assert.deepEqual(assertCourseTransition('ACTIVE','PAUSED'),{from:'ACTIVE',to:'PAUSED'});
  assert.deepEqual(assertCourseTransition('PAUSED','ACTIVE'),{from:'PAUSED',to:'ACTIVE'});
  assert.deepEqual(assertCourseTransition('FINALIZING','INCOMPLETE'),{from:'FINALIZING',to:'INCOMPLETE'});
  assert.deepEqual(assertCourseTransition('INCOMPLETE','FINALIZING'),{from:'INCOMPLETE',to:'FINALIZING'});
  assert.throws(()=>assertCourseTransition('INCOMPLETE','ARCHIVED'),{code:'TEACHING_D10_COURSE_TRANSITION_INVALID'});
  assert.throws(()=>assertCourseTransition('ACTIVE','COMPLETED'),{code:'TEACHING_D10_COURSE_TRANSITION_INVALID'});
});

test('D10 Request lifecycle prevents alternative or rejected state from jumping to application',()=>{
  assert.deepEqual(assertRequestTransition('DRAFT','SUBMITTED'),{from:'DRAFT',to:'SUBMITTED'});
  assert.deepEqual(assertRequestTransition('REVIEWING','ALTERNATIVE_PROPOSED'),{from:'REVIEWING',to:'ALTERNATIVE_PROPOSED'});
  assert.deepEqual(assertRequestTransition('ALTERNATIVE_PROPOSED','APPROVED_WITH_ADJUSTMENT'),{from:'ALTERNATIVE_PROPOSED',to:'APPROVED_WITH_ADJUSTMENT'});
  assert.throws(()=>assertRequestTransition('ALTERNATIVE_PROPOSED','APPLIED'),{code:'TEACHING_D10_REQUEST_TRANSITION_INVALID'});
  assert.throws(()=>assertRequestTransition('REJECTED','APPLIED'),{code:'TEACHING_D10_REQUEST_TRANSITION_INVALID'});
  assert.throws(()=>assertRequestTransition('WITHDRAWN','APPLIED'),{code:'TEACHING_D10_REQUEST_TRANSITION_INVALID'});
});

test('D10 four-Course launch policy counts canonical lifecycle states without becoming a schema cap',()=>{
  for(const state of ['READY','ACTIVE','PAUSED','INCOMPLETE']) assert.equal(admissionCountsState(state),true,state);
  for(const state of ['DRAFT','COMPLETED','ARCHIVED']) assert.equal(admissionCountsState(state),false,state);
  assert.equal(admissionCountsState('INCOMPLETE',{hasIncompleteClosure:true}),false);
  assert.equal(ADMISSION_POLICY.maximumConcurrentCourses,4);
  assert.equal(ADMISSION_POLICY.schemaMaximum,false);
  assert.equal(ADMISSION_POLICY.oneStudentIdentity,true);
});

test('D10 explicitly does not invent Reduced Load Week release policy',()=>{
  assert.throws(()=>requestDefinition('REDUCED_LOAD_WEEK'),{code:'TEACHING_D10_REDUCED_LOAD_WEEK_NOT_RETAINED'});
});

test('D10 default grading declaration uses the frozen Blueprint weights while D20 remains calculation owner',()=>{
  const total=Object.values(DEFAULT_GRADING_POLICY.categoryWeights).reduce((sum,n)=>sum+n,0);
  assert.equal(total,1);
  assert.deepEqual(DEFAULT_GRADING_POLICY.categoryWeights,{CLASSWORK:.10,HOMEWORK:.05,GRADED_IMPROMPTU:.10,SCHEDULED_TESTS:.15,MID_SEMESTER:.20,FINAL_EXAMINATION:.40});
  assert.equal(DEFAULT_GRADING_POLICY.rules.calculationOwner,'GRADEBOOK_D20');
});

test('D10 Course activation publishes COURSE_ACTIVATED through the D05 transactional mutation boundary',async()=>{
  let event=null,mutationCalls=0;
  const repository={
    async getActivationFacts(){return facts('READY');},
    async activateCourseUsing(_tx,input){mutationCalls+=1;assert.equal(input.studentId,'u1');return {
      course:{course_id:'c1',state_version:3},activationId:'a1',activatedAt:new Date('2026-09-29T07:30:00Z'),
      schedule:{timetable:{timetable_version_id:'tt1',version_no:1}},
      facts:{plan:{course_plan_id:'p1'}},
    };},
  };
  const transactionalMutation={async mutateAndPublish({mutate,buildEvent}){const result=await mutate({query(){}});event=buildEvent(result);return {mutationResult:result};}};
  const service=createD10Service({repository,d09Repository:{},transactionalMutation,randomUUID:()=> '00000000-0000-4000-8000-000000000001',clock:()=>new Date('2026-09-29T07:30:00Z')});
  const review=await service.activateCourse({id:'u1'},'c1');
  assert.equal(mutationCalls,1);
  assert.equal(event.eventType,TEACHING_EVENTS.COURSE_ACTIVATED);
  assert.equal(event.eventCategory,'committed_domain_event');
  assert.equal(event.aggregateId,'c1');
  assert.equal(event.aggregateVersion,3);
  assert.equal(review.course.lifecycleState,'READY');
});

test('D10 emergency absence fast path requires no proof and never creates automatic behavior penalty',async()=>{
  let current={request_id:'r1',student_id:'u1',course_id:'c1',request_type:'EMERGENCY_ABSENCE',requester_type:'STUDENT',target_owner:'attendance',target_type:'CLASS',target_ref:'cl1',target_version_ref:'class-schedule:1',lifecycle_state:'DRAFT',state_version:1,requested_change:{classId:'cl1',proofRequired:false,behaviorPenaltyAutomatic:false},created_at:'2026-09-29T07:00:00Z',updated_at:'2026-09-29T07:00:00Z'};
  const repository={
    async createRequest(){return current;},
    async transitionRequest({toState}){current={...current,lifecycle_state:toState,state_version:current.state_version+1};return current;},
    async getRequest(){return {request:current,history:[]};},
    async recordDecisionUsing(_tx,{decisionState,decision}){current={...current,lifecycle_state:decisionState,state_version:current.state_version+1,decision};return current;},
  };
  const transactionalMutation={async mutateAndPublish({mutate,buildEvent}){const result=await mutate({query(){}});buildEvent(result);return {mutationResult:result};}};
  const service=createD10Service({repository,d09Repository:{},transactionalMutation,randomUUID:()=> '00000000-0000-4000-8000-000000000002',clock:()=>new Date('2026-09-29T07:30:00Z')});
  const out=await service.createRequest({id:'u1'},{type:'EMERGENCY_ABSENCE',courseId:'c1',requestedChange:{classId:'cl1',note:'Emergency'}});
  assert.equal(out.state,'APPROVED');
  assert.equal(out.decision.proofRequired,false);
  assert.equal(out.decision.behaviorPenaltyAutomatic,false);
  assert.equal(out.requiresFutureOwner,true);
});

test('D10 persistence enforces exactly one application per Request, RLS and separate Course axes',()=>{
  const sql=fs.readFileSync(path.resolve(__dirname,'../../../migrations/20260929_teaching_d10_course_lifecycle_requests.sql'),'utf8');
  for(const name of ['teaching_requests','teaching_request_history','teaching_request_applications','teaching_course_activations','teaching_course_lifecycle_history','teaching_course_admission_decisions']) assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS public\\.'+name));
  assert.match(sql,/request_id text NOT NULL UNIQUE REFERENCES public\.teaching_requests/);
  assert.match(sql,/status_overlays text\[\]/);
  assert.match(sql,/progression_outcome text/);
  assert.match(sql,/teaching_guard_d10_course_lifecycle/);
  assert.match(sql,/teaching_guard_d10_request_update/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE INSERT,UPDATE,DELETE,TRUNCATE[\s\S]*FROM authenticated,anon,public/);
  assert.doesNotMatch(sql,/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,160}TO\s+authenticated/i);
});

test('D10 repository short-circuits application replay before target mutation and revalidates state/version',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d10-lifecycle-requests.js'),'utf8');
  assert.match(src,/select \* from public\.teaching_request_applications where student_id=\$1 and request_id=\$2/);
  assert.match(src,/if\(existingApps\?\.\[0\]\) return \{request:current,application:existingApps\[0\],idempotent:true\}/);
  assert.match(src,/TEACHING_D10_REQUEST_STALE/);
  assert.match(src,/ALTERNATIVE_ACCEPTANCE_REQUIRED/);
  assert.match(src,/REQUEST_NOT_EFFECTIVE_YET/);
});

test('D10 post-activation UI removes direct timetable authority and exposes one Request Center/context contract',()=>{
  const d09=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d09.js'),'utf8');
  const d10=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d10.js'),'utf8');
  const html=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching.html'),'utf8');
  assert.match(d09,/Request this availability change/);
  assert.match(d09,/Timetable locked after activation/);
  assert.match(d09,/Request new time/);
  assert.match(d09,/Emergency absence/);
  assert.match(d10,/id:'requests'/);
  assert.match(d10,/requestAssignmentExtension/);
  assert.match(d10,/requestEarlyDismissal/);
  assert.match(d10,/requestTeacherChange/);
  assert.match(d10,/ALTERNATIVE_PROPOSED/);
  assert.match(html,/<script type="module" src="\/teaching-d10\.js"><\/script>/);
  assert.doesNotMatch(html,/<\/script>\\n\s*<script type="module" src="\/teaching-d10\.js"/);
});

test('D10 design gate covers all three anchors without implementing D11 live controller',()=>{
  const design=fs.readFileSync(path.resolve(__dirname,'../../../docs/teaching/design/d10-first-three-anchor-mockups.md'),'utf8');
  for(const token of ['Teaching shell + Today anchor','Course Home anchor','Normal Live Classroom anchor','TCH-0578','TCH-0581']) assert.ok(design.includes(token),token);
  assert.match(design,/non-functional D10 mockup/);
});

test('D10 source does not select model providers or create future Gradebook, Attendance, SKM or Progression authority',()=>{
  const files=['teaching/d10/contracts.js','teaching/d10/service.js','teaching/d10/runtime.js','teaching/repositories/d10-lifecycle-requests.js'];
  const src=files.map((file)=>fs.readFileSync(path.resolve(__dirname,'../../..',file),'utf8')).join('\n');
  assert.doesNotMatch(src,/@google\/generative-ai|openai|anthropic|gemini-/i);
  assert.doesNotMatch(src,/insert into\s+public\.teaching_(gradebook|attendance|student_knowledge|progression)/i);
});
