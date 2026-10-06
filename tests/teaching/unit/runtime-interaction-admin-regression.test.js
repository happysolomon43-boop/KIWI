'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { schedulingRequest } = require('../../../teaching/d09/intelligence');
const { validateRequestForReview, decorateD10RequestExperience } = require('../../../teaching/d10/request-experience-service');
const { dedupeCourses, decorateCourseUniqueness } = require('../../../teaching/d07/course-uniqueness-service');
const { structuralSnapshot, representativeCases } = require('../../../teaching/admin-ai-diagnostics');
const { setActiveTeachingAIBoundary, getActiveTeachingAIBoundary } = require('../../../teaching/ai/runtime-bridge');

function d09Course() {
  return { course_id:'course-1', student_id:'student-1', state_version:4, lifecycle_state:'DRAFT', subject_snapshot_ref:'snapshot-1' };
}
function d09Context() {
  const course=d09Course();
  return {
    semester:{semester_id:'sem-1',timezone:'Africa/Lagos'},
    courses:[{
      course,
      plan:{course_plan_id:'plan-1',version_no:2},
      units:[{
        learning_unit_id:'lu-1', title:'Carbohydrates', intended_competence:'Explain carbohydrate structure and function.',
        criticality:'HIGH', foundational:true, instructional_load_min_minutes:0, instructional_load_max_minutes:0,
        metadata:{instructional_treatment:'FULL_INSTRUCTION'}, exit_conditions:[],
      }],
      dependencies:[],
    }],
  };
}

test('TPF-10 instructional-load estimation remains advisory rather than state-bearing', () => {
  const request=schedulingRequest({course:d09Course(),context:d09Context(),taskMode:'instructional_load_estimation'});
  assert.equal(request.declaredAuthorityLevel,'T2');
  assert.deepEqual(request.outputSchema.state_bearing_fields,[]);
  assert.equal(request.commit,false);
  assert.equal(request.directive.downstream_handoff.commit_owner_boundary,'Curriculum/Scheduler');
});

test('malformed availability is rejected before authoritative review', () => {
  assert.throws(() => validateRequestForReview({
    type:'PERMANENT_AVAILABILITY_CHANGE',
    requestedChange:{scheduleInputs:{
      semester:{semesterId:'sem-1',name:'Semester',startsAt:'2026-10-01T00:00:00.000Z',endsAt:'2026-12-01T00:00:00.000Z',timezone:'Africa/Lagos'},
      availability:[{dayOfWeek:1,startLocal:'15:30',endLocal:'12:00',kind:'AVAILABLE'}],
      blocks:[],deadlines:[],reserves:[],preferences:{},
    }},
  }), (error) => error?.code === 'TEACHING_D09_LOCAL_WINDOW_INVALID');
});

test('an already-stranded REVIEWING request is deterministically rejected instead of remaining stuck', async () => {
  let state='REVIEWING';
  let version=3;
  let rawDecision=null;
  const base={
    async getRequest(){return {requestId:'r1',type:'PERMANENT_AVAILABILITY_CHANGE',state,stateVersion:version,target:{owner:'scheduler'},requestedChange:{scheduleInputs:{semester:{semesterId:'sem-1',name:'Semester',startsAt:'2026-10-01T00:00:00.000Z',endsAt:'2026-12-01T00:00:00.000Z',timezone:'Africa/Lagos'},availability:[{dayOfWeek:1,startLocal:'15:30',endLocal:'12:00',kind:'AVAILABLE'}],blocks:[],deadlines:[],reserves:[],preferences:{}}},decision:rawDecision};},
    async submitRequest(){throw new Error('submit should not be needed for REVIEWING');},
    async reviewRequest(){throw new Error('base review must not see malformed REVIEWING input');},
  };
  const repository={
    async recordDecisionUsing(_tx,input){
      assert.equal(input.decisionState,'REJECTED');
      assert.equal(input.expectedVersion,3);
      state='REJECTED';version=4;rawDecision=input.decision;
      return {request_id:'r1',target_owner:'scheduler',lifecycle_state:state,state_version:version,decision:rawDecision};
    },
  };
  const transactionalMutation={async mutateAndPublish({mutate,buildEvent}){const mutationResult=await mutate({});const event=await buildEvent(mutationResult);assert.equal(event.payload.decision_state,'REJECTED');return {mutationResult,event};}};
  let n=0;
  const service=decorateD10RequestExperience(base,{repository,transactionalMutation,randomUUID:()=>`id-${++n}`,clock:()=>new Date('2026-10-06T00:30:00Z')});
  const result=await service.reviewRequest({id:'student-1'},'r1');
  assert.equal(result.state,'REJECTED');
  assert.equal(result.recoveredFromInvalidReview,true);
  assert.equal(result.decision.code,'TEACHING_D09_LOCAL_WINDOW_INVALID');
});

test('D07 exposes one canonical live course and refuses another live course for the same subject', async () => {
  const rows=[
    {course_id:'draft-new',subject_id:'subject-1',title:'Nutrition',lifecycle_state:'DRAFT',state_version:2,updated_at:'2026-10-06T00:00:00Z'},
    {course_id:'active',subject_id:'subject-1',title:'Nutrition',lifecycle_state:'ACTIVE',state_version:8,updated_at:'2026-10-05T22:00:00Z'},
    {course_id:'draft-old',subject_id:'subject-1',title:'Nutrition',lifecycle_state:'DRAFT',state_version:1,updated_at:'2026-10-05T20:00:00Z'},
  ];
  assert.deepEqual(dedupeCourses(rows).map((row)=>row.course_id),['active']);
  const decorated=decorateCourseUniqueness({async listCourses(){return rows;},async createCourse(){throw new Error('must not create');}});
  await assert.rejects(() => decorated.createCourse({id:'student-1'},{subjectId:'subject-1'}), (error) => error?.code==='TEACHING_D07_DUPLICATE_COURSE' && error?.courseId==='active');
});

test('Admin Teaching diagnostic covers the frozen capability and family census structurally', () => {
  const snapshot=structuralSnapshot();
  assert.equal(snapshot.capabilityCount,170);
  assert.equal(snapshot.modelBackedCapabilityCount,148);
  assert.equal(snapshot.promptFamilyCount,20);
  const cases=representativeCases();
  assert.equal(cases.length,20);
  assert.equal(new Set(cases.map((item)=>item.familyId)).size,20);
});

test('Teaching runtime bridge exposes only an execution boundary', () => {
  const boundary={execute:async()=>({accepted:true})};
  assert.equal(setActiveTeachingAIBoundary(boundary),boundary);
  assert.equal(getActiveTeachingAIBoundary(),boundary);
});

test('Teaching interaction and Admin diagnostic clients are actually bootstrapped', () => {
  const root=path.resolve(__dirname,'../../..');
  const display=fs.readFileSync(path.join(root,'public/teaching-display.js'),'utf8');
  const runtime=fs.readFileSync(path.join(root,'public/kiwi-runtime-config.js'),'utf8');
  const interaction=fs.readFileSync(path.join(root,'public/teaching-interaction-system.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/teaching-ui-system.css'),'utf8');
  const admin=fs.readFileSync(path.join(root,'public/admin-teaching-ai-diagnostics.js'),'utf8');
  assert.match(display,/teaching-interaction-system\.js/);
  assert.match(runtime,/admin-teaching-ai-diagnostics\.js/);
  assert.match(interaction,/data-kiwi-busy/);
  assert.match(interaction,/Syne/);
  assert.match(interaction,/kiwi\.teaching\.location\.v1/);
  assert.doesNotMatch(interaction,/teachingActivityChip/);
  assert.doesNotMatch(interaction,/Loading Teaching data/);
  assert.match(interaction,/finally\{endForButton\(triggerButton\);\}/);
  assert.match(ui,/\.teaching-d08-link-button\s*\{[\s\S]*appearance:none/);
  assert.match(ui,/button\.teaching-course-feature-card\s*\{[\s\S]*appearance:none/);
  assert.match(admin,/Running in background/);
  assert.match(admin,/20 frozen Teaching prompt family|frozen Teaching prompt family|totalFamilies/);
});
