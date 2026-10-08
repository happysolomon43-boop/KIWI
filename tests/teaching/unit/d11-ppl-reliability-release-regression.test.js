'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildPreparationEvent}=require('../../../teaching/preparation/events');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');
const {validateTeachingEvent}=require('../../../teaching/events/contracts');
const {scheduledEvent}=require('../../../teaching/d11/service');
const {preparationReviewDueAt,shouldDeferPreparation}=require('../../../teaching/d11/preparation-window');

function loadHandler({result={done:false},fail=null,end='2026-10-09T12:00:00Z',startAt='2026-10-09T10:00:00Z'}={}){
  const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/service.js'),'utf8');
  const start=source.indexOf('  async function handlePreparationEvent(event) {');
  const finish=source.indexOf('\n  async function startController(',start);
  assert.ok(start>0&&finish>start);
  const events=[],reviews=[];let modelCalls=0;
  const runtime={
    intelligence:{},
    preparationRepository:{getWorkspace:async()=>({workspace_id:'workspace-1',student_id:'student-1',target_kind:'next_class',target_ref:'class-1',lifecycle_state:'ACTIVE',state_version:2})},
    repository:{getClassContext:async()=>({classRow:{class_id:'class-1',course_id:'course-1',lifecycle_state:'SCHEDULED',scheduled_start_at:startAt,scheduled_end_at:end,schedule_version:1,source_timetable_version_id:'approved-1',course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED'},plan:{course_plan_id:'plan-1',version_no:1}})},
    dueEventStore:{enqueue:async event=>{reviews.push(event);return {inserted:true,event};}},
    scheduledEvent,preparationReviewDueAt,shouldDeferPreparation,
    fail:(message,code,status)=>{const error=new Error(message);error.code=code;error.status=status;throw error;},
    preparationStep:async()=>{modelCalls+=1;if(fail)throw fail;return result;},
    outboxStore:{append:async event=>{events.push(event);return {inserted:true,event};}},
    buildPreparationEvent,
    TEACHING_EVENTS,
    clock:()=>new Date('2026-10-08T10:00:00Z'),
    randomUUID:()=> 'generated-id',
    canonicalEventField:(event,camel,snake)=>event[camel]??event[snake]??null,
  };
  const args=Object.keys(runtime),handler=new Function(...args,source.slice(start,finish)+'\nreturn handlePreparationEvent;')(...Object.values(runtime));
  return {handler,events,reviews,getModelCalls:()=>modelCalls};
}
const seed={eventId:'seed-1',aggregateId:'workspace-1',correlationId:'cor-1'};
test('D11 progressive next-class PPL emits durable, validated, idempotent continuation for next maturity stage',async()=>{
  const {handler,events}=loadHandler();
  const result=await handler(seed);
  assert.equal(result.done,false);
  assert.equal(result.continuationQueued,true);
  assert.equal(events.length,1);
  const event=events[0];
  assert.equal(event.eventType,TEACHING_EVENTS.PREPARATION_INPUT_CHANGED);
  assert.equal(event.aggregateId,'workspace-1');
  assert.equal(event.aggregateVersion,2);
  assert.equal(event.idempotencyKey.includes('workspace-1'),true);
  assert.equal(event.payload.reason,'STAGED_LESSON_PREPARATION_CONTINUATION');
  assert.ok(validateTeachingEvent(event));
});
test('D11 PPL failures propagate for durable retry, rather than being falsely acknowledged',async()=>{
  const error=Object.assign(new Error('Model route failed'),{code:'TEST_MODEL_FAILURE'});
  const {handler,events}=loadHandler({fail:error});
  await assert.rejects(handler(seed),{code:'TEST_MODEL_FAILURE'});
  assert.equal(events.length,0);
});
test('D11 skips elapsed and cancelled PPL workspaces rather than running costly stale planning',async()=>{
  const {handler,events}=loadHandler({startAt:'2026-10-08T08:00:00Z',end:'2026-10-08T09:00:00Z'});
  const result=await handler(seed);
  assert.equal(result.reason,'CLASS_NO_LONGER_PREPARABLE');
  assert.equal(result.modelWorkStarted,undefined);
  assert.equal(events.length,0);
});
test('D11 PPL completed stage does not spin or emit another continuation',async()=>{
  const {handler,events}=loadHandler({result:{done:true}});
  const result=await handler(seed);
  assert.equal(result.done,true);
  assert.equal(result.continuationQueued,false);
  assert.equal(events.length,0);
});
test('D11 expired scheduled starts are superseded and cannot mint sessions or attendance',()=>{
  const controller=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/service.js'),'utf8');
  const runtime=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/runtime.js'),'utf8');
  assert.match(controller,/TEACHING_D11_CLASS_WINDOW_EXPIRED/);
  assert.match(runtime,/reason:'CLASS_START_WINDOW_EXPIRED'/);
  assert.match(runtime,/RECONCILIATION_DISPOSITIONS\.SUPERSEDED/);
});


test('D11 future next-Class workspace schedules a durable review instead of consuming models weeks early',async()=>{
  const {handler,events,reviews,getModelCalls}=loadHandler({
    startAt:'2026-11-10T10:00:00Z',end:'2026-11-10T12:00:00Z',
  });
  const result=await handler(seed);
  assert.equal(result.deferred,true);
  assert.equal(result.modelWorkStarted,false);
  assert.equal(getModelCalls(),0);
  assert.equal(events.length,0);
  assert.equal(reviews.length,1);
  assert.equal(reviews[0].eventType,TEACHING_EVENTS.PREPARATION_REVIEW_DUE);
  assert.equal(reviews[0].dueAt,'2026-11-07T10:00:00.000Z');
  assert.equal(reviews[0].payload.preparation_workspace_id,'workspace-1');
  assert.equal(reviews[0].payload.workspace_state_version,2);
  assert.equal(reviews[0].payload.schedule_version,1);
  assert.equal(reviews[0].triggerType,'system_time');
  assert.ok(validateTeachingEvent(reviews[0]));
});
test('Preparation lead-window boundary is deterministic across Course and timezone strings',()=>{
  assert.equal(shouldDeferPreparation('2026-10-12T09:00:00Z',new Date('2026-10-09T08:59:59Z')),true);
  assert.equal(shouldDeferPreparation('2026-10-12T09:00:00Z',new Date('2026-10-09T09:00:00Z')),false);
  assert.equal(preparationReviewDueAt('2026-11-08T09:00:00+01:00'),'2026-11-05T08:00:00.000Z');
  assert.throws(()=>preparationReviewDueAt('not-a-date'),TypeError);
});
