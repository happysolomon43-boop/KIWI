'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createD11RuntimeRecovery}=require('../../../teaching/d11/runtime-recovery');
const {createD11RuntimeRecoveryRepository}=require('../../../teaching/repositories/d11-runtime-recovery');

const candidate=(id='class-alpha')=>({
  class_id:id,student_id:'student-1',course_id:'course-2',
  source_timetable_version_id:'approved-v4',schedule_version:3,
});

test('recovery repository searches all Courses through authoritative Class/timetable and missing runtime joins',async()=>{
  let statement,params;
  const repository=createD11RuntimeRecoveryRepository({query:async(sql,p)=>{statement=sql;params=p;return {rows:[candidate()]};}});
  const rows=await repository.listMissingCurrentClasses({dayKey:'20261008',limit:500});
  assert.equal(rows.length,1);
  assert.deepEqual(params,['20261008',64]);
  for(const marker of [
    "c.lifecycle_state='SCHEDULED'","co.lifecycle_state='ACTIVE'","t.timetable_state='APPROVED'",
    'c.scheduled_start_at>now()','teaching_class_sessions','teaching_preparation.workspaces',
    'teaching_runtime.due_events','teaching_runtime.event_outbox'
  ])assert.ok(statement.includes(marker),marker);
  assert.ok(!statement.includes('c.course_id=$'),'must not filter to originating Course');
  await assert.rejects(()=>repository.listMissingCurrentClasses({dayKey:'invalid'}),/UTC day key/);
});

test('durable recovery emits one guarded reconciliation per missing Class without creating academic truth',async()=>{
  let captured=[];
  const repository={listMissingCurrentClasses:async(input)=>{assert.deepEqual(input,{dayKey:'20261008',limit:32});return [candidate(),candidate('class-beta')];}};
  const recover=createD11RuntimeRecovery({
    repository,outboxStore:{append:async(event)=>{captured.push(event);return {inserted:true};}},
    clock:()=>new Date('2026-10-08T13:41:00Z'),
    logger:{info() {},error(){throw new Error('unexpected error');}}
  });
  assert.deepEqual(await recover.runOnce(),{scanned:2,enqueued:2,failed:0});
  assert.equal(captured[0].eventType,'teaching.class.preparation_reconcile');
  assert.equal(captured[0].eventId,'d11-class-runtime-audit:class-alpha:schedule-v3:20261008');
  assert.equal(captured[0].aggregateVersion,3);
  assert.equal(captured[0].actorId,'student-1');
  assert.equal(captured[0].payload.timetable_version_id,'approved-v4');
  assert.equal(captured[0].payload.schedule_version,3);
  assert.equal(captured[0].idempotencyKey,captured[0].eventId);
  assert.notEqual(captured[0].eventId,captured[1].eventId);
  assert.equal(captured[0].payload.reason,'AUTHORITATIVE_RUNTIME_GAP_RECONCILIATION');
  assert.equal(JSON.stringify(captured).includes('LESSON_BLUEPRINT'),false,'recovery must not forge a lesson Blueprint');
});

test('one queue failure does not suppress other classes and is reported',async()=>{
  const problems=[];
  const recover=createD11RuntimeRecovery({
    repository:{listMissingCurrentClasses:async()=>[candidate(),candidate('class-beta')]},
    outboxStore:{append:async(e)=>{if(e.aggregateId==='class-alpha')throw Object.assign(new Error('offline'),{code:'DB_TEMPORARY'});}},
    clock:()=>new Date('2026-10-08T13:41:00Z'),
    logger:{info() {},error:(s,code)=>problems.push(code)}
  });
  assert.deepEqual(await recover.runOnce(),{scanned:2,enqueued:1,failed:1});
  assert.deepEqual(problems,['DB_TEMPORARY']);
});

test('concurrent sweeps do not duplicate events',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve);
  const recover=createD11RuntimeRecovery({
    repository:{listMissingCurrentClasses:async()=>{await pending;return [candidate()];}},
    outboxStore:{append:async()=>({inserted:true})},
    logger:{info() {}}
  });
  const first=recover.runOnce();
  assert.deepEqual(await recover.runOnce(),{skipped:true,reason:'RECOVERY_ALREADY_RUNNING'});
  release();assert.equal((await first).enqueued,1);
});
