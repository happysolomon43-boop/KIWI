'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {obsoletePreparationReason,createD11PreparationCancellation}=
  require('../../../teaching/d11/preparation-cancellation');

const parent={
  klass:{class_id:'c',student_id:'s',course_id:'course',lifecycle_state:'SCHEDULED',
    schedule_version:2,source_timetable_version_id:'t',scheduled_end_at:'2026-10-15T00:00:00Z'},
  course:{course_id:'course',student_id:'s',lifecycle_state:'ACTIVE',state_version:8},
  timetable:{timetable_version_id:'t',timetable_state:'APPROVED'},
  plan:{course_plan_id:'plan',version_no:4},
  bundle:{preconditions:{course_plan_id:'plan',course_plan_version:4,course_state_version:8,
    class_schedule_version:2,timetable_version_id:'t'}},
  now:new Date('2026-10-08T12:00:00Z'),
};
test('cancellation covers Course, Class, replaced timetable and removed Topic through Course Plan lineage',()=>{
  assert.equal(obsoletePreparationReason(parent),null);
  const changed=(key,patch)=>obsoletePreparationReason({...parent,[key]:{...parent[key],...patch}});
  assert.equal(changed('klass',{lifecycle_state:'CANCELLED'}),'CLASS_CANCELLED');
  assert.equal(changed('course',{lifecycle_state:'INCOMPLETE'}),'COURSE_NOT_ACTIVE');
  assert.equal(changed('course',{lifecycle_state:'PAUSED'}),'COURSE_NOT_ACTIVE');
  assert.equal(changed('timetable',{timetable_state:'SUPERSEDED'}),'TIMETABLE_SUPERSEDED');
  assert.equal(changed('plan',{course_plan_id:'plan-v5',version_no:5}),'COURSE_PLAN_SUPERSEDED');
  assert.equal(changed('plan',{version_no:5}),'COURSE_PLAN_VERSION_CHANGED');
  assert.equal(changed('klass',{schedule_version:3}),'CLASS_SCHEDULE_CHANGED');
  assert.equal(changed('course',{state_version:9}),'COURSE_VERSION_CHANGED');
  assert.equal(obsoletePreparationReason({...parent,klass:null}),'CLASS_REMOVED');
  assert.equal(obsoletePreparationReason({...parent,bundle:null}),'INPUT_BUNDLE_MISSING');
  assert.equal(obsoletePreparationReason({...parent,liveSession:true,
    klass:{...parent.klass,lifecycle_state:'CANCELLED'}}),null,'live academic sessions must be preserved');
  assert.equal(obsoletePreparationReason({...parent,now:new Date('2026-10-16T00:00:00Z')}),'CLASS_PREPARATION_WINDOW_CLOSED');
});

function fake({lifecycle='CANCELLED',courseLifecycle='ACTIVE',timetableState='SUPERSEDED',
    planVersion=4,hasActiveSession=false,workspaceLifecycle='ACTIVE'}={}){
  const queries=[],notices=[];
  const data={
    workspace_id:'w-1',target_ref:'c',student_id:'s',lifecycle_state:workspaceLifecycle,
    workspace_type:'LESSON_BLUEPRINT',target_kind:'next_class',maturity_stage:'SKELETON',
    state_version:1,current_authoritative_input_bundle_ref:'bundle',
  };
  const sql=async(q,params=[])=>{
    queries.push({q,params});
    if(q.includes('select w.workspace_id'))return {rows:[{workspace_id:'w-1'}]};
    if(q.includes('select student_id,target_ref'))return {rows:[{student_id:'s',target_ref:'c'}]};
    if(q.includes('from public.teaching_classes where'))return {rows:[{...parent.klass,lifecycle_state:lifecycle}]};
    if(q.includes('from public.teaching_courses where'))return {rows:[{...parent.course,lifecycle_state:courseLifecycle}]};
    if(q.includes('from public.teaching_timetable_versions where'))return {rows:[{...parent.timetable,timetable_state:timetableState}]};
    if(q.includes('from public.teaching_course_plans where'))return {rows:[{...parent.plan,version_no:planVersion}]};
    if(q.includes('from teaching_preparation.workspaces where workspace_id=$1 for update'))return {rows:[data]};
    if(q.includes('from public.teaching_class_sessions'))return {rows:hasActiveSession?[{one:1}]:[]};
    if(q.includes('select preconditions from teaching_preparation.authoritative_input_bundles'))return {rows:[parent.bundle]};
    if(q.includes('update teaching_preparation.workspaces'))return {rows:[{...data,lifecycle_state:'SUPERSEDED',state_version:2}]};
    if(q.includes('update teaching_runtime.event_outbox'))return {rows:[{event_id:'pending-ppl'}]};
    if(q.includes('update teaching_runtime.due_events'))return {rows:[{event_id:'pending-due'}]};
    if(q.includes('insert into public.teaching_academic_audit_log'))return {rows:[]};
    throw new Error('Unexpected SQL: '+q.slice(0,100));
  };
  const instance=createD11PreparationCancellation({
    query:sql,withTransaction:fn=>fn({query:sql}),randomUUID:()=> 'audit-1',
    clock:()=>parent.now,
    logger:{info:(...x)=>notices.push(x),error:(...x)=>notices.push(x)},
  });
  return {instance,queries,notices};
}
test('Class cancellation retires workspace, stops queued PPL, prevents future class due and preserves audit',async()=>{
  const {instance,queries}=fake();
  const result=await instance.retireOne('w-1');
  assert.equal(result.retired,true);
  assert.equal(result.reason,'CLASS_CANCELLED');
  assert.equal(result.queuedAiCancelled,1);
  assert.equal(result.reviewsSuperseded,1);
  assert.equal(result.classDueSuperseded,1);
  assert.ok(queries.some(x=>x.q.includes('for share')),'lock authoritative Class first');
  assert.ok(queries.some(x=>x.q.includes('for update')),'lock Workspace before lifecycle mutation');
  assert.ok(queries.some(x=>x.q.includes("status='CANCELLED'")&&x.q.includes("status in ('PENDING','RETRY_WAIT')")));
  assert.ok(queries.some(x=>x.q.includes("resolution='SUPERSEDED'")));
  assert.ok(queries.some(x=>x.q.includes('preparation.workspace.parent_reconciled')));
  assert.ok(!queries.some(x=>x.q.includes('delete from')),'all provenance remains retained');
  assert.ok(!queries.some(x=>x.q.includes('teaching_attendance_records')),'must not change Attendance Ledger');
});

test('a Course Plan version change retires old model work but preserves Class start/end',async()=>{
  const {instance,queries}=fake({lifecycle:'SCHEDULED',timetableState:'APPROVED',planVersion:5});
  const result=await instance.retireOne('w-1');
  assert.equal(result.reason,'COURSE_PLAN_VERSION_CHANGED');
  assert.equal(result.classDueSuperseded,0);
  assert.ok(!queries.some(x=>x.q.includes("event_type in ('teaching.class.start_due','teaching.class.end_due')")));
});

test('active Class session blocks automatic retirement even if timetable superseded',async()=>{
  const {instance,queries}=fake({hasActiveSession:true});
  assert.deepEqual(await instance.retireOne('w-1'),{retired:false,reason:'PARENT_STILL_CURRENT'});
  assert.ok(!queries.some(x=>x.q.includes('update teaching_preparation.workspaces')));
});

test('terminal workspaces are never reopened or overwritten',async()=>{
  const {instance}=fake({workspaceLifecycle:'HANDED_OFF'});
  assert.deepEqual(await instance.retireOne('w-1'),{retired:false,reason:'WORKSPACE_NO_LONGER_ELIGIBLE'});
});

test('bounded scan cannot overlap and separates Class retirement failures',async()=>{
  const {instance,queries}=fake();
  const summary=await instance.runOnce();
  assert.equal(summary.candidates,1);assert.equal(summary.retired,1);
  const scan=queries.find(x=>x.q.includes('select w.workspace_id'));
  assert.deepEqual(scan.params,[32]);
  for(const term of ["w.workspace_type='LESSON_BLUEPRINT'","c.lifecycle_state<>'SCHEDULED'",
    "co.lifecycle_state<>'ACTIVE'","tv.timetable_state<>'APPROVED'",
    "b.preconditions->>'course_plan_id'","teaching_class_sessions",
    "w.lifecycle_state in ('ACTIVE','FINALIZATION_DUE','FINALIZED')"])
    assert.ok(scan.q.includes(term),term);
});

test('late AI artifact capture is fenced inside a Class/Course/Plan lock',()=>{
  const text=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');
  const from=text.indexOf('async function recordPreparationArtifactUsing(');
  const until=text.indexOf('async function getPreparationArtifactPayload(',from);
  const section=text.slice(from,until);
  assert.ok(section.includes('await loadClassBase(studentId,classId,tx,true)'));
  assert.ok(section.includes('await loadCurrentPlan(studentId,klass.course_id,tx,true)'));
  assert.ok(section.includes('workspace.lifecycle_state===\'ACTIVE\''));
  assert.ok(section.includes("klass.source_timetable_state==='APPROVED'"));
  assert.ok(section.includes("error.code='TEACHING_D11_PREPARATION_PARENT_SUPERSEDED'"));
  assert.ok(section.includes('error.retryable=false'));
  assert.ok(section.indexOf('if(!stillCurrent)')<section.indexOf('insert into teaching_preparation.artifact_versions'));
  assert.ok(section.includes('withTransaction')===false,'Core artifact mutation takes caller-owned transaction');
  assert.match(text,/async function recordPreparationArtifact\(args=\{\}\)\{\s*return withTransaction\(tx=>recordPreparationArtifactUsing\(tx,args\)\)/);
  assert.match(text,/await recordPreparationArtifactUsing\(tx,\{\s*studentId,classId:toClassId,blueprint/);
});
