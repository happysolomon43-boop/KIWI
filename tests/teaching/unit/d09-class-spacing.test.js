'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertClassSpacing,spacingAllowed}=require('../../../teaching/d09/class-spacing');
const {computeSchedule,validateEditedSchedule}=require('../../../teaching/d09/scheduler');
const {naturalizeScheduleResult}=require('../../../teaching/d09/schedule-naturalizer');
const context={semester:{semester_id:'s',state_version:1,starts_at:'2026-10-12T00:00:00Z',ends_at:'2026-10-13T23:59:00Z',timezone:'Africa/Lagos'},profile:{preferences:{},settings:{}},availability:[{day_of_week:1,local_start:'09:00',local_end:'20:00',kind:'AVAILABLE'},{day_of_week:2,local_start:'09:00',local_end:'20:00',kind:'AVAILABLE'}],courses:[{course:{course_id:'new',state_version:1},plan:{course_plan_id:'p',version_no:1},units:[{learning_unit_id:'u',instructional_load_min_minutes:60,instructional_load_max_minutes:60,metadata:{}}],dependencies:[]}],blocks:[],deadlines:[],reserves:[]};
const slot=(id,start,end)=>({timetable_slot_id:id,courseId:id,kind:'CLASS',startsAt:start,endsAt:end,plannedMinutes:(Date.parse(end)-Date.parse(start))/60000});
const existing=slot('existing','2026-10-12T08:00:00Z','2026-10-12T10:00:00Z');
test('end-to-start spacing rejects adjacency, accepts exactly 3 and 8 hours, rejects a same-day 9-hour gap',()=>{
  assert.equal(spacingAllowed('2026-10-12T10:00:00Z','2026-10-12T11:00:00Z',[existing],'Africa/Lagos'),false);
  for(const start of ['2026-10-12T13:00:00Z','2026-10-12T18:00:00Z'])assert.equal(spacingAllowed(start,new Date(Date.parse(start)+3600000).toISOString(),[existing],'Africa/Lagos'),true);
  assert.equal(spacingAllowed('2026-10-12T19:00:00Z','2026-10-12T20:00:00Z',[existing],'Africa/Lagos'),false);
});
test('Course admission respects approved Classes outside the new Course workload',()=>{
  const admission={...context,fixedAuthoritySlots:[existing],blocks:[{block_kind:'HARD_UNAVAILABLE',starts_at:existing.startsAt,ends_at:existing.endsAt}]};
  const result=computeSchedule(admission,{now:'2026-10-11T00:00:00Z'});
  assert.notEqual(result.outcome,'INFEASIBLE');assert.equal(result.schedule.length,1);
  assert.doesNotThrow(()=>assertClassSpacing([...result.schedule,existing],'Africa/Lagos'));
  assert.equal(Date.parse(result.schedule[0].startsAt)>=Date.parse('2026-10-12T13:00:00Z'),true);
});
test('insufficient spacing capacity is infeasible rather than an automatic compression exception',()=>{
  const constrained={...context,semester:{...context.semester,ends_at:'2026-10-12T23:59:00Z'},availability:[{day_of_week:1,local_start:'09:00',local_end:'12:00',kind:'AVAILABLE'}],fixedAuthoritySlots:[existing],blocks:[{block_kind:'HARD_UNAVAILABLE',starts_at:existing.startsAt,ends_at:existing.endsAt}]};
  const result=computeSchedule(constrained,{now:'2026-10-11T00:00:00Z'});assert.equal(result.outcome,'INFEASIBLE');assert.equal(result.metrics.unscheduledMinutes,60);
});
test('formal edits cannot bypass the gap with an exception reason',()=>{
  const next=slot('next','2026-10-12T13:00:00Z','2026-10-12T14:00:00Z');
  assert.throws(()=>validateEditedSchedule(context,[existing,next],[{slotId:'next',startsAt:'2026-10-12T10:00:00Z',endsAt:'2026-10-12T11:00:00Z',exceptionReason:'approved request'}],{now:'2026-10-11T00:00:00Z'}),{code:'TEACHING_D09_INTERCLASS_GAP_VIOLATION'});
});
test('naturalizer cannot move fixed admission authority',()=>{
 const raw={schedule:[existing],policy:{activeAuthorityPreserved:true},metrics:{stableSlotsRetained:1}};
 assert.equal(naturalizeScheduleResult(context,raw),raw);
});
const {repairSpacing}=require('../../../teaching/d09/spacing-repair');
test('legacy spacing repair preserves exact Classes and history rather than regenerating full curriculum',()=>{
  const old=slot('history','2026-10-10T08:00:00Z','2026-10-10T09:00:00Z');
  const close=slot('new','2026-10-12T10:00:00Z','2026-10-12T11:00:00Z');
  const latest={timetable:{state_digest:'original'},slots:[old,existing,close],feasibility:{outcome:'FEASIBLE',headroom_policy_version:'h1',target_headroom_ratio:.2,minimum_headroom_ratio:.15,capacity_metrics:{scheduledMinutes:240,debtMinutes:0},reasons:[],alternatives:[]}};
  const repair=repairSpacing(context,latest,'2026-10-11T00:00:00Z');
  assert.equal(repair.schedule.length,3);assert.equal(repair.schedule[0].startsAt,old.startsAt);
  assert.deepEqual(repair.schedule.map(s=>[s.courseId,s.plannedMinutes]).sort(),latest.slots.map(s=>[s.courseId,s.plannedMinutes]).sort());
  assert.equal(repair.schedule.reduce((sum,s)=>sum+Date.parse(s.endsAt)-Date.parse(s.startsAt),0),latest.slots.reduce((sum,s)=>sum+Date.parse(s.endsAt)-Date.parse(s.startsAt),0));
  assert.doesNotThrow(()=>assertClassSpacing(repair.schedule,'Africa/Lagos',{now:'2026-10-11T00:00:00Z'}));
});
test('repair converts stored database slots into complete persistence inputs and refreshes horizons',()=>{
 const stored=(id,start,end,stage)=>({timetable_slot_id:id,course_id:id,slot_kind:'CLASS',starts_at:start,ends_at:end,timezone:'Africa/Lagos',horizon_stage:stage,learning_unit_refs:['lu-'+id],planned_minutes:(Date.parse(end)-Date.parse(start))/60000,exception_codes:['LEGACY'],rationale:'Approved lesson'});
 const latest={timetable:{state_digest:'db-rows'},slots:[stored('history','2026-10-10T08:00:00Z','2026-10-10T09:00:00Z','IMMINENT'),stored('existing','2026-10-12T08:00:00Z','2026-10-12T10:00:00Z','IMMINENT'),stored('new','2026-10-12T10:00:00Z','2026-10-12T11:00:00Z','FLEXIBLE')],feasibility:{outcome:'FEASIBLE',headroom_policy_version:'h1',target_headroom_ratio:.2,minimum_headroom_ratio:.15,capacity_metrics:{scheduledMinutes:240,debtMinutes:0},reasons:[],alternatives:[]}};
 const repaired=repairSpacing(context,latest,'2026-10-11T00:00:00Z');
 for(const row of repaired.schedule){for(const field of ['courseId','kind','startsAt','endsAt','timezone','horizonStage','learningUnitIds','plannedMinutes','exceptionCodes'])assert.notEqual(row[field],undefined,field+' must reach the persistence boundary');assert.equal(row.horizonStage,'IMMINENT');}
 assert.deepEqual(repaired.schedule[0].exceptionCodes,['LEGACY']);
 assert.equal(repaired.schedule.every(s=>s.learningUnitIds.length===1),true);
});
