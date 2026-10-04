'use strict';

const { FULL_CORPUS, DECISION, AUTHORING_STATES, FAILURE_ROOT_CAUSES, qualifyRoute, comparePplStrategies } = require('./index');

const DEFAULT_ROUTE_POLICY = Object.freeze({
  normalTeachingRoute: 'website_default_ai_route',
  coursePlanRoute: 'flash_generation_ai_route',
  inheritanceForbidden: true,
});

const REQUIRED_VALIDATORS = Object.freeze([
  'schema','authority','uncertainty','scope','provenance','protected_content','academic_correctness','coverage_coherence','anchoring_resistance'
]);

const CROSS_FAMILY_CHAINS = Object.freeze([
  ['TPF-04','TPF-05','TPF-06','TPF-07','TPF-08','TPF-09'],
  ['TPF-12','TPF-13','TPF-14','AUTHORITATIVE_PACKAGE_LOCK'],
  ['TPF-15','DETERMINISTIC_AGGREGATION','TPF-16','GRADEBOOK_OWNER'],
  ['TPF-11','ASSESSMENT_INTEGRITY_HANDOFF'],
  ['TPF-18','TPF-08'],
]);

function resolveD30Route({ responsibilityKey='', capabilityId='', isCoursePlan=false }={}) {
  const coursePlan = isCoursePlan || /course[_ -]?plan/i.test(String(responsibilityKey)) || /course[_ -]?plan/i.test(String(capabilityId));
  return Object.freeze({
    routeKey: coursePlan ? DEFAULT_ROUTE_POLICY.coursePlanRoute : DEFAULT_ROUTE_POLICY.normalTeachingRoute,
    source: coursePlan ? 'flash_generation_route' : 'website_default_route',
    independentQualificationRequired: true,
  });
}

function validateCaseShape(testCase) {
  const defects=[];
  if(!testCase?.id) defects.push({severity:'P0',code:'CASE_ID_MISSING'});
  if(!testCase?.familyId) defects.push({severity:'P0',code:'FAMILY_ID_MISSING'});
  if(!testCase?.kind) defects.push({severity:'P1',code:'RUN_KIND_MISSING'});
  return defects;
}

function deterministicValidate({ testCase, output, context={} }={}) {
  const defects=[...validateCaseShape(testCase)];
  if(output == null) defects.push({severity:'P1',code:'EMPTY_OUTPUT'});
  if(context.authorityEscalation===true) defects.push({severity:'P0',code:'AUTHORITY_ESCALATION'});
  if(context.protectedContentLeak===true) defects.push({severity:'P0',code:'PROTECTED_CONTENT_LEAK'});
  if(context.unsupportedClaim===true) defects.push({severity:'P1',code:'UNSUPPORTED_CLAIM'});
  if(context.scopeExpansion===true) defects.push({severity:'P1',code:'SCOPE_EXPANSION'});
  return Object.freeze({accepted:!defects.some(d=>d.severity==='P0'||d.severity==='P1'),defects:Object.freeze(defects)});
}

function createRunRecord({testCase,route,modelMetadata={},validation,latencyMs=0,tokens={},costUsd=0,retryCount=0,timedOut=false,fallbackUsed=false}={}){
  return Object.freeze({
    runId:`${testCase.id}:${route.routeKey}:${modelMetadata.modelId||'unknown'}:${Date.now()}`,
    caseId:testCase.id,familyId:testCase.familyId,kind:testCase.kind,routeId:route.routeKey,
    modelId:modelMetadata.modelId||'unknown',provider:modelMetadata.provider||'unknown',settingsHash:modelMetadata.settingsHash||'runtime-default',
    validation,latencyMs,inputTokens:Number(tokens.input||0),outputTokens:Number(tokens.output||0),estimatedCostUsd:Number(costUsd||0),
    retryCount:Number(retryCount||0),timedOut:Boolean(timedOut),fallbackUsed:Boolean(fallbackUsed),
  });
}

function createQualificationHarness({ executeCentral, persistRun=null, semanticReview=null }={}) {
  if(typeof executeCentral!=='function') throw new TypeError('D30 harness requires central KIWI AI Orchestrator execution.');
  async function executeCase(testCase,{responsibilityKey='',capabilityId='',isCoursePlan=false,request={},review=false}={}){
    const route=resolveD30Route({responsibilityKey,capabilityId,isCoursePlan});
    const started=Date.now();
    let central;
    try { central=await executeCentral({testCase,route,request}); }
    catch(error){
      const validation=Object.freeze({accepted:false,defects:Object.freeze([{severity:'P1',code:error?.code||'ROUTE_EXECUTION_FAILED'}])});
      const record=createRunRecord({testCase,route,validation,latencyMs:Date.now()-started,timedOut:error?.code==='TIMEOUT'});
      if(persistRun) await persistRun(record);
      return record;
    }
    const validation=deterministicValidate({testCase,output:central?.output??central,context:central?.validationContext||{}});
    let semantic=null;
    if(review && semanticReview) semantic=await semanticReview({testCase,output:central?.output??central,route});
    const record=createRunRecord({testCase,route,modelMetadata:central?.modelMetadata||{},validation:Object.freeze({...validation,semantic}),latencyMs:Date.now()-started,tokens:central?.tokens,costUsd:central?.costUsd,retryCount:central?.retryCount,fallbackUsed:central?.fallbackUsed});
    if(persistRun) await persistRun(record);
    return record;
  }
  async function runCorpus(cases=FULL_CORPUS,options={}){
    const records=[];
    for(const testCase of cases) records.push(await executeCase(testCase,options));
    return Object.freeze(records);
  }
  return Object.freeze({executeCase,runCorpus});
}

function simulateRouteFailures({attempts=[]}={}){
  const results=attempts.map((attempt,index)=>Object.freeze({
    index,provider:attempt.provider||'unknown',condition:attempt.condition||'unknown',
    retryAllowed:!['AUTH','INVALID_REQUEST','SAFETY_BLOCK'].includes(attempt.condition),
    circuitBreak:attempt.condition==='QUOTA_EXHAUSTED'||attempt.condition==='PROVIDER_DOWN',
    rotateCredential:attempt.condition==='AUTH'||attempt.condition==='QUOTA_EXHAUSTED',
    generationAffinityPreserved:attempt.generationAffinityPreserved!==false,
  }));
  return Object.freeze(results);
}

function stabilityReport(records,{minimumRuns=3}={}){
  const groups=new Map();
  for(const r of records){const key=`${r.caseId}:${r.routeId}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}
  const unstable=[];
  for(const [key,runs] of groups){const decisions=new Set(runs.map(r=>Boolean(r.validation?.accepted)));if(runs.length<minimumRuns||decisions.size>1)unstable.push({key,runs:runs.length,decisionVariants:decisions.size});}
  return Object.freeze({passed:unstable.length===0,minimumRuns,unstable:Object.freeze(unstable)});
}

function buildRouteQualificationReport({routeId,familyId,role='primary',records=[],humanReviews=[],minimumRuns=3}={}){
  const defects=records.flatMap(r=>r.validation?.defects||[]);
  const stability=stabilityReport(records,{minimumRuns});
  const requiresHuman=records.some(r=>r.criticality==='C4'||r.consequential===true);
  const humanReviewSatisfied=!requiresHuman||humanReviews.some(r=>r.independent===true&&r.decision==='PASS');
  const decision=qualifyRoute({routeId,familyId,role,runs:records,requiresHumanReview:requiresHuman,humanReviewSatisfied,stabilitySatisfied:stability.passed});
  return Object.freeze({...decision,defects:Object.freeze(defects),stability,humanReviewSatisfied,specificationComplete:true,productionQualified:decision.decision===DECISION.QUALIFIED});
}

function validatePromptGovernance(record={}){
  const errors=[];
  if(!AUTHORING_STATES.includes(record.state)) errors.push('INVALID_AUTHORING_STATE');
  if(record.state!=='NOT_STARTED'&&!record.behaviorBriefApproved) errors.push('BEHAVIOR_BRIEF_REQUIRED');
  if(record.failureRootCause&&!FAILURE_ROOT_CAUSES.includes(record.failureRootCause)) errors.push('INVALID_FAILURE_ROOT_CAUSE');
  if(record.silentFrozenPromptMutation) errors.push('FROZEN_PROMPT_MUTATION_FORBIDDEN');
  if(record.duplicatesSharedRules) errors.push('SHARED_RULE_DUPLICATION');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

function verifyCrossFamilyCompatibility(observations=[]){
  const missing=[];
  for(const chain of CROSS_FAMILY_CHAINS){const key=chain.join('→');if(!observations.some(o=>o.chain===key&&o.compatible===true))missing.push(key)}
  return Object.freeze({passed:missing.length===0,missing:Object.freeze(missing)});
}

function buildPplQualification({oneShot,progressive}={}){
  const comparison=comparePplStrategies({oneShot,progressive});
  return Object.freeze({...comparison,reducePreparationProfile:comparison.decision!=='PROGRESSIVE_QUALIFIED'});
}

module.exports={DEFAULT_ROUTE_POLICY,REQUIRED_VALIDATORS,CROSS_FAMILY_CHAINS,resolveD30Route,deterministicValidate,createRunRecord,createQualificationHarness,simulateRouteFailures,stabilityReport,buildRouteQualificationReport,validatePromptGovernance,verifyCrossFamilyCompatibility,buildPplQualification};