'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {registerD11Runtime}=require('../../../teaching/d11/runtime');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');
const {validateTeachingEvent}=require('../../../teaching/events/contracts');

const tomorrow=()=>new Date(Date.now()+86400000).toISOString();
const nextDay=()=>new Date(Date.now()+90000000).toISOString();
const klass=(id,courseId,timetable='tt-new')=>({
 student_id:'student-a',class_id:id,course_id:courseId,
 lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',
 source_timetable_version_id:timetable,source_timetable_state:'APPROVED',
 schedule_version:22,scheduled_start_at:tomorrow(),scheduled_end_at:nextDay(),
});
function buildRuntime({classes=[],originCourse='gst',onGetClass=null,outboxAvailable=true}={}){
 const subscriptions=new Map(),outbox=[],due=[],refresh=[],seed=[];
 const repository={
  listClassesForCourse:async(_student,course)=>course===originCourse?[]:classes.filter(k=>k.course_id===course),
  listClassesForApprovedTimetable:async(_student,version)=>classes.filter(k=>k.source_timetable_version_id===version),
  getClassContext:async(_student,id)=>onGetClass?onGetClass(id):({classRow:classes.find(c=>c.class_id===id)}),
  ensurePreparationWorkspace:async args=>{seed.push(args);return {workspace:{workspace_id:'ws-'+args.classId}};},
 };
 const service={startController:async()=>{},refreshCoursePreparation:async(studentId,courseId)=>{refresh.push({studentId,courseId});return [];}};
 const registry={register(type,{handle,subscriberId})=>{
  subscriptions.set(type+':'+subscriberId,handle);return {eventType:type,subscriberId};}};
 registerD11Runtime({
  publishedEvents:registry,eventRuntime:{register:()=>({})},
  dueEventStore:{enqueue:async event=>{due.push(event);return {};}},repository,service,
  outboxStore:outboxAvailable?{append:async event=>{outbox.push(validateTeachingEvent(event));return {inserted:true};}}:null,
 });
 const find=(type)=>[...subscriptions.entries()].find(([k])=>k.startsWith(type+':'))?.[1];
 return {find,repository,refresh,seed,due,outbox};
}

test('availability Request on GST fans out two different Physics Courses from same approved timetable without synchronous AI',async()=>{
 const v=buildRuntime({classes:[klass('phy-1','phy101'),klass('phy-2','phy103')]});
 const result=await v.find(TEACHING_EVENTS.REQUEST_APPLIED)({
  eventId:'req-1',actorId:'student-a',correlationId:'cor-1',
  aggregateId:'request-1',
  payload:{course_id:'gst',request_type:'PERMANENT_AVAILABILITY_CHANGE',timetable_version_id:'tt-new',target_version_after:'timetable:tt-new:version:22'},
 });
 assert.equal(result.queuedClassReconciliations,2);
 assert.equal(result.refreshed,0);
 assert.deepEqual(v.refresh,[{studentId:'student-a',courseId:'gst'}]);
 assert.equal(v.seed.length,0);
 assert.equal(v.due.length,0);
 assert.deepEqual(v.outbox.map(e=>e.payload.class_id),['phy-1','phy-2']);
 assert.equal(v.outbox.every(e=>e.eventType===TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE),true);
 assert.equal(v.outbox.every(e=>e.causationId==='req-1'),true);
 assert.equal(v.outbox.every(e=>e.idempotencyKey===e.eventId),true);
 assert.equal(new Set(v.outbox.map(e=>e.eventId)).size,2);
});
test('legacy timetable:UUID:version event still resolves authoritative reflow scope',async()=>{
 const v=buildRuntime({classes:[klass('phy-1','phy101')]});
 const r=await v.find(TEACHING_EVENTS.REQUEST_APPLIED)({
  eventId:'older-req',actorId:'student-a',payload:{course_id:'gst',target_version_after:'timetable:tt-new:version:22'},
 });
 assert.equal(r.queuedClassReconciliations,1);
});
test('durable Class-scoped publication seeds a workspace and start/end events only for live approved Class',async()=>{
 const row=klass('phy-1','phy103');
 const v=buildRuntime({classes:[row]});
 const event={eventId:'new-class-1',actorId:'student-a',aggregateId:'phy-1',
  payload:{class_id:'phy-1',course_id:'phy103',timetable_version_id:'tt-new',schedule_version:22}};
 const r=await v.find(TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE)(event);
 assert.equal(r.seeded,true);
 assert.equal(r.workspaceId,'ws-phy-1');
 assert.equal(v.seed.length,1);
 assert.equal(v.due.length,2);
 assert.ok(v.due.some(e=>e.eventType===TEACHING_EVENTS.CLASS_START_DUE));
 assert.ok(v.due.some(e=>e.eventType===TEACHING_EVENTS.CLASS_END_DUE));
});
test('superseded, cancelled, wrong-student, wrong-version and elapsed Classes never mint academic prep',async()=>{
 const kinds=[
  {...klass('phy-1','phy103'),source_timetable_state:'SUPERSEDED'},
  {...klass('phy-1','phy103'),lifecycle_state:'CANCELLED'},
  {...klass('phy-1','phy103'),student_id:'student-b'},
  {...klass('phy-1','phy103'),schedule_version:23},
  {...klass('phy-1','phy103'),course_lifecycle_state:'PAUSED'},
  {...klass('phy-1','phy103'),scheduled_start_at:'2026-09-01T10:00:00Z'},
  {...klass('phy-1','phy103'),source_timetable_version_id:'tt-old'},
 ];
 for(const row of kinds){
  const v=buildRuntime({classes:[row]});
  const r=await v.find(TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE)({
    eventId:'stale-1',actorId:'student-a',
    payload:{class_id:'phy-1',timetable_version_id:'tt-new',schedule_version:22},
  });
  assert.equal(r.noop,true);
  assert.equal(v.seed.length,0);
  assert.equal(v.due.length,0);
 }
});
test('cannot silently acknowledge timetable fanout when durable publication is not wired',async()=>{
 const v=buildRuntime({classes:[klass('phy-1','phy103')],outboxAvailable:false});
 await assert.rejects(v.find(TEACHING_EVENTS.REQUEST_APPLIED)({
  eventId:'req-1',actorId:'student-a',payload:{course_id:'gst',timetable_version_id:'tt-new'},
 }),{code:'TEACHING_D11_TIMETABLE_RECONCILIATION_UNAVAILABLE'});
});
test('request publisher binds version from all schedule-related Request kinds, not just a GST-specific patch',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d10/service.js'),'utf8');
 assert.match(source,/timetable_version_id:targetResult\?\.timetableVersionId/);
 assert.match(source,/timetableVersionId:saved\.timetable\.timetable_version_id/);
 assert.match(source,/timetableVersionId:rebuilt\.saved\.timetable\.timetable_version_id/);
 const d11repo=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');
 assert.match(d11repo,/t\.timetable_state='APPROVED'/);
 assert.match(d11repo,/co\.lifecycle_state='ACTIVE'/);
 assert.match(d11repo,/c\.source_timetable_version_id=\$2/);
 assert.match(d11repo,/c\.student_id=\$1/);
});
