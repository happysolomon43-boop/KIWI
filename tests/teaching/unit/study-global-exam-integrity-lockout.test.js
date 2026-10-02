'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {profile,sessionConsequence}=require('../../../services/integrity/contracts');

const root=path.resolve(__dirname,'../../..');
const guard=()=>fs.readFileSync(path.join(root,'public/kiwi-integrity-session-guard.js'),'utf8');
const html=()=>fs.readFileSync(path.join(root,'index.html'),'utf8');
const backend=()=>fs.readFileSync(path.join(root,'index.js'),'utf8');

function createGuardHarness({deferFirstCreate=false,createStatus='ACTIVE'}={}){
  const elements=new Map();
  const windowListeners=new Map();
  const documentListeners=new Map();
  const add=(registry,type,handler)=>{const values=registry.get(type)||new Set();values.add(handler);registry.set(type,values);};
  const remove=(registry,type,handler)=>{registry.get(type)?.delete(handler);};
  const emit=(registry,event)=>{for(const handler of registry.get(event.type)||[])handler(event);};
  const document={
    readyState:'loading',
    visibilityState:'visible',
    fullscreenElement:null,
    addEventListener:(type,handler)=>add(documentListeners,type,handler),
    removeEventListener:(type,handler)=>remove(documentListeners,type,handler),
    getElementById:(id)=>elements.get(id)||null,
    createElement:()=>{
      const node={style:{},innerHTML:'',setAttribute(){},remove(){if(this.id)elements.delete(this.id);}};
      Object.defineProperty(node,'id',{get(){return this._id||'';},set(value){this._id=String(value);}});
      return node;
    },
    body:{appendChild(node){if(node.id)elements.set(node.id,node);}},
  };
  let createCalls=0;
  let closeCalls=0;
  let resolveFirstCreate=null;
  const context={
    AppState:{tempExam:{examId:'exam-1'}},
    document,
    navigator:{onLine:true},
    console,
    CustomEvent:class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}},
    setInterval:()=>1,
    clearInterval:()=>{},
    addEventListener:(type,handler)=>add(windowListeners,type,handler),
    removeEventListener:(type,handler)=>remove(windowListeners,type,handler),
    dispatchEvent:(event)=>{emit(windowListeners,event);return true;},
    KIWI_API_CLIENT:{
      kiwiApiRequest:async(pathname,{body}={})=>{
        if(pathname==='/teaching/integrity/sessions'){
          createCalls+=1;
          const snapshot={sessionId:`session-${createCalls}`,ownerType:body.ownerType,ownerRef:String(body.ownerRef),status:createStatus};
          if(deferFirstCreate&&createCalls===1){
            return new Promise((resolve)=>{resolveFirstCreate=()=>resolve(snapshot);});
          }
          return snapshot;
        }
        if(/\/close$/.test(pathname)){
          closeCalls+=1;
          return {sessionId:`session-${createCalls}`,ownerType:'KIWI_EXAM',ownerRef:String(context.AppState.tempExam.examId),status:'CLOSED'};
        }
        throw new Error(`Unexpected guard request: ${pathname}`);
      },
    },
  };
  context.window=context;
  vm.runInNewContext(guard(),context,{filename:'kiwi-integrity-session-guard.js'});
  return {
    api:context.KIWIIntegritySessionGuard,
    appState:context.AppState,
    createCalls:()=>createCalls,
    closeCalls:()=>closeCalls,
    resolveFirstCreate:()=>{assert.ok(resolveFirstCreate,'expected first create request to be pending');resolveFirstCreate();},
    hasOverlay:()=>elements.has('kiwiIntegrityGlobalExamLock'),
  };
}

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

test('Study shell delegates integrity lifecycle ownership to the shared guard',()=>{
  const src=html();
  assert.match(src,/\/kiwi-integrity-session-guard\.js/);
  assert.match(src,/Integrity Session Guard owns exam integrity activation/);
  assert.match(src,/kiwi:exam-ended/);
  assert.doesNotMatch(src,/_startExamIntegrityGuard/);
  assert.doesNotMatch(src,/_renderIntegrityExamLock/);
  assert.doesNotMatch(src,/KIWIIntegritySessionGuard\.activate/);
  assert.doesNotMatch(src,/KIWIIntegritySessionGuard\.deactivate/);
  assert.doesNotMatch(src,/pagehide — fires after the user confirms leaving[\s\S]{0,900}\/forfeit/);
  assert.match(src,/\/exams\/.*\/forfeit/);
});

test('shared guard owns Study exam closure without watcher reactivation races',()=>{
  const src=guard();
  assert.match(src,/function closeStudyExamGuard\(event\)/);
  assert.match(src,/endedStudyExamId/);
  assert.match(src,/studyExamActivation/);
  assert.match(src,/global\.addEventListener\('kiwi:exam-ended'/);
  assert.match(src,/if\(state\.endedStudyExamId===id\)return null/);
  assert.match(src,/if\(state\.studyExamActivation\?\.id===id\)return state\.studyExamActivation\.promise/);
});

test('shared guard deduplicates concurrent activation and does not reopen an ended exam',async()=>{
  const harness=createGuardHarness({deferFirstCreate:true});
  const first=harness.api.ensureStudyExamGuard();
  const second=harness.api.ensureStudyExamGuard();
  await Promise.resolve();
  assert.equal(harness.createCalls(),1);
  harness.resolveFirstCreate();
  const [one,two]=await Promise.all([first,second]);
  assert.equal(one.ownerRef,'exam-1');
  assert.equal(two.ownerRef,'exam-1');
  assert.equal(harness.createCalls(),1);
  await harness.api.closeStudyExamGuard({detail:{examId:'exam-1'}});
  assert.equal(harness.closeCalls(),1);
  assert.equal(await harness.api.ensureStudyExamGuard(),null);
  assert.equal(harness.createCalls(),1);
  harness.appState.tempExam={examId:'exam-2'};
  const next=await harness.api.ensureStudyExamGuard();
  assert.equal(next.ownerRef,'exam-2');
  assert.equal(harness.createCalls(),2);
});

test('exam-ended during in-flight activation closes the late session and suppresses reactivation',async()=>{
  const harness=createGuardHarness({deferFirstCreate:true});
  const pending=harness.api.ensureStudyExamGuard();
  await Promise.resolve();
  assert.equal(harness.createCalls(),1);
  assert.equal(await harness.api.closeStudyExamGuard({detail:{examId:'exam-1'}}),null);
  harness.resolveFirstCreate();
  assert.equal(await pending,null);
  assert.equal(harness.closeCalls(),1);
  assert.equal(await harness.api.ensureStudyExamGuard(),null);
  assert.equal(harness.createCalls(),1);
});

test('shared guard removes its own lock overlay when a locked exam ends',async()=>{
  const harness=createGuardHarness({createStatus:'LOCKED'});
  const snapshot=await harness.api.ensureStudyExamGuard();
  assert.equal(snapshot.status,'LOCKED');
  assert.equal(harness.hasOverlay(),true);
  await harness.api.closeStudyExamGuard({detail:{examId:'exam-1'}});
  assert.equal(harness.api.current(),null);
  assert.equal(harness.hasOverlay(),false);
  assert.equal(harness.closeCalls(),0);
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
