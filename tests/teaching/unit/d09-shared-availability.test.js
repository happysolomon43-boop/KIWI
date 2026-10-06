'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createD09Service}=require('../../../teaching/d09/service');

function semester(){return {semester_id:'sem1',name:'Term 1',state_version:1,starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-10-31T23:59:59Z',timezone:'UTC'};}
function availability(day=1,start='09:00',end='12:00'){return [{day_of_week:day,local_start:start,local_end:end,kind:'AVAILABLE',preference_weight:0}];}
function bundle(id,state='DRAFT'){
  return {
    course:{course_id:id,title:id,state_version:1,subject_snapshot_ref:'snap',lifecycle_state:state,semester_id:'sem1'},
    plan:{course_plan_id:id+'-p',version_no:1,plan_state:'REVIEW_READY',source_snapshot_ref:'snap'},
    units:[{learning_unit_id:id+'-u1',title:'Unit',instructional_load_min_minutes:60,instructional_load_max_minutes:60,metadata:{instructional_treatment:'FULL_INSTRUCTION'}}],
    dependencies:[],coverage:[],scopeChanges:[],semesterTimezone:'UTC',
  };
}
function context(courses=[bundle('c1')]){
  return {
    course:{course_id:'c1',title:'c1',lifecycle_state:'DRAFT',state_version:1,semester_id:'sem1'},
    semester:semester(),
    profile:{profile_id:'sp1',version_no:1,semester_state_version:1,preferences:{},settings:{horizon:{imminentDays:7,concreteDays:28}}},
    availability:availability(),blocks:[],deadlines:[],reserves:[],courses,unresolvedCourses:[],priorSlots:[],inheritedDefault:false,
  };
}
let seq=0;
function nextId(){seq+=1;return '00000000-0000-4000-8000-'+String(seq).padStart(12,'0');}

test('shared availability save automatically recalculates the Semester timetable',async()=>{
  let mutationCalls=0,proposalCalls=0,contextReads=0;
  const scheduledContext=context();
  const repository={
    async getSchedulingContext(){contextReads+=1;return scheduledContext;},
    async saveScheduleInputsUsing(){return {semester:scheduledContext.semester,profile:scheduledContext.profile,ppl:{isNew:false,workspaceId:'w1',workspaceVersion:2,changedRefs:['schedule-profile:sp1'],targetEffectiveAt:scheduledContext.semester.ends_at}};},
    async saveProposalUsing(_tx,{result,source}){proposalCalls+=1;assert.equal(source,'AVAILABILITY_AUTO_RECALC');return {timetable:{timetable_version_id:'tt2'},slots:[],feasibility:{outcome:result.outcome},ppl:{isNew:false,workspaceId:'w1',workspaceVersion:3,changedRefs:['timetable:tt2'],targetEffectiveAt:scheduledContext.semester.ends_at}};},
    async getScheduleReview(){return {...scheduledContext,timetable:{timetable_version_id:'tt2',version_no:2,timetable_state:'PROPOSED',source_kind:'AVAILABILITY_AUTO_RECALC',created_at:'2026-10-01T00:00:00Z'},slots:[],feasibility:{outcome:'FEASIBLE',evaluated_at:'2026-10-01T00:00:00Z',capacity_metrics:{},reasons:[],alternatives:[],headroom_policy_version:'recovery-headroom.v1'},debtMinutes:0};},
    async listSemesters(){return [];},
  };
  const transactionalMutation={async mutateAndPublish({mutate,buildEvent}){mutationCalls+=1;const result=await mutate({});buildEvent(result);return {mutationResult:result};}};
  const service=createD09Service({repository,transactionalMutation,randomUUID:nextId,clock:()=>new Date('2026-09-29T04:00:00Z')});
  const review=await service.saveScheduleInputs({id:'u1'},'c1',{
    semester:{semesterId:'sem1',name:'Term 1',startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-10-31T23:59:59Z',timezone:'UTC'},
    availability:[{dayOfWeek:1,startLocal:'09:00',endLocal:'12:00',kind:'AVAILABLE'}],
    blocks:[],deadlines:[],reserves:[],preferences:{},
  });
  assert.equal(contextReads,2);
  assert.equal(mutationCalls,2);
  assert.equal(proposalCalls,1);
  assert.equal(review.timetable.sourceKind,'AVAILABILITY_AUTO_RECALC');
});

test('active Semester shared-availability changes require the formal Request path',async()=>{
  const before=context([bundle('active','ACTIVE')]);
  before.course={course_id:'draft',title:'draft',lifecycle_state:'DRAFT',state_version:1,semester_id:null};
  before.inheritedDefault=true;
  const repository={async getSchedulingContext(){return before;},async listSemesters(){return [];}};
  const transactionalMutation={async mutateAndPublish(){throw new Error('must not mutate');}};
  const service=createD09Service({repository,transactionalMutation,randomUUID:nextId,clock:()=>new Date('2026-09-29T04:00:00Z')});
  await assert.rejects(()=>service.saveScheduleInputs({id:'u1'},'draft',{
    semester:{semesterId:'sem1',name:'Term 1',startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-10-31T23:59:59Z',timezone:'UTC'},
    availability:[{dayOfWeek:2,startLocal:'10:00',endLocal:'13:00',kind:'AVAILABLE'}],
    blocks:[],deadlines:[],reserves:[],preferences:{},
  }),{code:'TEACHING_D09_ACTIVE_SEMESTER_AVAILABILITY_REQUIRES_REQUEST'});
});

test('repository and UI expose one Semester-global availability default to unattached Courses',()=>{
  const repository=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d09-scheduling.js'),'utf8');
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d09.js'),'utf8');
  assert.match(repository,/latestDefaultSemester/);
  assert.match(repository,/COURSE_NOT_ATTACHED_TO_DEFAULT_SEMESTER/);
  assert.match(repository,/inheritedDefault/);
  assert.match(ui,/shared across the Semester/);
  assert.match(ui,/Using your current Semester availability as the default/);
  assert.match(ui,/recalculate the timetable automatically/);
});
