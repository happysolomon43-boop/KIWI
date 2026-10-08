'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {obsoleteClassDueReason,createD11ClassDueCancellation}=require('../../../teaching/d11/class-due-cancellation');
const valid={
  event:{event_id:'start-1',status:'PENDING',actor_id:'student-a',event_type:'teaching.class.start_due',
    payload:{class_id:'class-a',schedule_version:3,timetable_version_id:'t1'}},
  klass:{class_id:'class-a',student_id:'student-a',course_id:'course-a',lifecycle_state:'SCHEDULED',
    schedule_version:3,source_timetable_version_id:'t1',scheduled_end_at:'2026-11-10T11:00:00Z'},
  course:{course_id:'course-a',lifecycle_state:'ACTIVE'},
  timetable:{timetable_version_id:'t1',timetable_state:'APPROVED'},
  now:new Date('2026-10-08T09:00:00Z')
};
test('D11 due cleanup detects all lost parent authorities without touching live sessions',()=>{
  assert.equal(obsoleteClassDueReason(valid),null);
  assert.equal(obsoleteClassDueReason({...valid,klass:null}),'CLASS_REMOVED');
  assert.equal(obsoleteClassDueReason({...valid,klass:{...valid.klass,lifecycle_state:'CANCELLED'}}),'CLASS_NO_LONGER_SCHEDULED');
  assert.equal(obsoleteClassDueReason({...valid,course:{...valid.course,lifecycle_state:'INCOMPLETE'}}),'COURSE_NOT_ACTIVE');
  assert.equal(obsoleteClassDueReason({...valid,timetable:{...valid.timetable,timetable_state:'SUPERSEDED'}}),'TIMETABLE_SUPERSEDED');
  assert.equal(obsoleteClassDueReason({...valid,event:{...valid.event,payload:{...valid.event.payload,schedule_version:2}}}),'CLASS_SCHEDULE_VERSION_CHANGED');
  assert.equal(obsoleteClassDueReason({...valid,event:{...valid.event,payload:{...valid.event.payload,timetable_version_id:'old-t'}}}),'TIMETABLE_VERSION_CHANGED');
  assert.equal(obsoleteClassDueReason({...valid,now:new Date('2026-11-12')}),'CLASS_WINDOW_EXPIRED');
  assert.equal(obsoleteClassDueReason({...valid,klass:{...valid.klass,lifecycle_state:'CANCELLED'},liveSession:true}),null);
});
test('orphan Class start and end timers are superseded with audit reason; Attendance due untouched',async()=>{
  let queries=[];
  const sql=async(q,params=[])=>{
    queries.push({q,params});
    if(q.includes('select e.event_id'))return {rows:[{event_id:'start-1'}]};
    if(q.includes('select actor_id,payload'))return {rows:[{actor_id:'student-a',payload:valid.event.payload}]};
    if(q.includes('from public.teaching_classes where'))return {rows:[{...valid.klass,lifecycle_state:'CANCELLED'}]};
    if(q.includes('from public.teaching_courses where'))return {rows:[valid.course]};
    if(q.includes('from public.teaching_timetable_versions where'))return {rows:[valid.timetable]};
    if(q.includes('from teaching_runtime.due_events where event_id=$1 for update'))return {rows:[valid.event]};
    if(q.includes('from public.teaching_class_sessions'))return {rows:[]};
    if(q.includes('update teaching_runtime.due_events'))return {rows:[{event_id:'start-1'}]};
    throw new Error('Unexpected SQL '+q);
  };
  const service=createD11ClassDueCancellation({query:sql,withTransaction:f=>f({query:sql}),clock:()=>valid.now,logger:{info() {},error(){}}});
  const result=await service.runOnce();
  assert.deepEqual(result,{candidates:1,retired:1,failed:0});
  const scan=queries.find(x=>x.q.includes('select e.event_id'));
  assert.ok(scan.q.includes("e.event_type in ('teaching.class.start_due','teaching.class.end_due')"));
  assert.ok(scan.q.includes("not exists ("));
  assert.ok(scan.q.includes("s.lifecycle_state<>'CLOSED'"));
  assert.ok(!queries.some(x=>x.q.includes('delete from')));
  assert.ok(!queries.some(x=>x.q.includes('teaching.attendance.finalization_due')));
  const update=queries.find(x=>x.q.includes('update teaching_runtime.due_events'));
  assert.ok(update.q.includes("status='SUPERSEDED'"));
  assert.ok(update.q.includes("resolution='SUPERSEDED'"));
  assert.deepEqual(update.params,['start-1','CLASS_NO_LONGER_SCHEDULED']);
});
