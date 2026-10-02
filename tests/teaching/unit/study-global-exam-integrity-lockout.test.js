'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {profile,sessionConsequence}=require('../../../services/integrity/contracts');

const root=path.resolve(__dirname,'../../..');
const guard=()=>fs.readFileSync(path.join(root,'public/kiwi-integrity-session-guard.js'),'utf8');
const html=()=>fs.readFileSync(path.join(root,'index.html'),'utf8');
const backend=()=>fs.readFileSync(path.join(root,'index.js'),'utf8');

test('normal Study exam profile warns first and locks second',()=>{
  assert.deepEqual(sessionConsequence({sessionProfile:profile('SCHEDULED_TEST'),confirmedDepartureCount:1}),{action:'WARN',outcome:'FIRST_PROHIBITED_DEPARTURE_WARNING'});
  assert.deepEqual(sessionConsequence({sessionProfile:profile('SCHEDULED_TEST'),confirmedDepartureCount:2}),{action:'LOCK',outcome:'LOCKED_FOR_REVIEW'});
});

test('Reckoning remains a high-stakes Study exam and locks on second departure',()=>{
  assert.deepEqual(sessionConsequence({sessionProfile:profile('HIGH_STAKES_EXAM'),confirmedDepartureCount:1}),{action:'WARN',outcome:'FIRST_PROHIBITED_DEPARTURE_WARNING'});
  assert.deepEqual(sessionConsequence({sessionProfile:profile('HIGH_STAKES_EXAM'),confirmedDepartureCount:2}),{action:'LOCK',outcome:'ATTEMPT_INVALIDATED_RULE_BREACH'});
});

test('shared browser guard auto-binds every Study AppState exam and ignores ordinary Study',()=>{
  const src=guard();
  assert.match(src,/function studyExamId\(\)/);
  assert.match(src,/global\.AppState&&global\.AppState\.tempExam/);
  assert.match(src,/ownerType:'KIWI_EXAM'/);
  assert.match(src,/function ensureStudyExamGuard\(\)/);
  assert.match(src,/function enableStudyExamAutoGuard\(\)/);
  assert.match(src,/setInterval\(tick,750\)/);
  assert.match(src,/DOMContentLoaded',enableStudyExamAutoGuard/);
  assert.match(src,/if\(!examId\)return null/);
});

test('legacy Study shell still loads the shared guard and has no first-pagehide auto-forfeit',()=>{
  const src=html();
  assert.match(src,/\/kiwi-integrity-session-guard\.js/);
  assert.match(src,/Integrity Session Guard owns pagehide\/background recording/);
  assert.doesNotMatch(src,/pagehide — fires after the user confirms leaving[\s\S]{0,900}\/forfeit/);
});

test('all active Study exam mutation families retain server-side terminal lock enforcement',()=>{
  const src=backend();
  assert.match(src,/function respondToLockedExamMutation/);
  assert.match(src,/EXAM_INTEGRITY_SESSION_LOCKED/);
  assert.match(src,/examRouter\.post\('\/:id\/forfeit'[\s\S]*?respondToLockedExamMutation/);
  assert.match(src,/examRouter\.post\('\/:id\/auto-forfeit'[\s\S]*?respondToLockedExamMutation/);
  assert.match(src,/examRouter\.post\('\/:id\/reckoning\/answer'[\s\S]*?loadMutableExamOrRespond/);
  assert.match(src,/examRouter\.post\('\/:id\/reckoning\/continue'[\s\S]*?loadMutableExamOrRespond/);
  assert.match(src,/examRouter\.post\('\/:id\/reckoning\/finalize'[\s\S]*?loadMutableExamOrRespond/);
  assert.match(src,/examRouter\.post\('\/:id\/start'[\s\S]*?respondToLockedExamMutation/);
  assert.match(src,/examRouter\.post\('\/:id\/start-token'[\s\S]*?loadMutableExamOrRespond/);
  assert.match(src,/examRouter\.get\('\/:id\/question\/:number'[\s\S]*?loadMutableExamOrRespond/);
  assert.match(src,/examRouter\.post\('\/:id\/pre-mark'[\s\S]*?respondToLockedExamMutation/);
});
