'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createD09Service}=require('../../../teaching/d09');

function bundle(id='c1'){
  return {
    course:{course_id:id,title:id,state_version:3,subject_snapshot_ref:'snap',lifecycle_state:'DRAFT',semester_id:'sem1'},
    plan:{course_plan_id:id+'-plan',version_no:2,plan_state:'REVIEW_READY',source_snapshot_ref:'snap'},
    units:[],dependencies:[],coverage:[],scopeChanges:[],semesterTimezone:'UTC',
  };
}
function context(){
  const item=bundle();
  return {
    course:item.course,
    semester:{semester_id:'sem1',name:'Semester',state_version:2,starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-12-01T00:00:00Z',timezone:'UTC'},
    profile:{profile_id:'profile1',version_no:4,preferences:{},settings:{}},
    availability:[],blocks:[],deadlines:[],reserves:[],courses:[item],unresolvedCourses:[],priorSlots:[],inheritedDefault:false,
  };
}

test('production D09 composition queues a durable timetable build and joins active work',async()=>{
  const events=[];
  const current=context();
  let active=null;
  const repository={
    async getSchedulingContext(){return current;},
    async latestBackgroundTimetableBuild(){return active;},
  };
  const outboxStore={
    async append(event){
      events.push(event);
      active={event_id:event.eventId,status:'PENDING',payload:event.payload};
      return {inserted:true,event:{...event,event_id:event.eventId,status:'PENDING'}};
    },
  };
  const service=createD09Service({
    repository,
    transactionalMutation:{async mutateAndPublish(){throw new Error('not used');}},
    randomUUID:()=> 'tt-job-1',
    outboxStore,
    clock:()=>new Date('2026-10-07T13:00:00Z'),
  });

  const first=await service.queueTimetableBuild({id:'student-1'},'c1',{
    operation:'BUILD',
    source:'MANUAL_BACKGROUND_BUILD',
  });
  const second=await service.queueTimetableBuild({id:'student-1'},'c1',{
    operation:'BUILD',
    source:'MANUAL_BACKGROUND_BUILD',
  });

  assert.equal(events.length,1);
  assert.equal(events[0].eventType,'teaching.timetable.build_requested');
  assert.equal(events[0].payload.expected_state_version,'3');
  assert.equal(events[0].payload.profile_version,4);
  assert.deepEqual(events[0].provenanceRefs,['course-plan:c1-plan:v2']);
  assert.equal(first.background,true);
  assert.equal(first.status,'PENDING');
  assert.equal(second.joinedExisting,true);
  assert.equal(second.jobId,'tt-job-1');
});

test('changed Semester scheduling basis queues a successor instead of joining obsolete background work',async()=>{
  const events=[];
  const current=context();
  let active=null;
  let id=0;
  const repository={
    async getSchedulingContext(){return current;},
    async latestBackgroundTimetableBuild(){return active;},
  };
  const outboxStore={
    async append(event){
      events.push(event);
      active={event_id:event.eventId,status:'PENDING',payload:event.payload};
      return {inserted:true,event:{...event,event_id:event.eventId,status:'PENDING'}};
    },
  };
  const service=createD09Service({
    repository,
    transactionalMutation:{async mutateAndPublish(){throw new Error('not used');}},
    randomUUID:()=> `tt-job-${++id}`,
    outboxStore,
    clock:()=>new Date('2026-10-07T13:00:00Z'),
  });

  const first=await service.queueTimetableBuild({id:'student-1'},'c1',{
    operation:'BUILD',source:'MANUAL_BACKGROUND_BUILD',
  });
  current.profile={...current.profile,version_no:5};
  const second=await service.queueTimetableBuild({id:'student-1'},'c1',{
    operation:'BUILD',source:'MANUAL_BACKGROUND_BUILD',
  });
  const third=await service.queueTimetableBuild({id:'student-1'},'c1',{
    operation:'BUILD',source:'MANUAL_BACKGROUND_BUILD',
  });

  assert.equal(events.length,2);
  assert.notEqual(events[0].payload.basis_digest,events[1].payload.basis_digest);
  assert.equal(first.joinedExisting,false);
  assert.equal(second.joinedExisting,false);
  assert.equal(second.supersedesJobId,'tt-job-1');
  assert.equal(events[1].causationId,'tt-job-1');
  assert.equal(third.joinedExisting,true);
  assert.equal(third.jobId,'tt-job-2');
});

test('queued timetable basis validation rejects work after shared Semester inputs change',async()=>{
  const current=context();
  const repository={
    async getSchedulingContext(){return current;},
    async latestBackgroundTimetableBuild(){return null;},
  };
  const events=[];
  const service=createD09Service({
    repository,
    transactionalMutation:{async mutateAndPublish(){throw new Error('not used');}},
    randomUUID:()=> 'tt-basis-job',
    outboxStore:{async append(event){events.push(event);return {inserted:true,event:{...event,event_id:event.eventId,status:'PENDING'}};}},
    clock:()=>new Date('2026-10-07T13:00:00Z'),
  });
  await service.queueTimetableBuild({id:'student-1'},'c1',{
    operation:'REFLOW',source:'SCHEDULE_INPUT_AUTO_RECALC',
  });
  const before=await service.validateQueuedTimetableBuild(
    {id:'student-1'},'c1',events[0].payload,
  );
  assert.equal(before.current,true);

  current.profile={...current.profile,version_no:5};
  const after=await service.validateQueuedTimetableBuild(
    {id:'student-1'},'c1',events[0].payload,
  );
  assert.equal(after.current,false);
  assert.equal(after.reason,'SCHEDULING_BASIS_CHANGED');
});

test('schedule review projects durable timetable job state for leave-and-return UI',async()=>{
  const current=context();
  const repository={
    async getScheduleReview(){
      return {
        ...current,
        timetable:null,slots:[],feasibility:null,staleSchedule:false,debtMinutes:0,
        backgroundTimetableBuild:{
          event_id:'tt-job-2',status:'CLAIMED',attempt_count:1,created_at:'2026-10-07T13:00:00Z',
          payload:{operation:'REFLOW',source:'SCHEDULE_INPUT_AUTO_RECALC'},
        },
      };
    },
  };
  const service=createD09Service({
    repository,
    transactionalMutation:{async mutateAndPublish(){throw new Error('not used');}},
    randomUUID:()=> 'unused',
    clock:()=>new Date('2026-10-07T13:02:00Z'),
  });

  const review=await service.getScheduleReview({id:'student-1'},'c1');
  assert.equal(review.backgroundBuild.active,true);
  assert.equal(review.backgroundBuild.status,'CLAIMED');
  assert.equal(review.backgroundBuild.operation,'REFLOW');
  assert.equal(review.backgroundBuild.source,'SCHEDULE_INPUT_AUTO_RECALC');
});

test('Teaching backend returns 202 for manual timetable builds and executes them through the durable worker',()=>{
  const backend=fs.readFileSync(path.resolve(__dirname,'../../../teaching-backend.js'),'utf8');
  assert.match(backend,/publishedEventRegistry\.register\('teaching\.timetable\.build_requested'/);
  assert.match(backend,/subscriberId: 'd09-timetable-background-worker'/);
  assert.match(backend,/queueTimetableBuild\(req\.user, req\.params\.id/);
  assert.match(backend,/res\.status\(202\)\.json/);
  assert.match(backend,/operation: 'BUILD'/);
  assert.match(backend,/operation === 'REFLOW'/);
  assert.match(backend,/expected_state_version/);
  assert.match(backend,/validateQueuedTimetableBuild/);
  assert.match(backend,/SCHEDULING_BASIS_CHANGED/);
});

test('both Schedule surfaces show and poll durable background timetable state',()=>{
  const active=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-schedule-experience.js'),'utf8');
  const legacy=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d09.js'),'utf8');
  for(const source of [active,legacy]){
    assert.match(source,/backgroundBuild/);
    assert.match(source,/Timetable building in background/);
    assert.match(source,/build will continue/);
    assert.match(source,/5000/);
  }
});
