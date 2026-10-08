'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {registerD11Runtime}=require('../../../teaching/d11/runtime');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');
const {validateTeachingEvent}=require('../../../teaching/events/contracts');

const futureStart='2027-04-10T10:00:00.000Z';
function klass(id,courseId,timetableId='approved-timetable'){
  return {student_id:'student-1',class_id:id,course_id:courseId,
    course_lifecycle_state:'ACTIVE',lifecycle_state:'SCHEDULED',
    source_timetable_state:'APPROVED',source_timetable_version_id:timetableId,
    scheduled_start_at:futureStart,scheduled_end_at:'2027-04-10T11:30:00.000Z',
    schedule_version:4,timezone:'UTC'};
}
function environment({
  rows=[klass('phy101-class','PHY101'),klass('phy103-class','PHY103')],
  originalClasses=[],withoutApproved=false,workspaceGuard=null,
}={}){
  const handlers=new Map(),published=[],byId=new Map(),dueEvents=[],guardCalls=[],refreshCalls=[],classContexts=new Map();
  for(const row of rows)classContexts.set(row.class_id,{classRow:row,session:null});
  const publishedEvents={register:(kind,spec)=>{handlers.set(kind,spec.handle);return {kind,id:spec.subscriberId}}};
  const repository={
    listClassesForCourse:async(studentId,courseId)=>{assert.equal(studentId,'student-1');return courseId==='GST'?originalClasses:[];},
    listClassesForApprovedTimetable:async(studentId,version)=>{
      assert.equal(studentId,'student-1');assert.equal(version,'approved-timetable');
      return withoutApproved?[]:rows;
    },
    listClassesForAppliedScheduleRequest:async(studentId,requestId)=>{
      assert.equal(studentId,'student-1');assert.equal(requestId,'applied-req');return rows;
    },
    getClassContext:async(studentId,classId)=>{assert.equal(studentId,'student-1');return classContexts.get(classId)||null;},
    ensurePreparationWorkspace:async opts=>{
      guardCalls.push(opts);
      if(workspaceGuard)return workspaceGuard(opts);
      return {workspace:{workspace_id:'workspace:'+opts.classId}};
    },
  };
  const seen=new Set();
  const outboxStore={append:async event=>{
    validateTeachingEvent(event);
    if(seen.has(event.eventId))return {inserted:false,event};
    seen.add(event.eventId);published.push(event);return {inserted:true,event};
  }};
  const dueEventStore={enqueue:async event=>{dueEvents.push(event);return {inserted:true}}};
  registerD11Runtime({
    publishedEvents,eventRuntime:{register:()=>{}},dueEventStore,repository,outboxStore,
    service:{startController:async()=>({}),refreshCoursePreparation:async(studentId,courseId,options)=>{
      refreshCalls.push({studentId,courseId,options});return [];
    }},
  });
  return {handlers,published,dueEvents,guardCalls,refreshCalls,classContexts};
}
function requestApplied(payload){
  return {eventId:'d10-committed-request',actorId:'student-1',aggregateId:'applied-req',
    correlationId:'corr',payload:{request_id:'applied-req',course_id:'GST',request_type:'PERMANENT_AVAILABILITY_CHANGE',...payload}};
}
test('semester availability Request for Course with zero Classes fans out all affected Courses',async()=>{
  const e=environment();
  const result=await e.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)(requestApplied({timetable_version_id:'approved-timetable'}));
  assert.equal(result.refreshed,0);
  assert.equal(result.queuedClassReconciliations,2);
  assert.deepEqual(e.published.map(x=>x.payload.course_id),['PHY101','PHY103']);
  assert.equal(e.dueEvents.length,0);
  for(const entry of e.published){
    assert.equal(entry.eventType,TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE);
    assert.equal(entry.payload.timetable_version_id,'approved-timetable');
    assert.equal(entry.actorId,'student-1');
    assert.equal(entry.causationId,'d10-committed-request');
    const seeded=await e.handlers.get(TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE)(entry);
    assert.equal(seeded.seeded,true);
  }
  assert.equal(e.guardCalls.length,2);
  assert.ok(e.guardCalls.every(x=>x.expectedTimetableVersionId==='approved-timetable'&&x.expectedScheduleVersion===4));
  assert.equal(e.dueEvents.length,4);
  assert.equal(e.dueEvents.filter(x=>x.eventType===TEACHING_EVENTS.CLASS_START_DUE).length,2);
  assert.equal(e.dueEvents.filter(x=>x.eventType===TEACHING_EVENTS.CLASS_END_DUE).length,2);
});
test('one committed Request event can replay without generating duplicate fanout tasks',async()=>{
  const e=environment();
  const ev=requestApplied({timetable_version_id:'approved-timetable'});
  await e.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)(ev);
  await e.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)(ev);
  assert.equal(e.published.length,2);
  assert.deepEqual(new Set(e.published.map(x=>x.eventId)).size,2);
});
test('older approved request events without timetable_version_id safely recover by request-owned Class lineage',async()=>{
  const e=environment();
  const result=await e.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)(requestApplied({}));
  assert.equal(result.queuedClassReconciliations,2);
  assert.equal(e.published.length,2);
  assert.ok(e.published.every(x=>x.payload.timetable_version_id==='approved-timetable'));
});
test('legacy timetable version reference is supported without global-course assumptions',async()=>{
  const e=environment();
  const result=await e.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)(requestApplied({
    target_version_after:'timetable:approved-timetable:version:14',
  }));
  assert.equal(result.queuedClassReconciliations,2);
});
test('unrelated Request types never run semester-wide Class rebuild fanout',async()=>{
  const e=environment();
  const result=await e.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)(requestApplied({request_type:'TEACHER_CHANGE'}));
  assert.equal(result.seeded,0);
  assert.equal(e.published.length,0);
});
test('cancelled, superseded, moved and started Classes never mint new workspaces or due events',async()=>{
  const e=environment({rows:[klass('future','PHY101')]});
  await e.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)(requestApplied({timetable_version_id:'approved-timetable'}));
  const payload=e.published[0];
  for(const state of [
    {...klass('future','PHY101'),lifecycle_state:'CANCELLED'},
    {...klass('future','PHY101'),source_timetable_state:'SUPERSEDED'},
    {...klass('future','PHY101'),source_timetable_version_id:'newer-version'},
    {...klass('future','PHY101'),schedule_version:5},
    {...klass('future','PHY101'),course_lifecycle_state:'PAUSED'},
    {...klass('future','PHY101'),scheduled_start_at:'2020-10-08T10:00:00Z'},
  ]){
    e.classContexts.set('future',{classRow:state,session:null});
    const result=await e.handlers.get(TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE)(payload);
    assert.equal(result.noop,true);
  }
  const record=klass('future','PHY101');
  e.classContexts.set('future',{classRow:record,session:null});
  const live=await e.handlers.get(TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE)(payload);
  assert.equal(live.seeded,true);
  assert.equal(e.guardCalls.length,1);
  assert.equal(e.dueEvents.length,2);
});
test('locked repository eligibility losing a race returns NOOP and cannot schedule Class due events',async()=>{
  const e=environment({rows:[klass('future','PHY101')],workspaceGuard:async()=>null});
  await e.handlers.get(TEACHING_EVENTS.REQUEST_APPLIED)(requestApplied({timetable_version_id:'approved-timetable'}));
  const result=await e.handlers.get(TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE)(e.published[0]);
  assert.equal(result.noop,true);
  assert.equal(result.reason,'AUTHORITATIVE_CLASS_SUPERSEDED');
  assert.equal(e.dueEvents.length,0);
});
test('source SQL and D10 commit payload correctly bind cross-Course approved timetable to durable Class reconcile',()=>{
  const repo=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');
  const d10=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d10/service.js'),'utf8');
  const runtime=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/runtime.js'),'utf8');
  const foundation=fs.readFileSync(path.resolve(__dirname,'../../../teaching/index.js'),'utf8');
  assert.match(repo,/source_timetable_version_id=\$2/);
  assert.match(repo,/t\.timetable_state='APPROVED'/);
  assert.match(repo,/c\.source_request_id=\$2/);
  assert.match(repo,/c\.scheduled_start_at>now\(\)/);
  assert.match(repo,/expectedTimetableVersionId\s*!=\s*null/);
  assert.match(repo,/loadClassBase\(studentId, classId, tx, true\)/);
  assert.match(d10,/timetable_version_id:targetResult\?\.timetableVersionId/);
  assert.match(runtime,/TEACHING_EVENTS\.CLASS_PREPARATION_RECONCILE/);
  assert.match(foundation,/outboxStore:d10RuntimePlatform\.outboxStore/);
});
