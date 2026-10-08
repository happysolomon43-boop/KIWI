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
  assert.equal(eligibility(21).allowed,false);
  assert.equal(eligibility(75).allowed,false);
  assert.equal(eligibility(1,{session:{lifecycle_state:'ACTIVE'}}).allowed,false);
  assert.equal(eligibility(1,{classRow:{lifecycle_state:'CANCELLED'}}).allowed,false);
  assert.equal(eligibility(1,{classRow:{source_timetable_state:'SUPERSEDED'}}).allowed,false);
  assert.equal(eligibility(1,{classRow:{course_lifecycle_state:'PAUSED'}}).allowed,false);
  assert.ok(MAX_LATE_START_MS<=20*60*1000);
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
  assert.match(d11,/context\.classRow\.source_timetable_state!=='APPROVED'/);
});

test('Classroom first reads the real session before JOIN, and prepares validated Blueprint before controller start',()=>{
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(ui,/async function recoverPreparedLesson\(/);
  assert.match(ui,/allowLateStartRecovery:true,maxSteps:1/);
  assert.match(ui,/current\?\.blueprint\?\.currentForAuthoritativeContext===true/);
  assert.match(ui,/if\(path==='start'\)await recoverPreparedLesson\(classId\)/);
  assert.match(ui,/try\{await fetchSnapshot\(\);if\(!reviewOnly&&state\.snapshot\?\.controller/);
  assert.doesNotMatch(ui,/try\{if\(!reviewOnly\)await kiwiApiRequest\(`\/teaching\/classes/);
  assert.match(ui,/if\(path==='start'\)await kiwiApiRequest\(/);
});
