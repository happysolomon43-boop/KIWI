'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {D11_BLUEPRINT_OUTPUT_FORMAT}=require('../../../teaching/d11/blueprint-output-contract');
const {serializablePromptContract}=require('../../../teaching/prompt-runtime/prompt-composer');
const {validateLessonBlueprintProposal}=require('../../../teaching/d11/contracts');
const {validateModelOutput}=require('../../../teaching/ai/output-validation');
const {validatePreparationMetadata}=require('../../../teaching/prompt-runtime/preparation');
const {decidePplExecution,createPplBudgetState}=require('../../../teaching/d28/ppl-governance');
const {createD28PolicyConfig}=require('../../../teaching/d28/contracts');

test('TPF-05 runtime uses exact D11 mode-specific output shape without changing frozen family text',()=>{
  const invocation={
    contract_version:'v1',constitution:{},capability:{},directive:{},context_allowlist:{},
    prompt:{family_id:'TPF-05',family_version:'1.3',task_mode:'pre_class_lesson_blueprint_generation'},
    output_schema:{id:'d11.lesson-blueprint',version:'1',declared_fields:['objectives','segments']},
  };
  const rendered=serializablePromptContract(invocation);
  assert.deepEqual(rendered.output_schema.mode_specific_format,D11_BLUEPRINT_OUTPUT_FORMAT);
  assert.equal(rendered.output_schema.mode_specific_format.top_level_required.includes('segments'),true);
  assert.equal(rendered.output_schema.mode_specific_format.top_level_required.includes('adaptive_reserve_minutes'),true);
  assert.equal(rendered.output_schema.mode_specific_format.segment_required.planned_minutes.includes('required'),true);
  const generic=serializablePromptContract({...invocation,prompt:{...invocation.prompt,family_id:'TPF-08'}});
  assert.equal(generic.output_schema.mode_specific_format,undefined);
  const frozen=fs.readFileSync(path.resolve(__dirname,'../../../teaching/prompt-runtime/frozen/v1.3/TPF-05_Lesson_Planning_Homework_Live_Replanning_v1.3_DESIGN_FROZEN.md'),'utf8');
  assert.match(frozen,/The runtime may use a mode-specific schema derived from this envelope/);
});

test('D11 missing objective IDs are audit-safe field paths and remain rejected',async()=>{
  const proposal={status:'OK',objectives:[{learning_unit_ref:'unit-1',label:'Measure position',criticality:'CORE'}],segments:[]};
  const validator=async out=>validateLessonBlueprintProposal(out,{learningUnits:[{learning_unit_id:'unit-1'}],scheduledStartAt:'2026-10-09T09:00:00Z',scheduledEndAt:'2026-10-09T10:00:00Z'});
  const validation=validator(proposal);
  assert.equal((await validation).reason,'TEACHING_D11_FIELD_REQUIRED');
  assert.equal((await validation).fieldPath,'objective.id');
  const rejected=await validateModelOutput({output:proposal,authorityLevel:'T3',schemaValidator:validator,domainValidator:async()=>({ok:true})});
  assert.equal(rejected.accepted,false);
  assert.equal(rejected.validationFailure.fieldPath,'objective.id');
  assert.equal(rejected.validationFailure.repairable,'MODEL_RETRY');
  assert.equal('output' in rejected,false);
});

test('Repair metadata is server-bound, one attempt only, and independent of D28 empirical qualification',()=>{
  const common={
    workspace_ref:'workspace-1',workspace_version:'1',stage:'Active',maturity:'Skeleton',
    authoritative_input_bundle:{input_bundle_id:'bundle-1'},material_delta:{},finding_refs:[],
    review_purpose:'progressive_next_class_preparation',maturity_target:'Structured',
    protection_class:'UNPROTECTED',route_posture:'bounded_interpretive',
    idempotency_key:'model:repair-1',correlation_id:'model:original',
  };
  assert.equal(validatePreparationMetadata({...common,repair_attempt:1}).repair_attempt,1);
  assert.throws(()=>validatePreparationMetadata({...common,repair_attempt:2}),{code:'TEACHING_PPL_CONTRACT_INVALID'});
  const policy=createD28PolicyConfig({}).ppl;
  const state=createPplBudgetState(policy);
  const decision=decidePplExecution({materialChange:true,routePosture:'bounded_interpretive',
    routeQualified:false,ownerReleaseAuthorized:true,currentStage:'EARLY',state,policy,
    delta:{scheduledReviews:0,modelCalls:2,candidates:1,inFlight:1}});
  assert.equal(decision.modelCallAllowed,true);
  assert.equal(decision.empiricallyQualified,false);
  assert.equal(decision.budget.next.scheduledReviews,0);
  const held=decidePplExecution({materialChange:true,routePosture:'bounded_interpretive',
    routeQualified:false,ownerReleaseAuthorized:false,currentStage:'EARLY',state,policy,
    delta:{scheduledReviews:0,modelCalls:2}});
  assert.equal(held.modelCallAllowed,false);
});

function harness(responses){
  const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/service.js'),'utf8');
  const first=source.indexOf('  async function preparationStep(user,classId,');
  const last=source.indexOf('\n  async function prepareLesson(',first);
  assert.ok(first>0&&last>first);
  const calls=[],saved=[],transitions=[];
  const context={classRow:{student_id:'u',class_id:'class-1',scheduled_end_at:'2026-10-09T11:00:00Z'},learningUnits:[],plan:{}};
  const workspace={workspace_id:'ws',maturity_stage:'SKELETON',lifecycle_state:'ACTIVE',state_version:1};
  const environment={
    assertModelRoute:()=>{},assertClassPlanningEligible:()=>{},
    repository:{
      getClassContext:async()=>context,
      ensurePreparationWorkspace:async()=>({workspace,bundle:{}}),
      getPlanningSignals:async()=>({}),
      recordPreparationArtifact:async()=>({artifact:{artifact_version_id:'artifact-1'}}),
    },
    preparationRepository:{getWorkspaceSnapshot:async()=>({workspace})},
    buildPreparationMetadata:async(c,p,target,route,key)=>({workspace_ref:'ws',workspace_version:'1',idempotency_key:key,correlation_id:key}),
    intelligence:{planLesson:async args=>{calls.push(args);return responses.shift()||{accepted:false};}},
    reservePolicy:undefined,
    NEXT_MATURITY:{SKELETON:'STRUCTURED'},
    ROUTE_FOR_TARGET:{STRUCTURED:'bounded_interpretive'},
    validateLessonBlueprintProposal:()=>({ok:true,value:{}}),
    transitionPreparation:async (...args)=>{transitions.push(args);},
    publicContext:v=>v,
    fail:(msg,code)=>{const error=new Error(msg);error.code=code;throw error;},
  };
  const run=new Function(...Object.keys(environment),source.slice(first,last)+'\nreturn preparationStep;')(...Object.values(environment));
  return {run,calls,saved,transitions};
}
test('One repairable D11 Blueprint rejection creates a new orchestration identity with safe feedback',async()=>{
  const h=harness([
    {accepted:false,validationFailure:{stage:'schema',reason:'TEACHING_D11_FIELD_REQUIRED',fieldPath:'objective.id',retryable:true,repairable:'MODEL_RETRY'}},
    {accepted:true,validatedResult:{output:{}}},
  ]);
  const result=await h.run({id:'u'},'class-1',{requestKey:'evt-1'});
  assert.equal(result.done,false);
  assert.equal(h.calls.length,2);
  assert.equal(h.calls[0].requestKey,'evt-1');
  assert.equal(h.calls[1].requestKey,'evt-1:blueprint-schema-repair-1');
  assert.equal(h.calls[1].repairFeedback.fieldPath,'objective.id');
  assert.equal(h.calls[1].preparation.repair_attempt,1);
  assert.equal(h.calls[1].preparation.correlation_id,'evt-1');
  assert.equal(h.transitions.length,1);
});
test('A failed repair cannot produce a third model call or advance maturity',async()=>{
  const rejected={accepted:false,validationFailure:{stage:'schema',reason:'TEACHING_D11_FIELD_REQUIRED',retryable:true,repairable:'MODEL_RETRY'}};
  const h=harness([rejected,rejected]);
  await assert.rejects(h.run({id:'u'},'class-1',{requestKey:'evt-2'}),{code:'TEACHING_D11_BLUEPRINT_NOT_ACCEPTED'});
  assert.equal(h.calls.length,2);
  assert.equal(h.transitions.length,0);
});
test('Non-repairable, stale or replayed model results never trigger new academic model execution',async()=>{
  for(const denied of [
    {accepted:false,validationFailure:{stage:'domain',reason:'SCOPE',retryable:false,repairable:'TARGETED_REPAIR'}},
    {replay:true,accepted:false,status:'NOOP'},
    {accepted:false,stale:true},
  ]){
    const h=harness([denied]);
    await assert.rejects(h.run({id:'u'},'class-1',{requestKey:'evt-3'}),{code:'TEACHING_D11_BLUEPRINT_NOT_ACCEPTED'});
    assert.equal(h.calls.length,1);
    assert.equal(h.transitions.length,0);
  }
});
