'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {staleBlueprintReason,createD11BlueprintInvalidation}=require('../../../teaching/d11/blueprint-invalidation');
const b={blueprint_state:'VALIDATED',student_id:'s',lesson_blueprint_id:'b1',class_id:'c',
  course_plan_id:'plan',version_no:2,source_course_plan_version:3,source_course_state_version:4,
  source_class_schedule_version:5,source_timetable_version_id:'tv'};
const c={class_id:'c',course_id:'course',student_id:'s',lifecycle_state:'SCHEDULED',
  schedule_version:5,source_timetable_version_id:'tv'};
const co={course_id:'course',student_id:'s',lifecycle_state:'ACTIVE',state_version:4};
const tv={timetable_version_id:'tv',timetable_state:'APPROVED'};
const p={course_plan_id:'plan',version_no:3};
test('Blueprint invalidation follows Class, Course, timetable and Topic→Course Plan authority',()=>{
  const x={blueprint:b,klass:c,course:co,timetable:tv,plan:p};
  assert.equal(staleBlueprintReason(x),null);
  assert.equal(staleBlueprintReason({...x,klass:{...c,lifecycle_state:'CANCELLED'}}),'CLASS_NO_LONGER_PREPARABLE');
  assert.equal(staleBlueprintReason({...x,course:{...co,lifecycle_state:'PAUSED'}}),'COURSE_NO_LONGER_ACTIVE');
  assert.equal(staleBlueprintReason({...x,timetable:{...tv,timetable_state:'SUPERSEDED'}}),'TIMETABLE_SUPERSEDED');
  assert.equal(staleBlueprintReason({...x,plan:{...p,version_no:4}}),'COURSE_PLAN_SUPERSEDED');
  assert.equal(staleBlueprintReason({...x,klass:{...c,schedule_version:6}}),'CLASS_SCHEDULE_CHANGED');
  assert.equal(staleBlueprintReason({...x,course:{...co,state_version:5}}),'COURSE_VERSION_CHANGED');
  assert.equal(staleBlueprintReason({...x,klass:{...c,lifecycle_state:'CANCELLED'},sessionExists:true}),null,
    'even CLOSED historical Classroom sessions retain their lesson provenance');
});
test('D11 owner supersedes only unstarted stale validated Blueprints and audits the change',async()=>{
  const seen=[];
  const sql=async(q,args=[])=>{
    seen.push({q,args});
    if(q.includes('select b.lesson_blueprint_id'))return {rows:[{lesson_blueprint_id:'b1'}]};
    if(q.includes('select class_id,student_id from public.teaching_lesson_blueprints'))return {rows:[{class_id:'c',student_id:'s'}]};
    if(q.includes('from public.teaching_classes where'))return {rows:[c]};
    if(q.includes('from public.teaching_courses where'))return {rows:[co]};
    if(q.includes('from public.teaching_timetable_versions where'))return {rows:[tv]};
    if(q.includes('from public.teaching_course_plans where'))return {rows:[{...p,version_no:4}]};
    if(q.includes('from public.teaching_lesson_blueprints where lesson_blueprint_id=$1 for update'))return {rows:[b]};
    if(q.includes('from public.teaching_class_sessions'))return {rows:[]};
    if(q.includes('update public.teaching_lesson_blueprints'))return {rows:[{lesson_blueprint_id:'b1'}]};
    if(q.includes('insert into public.teaching_academic_audit_log'))return {rows:[]};
    throw Error('Unexpected Blueprint SQL');
  };
  const r=createD11BlueprintInvalidation({query:sql,withTransaction:fn=>fn({query:sql}),
    randomUUID:()=> 'audit-id',logger:{info() {},error(){}}});
  assert.deepEqual(await r.runOnce(),{candidates:1,retired:1,failed:0});
  assert.ok(seen.some(x=>x.q.includes("blueprint_state='VALIDATED'")&&x.q.includes('not exists(select 1 from public.teaching_class_sessions')));
  assert.ok(seen.some(x=>x.q.includes("set blueprint_state='SUPERSEDED'")));
  assert.ok(seen.some(x=>x.q.includes('lesson_blueprint.parent_reconciled')));
  assert.ok(!seen.some(x=>x.q.includes('delete from')));
});
test('Class session history blocks stale-Blueprint retirement even after Course cancellation',async()=>{
  const sql=async(q)=>{
    if(q.includes('select class_id,student_id'))return {rows:[{student_id:'s',class_id:'c'}]};
    if(q.includes('from public.teaching_classes where'))return {rows:[{...c,lifecycle_state:'CANCELLED'}]};
    if(q.includes('from public.teaching_courses where'))return {rows:[co]};
    if(q.includes('from public.teaching_timetable_versions where'))return {rows:[tv]};
    if(q.includes('from public.teaching_course_plans where'))return {rows:[p]};
    if(q.includes('from public.teaching_lesson_blueprints where'))return {rows:[b]};
    if(q.includes('from public.teaching_class_sessions'))return {rows:[{one:1}]};
    throw Error('Protected Class session must short-circuit Blueprint rewrite');
  };
  const r=createD11BlueprintInvalidation({query:sql,withTransaction:fn=>fn({query:sql}),randomUUID:()=> 'audit-id'});
  assert.deepEqual(await r.retireOne('b1'),{retired:false,reason:'ACADEMIC_BLUEPRINT_CURRENT_OR_HISTORICAL'});
});
