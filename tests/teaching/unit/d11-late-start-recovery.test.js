'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {lateStartRecoveryEligibility,MAX_LATE_START_MS,MIN_TEACHING_REMAINING_MS}
  =require('../../../teaching/d11/late-start-recovery');

const start=Date.parse('2026-10-09T00:00:00Z');
const end=start+76*60*1000;
const eligibleClass={
  scheduled_start_at:new Date(start).toISOString(),
  scheduled_end_at:new Date(end).toISOString(),
  lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED'
};
const eligibility=(minutes,options={})=>lateStartRecoveryEligibility({
  classRow:{...eligibleClass,...(options.classRow||{})},
  session:options.session||null,
  now:new Date(start+minutes*60*1000)
});

test('Late preparation is available only in an actual recoverable live Class',()=>{
  assert.equal(eligibility(1).allowed,true);
  assert.equal(eligibility(15).allowed,true);
  assert.equal(eligibility(0).allowed,true);
  assert.equal(eligibility(-1).allowed,false);
  assert.equal(eligibility(21).allowed,true);
  assert.equal(eligibility(44).allowed,true);
  assert.equal(eligibility(46).allowed,false);
  assert.equal(eligibility(75).allowed,false);
  assert.equal(eligibility(1,{session:{lifecycle_state:'ACTIVE'}}).allowed,false);
  assert.equal(eligibility(1,{classRow:{lifecycle_state:'CANCELLED'}}).allowed,false);
  assert.equal(eligibility(1,{classRow:{source_timetable_state:'SUPERSEDED'}}).allowed,false);
  assert.equal(eligibility(1,{classRow:{course_lifecycle_state:'PAUSED'}}).allowed,false);
  assert.ok(MAX_LATE_START_MS<=45*60*1000);
  assert.ok(MIN_TEACHING_REMAINING_MS>=20*60*1000);
});

test('PPL record guard retains preclass rule unless explicitly authorized late recovery',()=>{
  const repo=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');
  assert.match(repo,/allowLateStartRecovery=false/);
  assert.match(repo,/lateStartRecoveryEligibility\(\{classRow:klass,session,now:clock\(\)\}\)\.allowed/);
  assert.match(repo,/Date\.parse\(klass\.scheduled_start_at\)>clock\(\)\.getTime\(\)/);
  assert.match(repo,/&&\s*!session/);
  assert.match(repo,/source_timetable_state==='APPROVED'/);
});

test('D11 late recovery still requires real model planning, deterministic validation and approved start authority',()=>{
  const d11=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/service.js'),'utf8');
  assert.match(d11,/if\(allowLateStartRecovery && !lateStartRecoveryEligibility/);
  assert.match(d11,/intelligence\.planLesson\(/);
  assert.match(d11,/validateLessonBlueprintProposal\(/);
  assert.match(d11,/allowLateStartRecovery,/);
  assert.match(d11,/ensureControllerStartedUsing/);
  assert.match(d11,/alreadyHandedOff=blueprintCurrentForContext\(context\)&&!context\.workspace/);
  assert.match(d11,/alreadyHandedOff\?null/);
  assert.match(d11,/context\.classRow\.source_timetable_state!=='APPROVED'/);
});

test('Classroom first reads the real session before JOIN, and prepares validated Blueprint before controller start',()=>{
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(ui,/async function recoverPreparedLesson\(/);
  assert.match(ui,/allowLateStartRecovery:true,maxSteps:1/);
  assert.match(ui,/current\?\.blueprint\?\.currentForAuthoritativeContext===true/);
  assert.match(ui,/!current\?\.preparation/);
  assert.match(ui,/if\(path==='start'\)await recoverPreparedLesson\(classId\)/);
  assert.match(ui,/try\{await fetchSnapshot\(\);if\(!reviewOnly&&state\.snapshot\?\.controller/);
  assert.doesNotMatch(ui,/try\{if\(!reviewOnly\)await kiwiApiRequest\(`\/teaching\/classes/);
  assert.match(ui,/if\(path==='start'\)await kiwiApiRequest\(/);
});


test('Ordinary D11 Classroom context stays server-authoritative and never references recovery-only locals',async()=>{
  const {createD11Service}=require('../../../teaching/d11/service');
  const classId='phy101-scheduled-class';
  const classRow={
    class_id:classId,course_id:'phy101',student_id:'student-1',
    scheduled_start_at:'2026-10-09T00:44:00.000Z',
    scheduled_end_at:'2026-10-09T02:00:00.000Z',
    timezone:'Africa/Lagos',schedule_version:27,
    lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',
    course_state_version:3,source_timetable_state:'APPROVED',
    source_timetable_version_id:'approved-v27'
  };
  const repo={
    getClassContext:async(userId,id)=>{
      assert.equal(userId,'student-1');
      assert.equal(id,classId);
      return {classRow,plan:{course_plan_id:'phy101-plan',version_no:2},
        workspace:null,blueprint:null,session:null};
    }
  };
  const service=createD11Service({
    repository:repo,
    withTransaction:async fn=>fn({query:async()=>({rows:[]})}),
    dueEventStore:{enqueueUsing:async()=>({})},
    outboxStore:{appendUsing:async()=>({})},
    clock:()=>new Date('2026-10-09T01:03:00.000Z')
  });
  const actual=await service.getClass({id:'student-1'},classId);
  assert.equal(actual.class.classId,classId);
  assert.equal(actual.class.scheduledStartAt,classRow.scheduled_start_at);
  assert.equal(actual.time.remaining_minutes,57);
  assert.equal(actual.serverAuthoritative,true);
  assert.equal(actual.controller,null);
  assert.equal(actual.blueprint,null);
  assert.equal(actual.preparation,null);
  // The public context is reused by the regular and late-preparation routes.
  const normal=service.publicContext({classRow,plan:{course_plan_id:'phy101-plan',version_no:2},
    workspace:null,blueprint:null,session:null});
  assert.equal(normal.class.scheduledStartAt,actual.class.scheduledStartAt);
});

test('Recovery timestamps remain inside the preparation scope, with identical planner and validator windows',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/service.js'),'utf8');
  const contextScope=source.slice(source.indexOf('  function publicContext('),source.indexOf('  async function preparationStep('));
  const preparationScope=source.slice(source.indexOf('  async function preparationStep('),source.indexOf('  async function prepareLesson('));
  const remaining=source.slice(source.indexOf('  async function prepareLesson('));
  assert.doesNotMatch(contextScope,/\brecoveryStart\b/);
  assert.doesNotMatch(remaining,/\brecoveryStart\b/);
  assert.match(contextScope,/function publicContext\(context, now = clock\(\)\)[\s\S]*?scheduledStartAt:context\.classRow\.scheduled_start_at/);
  assert.match(preparationScope,/const recoveryStart=allowLateStartRecovery\?clock\(\)\.toISOString\(\):null/);
  assert.match(preparationScope,/const planningContext=recoveryStart\?\{\.\.\.context,classRow:\{\.\.\.context\.classRow,scheduled_start_at:recoveryStart\}\}:context/);
  assert.match(preparationScope,/validateLessonBlueprintProposal\(output,\{\s*learningUnits:context\.learningUnits,\s*scheduledStartAt:recoveryStart\|\|context\.classRow\.scheduled_start_at/);
  assert.match(preparationScope,/repository\.recordPreparationArtifact\(\{[\s\S]*?allowLateStartRecovery,/);
});
