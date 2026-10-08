'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerD11Runtime}=require('../../../teaching/d11/runtime');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');
const {RECONCILIATION_DISPOSITIONS}=require('../../../teaching/runtime/constants');

function fixture(){
  const registrations=new Map(),calls=[];
  const row={student_id:'student-a',class_id:'class-a',course_id:'course-a',lifecycle_state:'SCHEDULED',
    course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED',source_timetable_version_id:'timetable-a',
    scheduled_start_at:'2027-02-10T10:00:00.000Z',scheduled_end_at:'2027-02-10T11:30:00.000Z',schedule_version:7};
  const workspace={workspace_id:'workspace-a',lifecycle_state:'ACTIVE',maturity_stage:'SKELETON',state_version:4};
  const ctx={classRow:row,workspace,session:null};
  const service={
    startController:async()=>({}),refreshCoursePreparation:async()=>[],
    handlePreparationEvent:async event=>{calls.push(event);return {modelWorkStarted:true,deferred:false}},
  };
  registerD11Runtime({
    publishedEvents:{register:()=>({})},eventRuntime:{register:(name,spec)=>registrations.set(name,spec)},
    dueEventStore:{enqueue:async()=>({inserted:true})},
    repository:{getClassContext:async()=>ctx,listClassesForCourse:async()=>[]},
    service,outboxStore:{append:async()=>({inserted:true})},
  });
  const event={event_id:'d11-ppl-review:workspace-a:state-v4:schedule-v7',
    actor_id:'student-a',aggregate_id:'class-a',correlation_id:'corr-a',
    payload:{class_id:'class-a',preparation_workspace_id:'workspace-a',
      workspace_state_version:4,schedule_version:7,timetable_version_id:'timetable-a'}};
  return {registrations,calls,ctx,event};
}
test('D02 deferred Class review reconciles current workspace and hands off to D11 once',async()=>{
  const x=fixture(),reg=x.registrations.get(TEACHING_EVENTS.PREPARATION_REVIEW_DUE);
  assert.ok(reg);
  const result=await reg.reconcile(x.event);
  assert.equal(result.disposition,RECONCILIATION_DISPOSITIONS.ACTIONABLE);
  const next=await reg.handle(x.event);
  assert.equal(next.safeMetadata.model_work_started,true);
  assert.equal(x.calls.length,1);
  assert.equal(x.calls[0].aggregateId,'workspace-a');
  assert.equal(x.calls[0].eventId,x.event.event_id);
});
test('stale deferred reviews are superseded for new timetable, schedule version, Class, or workspace',async()=>{
  const states=[
    ctx=>{ctx.classRow={...ctx.classRow,lifecycle_state:'CANCELLED'};},
    ctx=>{ctx.classRow={...ctx.classRow,source_timetable_state:'SUPERSEDED'};},
    ctx=>{ctx.classRow={...ctx.classRow,source_timetable_version_id:'tt-new'};},
    ctx=>{ctx.classRow={...ctx.classRow,schedule_version:8};},
    ctx=>{ctx.classRow={...ctx.classRow,course_lifecycle_state:'PAUSED'};},
    ctx=>{ctx.classRow={...ctx.classRow,scheduled_start_at:'2020-01-01T10:00:00.000Z'};},
    ctx=>{ctx.session={lifecycle_state:'ACTIVE'};},
    ctx=>{ctx.workspace={...ctx.workspace,workspace_id:'ws-new'};},
    ctx=>{ctx.workspace={...ctx.workspace,state_version:5};},
  ];
  for(const change of states){
    const x=fixture();change(x.ctx);
    const outcome=await x.registrations.get(TEACHING_EVENTS.PREPARATION_REVIEW_DUE).reconcile(x.event);
    assert.equal(outcome.disposition,RECONCILIATION_DISPOSITIONS.SUPERSEDED);
    assert.equal(x.calls.length,0);
  }
});
test('review events for completed PPL workspaces are idempotently satisfied',async()=>{
  const x=fixture();x.ctx.workspace={...x.ctx.workspace,maturity_stage:'PRE_LOCK_READY',lifecycle_state:'HANDED_OFF'};
  const outcome=await x.registrations.get(TEACHING_EVENTS.PREPARATION_REVIEW_DUE).reconcile(x.event);
  assert.equal(outcome.disposition,RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED);
});
test('review scheduling cannot swallow timer registration failure and silently lose Class preparation',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/service.js'),'utf8');
  const runtime=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/runtime.js'),'utf8');
  assert.match(src,/TEACHING_D11_PREPARATION_REVIEW_SCHEDULER_UNAVAILABLE/);
  assert.match(src,/eventType:TEACHING_EVENTS\.PREPARATION_REVIEW_DUE/);
  assert.match(runtime,/eventRuntime\.register\(TEACHING_EVENTS\.PREPARATION_REVIEW_DUE/);
  assert.match(runtime,/PREPARATION_CLASS_NO_LONGER_CURRENT/);
});
