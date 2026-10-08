'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createD14ClassroomRepository}=require('../../../teaching/repositories/d14-classroom');
const {createD14Service}=require('../../../teaching/d14/service');

function classroomFake(parent={class_state:'CANCELLED',course_state:'ACTIVE',timetable_state:'SUPERSEDED'}){
  const statements=[];
  const run=async(sql,values=[])=>{
    statements.push({sql,values});
    if(sql.includes('from public.teaching_teacher_communications where student_id=$1 and idempotency_key=$2'))return {rows:[]};
    if(sql.includes('from public.teaching_classroom_interactions where student_id=$1 and idempotency_key=$2'))return {rows:[]};
    if(sql.includes('from public.teaching_classes c')&&sql.includes('for share of c,co'))return {rows:[parent]};
    if(sql.includes('from public.teaching_class_sessions where student_id=$1 and class_id=$2 for update'))
      return {rows:[{class_session_id:'session',state_version:2,lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION'}]};
    if(sql.includes('insert into public.teaching_classroom_help_requests'))return {rows:[]};
    if(sql.includes('insert into public.teaching_teacher_communications')||sql.includes('insert into public.teaching_classroom_interactions'))
      return {rows:[{interaction_id:'interaction'}]};
    throw Error('Unexpected SQL '+sql);
  };
  const repo=createD14ClassroomRepository({
    query:run,withTransaction:fn=>fn({query:run}),randomUUID:()=> 'uuid',
    d11Repository:{getClassContext:async()=>({})},
    outboxStore:{appendUsing:async(_query,event)=>{statements.push({sql:'teaching_runtime.event_outbox append',values:[event]});return {inserted:true};}},
  });
  return {repo,statements};
}
test('cancelled Class denies Teacher publication after model returns before SQL commit',async()=>{
  const {repo,statements}=classroomFake();
  await assert.rejects(repo.publishTeacherTurn({
    studentId:'u',classId:'c',expectedControllerVersion:2,
    message:'AI output that must never publish',idempotencyKey:'teacher-1'
  }),{code:'TEACHING_D14_PARENT_AUTHORITY_REVOKED',retryable:false});
  assert.ok(statements.some(x=>x.sql.includes('for share of c,co')));
  assert.ok(!statements.some(x=>x.sql.includes('insert into public.teaching_teacher_communications')));
});
test('cancelled Course or superseded timetable denies student Teacher messages even if session remains active',async()=>{
  for(const parent of [
    {class_state:'SCHEDULED',course_state:'INCOMPLETE',timetable_state:'APPROVED'},
    {class_state:'SCHEDULED',course_state:'ACTIVE',timetable_state:'SUPERSEDED'},
  ]){
    const {repo,statements}=classroomFake(parent);
    await assert.rejects(repo.recordInteraction({
      studentId:'u',classId:'c',session:{class_session_id:'session',state_version:2},
      kind:'ASK_TEACHER',body:'Why?',idempotencyKey:'student-1',
    }),{code:'TEACHING_D14_PARENT_AUTHORITY_REVOKED'});
    assert.ok(!statements.some(x=>x.sql.includes('insert into public.teaching_classroom_interactions')));
  }
});
test('new Classroom JOIN cannot create attendance evidence for a cancelled timetable',async()=>{
  const {repo,statements}=classroomFake({
    class_state:'SCHEDULED',course_state:'ACTIVE',timetable_state:'SUPERSEDED'
  });
  await assert.rejects(repo.recordInteraction({
    studentId:'u',classId:'c',session:null,kind:'JOIN',body:null,idempotencyKey:'join-cancelled',
  }),{code:'TEACHING_D14_PARENT_AUTHORITY_REVOKED'});
  assert.ok(!statements.some(x=>x.sql.includes('insert into public.teaching_classroom_interactions')));
});
test('legitimate active current Teacher messaging holds parent authority through commit',async()=>{
  const {repo,statements}=classroomFake({
    class_state:'SCHEDULED',course_state:'ACTIVE',timetable_state:'APPROVED'
  });
  const result=await repo.recordInteraction({
    studentId:'u',classId:'c',session:{class_session_id:'session',state_version:2},
    kind:'NEED_HELP',body:'Help me',idempotencyKey:'student-2',
  });
  assert.equal(result.interaction_id,'interaction');
  assert.ok(statements.find(x=>x.sql.includes('insert into public.teaching_classroom_interactions')));
  assert.ok(statements.find(x=>x.sql.includes('insert into public.teaching_classroom_help_requests')));
  assert.ok(statements.find(x=>x.sql.includes('teaching_runtime.event_outbox append')));
});
test('historical LEAVE intent remains outside AI conversation cancellation',async()=>{
  const {repo,statements}=classroomFake();
  await repo.recordInteraction({
    studentId:'u',classId:'c',session:{class_session_id:'session',state_version:2},
    kind:'LEAVE',body:null,idempotencyKey:'leave-1',
  });
  assert.ok(!statements.some(x=>x.sql.includes('for share of c,co')));
});
test('Classroom snapshot and early entry refuse revoked timetable authority',async()=>{
  const ctx={classRow:{
    class_id:'c',course_id:'course',lifecycle_state:'SCHEDULED',
    course_lifecycle_state:'ACTIVE',source_timetable_state:'SUPERSEDED',
    scheduled_start_at:'2026-10-08T09:00:00Z',scheduled_end_at:'2026-10-08T10:00:00Z',
  },session:{class_session_id:'session',state_version:2,lifecycle_state:'ACTIVE',
    instructional_substate:'INSTRUCTION',progress_state:{}}};
  const repository={
    identity:async()=>({course_title:'Course'}),board:async()=>[],notebook:async()=>[],
    latestNote:async()=>null,latestTeacherMessage:async()=>null,firstEntry:async()=>null,
    conversation:async()=>[],
  };
  const d14=createD14Service({
    repository,d11Repository:{getClassContext:async()=>ctx},
    d11Service:{getClass:async()=>({class:{},controller:{},time:{}})},
    d12Service:{},clock:()=>new Date('2026-10-08T09:15:00Z'),
    randomUUID:()=> 'uuid',
  });
  const snapshot=await d14.snapshot({id:'u'},'c');
  assert.equal(snapshot.teacherMessagingAllowed,false);
  await assert.rejects(d14.signal({id:'u'},'c',{kind:'ASK_TEACHER',body:'A',idempotencyKey:'ask'}),{
    code:'TEACHING_D14_TEACHER_MESSAGES_PAUSED'
  });
  ctx.session=null;
  await assert.rejects(d14.enter({id:'u'},'c'),{code:'TEACHING_D14_CLASS_TIMETABLE_SUPERSEDED'});
});
