'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createD14Service,classroomEntryWindow,CLASSROOM_EARLY_ENTRY_MINUTES}=require('../../../teaching/d14/service');

const classRow={
  class_id:'class-1',course_id:'course-1',lifecycle_state:'SCHEDULED',
  scheduled_start_at:'2026-10-06T08:00:00.000Z',
  scheduled_end_at:'2026-10-06T09:30:00.000Z',
};

function makeService(now){
  const interactions=[];
  const repository={
    async recordInteraction(value){interactions.push(value);return {interaction_id:'join-1',interaction_kind:value.kind,created_at:now};},
  };
  const d11Repository={async getClassContext(){return {classRow,session:null,blueprint:null};}};
  const service=createD14Service({
    repository,d11Repository,d11Service:{},d12Service:{},clock:()=>new Date(now),randomUUID:()=> 'uuid-1',
  });
  return {service,interactions};
}

test('D14 Classroom opens exactly one hour before the authoritative Class start',()=>{
  assert.equal(CLASSROOM_EARLY_ENTRY_MINUTES,60);
  const locked=classroomEntryWindow(classRow,new Date('2026-10-06T06:59:59.000Z'));
  assert.equal(locked.phase,'LOCKED');
  assert.equal(locked.entryAllowed,false);
  assert.equal(locked.liveStartAllowed,false);
  assert.equal(locked.opensAt,'2026-10-06T07:00:00.000Z');
  const preClass=classroomEntryWindow(classRow,new Date('2026-10-06T07:00:00.000Z'));
  assert.equal(preClass.phase,'PRE_CLASS');
  assert.equal(preClass.entryAllowed,true);
  assert.equal(preClass.liveStartAllowed,false);
  const live=classroomEntryWindow(classRow,new Date('2026-10-06T08:00:00.000Z'));
  assert.equal(live.phase,'CLASS_TIME');
  assert.equal(live.entryAllowed,true);
  assert.equal(live.liveStartAllowed,true);
});

test('D14 server rejects early Classroom entry even if the UI button is bypassed',async()=>{
  const {service,interactions}=makeService('2026-10-06T06:45:00.000Z');
  await assert.rejects(()=>service.enter({id:'student-1'},'class-1'),(error)=>{
    assert.equal(error.code,'TEACHING_D14_CLASSROOM_NOT_OPEN');
    assert.equal(error.status,423);
    assert.match(error.message,/60 minutes before/);
    return true;
  });
  assert.equal(interactions.length,0);
});

test('D14 pre-Class entry records presence but explicitly does not start live teaching',async()=>{
  const {service,interactions}=makeService('2026-10-06T07:30:00.000Z');
  const result=await service.enter({id:'student-1'},'class-1');
  assert.equal(result.entryWindow.phase,'PRE_CLASS');
  assert.equal(result.liveTeachingStarted,false);
  assert.equal(interactions.length,1);
  assert.equal(interactions[0].kind,'JOIN');
});
