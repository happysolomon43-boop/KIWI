'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const d30=require('../../../teaching/d30');

function fakeOrchestrator(){
  const lite={routeKey:'google::lite',provider:'google',modelId:'lite',reasoning:'LOW',taskClass:'FAKE'};
  const strong={routeKey:'google::strong',provider:'google',modelId:'strong',reasoning:'HIGH',taskClass:'FAKE'};
  return {
    run:async()=>{},
    plan(){return {candidates:[lite,strong]};},
    router:{
      getTask(){return {};},
      resolveCandidates(taskId,{preparationRoutePosture}={}){
        if(preparationRoutePosture==='economy_maintenance')return [lite];
        if(['strong_design','independent_validation','final_reconciliation'].includes(preparationRoutePosture))return [strong];
        return [lite,strong];
      },
    },
  };
}

function semantic(score){
  return {
    pass:true,accepted:true,academicCorrectness:score,scopeDiscipline:score,uncertaintyCalibration:score,
    provenanceQuality:score,coverage:score,coherence:score,anchoringResistance:score,defects:[],
  };
}

function record({scenario,arm,stage,attemptNo,score,cost,latency,defects=[]}){
  const routeKey=stage==='EARLY'?scenario.earlyRoute.routeKey:scenario.finalRoute.routeKey;
  return {
    runId:`${scenario.id}-${arm}-${stage}-${attemptNo}`,
    sessionId:'00000000-0000-4000-8000-000000000001',
    caseId:d30.pplCaseId(scenario.id,arm,stage),
    familyId:scenario.familyId,
    capabilityId:scenario.capabilityId,
    routeKey,routeRole:'STAGE',routePosture:stage==='EARLY'?'economy_maintenance':'final_reconciliation',
    modelId:stage==='EARLY'?'lite':'strong',provider:'google',centralTaskId:scenario.centralTaskId,
    promptFamilyVersion:d30.getFamilyDefinition(scenario.familyId).version,promptSha256:d30.getFamilyDefinition(scenario.familyId).promptSha256,
    runKind:'PPL_COMPARISON',criticality:scenario.criticality,attemptNo,
    validation:{pass:defects.every((item)=>!['P0','P1'].includes(item.severity))},semanticReview:semantic(score),
    defects,outputArtifact:{output:{scenario:scenario.id,arm,stage}},estimatedCostUsd:cost,latencyMs:latency,
  };
}

function completeEvidence(plan,{oneShotScore=.72,progressiveScore=.84}={}){
  const records=[];
  for(const scenario of plan.scenarios){
    for(let attemptNo=1;attemptNo<=plan.repeatCount;attemptNo+=1){
      records.push(record({scenario,arm:'ONE_SHOT',stage:'FINAL',attemptNo,score:oneShotScore,cost:2,latency:120}));
      records.push(record({scenario,arm:'PROGRESSIVE',stage:'EARLY',attemptNo,score:.70,cost:.2,latency:15}));
      records.push(record({scenario,arm:'PROGRESSIVE',stage:'FINAL',attemptNo,score:progressiveScore,cost:1.2,latency:80}));
    }
  }
  return records;
}

test('PPL plan covers matched lesson and assessment scenarios with three repeated attempts and 72 durable work items',()=>{
  const plan=d30.buildPplQualificationPlan({orchestrator:fakeOrchestrator()});
  assert.equal(plan.scenarios.length,8);
  assert.equal(plan.repeatCount,3);
  assert.equal(plan.scenarios.filter((item)=>item.familyId==='TPF-05').length,4);
  assert.equal(plan.scenarios.filter((item)=>item.familyId==='TPF-12').length,4);
  assert.equal(d30.buildPplWorkItems(plan).length,72);
  assert.equal(plan.scenarios.every((item)=>item.earlyRoute.routeKey==='google::lite'),true);
  assert.equal(plan.scenarios.every((item)=>item.finalRoute.routeKey==='google::strong'),true);
  assert.equal(plan.scenarios.every((item)=>item.earlyRoute.posture==='economy_maintenance'&&item.finalRoute.posture==='final_reconciliation'),true);
  assert.equal(plan.productionAuthorized,false);
  assert.equal(plan.authorizationGate,'D31');
});

test('one-shot and progressive final passes use the same final authoritative bundle while the progressive final may overturn an earlier proposal',()=>{
  const plan=d30.buildPplQualificationPlan({orchestrator:fakeOrchestrator()});
  const scenario=plan.scenarios[0];
  const one=d30.basePplCase(scenario,{arm:'ONE_SHOT',stage:'FINAL'});
  const earlyRecord=record({scenario,arm:'PROGRESSIVE',stage:'EARLY',attemptNo:1,score:.7,cost:.2,latency:15});
  const item=d30.buildPplWorkItems(plan).find((candidate)=>candidate.scenario.id===scenario.id&&candidate.arm==='PROGRESSIVE'&&candidate.stage==='FINAL'&&candidate.attemptNo===1);
  const progressive=d30.caseSpecForPplWorkItem(item,{records:[earlyRecord]});
  assert.deepEqual(progressive.preparationOverride.authoritative_input_bundle,one.preparationOverride.authoritative_input_bundle);
  assert.deepEqual(progressive.preparationOverride.previous_artifact,earlyRecord.outputArtifact.output);
  assert.equal(progressive.inputFixture.strongFinalMayOverturnPriorProposal,true);
  assert.equal(progressive.inputFixture.primaryAuthoritativeEvidenceSupplied,true);
  assert.equal(progressive.preparationOverride.route_posture,'final_reconciliation');
});

test('PPL materiality is calibrated from observed repeat noise and qualifies real quality gain or equivalent efficiency',()=>{
  const plan=d30.buildPplQualificationPlan({orchestrator:fakeOrchestrator()});
  const improved=d30.compareEmpiricalPpl({plan,records:completeEvidence(plan)});
  assert.equal(improved.complete,true);
  assert.equal(improved.thresholdCalibration,'OBSERVED_WITHIN_SCENARIO_REPEAT_RANGE');
  assert.equal(improved.empiricalNoiseFloors.coverage,0);
  assert.equal(improved.semanticImprovements.includes('coverage'),true);
  assert.equal(improved.materialQualityValue,true);
  assert.equal(improved.decision,'PROGRESSIVE_QUALIFIED');
  assert.equal(improved.activationAllowed,true);
  assert.equal(improved.productionAuthorized,false);

  const same=completeEvidence(plan,{oneShotScore:.8,progressiveScore:.8});
  const efficient=d30.compareEmpiricalPpl({plan,records:same});
  assert.equal(efficient.materialQualityValue,false);
  assert.equal(efficient.meaningfulEfficiency,true);
  assert.equal(efficient.decision,'PROGRESSIVE_QUALIFIED');
});

test('a strong final pass cannot erase a serious defect from its cheap early PPL stage',()=>{
  const plan=d30.buildPplQualificationPlan({orchestrator:fakeOrchestrator()});
  const records=completeEvidence(plan);
  const scenario=plan.scenarios[0];
  const failed=record({scenario,arm:'PROGRESSIVE',stage:'EARLY',attemptNo:1,score:.7,cost:.2,latency:15,defects:[{severity:'P1',code:'EARLY_STAGE_AUTHORITY_DEFECT'}]});
  const replaced=records.map((item)=>item.runId===failed.runId?failed:item);
  const comparison=d30.compareEmpiricalPpl({plan,records:replaced});
  assert.equal(comparison.progressive.seriousDefectCount,1);
  assert.equal(comparison.progressive.gatePasses.validators,false);
  assert.equal(comparison.activationAllowed,false);
  assert.equal(comparison.decision,'REDUCE_PREPARATION_PROFILE');
});

test('PPL comparison stays insufficient until every matched repeated final arm is present and stable',()=>{
  const plan=d30.buildPplQualificationPlan({orchestrator:fakeOrchestrator()});
  const partial=completeEvidence(plan).slice(0,-1);
  const comparison=d30.compareEmpiricalPpl({plan,records:partial});
  assert.equal(comparison.complete,false);
  assert.equal(comparison.decision,'INSUFFICIENT_EVIDENCE');
  assert.equal(comparison.activationAllowed,false);
});

test('C4 PPL final artifacts enter human academic review at representative attempt and on disagreement',()=>{
  const plan=d30.buildPplQualificationPlan({orchestrator:fakeOrchestrator()});
  const records=completeEvidence(plan);
  const selected=d30.pplHumanReviewRecords(records);
  assert.equal(selected.length,8);
  assert.equal(selected.every((item)=>item.familyId==='TPF-12'&&item.attemptNo===1),true);
  const scenario=plan.scenarios.find((item)=>item.familyId==='TPF-12');
  const failed=record({scenario,arm:'PROGRESSIVE',stage:'FINAL',attemptNo:2,score:.4,cost:1.2,latency:80,defects:[{severity:'P1',code:'ACADEMIC_DEFECT'}]});
  const expanded=d30.pplHumanReviewRecords([...records.filter((item)=>item.runId!==failed.runId),failed]);
  assert.equal(expanded.some((item)=>item.runId===failed.runId),true);
});