'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {computeSchedule,PREFERRED_SAME_DAY_GAP_MINUTES,PREFERRED_SAME_DAY_GAP_MAX_MINUTES}=require('../../../teaching/d09/scheduler');

function bundle(unitCount=8){
  return {
    course:{course_id:'nutrition',title:'Nutrition',state_version:1,subject_snapshot_ref:'subject:nutrition:v1',lifecycle_state:'DRAFT'},
    plan:{course_plan_id:'nutrition-plan',version_no:1,plan_state:'REVIEW_READY',source_snapshot_ref:'subject:nutrition:v1'},
    units:Array.from({length:unitCount},(_,index)=>({
      learning_unit_id:`lu-${index+1}`,title:`Unit ${index+1}`,
      instructional_load_min_minutes:60,instructional_load_max_minutes:60,
      metadata:{instructional_treatment:'FULL_INSTRUCTION'},
    })),
    dependencies:[],coverage:[],scopeChanges:[],semesterTimezone:'Africa/Lagos',
  };
}
function availability(){
  const rows=[];
  for(const day of [1,2,3,4,5]){
    rows.push({day_of_week:day,local_start:'09:00',local_end:'12:00',kind:'AVAILABLE',preference_weight:0});
    rows.push({day_of_week:day,local_start:'16:00',local_end:'19:00',kind:'AVAILABLE',preference_weight:0});
  }
  return rows;
}
function context(unitCount=8){
  return {
    semester:{semester_id:'sem-cadence',state_version:1,starts_at:'2026-10-05T00:00:00Z',ends_at:'2026-10-18T22:59:59Z',timezone:'Africa/Lagos'},
    profile:{profile_id:'profile-cadence',version_no:1,semester_state_version:1,preferences:{avoidConsecutiveSameCourseDays:true,preferredStartTimes:['09:00','16:00']},settings:{horizon:{imminentDays:7,concreteDays:28}}},
    availability:availability(),blocks:[],deadlines:[],reserves:[],courses:[bundle(unitCount)],unresolvedCourses:[],
  };
}
function dateDistance(a,b){return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000);}
function gapMinutes(a,b){
  const early=Date.parse(a.endsAt)<=Date.parse(b.startsAt)?a:b;
  const late=early===a?b:a;
  return Math.floor((Date.parse(late.startsAt)-Date.parse(early.endsAt))/60000);
}

test('D09 cadence is deterministic for identical authoritative inputs',()=>{
  const first=computeSchedule(context(),{now:'2026-10-04T08:00:00Z'});
  const second=computeSchedule(context(),{now:'2026-10-04T08:00:00Z'});
  assert.deepEqual(first.schedule,second.schedule);
  assert.equal(first.policy.deterministicCadenceVariation,true);
  assert.deepEqual(first.policy.preferredSameDayClassGapMinutes,[180,480]);
});

test('D09 one Course is naturally spread instead of greedily filling every earliest window',()=>{
  const result=computeSchedule(context(6),{now:'2026-10-04T08:00:00Z'});
  assert.equal(result.outcome,'FEASIBLE');
  const classes=result.schedule.filter((slot)=>slot.kind==='CLASS');
  const uniqueDates=[...new Set(classes.map((slot)=>slot.localDate))];
  assert.ok(uniqueDates.length>=3,'six learning units should use multiple teaching days');
  const distances=uniqueDates.slice(1).map((date,index)=>dateDistance(uniqueDates[index],date));
  assert.ok(distances.some((days)=>days>=2),'same-Course cadence should include a recovery/retention gap when capacity allows');
  assert.ok(distances.every((days)=>days<=5),'normal cadence should not create arbitrary long gaps');
});

test('D09 second same-day Class prefers a 3–8 hour gap rather than back-to-back packing',()=>{
  const tight=context(10);
  tight.semester={...tight.semester,ends_at:'2026-10-09T22:59:59Z'};
  const result=computeSchedule(tight,{now:'2026-10-04T08:00:00Z'});
  assert.equal(result.outcome,'FEASIBLE');
  const byDate=new Map();
  for(const slot of result.schedule.filter((item)=>item.kind==='CLASS')){
    if(!byDate.has(slot.localDate))byDate.set(slot.localDate,[]);
    byDate.get(slot.localDate).push(slot);
  }
  const doubleDays=[...byDate.values()].filter((slots)=>slots.length===2);
  assert.ok(doubleDays.length>0,'tight capacity should exercise a two-Class day');
  for(const slots of doubleDays){
    const gap=gapMinutes(slots[0],slots[1]);
    assert.ok(gap>=PREFERRED_SAME_DAY_GAP_MINUTES,`same-day Class gap ${gap} should be at least 180 minutes`);
    assert.ok(gap<=PREFERRED_SAME_DAY_GAP_MAX_MINUTES,`same-day Class gap ${gap} should stay within the preferred 8-hour band`);
  }
});
