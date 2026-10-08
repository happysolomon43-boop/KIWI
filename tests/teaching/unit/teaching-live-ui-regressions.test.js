'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createD14Service}=require('../../../teaching/d14/service');
const root=path.resolve(__dirname,'../../..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');

function classroomFixture({mode='INSTRUCTION',classState='SCHEDULED',courseState='ACTIVE',timetableState='APPROVED',sessionState='ACTIVE'}={}){
  const row={
    class_id:'c1',course_id:'co1',scheduled_start_at:'2026-10-08T10:00:00Z',
    scheduled_end_at:'2026-10-08T12:00:00Z',lifecycle_state:classState,
    course_lifecycle_state:courseState,source_timetable_state:timetableState,
    schedule_version:2,course_state_version:3,
  };
  const session=sessionState?{
    class_session_id:'s1',state_version:4,lifecycle_state:sessionState,
    instructional_substate:mode,progress_state:{},
  }:null;
  const repository={
    identity:async()=>({course_title:'Test Course'}),
    board:async()=>[],notebook:async()=>[],latestNote:async()=>null,
    latestTeacherMessage:async()=>null,firstEntry:async()=>null,
    conversation:async()=>[],helpRequests:async()=>[],
    recordInteraction:async(input)=>({...input,interaction_id:'i1',interaction_kind:input.kind,help_request_id:'h1',created_at:'2026-10-08T10:20:00Z'}),
  };
  const d11Repository={
    getClassContext:async()=>({classRow:row,session,blueprint:{planned_learning_unit_refs:[],blueprint_payload:{objectives:[]}}}),
    getClosureFact:async()=>null,
  };
  const d11Service={
    getClass:async()=>({class:{scheduledStartAt:row.scheduled_start_at,scheduledEndAt:row.scheduled_end_at},controller:{lifecycleState:session?.lifecycle_state||'PENDING'},time:{}}),
    getSummary:async()=>null,
  };
  return createD14Service({repository,d11Repository,d11Service,d12Service:{},clock:()=>new Date('2026-10-08T10:20:00Z'),randomUUID:()=> 'uuid'});
}
test('NEED HELP exists only in live approved instructional modes, with server enforcement',async()=>{
  const good=['OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','REMEDIATION'];
  const blocked=['ASSESSMENT','CLASSWORK','BREAK','INTERRUPTED','CLOSURE'];
  for(const mode of good){
    const app=classroomFixture({mode});
    assert.equal((await app.snapshot({id:'student'},'c1')).teacherMessagingAllowed,true,mode);
    assert.equal((await app.signal({id:'student'},'c1',{kind:'NEED_HELP',body:'Can you explain?',idempotencyKey:'key-'+mode})).status,'HELP_RAISED');
  }
  for(const mode of blocked){
    const app=classroomFixture({mode});
    assert.equal((await app.snapshot({id:'student'},'c1')).teacherMessagingAllowed,false,mode);
    await assert.rejects(app.signal({id:'student'},'c1',{kind:'NEED_HELP',body:'Can you explain?',idempotencyKey:'key'}),{code:'TEACHING_D14_TEACHER_MESSAGES_PAUSED'});
  }
  for(const flags of [{sessionState:'CLOSED'},{sessionState:null},{classState:'COMPLETED'},{classState:'CANCELLED'},{courseState:'DRAFT'},{timetableState:'PROPOSED'},{timetableState:'SUPERSEDED'}]){
    const app=classroomFixture(flags);
    assert.equal((await app.snapshot({id:'student'},'c1')).teacherMessagingAllowed,false,JSON.stringify(flags));
    await assert.rejects(app.signal({id:'student'},'c1',{kind:'NEED_HELP',body:'Can you explain?',idempotencyKey:'key'}),{code:flags.sessionState===null?'TEACHING_D14_CONTROLLER_NOT_STARTED':flags.sessionState==='CLOSED'?'TEACHING_D14_CLASS_CLOSED':'TEACHING_D14_TEACHER_MESSAGES_PAUSED'});
  }
});
test('live Classroom Details retains its expanded state and remains inline on small screens',()=>{
  const ui=read('public/teaching-classroom.js'),styles=read('public/teaching-classroom.css');
  assert.match(ui,/controlsWasOpen=Boolean/);
  assert.match(ui,/nextControls\.open=true/);
  assert.match(ui,/HELP|NEED HELP\?/);
  const fixed=styles.indexOf('.tc-controls[open]{position:fixed');
  const inline=styles.lastIndexOf('.tc-controls,.tc-controls[open]{position:static');
  assert.ok(fixed>=0&&inline>fixed,'mobile inline Details must override old fixed popup');
});
test('Course UI refreshes without auto-reload or editor reconstruction on clock-only updates',()=>{
  const shell=read('public/teaching.js'),classroom=read('public/teaching-classroom.js');
  assert.doesNotMatch(shell,/if\(!editing\)\{window\.location\.reload\(\);return;\}/);
  assert.match(shell,/A new frontend release is never permission to destroy/);
  assert.match(shell,/if\(activeTeachingView==='overview'\) renderActiveTeachingView\(\)/);
  assert.match(classroom,/comparable\(previous\)===comparable\(data\)/);
});
test('mobile dock and drawer share canonical destination and icons, with reachable backdrop',()=>{
  const shell=read('public/teaching.js'),html=read('public/teaching.html'),work=read('public/teaching-d16.js');
  assert.match(shell,/\{ id: 'overview', title: 'Courses'/);
  assert.match(shell,/\{ id: 'courses', label: 'Courses', icon: 'overview'/);
  assert.match(shell,/iconNode\.innerHTML = menuIcon\(icon/);
  assert.match(shell,/aria-current/);
  assert.match(work,/menuIcon:'work'/);
  assert.match(html,/\.teaching-dock__icon svg/);
  assert.match(html,/calc\(100vw - 76px\)/);
});
test('Calendar and rebuild status distinguish published old jobs from new build, preserving proposals',()=>{
  const ui=read('public/teaching-d09.js'),d23=read('teaching/d23/service.js'),repository=read('teaching/repositories/d09-scheduling.js');
  assert.match(ui,/jobId&&build\?\.eventId!==jobId/);
  assert.match(ui,/if\(error\?\.code==='KIWI_API_TIMEOUT'\)/);
  assert.match(ui,/without replacing the visible timetable/);
  assert.match(ui,/signature!==lastCalendarSignature/);
  assert.match(d23,/const assessmentsPromise=coursesPromise\.then/);
  assert.match(repository,/authoritativeView[\s\S]*latestApprovedTimetable/);
  assert.match(repository,/t\.timetable_state in \('PROPOSED','EDITED_PROPOSAL'\)/);
  assert.match(repository,/and not exists \(/);
});
