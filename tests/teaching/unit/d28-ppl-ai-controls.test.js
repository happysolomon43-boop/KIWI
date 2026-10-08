'use strict';const test=require('node:test'),assert=require('node:assert/strict'),ppl=require('../../../teaching/d28/ppl-governance'),ai=require('../../../teaching/d28/ai-controls'),policy={version:'p',maxScheduledReviews:2,maxCandidatesPerWorkspace:4,maxConcurrentExecutions:1,maxModelCalls:2,maxTotalTokens:100,maxEstimatedCostMicrounits:1000};test('PPL no-op/unqualified fail closed',()=>{const s=ppl.createPplBudgetState(policy);assert.equal(ppl.decidePplExecution({materialChange:false,routePosture:'economy_maintenance',routeQualified:true,state:s,policy}).modelCallAllowed,false);assert.equal(ppl.decidePplExecution({materialChange:true,routePosture:'final_reconciliation',routeQualified:false,currentStage:'FINAL',state:s,policy}).disposition,'FAIL_SAFE_ROUTE_UNQUALIFIED');assert.equal(ppl.buildPplProvenance({}).hiddenReasoningStored,false)});test('cache and validation retry are bounded',async()=>{assert.throws(()=>ai.assertSafeCachePolicy({enabled:true,personalized:true,authoritativeJudgment:false,protectedContent:false,sourceVersionDigest:'v'},'T1'),/explicit/);let calls=0;const c=ai.createD28AiExecutionControls({maxValidationAttempts:2}),r=await c.executeValidated({taskId:'t',request:{},capabilityId:'c',authorityLevel:'T2',executeCentral:async()=>({value:++calls}),validate:async o=>({accepted:o.value===2})});assert.equal(calls,2);assert.equal(r.validationRetryCount,1)});


test('D28 permits only explicit server-authorized D31 owner release and never claims D30 qualification',()=>{
  const state=ppl.createPplBudgetState(policy);
  const args={materialChange:true,routePosture:'bounded_interpretive',routeQualified:false,ownerReleaseAuthorized:true,currentStage:'EARLY',state,policy,delta:{scheduledReviews:1,modelCalls:1,inFlight:1}};
  const decision=ppl.decidePplExecution(args);
  assert.equal(decision.modelCallAllowed,true);
  assert.equal(decision.disposition,'OWNER_AUTHORIZED_BOUNDED_WORK');
  assert.equal(decision.authorizationBasis,'D31_OWNER_RELEASE_EXCEPTION');
  assert.equal(decision.empiricallyQualified,false);
  assert.equal(decision.automaticFinalization,false);
  const held=ppl.decidePplExecution({...args,ownerReleaseAuthorized:false});
  assert.equal(held.disposition,'FAIL_SAFE_ROUTE_UNQUALIFIED');
  assert.equal(held.modelCallAllowed,false);
});
test('D28 owner exception still enforces per-workspace budgets and final reconciliation posture',()=>{
  const base=ppl.createPplBudgetState(policy);
  const props={materialChange:true,routePosture:'strong_design',routeQualified:false,ownerReleaseAuthorized:true,currentStage:'FINAL',state:base,policy,delta:{scheduledReviews:1,modelCalls:1,inFlight:1}};
  const held=ppl.decidePplExecution(props);
  assert.equal(held.disposition,'FAIL_SAFE_STRONGER_ROUTE_REQUIRED');
  assert.equal(held.modelCallAllowed,false);
  const exhausted=ppl.decidePplExecution({...props,routePosture:'final_reconciliation',state:{...base,modelCalls:policy.maxModelCalls}});
  assert.equal(exhausted.disposition,'FAIL_SAFE_BUDGET_EXHAUSTED');
  assert.equal(exhausted.modelCallAllowed,false);
});
test('D28 runtime reads only the trusted D31 owner-release flag, not browser payload or synthetic qualification',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const runtime=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d28/runtime-service.js'),'utf8');
  assert.match(runtime,/resolveOwnerReleaseAuthorization\(env\)/);
  assert.match(runtime,/ownerReleaseAuthorized=ownerRelease\.enabled===true/);
  assert.match(runtime,/empiricallyQualified:routeQualified/);
  assert.match(runtime,/authorizationBasis:decision\.authorizationBasis/);
});
