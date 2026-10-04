'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const d30 = require('../../../teaching/d30');

function fakePlan() {
  const caseSpec = d30.HISTORICAL_FAMILY_CORPUS.find((item) => item.familyId === 'TPF-01');
  return Object.freeze({
    capabilityCount:1,
    primaryTargetCount:1,
    fallbackTargetCount:0,
    everyFallbackIndependent:true,
    targets:Object.freeze([Object.freeze({
      targetKey:`${caseSpec.capabilityId}::PRIMARY::fake::route`,
      capabilityId:caseSpec.capabilityId,
      familyId:caseSpec.familyId,
      familyVersion:caseSpec.familyVersion,
      criticality:caseSpec.criticality,
      stage:null,
      routePosture:'bounded_interpretive',
      centralTaskId:'QUICK_QUESTIONS',
      routeKey:'fake::route',
      provider:'fake',
      modelId:'route',
      routeRole:'PRIMARY',
      requiredCaseIds:Object.freeze([caseSpec.id]),
      repeatedCaseIds:Object.freeze([caseSpec.id]),
      productionAuthorized:false,
      authorizationGate:'D31',
    })]),
  });
}

function c4Records() {
  const cases = d30.HISTORICAL_FAMILY_CORPUS.filter((item) => item.familyId === 'TPF-02');
  const representative = cases.find((item) => item.caseClass === 'golden') || cases[0];
  const edge = cases.find((item) => d30.EDGE_REVIEW_CLASSES.includes(item.caseClass) && item.id !== representative.id) || cases[1];
  const target = {
    targetKey:'c4-target',
    capabilityId:representative.capabilityId,
    familyId:'TPF-02',
    familyVersion:representative.familyVersion,
    criticality:'C4',
    routeKey:'fake::c4',
    routeRole:'PRIMARY',
    requiredCaseIds:[representative.id,edge.id],
    repeatedCaseIds:[],
  };
  const make = (caseSpec, overrides = {}) => ({
    runId:`run-${caseSpec.id}`,
    sessionId:'00000000-0000-4000-8000-000000000001',
    caseId:caseSpec.id,
    familyId:caseSpec.familyId,
    capabilityId:caseSpec.capabilityId,
    routeKey:target.routeKey,
    routeRole:'PRIMARY',
    modelId:'model',provider:'fake',promptFamilyVersion:caseSpec.familyVersion,promptSha256:caseSpec.promptSha256,
    criticality:'C4',attemptNo:1,validation:{pass:true},semanticReview:{pass:true},defects:[],outputArtifact:{caseId:caseSpec.id,output:{bounded:true}},
    ...overrides,
  });
  return {target,representative,edge,records:[make(representative),make(edge)]};
}

test('work plan keys are deterministic and include stability replay attempts', () => {
  const plan = fakePlan();
  const items = d30.buildWorkItems({plan,includeCrossFamily:false});
  assert.equal(items.length,3);
  assert.deepEqual(items.map((item) => item.attemptNo),[1,2,3]);
  const keys = items.map(d30.workItemKey);
  assert.equal(new Set(keys).size,3);
  assert.ok(keys[0].includes('::PRIMARY::'));
});

test('C4 human review selection includes representative, edge and disagreement evidence', () => {
  const {target,representative,edge,records} = c4Records();
  const selected = d30.requiredHumanReviewCaseIds(target,records);
  assert.ok(selected.includes(representative.id));
  assert.ok(selected.includes(edge.id));

  const disagreementCase = d30.HISTORICAL_FAMILY_CORPUS.find((item) => item.familyId === 'TPF-02' && item.capabilityId === target.capabilityId && !selected.includes(item.id));
  if (disagreementCase) {
    const disagreement = {
      ...records[0],runId:`run-${disagreementCase.id}`,caseId:disagreementCase.id,
      validation:{pass:false},defects:[{severity:'P1',code:'DISAGREEMENT'}],outputArtifact:{caseId:disagreementCase.id,output:{bounded:true}},
    };
    const expandedTarget={...target,requiredCaseIds:[...target.requiredCaseIds,disagreementCase.id]};
    const expanded=d30.requiredHumanReviewCaseIds(expandedTarget,[...records,disagreement]);
    assert.ok(expanded.includes(disagreementCase.id));
  }
});

test('selected human-review queue contains only required C4/cross-family/consequential evidence', () => {
  const {target,records} = c4Records();
  const plan={...fakePlan(),targets:[target]};
  const queue=d30.selectedHumanReviewQueue({plan,records});
  assert.ok(queue.length >= 1);
  assert.equal(queue.every((item)=>item.familyId==='TPF-02'),true);
  assert.equal(queue.every((item)=>item.criticality==='C4'),true);
});

test('startOrResume reuses the exact running source-SHA session instead of creating duplicates', async () => {
  let beginCalls=0;
  const existing={id:'00000000-0000-4000-8000-000000000777',source_sha:'a'.repeat(40),environment:'INTEGRATION',status:'RUNNING'};
  const repository={
    async assertReady(){return true;},
    async findResumableSession({sourceSha,environment}){assert.equal(sourceSha,'a'.repeat(40));assert.equal(environment,'INTEGRATION');return existing;},
    async beginSession(){beginCalls+=1;return 'new-session';},
    async recordCaseResult(){},
  };
  const coordinator=d30.createD30QualificationCoordinator({
    baseOrchestrator:{run:async()=>{},plan:()=>({candidates:[]})},
    repository,
    semanticReviewer:null,
    invariantEvidenceProvider:null,
    crossFamilyExecutor:async()=>({authorityPreserved:true,provenancePreserved:true,handoffCompatible:true}),
  });
  const result=await coordinator.startOrResume({sourceSha:'a'.repeat(40),environment:'INTEGRATION'});
  assert.equal(result.sessionId,existing.id);
  assert.equal(result.resumed,true);
  assert.equal(beginCalls,0);
});

test('final report cannot close a session while empirical, human or PPL evidence is incomplete', async () => {
  const plan=fakePlan();
  const repository={
    async assertReady(){return true;},
    async beginSession(){return 'session';},
    async recordCaseResult(){},
    async listCaseResults(){return [];},
    async listHumanReviews(){return [];},
    async listCompletedRunKeys(){return new Set();},
    async sessionEvidenceCounts(){return {caseResults:0,humanReviews:0,openDefects:0,routeDecisions:0,pplComparisons:0};},
    async recordRouteDecision(){},
    async completeSession(){throw new Error('must not close incomplete session');},
  };
  const coordinator=d30.createD30QualificationCoordinator({
    baseOrchestrator:{run:async()=>{},plan:()=>({candidates:[]})},
    repository,
    crossFamilyExecutor:async()=>({authorityPreserved:true,provenancePreserved:true,handoffCompatible:true}),
  });
  const result=await coordinator.finalize({sessionId:'session',plan,records:[],humanReviews:[],pplComparison:null,includeCrossFamily:false});
  assert.equal(result.empiricalExecutionComplete,false);
  assert.equal(result.evidenceComplete,false);
  assert.equal(result.report.productionQualified,false);
  assert.equal(result.sessionStatus,'RUNNING');
});