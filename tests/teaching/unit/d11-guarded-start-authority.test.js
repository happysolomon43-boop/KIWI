'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=rel=>fs.readFileSync(path.resolve(__dirname,'../../../',rel),'utf8');

test('new automatic Class start cannot reopen cancelled or superseded timetable',()=>{
 const runtime=load('teaching/d11/runtime.js');
 const portion=runtime.slice(runtime.indexOf('eventRuntime.register(TEACHING_EVENTS.CLASS_START_DUE,'),
   runtime.indexOf('eventRuntime.register(TEACHING_EVENTS.BREAK_END_DUE,'));
 assert.ok(portion.includes("context.classRow.source_timetable_state)!=='APPROVED'"));
 assert.ok(portion.includes("context.classRow.lifecycle_state)!=='SCHEDULED'"));
 assert.ok(portion.includes("reason:'CLASS_COURSE_OR_TIMETABLE_NOT_CURRENT'"));
 assert.ok(portion.indexOf("reason:'CLASS_COURSE_OR_TIMETABLE_NOT_CURRENT'") < portion.indexOf('handle:async(event)=>'));
});
test('D11 Controller and final session transaction both check approved timetables and time',()=>{
 const service=load('teaching/d11/service.js');
 const starter=service.slice(service.indexOf('async function startController('),service.indexOf('async function replanLesson('));
 assert.ok(starter.includes("context.classRow.source_timetable_state!=='APPROVED'"));
 assert.ok(starter.includes("'TEACHING_D11_CLASS_PARENT_SUPERSEDED'"));
 const repo=load('teaching/repositories/d11-lesson-controller.js');
 const low=repo.slice(repo.indexOf('async function ensureControllerStartedUsing('),repo.indexOf('async function transitionUsing('));
 assert.ok(low.includes('from public.teaching_timetable_versions'));
 assert.ok(low.includes('for share'));
 assert.ok(low.includes("classRow.source_timetable_state !== 'APPROVED'"));
 assert.ok(low.includes("approvedTimetable.rows?.[0]?.timetable_state !== 'APPROVED'"));
 assert.ok(low.includes("classRow.lifecycle_state !== 'SCHEDULED'"));
 assert.ok(low.includes('Date.parse(classRow.scheduled_start_at)'));
 assert.ok(low.indexOf("approvedTimetable.rows?.[0]?.timetable_state !== 'APPROVED'") < low.indexOf('insert into public.teaching_class_sessions'));
});
test('D11 validated Blueprint must pass atomic Class/Course/timetable recheck before insertion',()=>{
 const repo=load('teaching/repositories/d11-lesson-controller.js');
 const check=repo.slice(repo.indexOf('async function assertContextCurrentUsing('),repo.indexOf('async function assertLiveContextCurrent('));
 assert.ok(check.includes('for share'));
 assert.ok(check.includes("classRow.lifecycle_state!=='SCHEDULED'"));
 assert.ok(check.includes("classRow.course_lifecycle_state!=='ACTIVE'"));
 assert.ok(check.includes("timetableRows?.[0]?.timetable_state!=='APPROVED'"));
 const save=repo.slice(repo.indexOf('async function saveBlueprintUsing('),repo.indexOf('async function ensureControllerStartedUsing('));
 assert.ok(save.includes('assertContextCurrentUsing(tx'));
 assert.ok(save.includes('insert into public.teaching_lesson_blueprints'));
 assert.ok(save.indexOf('assertContextCurrentUsing(tx')<save.indexOf('insert into public.teaching_lesson_blueprints'));
});
