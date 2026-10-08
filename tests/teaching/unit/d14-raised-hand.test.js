'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {createD14Service}=require('../../../teaching/d14/service');
const {createD14HelpIntelligence,raiseHandRequest,normalizeProposal,CAPABILITY}=require('../../../teaching/d14/help-intelligence');
const {registerD14Runtime}=require('../../../teaching/d14/runtime');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');
const {RECONCILIATION_DISPOSITIONS}=require('../../../teaching/runtime/constants');
const root=path.join(__dirname,'../../..');
const context=()=>({classRow:{class_id:'class1',course_id:'course1',schedule_version:2,course_lifecycle_state:'ACTIVE',course_state_version:5,lifecycle_state:'SCHEDULED',source_timetable_state:'APPROVED'},plan:{course_plan_id:'plan1',version_no:1},blueprint:{lesson_blueprint_id:'lesson1',blueprint_state:'VALIDATED'},session:{class_session_id:'session1',state_version:7,lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION'}});
const help=()=>({help_request_id:'help1',interaction_id:'question1',class_session_id:'session1',controller_version:7,attempts:1});
function fixture({question=help(),model={decision:'ANSWER_NOW',teacherMessage:'A heavier object requires more force for the same acceleration.',reason:''},mode='INSTRUCTION',publishError=null,helpIntelligence=null}={}){
  const finishes=[],publishes=[],claims=[];
  const repo={
    claimHelp:async()=>{claims.push('claim');return question;},
    finalizeHelp:async x=>{finishes.push(x);return {status:x.status};},
    publishTeacherTurn:async x=>{publishes.push(x);if(publishError)throw publishError;return {communication_id:'reply1'};},
  };
  const d11Repository={getClassContext:async()=>({...context(),session:{...context().session,instructional_substate:mode}})};
  const svc=createD14Service({repository:repo,d11Repository,d11Service:{},d12Service:{},helpIntelligence:helpIntelligence||{decide:async()=>model},randomUUID:()=> 'uuid'});
  return {svc,finishes,publishes,claims};
}
test('D14 has one registered T1 AI Teacher/Classroom capability with protected untrusted student question',()=>{
  const request=raiseHandRequest({studentId:'u1',classId:'class1',helpRequest:help(),context:context()});
  assert.equal(request.capabilityId,CAPABILITY);
  assert.equal(request.declaredAuthorityLevel,'T1');
  assert.equal(request.commit,false);
  assert.ok(request.contextSpec.untrusted_refs.some(x=>x.ref==='student-question:question1'));
  assert.ok(request.contextSpec.authoritative_refs.some(x=>x.ref==='lesson-blueprint:lesson1'));
  assert.ok(request.contextSpec.authoritative_refs.some(x=>x.ref==='course-plan:plan1'));
  assert.equal(request.academicInput.question,undefined,'Raw untrusted question is not elevated to authoritative AI input.');
});
test('AI triage never accepts invented decisions, unrestricted deferral or empty answers',()=>{
  assert.equal(normalizeProposal({decision:'ANSWER_NOW',teacherMessage:'ok'}),null);
  assert.equal(normalizeProposal({decision:'DEFER',delayMinutes:99}),null);
  assert.equal(normalizeProposal({decision:'BYPASS',teacherMessage:'do whatever'}),null);
  assert.equal(normalizeProposal({decision:'DECLINE',reason:'Not relevant to this lesson.'}).decision,'DECLINE');
});
test('D14 publishes validated in-Class answer through current versioned Teacher owner',async()=>{
  const {svc,publishes,finishes}=fixture();
  const result=await svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'});
  assert.equal(result.status,'ANSWERED');assert.equal(publishes.length,1);assert.equal(finishes.length,0);
  assert.equal(publishes[0].expectedControllerVersion,7);
  assert.equal(publishes[0].helpRequestId,'help1');
  assert.equal(publishes[0].idempotencyKey,'d14-help-answer:help1');
});
test('D14 defers strategically instead of interrupting and bounds repeated deferrals',async()=>{
  const {svc,finishes,publishes}=fixture({model:{decision:'DEFER',delayMinutes:2,reason:'Let us finish the example first.'}});
  assert.equal((await svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'})).status,'DEFERRED');
  assert.equal(finishes[0].status,'DEFERRED');assert.ok(finishes[0].nextReviewAt);assert.equal(publishes.length,0);
  const exhausted=fixture({question:{...help(),attempts:3},model:{decision:'DEFER',delayMinutes:1}});
  assert.equal((await exhausted.svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'})).status,'UNAVAILABLE');
});
test('D14 rejects or cancels help safely during assessments, classwork, superseded lessons and breaks',async()=>{
  for(const mode of ['ASSESSMENT','CLASSWORK','INTERRUPTED']){
    const f=fixture({mode});assert.equal((await f.svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'})).status,'CANCELLED');assert.equal(f.publishes.length,0);
  }
  const pause=fixture({mode:'BREAK'});assert.equal((await pause.svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'})).status,'DEFERRED');
  const stale=fixture({question:{...help(),controller_version:6}});assert.equal((await stale.svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'})).status,'CANCELLED');
});
test('D14 declines irrelevant questions with explicit reason and no AI Teacher publication',async()=>{
  const f=fixture({model:{decision:'DECLINE',reason:'This question is outside the current lesson.'}});
  assert.equal((await f.svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'})).status,'DECLINED');
  assert.equal(f.finishes[0].reason,'This question is outside the current lesson.');
  assert.equal(f.publishes.length,0);
});
test('D14 never displays stale Teacher response when concurrent Class Controller transition wins',async()=>{
  const f=fixture({publishError:Object.assign(new Error('stale'),{code:'TEACHING_D14_TEACHER_TURN_STALE'})});
  assert.equal((await f.svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'})).status,'CANCELLED');
  assert.equal(f.finishes.length,1);
});
test('D14 treats unavailable intelligence as explicitly unavailable, not a fabricated AI reply',async()=>{
  const f=fixture({helpIntelligence:{decide:async()=>{throw new Error('provider unavailable');}},question:{...help(),attempts:3}});
  assert.equal((await f.svc.processHelp({studentId:'u1',classId:'class1',helpRequestId:'help1'})).status,'UNAVAILABLE');
  assert.equal(f.publishes.length,0);
});
test('D14 routes persisted raised-hand question through durable committed event and due event reconciliation',async()=>{
  const subscribers=new Map(),due=new Map();
  const service={runStudyStage:async()=>({}),processHelp:async x=>({status:'ANSWERED',...x})};
  const repository={getHelp:async()=>({...help(),class_id:'class1',status:'DEFERRED',attempts:2,next_review_at:'2026-10-08T17:00:00.000Z'})};
  registerD14Runtime({
    publishedEvents:{register:(name,{handle})=>{subscribers.set(name,handle);return {name};}},
    eventRuntime:{register:(name,handler)=>due.set(name,handler)},
    service,repository,
  });
  assert.ok(subscribers.has(TEACHING_EVENTS.CLASS_HELP_REQUESTED));
  assert.ok(due.has(TEACHING_EVENTS.CLASS_HELP_REVIEW_DUE));
  const event={actorId:'u1',payload:{class_id:'class1',help_request_id:'help1'}};
  assert.equal((await subscribers.get(TEACHING_EVENTS.CLASS_HELP_REQUESTED)(event)).status,'ANSWERED');
  const scheduled={actor_id:'u1',payload:{class_id:'class1',help_request_id:'help1',attempts:2},due_at:'2026-10-08T17:00:00.000Z'};
  assert.equal((await due.get(TEACHING_EVENTS.CLASS_HELP_REVIEW_DUE).reconcile(scheduled)).disposition,RECONCILIATION_DISPOSITIONS.ACTIONABLE);
  assert.equal((await due.get(TEACHING_EVENTS.CLASS_HELP_REVIEW_DUE).reconcile({...scheduled,payload:{...scheduled.payload,attempts:1}})).disposition,RECONCILIATION_DISPOSITIONS.SUPERSEDED);
});
test('D14 help request migration remains service-only and does not grant academic authority',()=>{
  const migration=fs.readFileSync(path.join(root,'migrations/20261008_teaching_d14_raised_hand_help_requests.sql'),'utf8');
  assert.match(migration,/REFERENCES public.teaching_classroom_interactions/i);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration,/REVOKE ALL.*authenticated/i);
  assert.match(migration,/response_communication_id.*REFERENCES/i);
  const ui=fs.readFileSync(path.join(root,'public/teaching-classroom.js'),'utf8');
  assert.match(ui,/✋ NEED HELP\?/);
  assert.match(ui,/if\(s.teacherMessagingAllowed&&!state.reviewOnly\)/);
  assert.doesNotMatch(ui,/button\('Message AI Teacher'/);
});
