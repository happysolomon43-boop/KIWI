'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {registerD11Runtime}=require('../../../teaching/d11/runtime');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');

function harness(){
  const handlers=new Map(),ensured=[],timers=[],refreshed=[],lookups=[];
  const rows={
    'gst':[],
    'phy101':[{class_id:'class101',student_id:'student-1',course_id:'phy101',schedule_version:22,scheduled_start_at:'2026-10-15T11:00:00Z',scheduled_end_at:'2026-10-15T12:30:00Z'}],
    'phy103':[{class_id:'class103-1',student_id:'student-1',course_id:'phy103',schedule_version:22,scheduled_start_at:'2026-10-15T13:00:00Z',scheduled_end_at:'2026-10-15T15:00:00Z'}],
  };
  const repository={
    ensurePreparationWorkspace:async({studentId,classId})=>{ensured.push({studentId,classId});return {workspace:{workspace_id:'ws-'+classId}};},
    listClassesForCourse:async(studentId,id)=>{lookups.push({studentId,id});return rows[id]||[];},
    getClassContext:async()=>null,
  };
  const dueEventStore={enqueue:async event=>{timers.push(event);return {inserted:true}}};
  const service={
    startController:async()=>({}),processClassClosureArtifacts:async()=>({}),
    refreshCoursePreparation:async(studentId,courseId)=>{refreshed.push({studentId,courseId});return [];},
    handlePreparationEvent:async()=>({}),handleClassEndDue:async()=>({}),resumeBreakFromDueEvent:async()=>({}),
  };
  registerD11Runtime({
    publishedEvents:{register:(type,{handle})=>{handlers.set(type,handle);return {type}}},
    eventRuntime:{register:()=>({})},dueEventStore,repository,service,
  });
  return {handlers,ensured,timers,refreshed,lookups};
}

test('GST availability request seeds PPL + start/end due events across all Courses its approved timetable replaced',async()=>{
  const h=harness();
  const handled=await h.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)({
    actorId:'student-1',eventId:'request-applied-22',correlationId:'request-22',
    payload:{course_id:'gst',request_type:'PERMANENT_AVAILABILITY_CHANGE',affected_course_ids:['phy101','phy103']},
  });
  assert.equal(handled.seeded,2);
  assert.equal(handled.affectedCourses,3);
  assert.deepEqual(h.refreshed.map(x=>x.courseId),['gst','phy101','phy103']);
  assert.deepEqual(h.ensured.map(x=>x.classId),['class101','class103-1']);
  assert.equal(h.timers.filter(x=>x.eventType===TEACHING_EVENTS.CLASS_START_DUE).length,2);
  assert.equal(h.timers.filter(x=>x.eventType===TEACHING_EVENTS.CLASS_END_DUE).length,2);
  assert.ok(h.timers.every(x=>x.actorId==='student-1'));
});

test('PPL semester seeding is backwards compatible, deduplicated, and never touches unrelated Course IDs',async()=>{
  const h=harness();
  const handler=h.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED);
  await handler({actorId:'student-1',eventId:'old-event',payload:{course_id:'phy101'}});
  assert.deepEqual(h.ensured.map(x=>x.classId),['class101']);
  h.ensured.length=0;h.timers.length=0;
  const result=await handler({actorId:'student-1',eventId:'new-event',payload:{course_id:'phy101',affected_course_ids:['phy101','phy103','phy103','','phy101']}});
  assert.equal(result.seeded,2);
  assert.equal(h.timers.length,4);
  assert.deepEqual(h.ensured.map(x=>x.classId),['class101','class103-1']);
  assert.equal(h.lookups.some(x=>x.id==='unknown'),false);
});
test('D10 retains transactional Course coverage in formal reschedule, availability, break, pause and resume',()=>{
  const src=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d10/service.js'),'utf8');
  assert.match(src,/affected_course_ids:targetResult\?\.affectedCourseIds\|\|\[\]/);
  assert.ok((src.match(/affectedCourseIds:\[\.\.\.new Set\(/g)||[]).length>=4);
  assert.match(src,/classes\.map\(row=>String\(row\.course_id\)\)/);
  assert.match(src,/rebuilt\.classes\.map\(row=>String\(row\.course_id\)\)/);
  const target=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d09-scheduling.js'),'utf8');
  assert.match(target,/materializeApprovedTimetableUsing/);
  assert.match(target,/return classes;/);
});
