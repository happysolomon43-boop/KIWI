'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAssessmentWorkflow}=require('../../../teaching/d17/workflow');
const {createD31ReleaseReaders}=require('../../../teaching/d31/release-orchestrator');
const {createD17AssessmentRepository}=require('../../../teaching/repositories/d17-assessments');

function flow({eligible=true,blocked=false,moderation=false}={}){
  const calls=[],versions=[],validations=[];let bp=null,pack=null;
  let result={assessmentResultId:'r',markingState:moderation?'MODERATING':'PROVISIONAL',releaseState:'HELD',moderationRequired:moderation,reviewBlocked:false};
  const repository={requireAssessment:async()=>({assessment_id:'a',course_id:'c',graded:true}),assessment:async()=>({definition_state:'READY'}),attempt:async()=>({attempt_state:'SUBMITTED'}),latestPackage:async()=>pack,currentEligibility:async()=>eligible?[{learning_unit_id:'u',eligibility_basis:'TAUGHT'}]:[],courseAuditView:async()=>({course_plan_id:'p',course_plan_version:1}),upsertPplWorkspace:async()=>calls.push('waiting'),latestBlueprint:async()=>bp,candidateVersions:async()=>versions,validations:async()=>validations};
  const service={prepareBlueprint:async()=>{calls.push('plan');return {blueprint:bp={assessment_blueprint_id:'b',lane:'ELIGIBLE_CANDIDATE',maturity:'PRE_LOCK_READY',blueprint_payload:{slots:[{slot_id:'s'}]}}};},generateCandidate:async()=>{calls.push('generate');const version={candidate_version_id:'v',slot_id:'s'};versions.push(version);return {version};},validateItem:async()=>{calls.push('validate');validations.push({validation_scope:'ITEM',candidate_version_id:'v',outcome:blocked?'FAIL':'PASS'});},validateWholePackage:async()=>{calls.push('whole');if(blocked)throw new Error('Independent validation failed');},reconcileAndLock:async()=>{calls.push('lock');return {package:pack={assessment_package_id:'p',package_state:'LOCKED'}};}};
  const markingService={ensurePolicy:async()=>calls.push('policy'),markAttempt:async()=>{calls.push('mark');return {result};},moderateResult:async()=>{calls.push('moderate');result={...result,markingState:'MODERATED',reviewBlocked:blocked};},assessmentReview:async()=>result,transitionResult:async(_u,_r,{to})=>{calls.push(to);result={...result,releaseState:to};return result;}};
  const markingRepository={resultById:async()=>({course_id:'c'}),lockedPolicy:async()=>({appeal_policy:{default_review_direction:'two_way',authority_ref:'explicit-policy'}})};
  return {calls,workflow:createAssessmentWorkflow({repository,service,markingService,markingRepository})};
}
test('Assessment preparation executes owner gates in order; replay reuses the locked package',async()=>{
  const {calls,workflow}=flow();assert.equal((await workflow.prepare('student','a','event')).state,'READY');
  assert.deepEqual(calls,['policy','plan','generate','validate','whole','lock']);
  await workflow.prepare('student','a','retry');assert.equal(calls.length,6);
});
test('Untaught material waits without calling generation; failed validation cannot lock',async()=>{
  const waiting=flow({eligible:false});assert.equal((await waiting.workflow.prepare('student','a','event')).state,'WAITING_FOR_ELIGIBLE_MATERIAL');assert.deepEqual(waiting.calls,['waiting']);
  const blocked=flow({blocked:true});await assert.rejects(blocked.workflow.prepare('student','a','event'));assert.ok(!blocked.calls.includes('lock'));
});
test('Submission proceeds through independent moderation and publication; disagreement remains held',async()=>{
  const good=flow({moderation:true});assert.equal((await good.workflow.mark('student','attempt','event')).state,'APPEALABLE');assert.deepEqual(good.calls,['mark','moderate','RELEASED','APPEALABLE']);
  const disputed=flow({moderation:true,blocked:true});assert.equal((await disputed.workflow.mark('student','attempt','event')).state,'REVIEW_NEEDED');assert.deepEqual(disputed.calls,['mark','moderate']);
});
test('Durable database event field names reach the correct student and assessment',async()=>{
  const {workflow,calls}=flow(),handlers=new Map();workflow.register({register:(name,handler)=>handlers.set(name,handler)});
  const event={actor_id:'student',aggregate_id:'a',event_id:'e'};
  await handlers.get('teaching.assessment.preparation_due').handle(event);assert.ok(calls.includes('lock'));
});
test('Production AI reader accepts owned assessments and refuses missing/foreign owners',async()=>{
  const query=async(sql,params)=>({rows:params[0]!=='student'?[]:sql.includes('teaching_assessments')?[{assessment_id:'a',course_id:'c',state_version:7,definition_state:'READY'}]:[{course_id:'c'}]});
  const reader=createD31ReleaseReaders({query}),envelope={state_reference:{aggregate_type:'ASSESSMENT',aggregate_id:'a'},trigger:{actor_id:'student'},preconditions:{assessment_owner_required:true,gradebook_write_allowed:false}};
  const current=await reader.stateReader(envelope);assert.equal(current.stateReference.state_version,'7');assert.deepEqual(current.preconditions,{assessment_owner_required:true,gradebook_write_allowed:false});
  await assert.rejects(reader.stateReader({...envelope,trigger:{actor_id:'foreign'}}));
});
test('Question exposure rejects early windows and impromptu exposure outside the controller state',async()=>{
  const row={assessment_id:'a',assessment_type:'SCHEDULED_TEST',source_lineage:{assessment_schedule:{starts_at:'2026-10-09T12:00:00Z'}}};
  const repository=createD17AssessmentRepository({query:async sql=>({rows:sql.includes('teaching_assessments')?[row]:[{lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION'}]}),withTransaction:async()=>{},randomUUID:()=>'',clock:()=>new Date('2026-10-08T12:00:00Z')});
  await assert.rejects(repository.assertExposure('student','a'),{code:'TEACHING_D17_ASSESSMENT_NOT_OPEN'});
  row.assessment_type='IMPROMPTU_TEST';row.source_lineage={d19_measurement:{intended_class_id:'class'}};
  await assert.rejects(repository.assertExposure('student','a'),{code:'TEACHING_D19_CONTROLLER_ASSESSMENT_STATE_REQUIRED'});
});
