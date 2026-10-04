'use strict';

const { listCapabilities } = require('../capability-registry');
const { EVALUATION_SUITE_VERSION, getFamilyDefinition } = require('./contracts');
const { centralTaskFor, centrallyEligibleRouteKeys } = require('./route-policy');
const { runKey } = require('./repository');
const { seriousDefects } = require('./validators');

const PPL_COMPARISON_VERSION = 'teaching-d30-ppl-comparison-v1';
const PPL_COMPARISON_KEY = 'matched-lesson-assessment-one-shot-vs-progressive-v1';
const PPL_REPEAT_COUNT = 3;
const PPL_SEMANTIC_DIMENSIONS = Object.freeze([
  'academicCorrectness',
  'uncertaintyCalibration',
  'provenanceQuality',
  'coverage',
  'coherence',
  'anchoringResistance',
]);

const PPL_SCENARIOS = Object.freeze([
  Object.freeze({
    id:'LESSON-EVIDENCE-DELTA', familyId:'TPF-05', subject:'mathematics',
    focus:'Near-future Lesson preparation incorporates new Homework/evidence without freezing live-Class replanning.',
    initial:Object.freeze({course_plan_version:'cp-7',lesson_slot:'tomorrow-1',homework_evidence_version:'hw-12',schedule_version:'sched-4',evidence_state:'PARTIAL'}),
    final:Object.freeze({course_plan_version:'cp-7',lesson_slot:'tomorrow-1',homework_evidence_version:'hw-13',schedule_version:'sched-4',evidence_state:'MATERIAL_NEW_EVIDENCE'}),
    delta:Object.freeze({homework_evidence_version:['hw-12','hw-13'],purpose:'reconcile a material learning-evidence update'}),
  }),
  Object.freeze({
    id:'LESSON-SCHEDULE-DELTA', familyId:'TPF-05', subject:'physics',
    focus:'Lesson preparation reconciles an authoritative schedule/time-budget change while Scheduler authority remains external.',
    initial:Object.freeze({course_plan_version:'cp-8',lesson_slot:'tomorrow-2',schedule_version:'sched-9',available_minutes:55,evidence_state:'BOUNDED'}),
    final:Object.freeze({course_plan_version:'cp-8',lesson_slot:'tomorrow-2',schedule_version:'sched-10',available_minutes:40,evidence_state:'BOUNDED'}),
    delta:Object.freeze({schedule_version:['sched-9','sched-10'],available_minutes:[55,40],purpose:'reconcile changed authoritative time budget'}),
  }),
  Object.freeze({
    id:'LESSON-CONFLICT-RECHECK', familyId:'TPF-05', subject:'history',
    focus:'Final pre-Class reconciliation represents conflicting evidence rather than anchoring on the earlier preparation draft.',
    initial:Object.freeze({course_plan_version:'cp-9',source_bundle_version:'src-3',evidence_state:'BOUNDED'}),
    final:Object.freeze({course_plan_version:'cp-9',source_bundle_version:'src-4',evidence_state:'CONFLICTING',conflict:'Source A and Source B disagree on a material teaching claim.'}),
    delta:Object.freeze({source_bundle_version:['src-3','src-4'],purpose:'challenge prior draft after a source conflict appears'}),
  }),
  Object.freeze({
    id:'LESSON-ANCHOR-OVERTURN', familyId:'TPF-05', subject:'chemistry',
    focus:'A stronger final pass must be free to overturn an earlier cheap-route proposal from current primary authoritative evidence.',
    initial:Object.freeze({course_plan_version:'cp-10',evidence_version:'ev-21',provisional_emphasis:'worked examples',evidence_state:'BOUNDED'}),
    final:Object.freeze({course_plan_version:'cp-10',evidence_version:'ev-22',provisional_emphasis:'conceptual misconception repair',evidence_state:'CORRECTED'}),
    delta:Object.freeze({evidence_version:['ev-21','ev-22'],purpose:'overturn an obsolete provisional emphasis when current evidence requires it'}),
  }),
  Object.freeze({
    id:'ASSESSMENT-FORECAST-ELIGIBILITY', familyId:'TPF-12', subject:'mathematics',
    focus:'Assessment preparation keeps forecast scope separate from authoritative Assessment Eligibility at final re-evaluation.',
    initial:Object.freeze({course_plan_version:'cp-30',eligibility_ledger_version:'elig-8',forecast_scope:['LU-1','LU-2','LU-3'],eligible_scope:['LU-1'],assessment_policy_version:'ap-4'}),
    final:Object.freeze({course_plan_version:'cp-30',eligibility_ledger_version:'elig-9',forecast_scope:['LU-1','LU-2','LU-3'],eligible_scope:['LU-1','LU-2'],assessment_policy_version:'ap-4'}),
    delta:Object.freeze({eligibility_ledger_version:['elig-8','elig-9'],purpose:'reconcile current examinable scope without promoting forecast scope to eligibility'}),
  }),
  Object.freeze({
    id:'ASSESSMENT-WHOLE-PAPER', familyId:'TPF-12', subject:'biology',
    focus:'Major assessment preparation re-evaluates whole-paper coverage/coherence rather than treating item-level PASS as package PASS.',
    initial:Object.freeze({blueprint_version:'bp-11',candidate_pool_version:'pool-4',whole_paper_review_version:'review-1',known_finding:'outcome concentration unresolved'}),
    final:Object.freeze({blueprint_version:'bp-11',candidate_pool_version:'pool-5',whole_paper_review_version:'review-2',known_finding:'outcome concentration requires package-level repair before handoff'}),
    delta:Object.freeze({candidate_pool_version:['pool-4','pool-5'],whole_paper_review_version:['review-1','review-2'],purpose:'final whole-artifact coherence review'}),
  }),
  Object.freeze({
    id:'ASSESSMENT-PROTECTION-CHANGE', familyId:'TPF-12', subject:'computer_science',
    focus:'Protected assessment preparation reacts to contamination/exposure without leaking candidate specifics into ordinary teaching context.',
    initial:Object.freeze({blueprint_version:'bp-12',protection_state_version:'protect-6',candidate_state:'PROTECTED_VALID'}),
    final:Object.freeze({blueprint_version:'bp-12',protection_state_version:'protect-7',candidate_state:'CONTAMINATED_REVIEW_REQUIRED',protected_candidate_details_withheld:true}),
    delta:Object.freeze({protection_state_version:['protect-6','protect-7'],purpose:'retire or recheck affected protected preparation after contamination'}),
  }),
  Object.freeze({
    id:'ASSESSMENT-AMBIGUITY-FINAL', familyId:'TPF-12', subject:'interpretive_open_answer',
    focus:'Final assessment preparation preserves ambiguity/alternative-valid-answer handling instead of anchoring on a single earlier interpretation.',
    initial:Object.freeze({blueprint_version:'bp-13',rubric_review_version:'rub-2',evidence_state:'BOUNDED'}),
    final:Object.freeze({blueprint_version:'bp-13',rubric_review_version:'rub-3',evidence_state:'AMBIGUOUS_ALTERNATIVE_VALID_ANSWER',alternative_answer_requires_credit:true}),
    delta:Object.freeze({rubric_review_version:['rub-2','rub-3'],purpose:'final re-evaluation after a defensible alternative answer is identified'}),
  }),
]);

function capabilityForFamily(familyId) {
  const candidates = listCapabilities()
    .filter((item) => item.prompt_family_id === familyId && item.authority_ceiling !== 'T0')
    .sort((left,right) => left.id.localeCompare(right.id));
  if (!candidates.length) throw new Error(`No model-eligible capability is registered for PPL comparison family ${familyId}.`);
  return candidates[0];
}

function candidatesForPosture(orchestrator, taskId, posture) {
  if (!orchestrator?.plan) throw new TypeError('PPL qualification plan requires central KIWI AI Orchestrator plan().');
  const eligible = centrallyEligibleRouteKeys(orchestrator,taskId,posture);
  const planned = orchestrator.plan(taskId,{content:''}).candidates || [];
  const candidates = eligible ? planned.filter((item) => eligible.has(item.routeKey)) : planned;
  if (!candidates.length) {
    const error = new Error(`No central route is eligible for PPL posture ${posture} on ${taskId}.`);
    error.code='TEACHING_D30_PPL_ROUTE_UNAVAILABLE';
    throw error;
  }
  return Object.freeze(candidates);
}

function buildPplQualificationPlan({ orchestrator, repeatCount = PPL_REPEAT_COUNT } = {}) {
  if (!Number.isInteger(repeatCount) || repeatCount < 3) throw new Error('PPL empirical comparison requires at least three repeated attempts per matched scenario.');
  const scenarios=PPL_SCENARIOS.map((scenario) => {
    const capability=capabilityForFamily(scenario.familyId);
    const taskId=centralTaskFor({capabilityId:capability.id,familyId:scenario.familyId});
    const earlyCandidates=candidatesForPosture(orchestrator,taskId,'economy_maintenance');
    const finalCandidates=candidatesForPosture(orchestrator,taskId,'final_reconciliation');
    const early=earlyCandidates[0];
    const final=finalCandidates[0];
    return Object.freeze({
      ...scenario,
      capabilityId:capability.id,
      criticality:getFamilyDefinition(scenario.familyId).criticality,
      centralTaskId:taskId,
      earlyRoute:Object.freeze({routeKey:early.routeKey,provider:early.provider,modelId:early.modelId,posture:'economy_maintenance'}),
      finalRoute:Object.freeze({routeKey:final.routeKey,provider:final.provider,modelId:final.modelId,posture:'final_reconciliation'}),
      repeatCount,
    });
  });
  return Object.freeze({
    version:PPL_COMPARISON_VERSION,
    comparisonKey:PPL_COMPARISON_KEY,
    repeatCount,
    scenarios:Object.freeze(scenarios),
    matchedScenarioIds:Object.freeze(scenarios.map((item)=>item.id)),
    productionAuthorized:false,
    authorizationGate:'D31',
  });
}

function pplCaseId(scenarioId,arm,stage) {
  return `D30-PPL-${scenarioId}-${arm}-${stage}`.replace(/[^A-Z0-9-]/gi,'-').toUpperCase();
}

function basePplCase(scenario,{arm,stage,previousArtifact=null}={}) {
  const family=getFamilyDefinition(scenario.familyId);
  const progressive=arm==='PROGRESSIVE';
  const finalStage=stage==='FINAL';
  const bundle=finalStage ? scenario.final : scenario.initial;
  return Object.freeze({
    id:pplCaseId(scenario.id,arm,stage),
    suiteVersion:EVALUATION_SUITE_VERSION,
    familyId:scenario.familyId,
    familyVersion:family.version,
    promptSha256:family.promptSha256,
    capabilityId:scenario.capabilityId,
    criticality:family.criticality,
    kind:'PPL_COMPARISON',
    caseClass:'ppl_comparison',
    subject:scenario.subject,
    focus:scenario.focus,
    inputFixture:Object.freeze({
      scenarioId:scenario.id,
      comparisonArm:arm,
      comparisonStage:stage,
      matchedFinalAuthoritativeInput:finalStage,
      authoritativeInput:bundle,
      materialDelta:finalStage ? scenario.delta : null,
      earlyProposalAvailable:progressive && finalStage,
      strongFinalMayOverturnPriorProposal:progressive && finalStage,
      primaryAuthoritativeEvidenceSupplied:finalStage,
    }),
    expected:Object.freeze({
      authorityPreserved:true,
      provenancePreserved:true,
      uncertaintyRepresentable:true,
      coverageMeasured:true,
      coherenceMeasured:true,
      anchoringResistanceMeasured:true,
      finalReevaluationRequired:finalStage,
      priorCheapRouteNotAuthoritative:progressive,
    }),
    preparationOverride:Object.freeze({
      workspace_ref:`d30:ppl:${scenario.id}:${arm.toLowerCase()}`,
      workspace_version:'1',
      stage:finalStage ? 'Finalization Due' : 'Active',
      maturity:finalStage ? 'Candidate' : 'Skeleton',
      previous_artifact:progressive && finalStage ? previousArtifact : null,
      authoritative_input_bundle:Object.freeze({scenario_id:scenario.id,version:finalStage?'final':'initial',...bundle}),
      material_delta:finalStage ? scenario.delta : Object.freeze({purpose:'seed/triage initial preparation state'}),
      finding_refs:[],
      review_purpose:finalStage ? 'Final re-evaluation from primary authoritative evidence; overturn earlier proposal when current evidence requires it.' : 'Bounded inventory/risk triage only; do not cross a stronger maturity gate.',
      maturity_target:finalStage ? 'Pre-Lock Ready' : 'Structured',
      protection_class:scenario.familyId==='TPF-12' ? 'PROTECTED_FORMAL_ASSESSMENT' : 'ORDINARY_TEACHING',
      route_posture:finalStage ? 'final_reconciliation' : 'economy_maintenance',
      idempotency_key:`d30:ppl:${scenario.id}:${arm}:${stage}`,
      correlation_id:`d30:ppl:${scenario.id}`,
    }),
  });
}

function buildPplWorkItems(plan) {
  const items=[];
  for (const scenario of plan.scenarios) {
    for (let attemptNo=1;attemptNo<=scenario.repeatCount;attemptNo+=1) {
      items.push(Object.freeze({kind:'PPL',scenario,arm:'ONE_SHOT',stage:'FINAL',attemptNo,routeKey:scenario.finalRoute.routeKey}));
      items.push(Object.freeze({kind:'PPL',scenario,arm:'PROGRESSIVE',stage:'EARLY',attemptNo,routeKey:scenario.earlyRoute.routeKey}));
      items.push(Object.freeze({kind:'PPL',scenario,arm:'PROGRESSIVE',stage:'FINAL',attemptNo,routeKey:scenario.finalRoute.routeKey}));
    }
  }
  return Object.freeze(items);
}

function pplWorkItemKey(item) {
  return runKey({
    caseId:pplCaseId(item.scenario.id,item.arm,item.stage),
    routeKey:item.routeKey,
    routeRole:'STAGE',
    capabilityId:item.scenario.capabilityId,
    attemptNo:item.attemptNo,
  });
}

function findProgressiveEarlyRecord(records,item) {
  return records.find((record) =>
    record.caseId===pplCaseId(item.scenario.id,'PROGRESSIVE','EARLY') &&
    record.routeKey===item.scenario.earlyRoute.routeKey &&
    record.routeRole==='STAGE' &&
    record.capabilityId===item.scenario.capabilityId &&
    Number(record.attemptNo)===Number(item.attemptNo)
  ) || null;
}

function caseSpecForPplWorkItem(item,{records=[]}={}) {
  let previousArtifact=null;
  if (item.arm==='PROGRESSIVE' && item.stage==='FINAL') {
    const prior=findProgressiveEarlyRecord(records,item);
    if (!prior) {
      const error=new Error(`Progressive PPL final pass is missing its persisted early pass for ${item.scenario.id} attempt ${item.attemptNo}.`);
      error.code='TEACHING_D30_PPL_EARLY_EVIDENCE_REQUIRED';
      throw error;
    }
    previousArtifact=prior.outputArtifact?.output ?? prior.outputArtifact ?? null;
  }
  return basePplCase(item.scenario,{arm:item.arm,stage:item.stage,previousArtifact});
}

function range(values) {
  const numeric=values.filter(Number.isFinite);
  if (numeric.length<2) return 0;
  return Math.max(...numeric)-Math.min(...numeric);
}
function mean(values) {
  const numeric=values.filter(Number.isFinite);
  return numeric.length ? numeric.reduce((sum,value)=>sum+value,0)/numeric.length : null;
}
function recordScenarioId(record) {
  const match=String(record.caseId||'').match(/^D30-PPL-(.+)-(ONE-SHOT|PROGRESSIVE)-(EARLY|FINAL)$/);
  return match ? match[1] : null;
}
function isPplFinalRecord(record,arm) {
  const suffix=arm==='ONE_SHOT' ? '-ONE-SHOT-FINAL' : '-PROGRESSIVE-FINAL';
  return record.runKind==='PPL_COMPARISON' && String(record.caseId||'').endsWith(suffix);
}
function semanticMeasurements(record) {
  const semantic=record.semanticReview || {};
  return Object.freeze(Object.fromEntries(PPL_SEMANTIC_DIMENSIONS.map((key)=>[key,typeof semantic[key]==='number'?semantic[key]:null])));
}
function stableScenarioGate(records) {
  if (records.length<PPL_REPEAT_COUNT) return false;
  const decisions=new Set(records.map((record)=>record.validation?.pass===true && seriousDefects(record.defects||[]).length===0 && record.semanticReview?.pass===true));
  return decisions.size===1 && decisions.has(true);
}
function qualityRecordsForArm(records,arm) {
  const finals=records.filter((record)=>isPplFinalRecord(record,arm));
  const byScenario=new Map();
  for (const record of finals) {
    const scenarioId=recordScenarioId(record);
    if (!byScenario.has(scenarioId)) byScenario.set(scenarioId,[]);
    byScenario.get(scenarioId).push(record);
  }
  return Object.freeze(finals.map((record)=>{
    const scenarioId=recordScenarioId(record);
    const semantic=semanticMeasurements(record);
    const completeSemantic=PPL_SEMANTIC_DIMENSIONS.every((key)=>Number.isFinite(semantic[key]));
    return Object.freeze({
      scenarioId,
      attemptNo:record.attemptNo,
      qualityGates:Object.freeze({
        coverage:record.semanticReview?.accepted===true && Number.isFinite(semantic.coverage),
        coherence:record.semanticReview?.accepted===true && Number.isFinite(semantic.coherence),
        ambiguity:record.semanticReview?.accepted===true && Number.isFinite(semantic.uncertaintyCalibration),
        validators:record.validation?.pass===true,
        anchoringResistance:record.semanticReview?.accepted===true && Number.isFinite(semantic.anchoringResistance),
        stability:stableScenarioGate(byScenario.get(scenarioId)||[]),
      }),
      semantic,
      semanticComplete:completeSemantic,
      defects:Object.freeze([...(record.defects||[])]),
      estimatedCostUsd:Number(record.estimatedCostUsd||0),
      latencyMs:Number(record.latencyMs||0),
      routeKey:record.routeKey,
      modelId:record.modelId,
      provider:record.provider,
    });
  }));
}

function progressivePathRecords(records,plan) {
  const finalQuality=qualityRecordsForArm(records,'PROGRESSIVE');
  return Object.freeze(finalQuality.map((quality)=>{
    const scenario=plan.scenarios.find((item)=>item.id===quality.scenarioId);
    const early=records.find((record)=>record.caseId===pplCaseId(quality.scenarioId,'PROGRESSIVE','EARLY') && Number(record.attemptNo)===Number(quality.attemptNo) && record.routeKey===scenario?.earlyRoute.routeKey);
    if (!early) return quality;
    return Object.freeze({...quality,estimatedCostUsd:Number(quality.estimatedCostUsd||0)+Number(early.estimatedCostUsd||0),latencyMs:Number(quality.latencyMs||0)+Number(early.latencyMs||0),earlyRouteKey:early.routeKey});
  }));
}

function empiricalNoiseFloors(oneShotRecords,progressiveRecords,scenarioIds) {
  const floors={};
  for (const dimension of PPL_SEMANTIC_DIMENSIONS) {
    const observed=[];
    for (const scenarioId of scenarioIds) {
      observed.push(range(oneShotRecords.filter((item)=>item.scenarioId===scenarioId).map((item)=>item.semantic?.[dimension])));
      observed.push(range(progressiveRecords.filter((item)=>item.scenarioId===scenarioId).map((item)=>item.semantic?.[dimension])));
    }
    floors[dimension]=Math.max(0,...observed);
  }
  return Object.freeze(floors);
}

function summarizeEmpiricalArm(records) {
  const gateNames=['coverage','coherence','ambiguity','validators','anchoringResistance','stability'];
  return Object.freeze({
    sampleCount:records.length,
    scenarioCount:new Set(records.map((item)=>item.scenarioId)).size,
    seriousDefectCount:records.flatMap((item)=>item.defects||[]).filter((item)=>['P0','P1'].includes(item.severity)).length,
    gatePasses:Object.freeze(Object.fromEntries(gateNames.map((gate)=>[gate,records.length>0 && records.every((item)=>item.qualityGates?.[gate]===true)]))),
    semanticMeans:Object.freeze(Object.fromEntries(PPL_SEMANTIC_DIMENSIONS.map((dimension)=>[dimension,mean(records.map((item)=>item.semantic?.[dimension]))]))),
    averageCostUsd:mean(records.map((item)=>item.estimatedCostUsd)),
    averageLatencyMs:mean(records.map((item)=>item.latencyMs)),
  });
}

function compareEmpiricalPpl({plan,records=[]}={}) {
  if (!plan?.matchedScenarioIds?.length) throw new Error('PPL empirical comparison requires a matched scenario plan.');
  const oneShot=qualityRecordsForArm(records,'ONE_SHOT');
  const progressive=progressivePathRecords(records,plan);
  const expectedAttempts=plan.matchedScenarioIds.length*plan.repeatCount;
  const oneShotSummary=summarizeEmpiricalArm(oneShot);
  const progressiveSummary=summarizeEmpiricalArm(progressive);
  const complete=oneShot.length===expectedAttempts && progressive.length===expectedAttempts &&
    plan.matchedScenarioIds.every((id)=>oneShot.filter((item)=>item.scenarioId===id).length===plan.repeatCount && progressive.filter((item)=>item.scenarioId===id).length===plan.repeatCount);
  const noiseFloors=empiricalNoiseFloors(oneShot,progressive,plan.matchedScenarioIds);
  const regressions=[];
  const improvements=[];
  if (complete) {
    for (const dimension of PPL_SEMANTIC_DIMENSIONS) {
      const left=oneShotSummary.semanticMeans[dimension];
      const right=progressiveSummary.semanticMeans[dimension];
      const floor=noiseFloors[dimension];
      if (!Number.isFinite(left)||!Number.isFinite(right)) continue;
      if (right < left-floor) regressions.push(dimension);
      if (right > left+floor) improvements.push(dimension);
    }
  }
  const seriousDefectImprovement=progressiveSummary.seriousDefectCount<oneShotSummary.seriousDefectCount;
  const noGateRegression=Object.keys(oneShotSummary.gatePasses).every((gate)=>!oneShotSummary.gatePasses[gate] || progressiveSummary.gatePasses[gate]);
  const materialQualityValue=complete && regressions.length===0 && noGateRegression && (seriousDefectImprovement||improvements.length>0);
  const equivalentQuality=complete && regressions.length===0 && noGateRegression && progressiveSummary.seriousDefectCount<=oneShotSummary.seriousDefectCount;
  const meaningfulEfficiency=equivalentQuality && Number.isFinite(oneShotSummary.averageCostUsd) && Number.isFinite(progressiveSummary.averageCostUsd) && Number.isFinite(oneShotSummary.averageLatencyMs) && Number.isFinite(progressiveSummary.averageLatencyMs) && progressiveSummary.averageCostUsd<oneShotSummary.averageCostUsd && progressiveSummary.averageLatencyMs<oneShotSummary.averageLatencyMs;
  const progressiveGatesPass=Object.values(progressiveSummary.gatePasses).every(Boolean);
  const qualified=complete && progressiveGatesPass && progressiveSummary.seriousDefectCount===0 && (materialQualityValue||meaningfulEfficiency);
  return Object.freeze({
    version:PPL_COMPARISON_VERSION,
    comparisonKey:PPL_COMPARISON_KEY,
    decision:!complete?'INSUFFICIENT_EVIDENCE':qualified?'PROGRESSIVE_QUALIFIED':'REDUCE_PREPARATION_PROFILE',
    matchedScenarioCount:plan.matchedScenarioIds.length,
    repeatCount:plan.repeatCount,
    expectedFinalSamplesPerArm:expectedAttempts,
    complete,
    oneShot:oneShotSummary,
    progressive:progressiveSummary,
    empiricalNoiseFloors:noiseFloors,
    semanticImprovements:Object.freeze(improvements),
    semanticRegressions:Object.freeze(regressions),
    seriousDefectImprovement,
    materialQualityValue,
    equivalentQuality,
    meaningfulEfficiency,
    activationAllowed:qualified,
    thresholdCalibration:'OBSERVED_WITHIN_SCENARIO_REPEAT_RANGE',
    productionAuthorized:false,
    authorizationGate:'D31',
  });
}

module.exports={
  PPL_COMPARISON_VERSION,
  PPL_COMPARISON_KEY,
  PPL_REPEAT_COUNT,
  PPL_SEMANTIC_DIMENSIONS,
  PPL_SCENARIOS,
  capabilityForFamily,
  candidatesForPosture,
  buildPplQualificationPlan,
  pplCaseId,
  basePplCase,
  buildPplWorkItems,
  pplWorkItemKey,
  findProgressiveEarlyRecord,
  caseSpecForPplWorkItem,
  qualityRecordsForArm,
  progressivePathRecords,
  empiricalNoiseFloors,
  summarizeEmpiricalArm,
  compareEmpiricalPpl,
};