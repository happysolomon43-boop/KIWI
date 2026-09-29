'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  zonedLocalToInstant,computeSchedule,validateEditedSchedule,projectCalendarSlot,
}=require('../../../teaching/d09/scheduler');
const {normalizeScheduleInputs,headroomPolicy}=require('../../../teaching/d09/contracts');
const {schedulingRequest}=require('../../../teaching/d09/intelligence');
const {createD09Service}=require('../../../teaching/d09/service');

function semester(){return {semester_id:'sem1',state_version:1,starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-10-31T23:59:59Z',timezone:'UTC'};}
function availability(days=[1,2,3,4,5],start='09:00',end='12:00'){return days.map((day)=>({day_of_week:day,local_start:start,local_end:end,kind:'AVAILABLE',preference_weight:0}));}
function bundle(id,unitCount=4,minutes=60){
  const units=Array.from({length:unitCount},(_,i)=>({
    learning_unit_id:id+'-u'+(i+1),title:'Unit '+(i+1),instructional_load_min_minutes:minutes,
    instructional_load_max_minutes:minutes,metadata:{instructional_treatment:'FULL_INSTRUCTION'},
  }));
  return {course:{course_id:id,title:id,state_version:1,subject_snapshot_ref:'snap',lifecycle_state:'DRAFT'},
    plan:{course_plan_id:id+'-p',version_no:1,plan_state:'REVIEW_READY',source_snapshot_ref:'snap'},
    units,dependencies:[],coverage:[],scopeChanges:[],semesterTimezone:'UTC'};
}
function context(courses=[bundle('c1')],opts={}){
  return {
    semester:semester(),profile:{profile_id:'sp1',version_no:1,preferences:{avoidConsecutiveSameCourseDays:true},settings:{horizon:{imminentDays:7,concreteDays:28}}},
    availability:opts.availability||availability(),blocks:opts.blocks||[],deadlines:opts.deadlines||[],reserves:opts.reserves||[],
    courses,unresolvedCourses:[],
  };
}

test('D09 normalizes Stage 4 hard/soft schedule input and uses frozen headroom policy',()=>{
  const normalized=normalizeScheduleInputs({
    semester:{name:'Term 1',startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-12-01T00:00:00Z',timezone:'Africa/Lagos'},
    availability:[
      {dayOfWeek:1,startLocal:'09:00',endLocal:'12:00',kind:'AVAILABLE',preferenceWeight:10},
      {dayOfWeek:6,startLocal:'10:00',endLocal:'12:00',kind:'RECOVERY_ONLY'},
      {dayOfWeek:3,startLocal:'13:00',endLocal:'14:00',kind:'HARD_UNAVAILABLE'},
    ],
    blocks:[{kind:'HOLIDAY',startsAt:'2026-10-10T00:00:00Z',endsAt:'2026-10-11T00:00:00Z'}],
    deadlines:[{kind:'HARD',deadlineAt:'2026-11-20T00:00:00Z'}],
    reserves:[{kind:'REVISION',minutes:120}],preferences:{preferredStartTimes:['09:00']},
  });
  assert.equal(normalized.semester.timezone,'Africa/Lagos');
  assert.equal(normalized.availability[2].kind,'HARD_UNAVAILABLE');
  assert.equal(headroomPolicy().targetRatio,0.20);
  assert.equal(headroomPolicy().minimumRatio,0.15);
});

test('D09 rejects DST-nonexistent local time and resolves ambiguous fall-back deterministically',()=>{
  assert.throws(()=>zonedLocalToInstant('2026-03-08','02:30','America/New_York'),{code:'TEACHING_D09_LOCAL_TIME_NONEXISTENT'});
  assert.equal(zonedLocalToInstant('2026-11-01','01:30','America/New_York'),'2026-11-01T05:30:00.000Z');
});

test('D09 schedules by instructional load with at most two full Classes per day and keeps required work',()=>{
  const result=computeSchedule(context([bundle('c1',10,60)]),{now:'2026-09-29T04:00:00Z'});
  assert.equal(result.outcome,'FEASIBLE');
  assert.equal(result.metrics.requiredMinutes,600);
  assert.equal(result.metrics.unscheduledMinutes,0);
  const byDay=new Map();
  for(const slot of result.schedule)byDay.set(slot.localDate,(byDay.get(slot.localDate)||0)+1);
  assert.ok([...byDay.values()].every((count)=>count<=2));
  assert.ok(byDay.size<15);
  assert.equal(result.policy.requiredContentMayBeDeleted,false);
});

test('D09 global Scheduler arbitrates four Courses while respecting the normal daily maximum',()=>{
  const result=computeSchedule(context([bundle('c1'),bundle('c2'),bundle('c3'),bundle('c4')]),{now:'2026-09-29T04:00:00Z'});
  assert.equal(result.metrics.courseCount,4);
  assert.equal(result.metrics.unscheduledMinutes,0);
  assert.equal(new Set(result.schedule.filter((s)=>s.kind==='CLASS').map((s)=>s.courseId)).size,4);
  const byDay=new Map();result.schedule.forEach((slot)=>byDay.set(slot.localDate,(byDay.get(slot.localDate)||0)+1));
  assert.ok([...byDay.values()].every((count)=>count<=2));
});

test('D09 eight-Course stress simulation surfaces infeasibility instead of deleting curriculum',()=>{
  const courses=Array.from({length:8},(_,i)=>bundle('c'+(i+1),8,120));
  const result=computeSchedule(context(courses,{availability:availability([1],'09:00','11:00')}),{now:'2026-09-29T04:00:00Z'});
  assert.equal(result.outcome,'INFEASIBLE');
  assert.ok(result.metrics.unscheduledMinutes>0);
  assert.ok(result.reasons.includes('REQUIRED_INSTRUCTIONAL_LOAD_UNSCHEDULED'));
  assert.ok(result.alternatives.some((a)=>a.code==='KEEP_REQUIRED_SCOPE_AND_SURFACE_INFEASIBILITY'));
});

test('D09 protected periods admit intended reserve work and reject unrelated edits',()=>{
  const ctx=context([bundle('c1',1,60)],{
    blocks:[{course_id:'c1',block_kind:'PROTECTED_ASSESSMENT',starts_at:'2026-10-05T09:00:00Z',ends_at:'2026-10-05T12:00:00Z'}],
    reserves:[{course_id:'c1',reserve_kind:'ASSESSMENT',minutes:60}],
  });
  const initial=computeSchedule(ctx,{now:'2026-09-29T04:00:00Z'});
  assert.ok(initial.schedule.some((s)=>s.kind==='ASSESSMENT_RESERVE'));
  assert.throws(()=>validateEditedSchedule(ctx,[{
    timetable_slot_id:'s1',course_id:'c1',slot_kind:'CLASS',starts_at:'2026-10-05T09:00:00Z',
    ends_at:'2026-10-05T10:00:00Z',timezone:'UTC',learning_unit_refs:['c1-u1'],rationale:'test',
  }],[{slotId:'s1',startsAt:'2026-10-05T09:30:00Z',endsAt:'2026-10-05T10:30:00Z'}]),{code:'TEACHING_D09_HARD_CONSTRAINT_VIOLATION'});
});

test('D09 calendar timezone conversion is display-only',()=>{
  const projected=projectCalendarSlot({starts_at:'2026-10-01T08:00:00Z',ends_at:'2026-10-01T09:00:00Z'},'Africa/Lagos');
  assert.equal(projected.displayTimeZone,'Africa/Lagos');
  assert.equal(projected.authoritativeTimestampSource,'server');
  assert.equal(projected.displayProjectionOnly,true);
});

test('D09 frozen advisory seams remain non-committing TPF-10/TPF-05 requests',()=>{
  const course=bundle('c1').course,ctx=context();
  const initial=schedulingRequest({course,context:ctx,taskMode:'initial_timetable_proposal'});
  assert.equal(initial.capabilityId,'teaching.scheduling.initial_timetable_proposal');
  assert.equal(initial.promptFamilyId,'TPF-10');
  assert.equal(initial.promptFamilyVersion,'1.1');
  assert.equal(initial.commit,false);
  const horizon=schedulingRequest({course,context:ctx,taskMode:'rolling_planning_horizon_adjustment'});
  assert.equal(horizon.promptFamilyId,'TPF-05');
  assert.equal(horizon.promptFamilyVersion,'1.3');
});

let seq=0;function nextId(){seq+=1;return '00000000-0000-4000-8000-'+String(seq).padStart(12,'0');}
test('D09 authoritative timetable proposal commits through D05 and does not call AI',async()=>{
  let mutationCalls=0,aiCalls=0;
  const repository={
    async getSchedulingContext(){return context();},
    async saveProposalUsing(_tx,{context:ctx,result}){return {timetable:{timetable_version_id:'tt1'},ppl:{isNew:false,workspaceId:'w1',workspaceVersion:2,changedRefs:['semester:sem1'],targetEffectiveAt:ctx.semester.ends_at},result};},
    async getScheduleReview(){return {...context(),timetable:null,slots:[],feasibility:null,debtMinutes:0};},
    async listSemesters(){return [];},
  };
  const transactionalMutation={async mutateAndPublish({mutate,buildEvent}){mutationCalls+=1;const result=await mutate({});buildEvent(result);return {mutationResult:result};}};
  const service=createD09Service({repository,transactionalMutation,randomUUID:nextId,clock:()=>new Date('2026-09-29T04:00:00Z'),intelligence:{execute(){aiCalls+=1;}}});
  await service.proposeTimetable({id:'u1'},'c1');
  assert.equal(mutationCalls,1);
  assert.equal(aiCalls,0);
});

test('D09 migration creates versioned Scheduler truth with RLS and no authenticated mutation',()=>{
  const sql=fs.readFileSync(path.resolve(__dirname,'../../../migrations/20260929_teaching_d09_scheduling.sql'),'utf8');
  for(const name of ['teaching_schedule_profiles','teaching_availability_windows','teaching_schedule_blocks','teaching_schedule_deadlines','teaching_schedule_reserves','teaching_timetable_versions','teaching_timetable_slots','teaching_schedule_feasibility','teaching_schedule_debt_entries'])assert.match(sql,new RegExp('CREATE TABLE public\\.'+name));
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/teaching_guard_d09_timetable_update/);
  assert.match(sql,/REVOKE INSERT,UPDATE,DELETE,TRUNCATE[\s\S]*FROM authenticated/);
  assert.doesNotMatch(sql,/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,140}TO\s+authenticated/i);
});

test('D09 implementation does not select providers, activate Courses, write SKM or delete curriculum',()=>{
  const dir=path.resolve(__dirname,'../../../teaching/d09');
  const src=fs.readdirSync(dir).filter((f)=>f.endsWith('.js')).map((f)=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n');
  assert.doesNotMatch(src,/@google\/generative-ai|openai|anthropic|gemini-/i);
  assert.doesNotMatch(src,/insert into\s+public\.teaching_student_knowledge/i);
  assert.doesNotMatch(src,/delete from\s+public\.teaching_(learning_units|course_coverage)/i);
  assert.doesNotMatch(src,/lifecycle_state\s*=\s*['"]ACTIVE['"]/i);
});
