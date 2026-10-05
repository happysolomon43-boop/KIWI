'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const d30 = require('../../../teaching/d30');
const { createTeachingPromptControlPlane } = require('../../../teaching/prompt-runtime');
const { sanitizeAcademicInput, validatePassAControls, validatePassBControls } = require('../../../teaching/d20/intelligence');

const root = path.join(__dirname, '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function baseRun(overrides = {}) {
  return {
    sessionId:'00000000-0000-4000-8000-000000000001',
    runId:overrides.runId || `00000000-0000-4000-8000-${String(overrides.attemptNo || 1).padStart(12,'0')}`,
    caseId:'D30-TPF-01-001', familyId:'TPF-01', capabilityId:'teaching.course.student_profile_interpretation',
    routeKey:'groq::model-a', routeRole:'PRIMARY', routePosture:'bounded_interpretive', modelId:'model-a', provider:'groq', centralTaskId:'QUICK_QUESTIONS',
    promptFamilyVersion:'1.0', promptSha256:d30.getFamilyDefinition('TPF-01').promptSha256,
    runKind:'GOLDEN', criticality:'C3', attemptNo:1,
    validation:{pass:true}, semanticReview:{pass:true}, defects:[], outputArtifact:{result:'bounded'},
    ...overrides,
  };
}

function qualityRecord(scenarioId, { gates = true, defects = [], cost = 1, latency = 100 } = {}) {
  const qualityGates = typeof gates === 'object' ? gates : {
    coverage:gates, coherence:gates, validators:gates, anchoringResistance:gates, stability:gates,
  };
  return { scenarioId, qualityGates, defects, estimatedCostUsd:cost, latencyMs:latency };
}

test('D30 owns exactly the canonical 46-task scope', () => {
  assert.equal(d30.D30_TASK_IDS.length, 46);
  assert.equal(new Set(d30.D30_TASK_IDS).size, 46);
  for (const id of ['TCH-0819','TCH-0832','TCH-0834','TCH-0855','TCH-0857','TCH-0860','TCH-0866','TCH-0902','TCH-0920']) assert.ok(d30.D30_TASK_IDS.includes(id), id);
  for (const excluded of ['TCH-0833','TCH-0856','TCH-0858','TCH-0859','TCH-0867']) assert.equal(d30.D30_TASK_IDS.includes(excluded), false, excluded);
});

test('Phase-16 historical corpus and TPF-20 amendment meet exact distinct floors', () => {
  assert.deepEqual(d30.CORPUS_COUNTS, {
    historicalIsolated:1832, crossFamily:72, historicalDistinct:1904,
    tpf20Distinct:96, totalDistinct:2000, seedTraceSlots:38, modelEligibleCapabilities:148,
  });
  assert.equal(new Set(d30.FULL_DISTINCT_CORPUS.map((item) => item.id)).size, 2000);
  assert.equal(d30.HISTORICAL_FAMILY_CORPUS.filter((item) => item.seedExemplarTrace).every((item) => item.seedExemplarTrace.contentCopied === false), true);
});

test('every model-eligible capability is exercised and every family construction floor is preserved', () => {
  const covered = new Set(d30.HISTORICAL_FAMILY_CORPUS.concat(d30.TPF20_CORPUS).map((item) => item.capabilityId));
  assert.equal(covered.size, 148);
  for (const family of d30.FAMILY_DEFINITIONS.filter((item) => item.familyId !== 'TPF-20')) {
    const cases = d30.HISTORICAL_FAMILY_CORPUS.filter((item) => item.familyId === family.familyId);
    assert.equal(cases.length, family.constructionFloor, family.familyId);
    assert.equal(new Set(cases.map((item) => item.capabilityId)).size, family.capabilityCount, family.familyId);
  }
});

test('corpus spans adversarial, counterfactual, uncertainty, cross-subject, regression and TPF-20 required classes', () => {
  const classes = new Set(d30.HISTORICAL_FAMILY_CORPUS.map((item) => item.caseClass));
  for (const item of ['negative','counterfactual','uncertainty','injection','authority_attack','source_conflict','cross_subject','metamorphic','regression']) assert.ok(classes.has(item), item);
  assert.equal(new Set(d30.HISTORICAL_FAMILY_CORPUS.map((item) => item.subject)).size, 10);
  const tpf20 = new Set(d30.TPF20_CORPUS.map((item) => item.caseClass));
  for (const item of ['plan_actual_divergence','planned_card_change','final_card_change','relevant_cards','unrelated_cards','conflicting_cards','newly_validated_cards','claim_provenance','card_coverage','partial_class','missed_class','correction','unsupported_bridge','protected_content','injection','stale_input','preclass_latency','reconciliation_latency','stability','subject_knowledge_type_quality','academic_correctness','explanation_quality','accessibility','end_to_end_publication_gate']) assert.ok(tpf20.has(item), item);
  assert.deepEqual([...new Set(d30.TPF20_CORPUS.map((item) => item.stage))].sort(), ['END_TO_END','PRECLASS','RECONCILIATION']);
});

test('D30 family identities exactly match the frozen runtime prompt catalog', () => {
  const control = createTeachingPromptControlPlane();
  control.assertReady();
  const status = control.status();
  assert.equal(status.promptManifestVersion, d30.PROMPT_MANIFEST_VERSION);
  assert.equal(status.promptManifestSha256, d30.PROMPT_MANIFEST_SHA256);
  assert.equal(status.promptPackSha256, d30.PROMPT_PACK_SHA256);
  const runtimeFamilies = new Map(control.listPromptFamilies().map((item) => [item.id, item]));
  assert.equal(runtimeFamilies.size, 20);
  for (const family of d30.FAMILY_DEFINITIONS) {
    const runtime = runtimeFamilies.get(family.familyId);
    assert.ok(runtime, family.familyId);
    assert.equal(runtime.version, family.version, family.familyId);
    assert.equal(runtime.criticality, family.criticality, family.familyId);
    assert.equal(runtime.promptSha256, family.promptSha256, family.familyId);
  }
});

test('normal Teaching uses website-default central task and Course Plan uses flashcard-generation central task', () => {
  assert.equal(d30.centralTaskFor({familyId:'TPF-01'}), 'MAIN_CBT');
  assert.equal(d30.centralTaskFor({familyId:'TPF-20'}), 'MAIN_CBT');
  assert.equal(d30.centralTaskFor({familyId:'TPF-03'}), 'MAIN_CBT');
});

test('PPL route postures remain metadata and do not hard-code model IDs', () => {
  assert.equal(d30.routePostureFor({familyId:'TPF-20',stage:'PRECLASS'}), 'bounded_interpretive');
  assert.equal(d30.routePostureFor({familyId:'TPF-20',stage:'RECONCILIATION'}), 'final_reconciliation');
  assert.equal(d30.routePostureFor({familyId:'TPF-14'}), 'strong_design');
  assert.equal(d30.routePostureFor({familyId:'TPF-18'}), 'economy_maintenance');
});

test('qualification plan covers all 148 capabilities and independently enumerates every fallback', () => {
  const fakeOrchestrator = { plan(taskId) { return { candidates:[
    {routeKey:`primary::${taskId}`,provider:'primary',modelId:'model-p',reasoning:'MEDIUM',taskClass:taskId},
    {routeKey:`fallback::${taskId}`,provider:'fallback',modelId:'model-f',reasoning:'MEDIUM',taskClass:taskId},
  ] }; } };
  const plan = d30.buildQualificationPlan({orchestrator:fakeOrchestrator});
  assert.equal(plan.capabilityCount, 148);
  assert.equal(new Set(plan.targets.map((target) => target.capabilityId)).size, 148);
  assert.equal(plan.fallbackTargetCount > 0, true);
  assert.equal(plan.everyFallbackIndependent, true);
  assert.equal(plan.targets.every((target) => target.productionAuthorized === false && target.authorizationGate === 'D31'), true);
  assert.equal(plan.targets.filter((target) => target.familyId === 'TPF-20' && target.stage).length, 6);
  assert.equal(plan.targets.every((target) => target.centralTaskId === 'MAIN_CBT'), true);
});

test('deterministic validators fail closed on authority, injection, stale and protected-content violations', () => {
  const injection = d30.HISTORICAL_FAMILY_CORPUS.find((item) => item.caseClass === 'injection');
  const failed = d30.validateExecutionEvidence({caseSpec:injection,execution:{schemaValidation:true},invariantEvidence:{schema:true,authority:true,provenance:true,injectionResistance:false}});
  assert.equal(failed.pass, false);
  assert.ok(failed.defects.some((item) => item.severity === 'P0' && item.code === 'INJECTION_BOUNDARY_FAILED'));
  const protectedCase = d30.TPF20_CORPUS.find((item) => item.caseClass === 'protected_content');
  const protectedResult = d30.validateExecutionEvidence({caseSpec:protectedCase,execution:{schemaValidation:true},invariantEvidence:{schema:true,authority:true,provenance:true,protectedContentIsolation:false}});
  assert.ok(protectedResult.defects.some((item) => item.code === 'PROTECTED_CONTENT_ISOLATION_FAILED'));
});

test('semantic rubric is required and P0/P1 cannot be averaged away', () => {
  assert.equal(d30.evaluateSemanticReview({caseSpec:{},semanticReview:null}).pass, false);
  const bad = d30.evaluateSemanticReview({caseSpec:{},semanticReview:{accepted:true,academicCorrectness:1,scopeDiscipline:1,uncertaintyCalibration:1,provenanceQuality:1,defects:[{severity:'P1',code:'SERIOUS',message:'serious'}]}});
  assert.equal(bad.pass, false);
});

test('route qualification is capability-specific, fail-closed, and C4 requires case-bound human academic review', () => {
  const c = 'teaching.course.student_profile_interpretation';
  const passing = baseRun({capabilityId:c});
  const summary = d30.summarizeRouteQualification({routeKey:passing.routeKey,routeRole:'PRIMARY',familyId:'TPF-01',capabilityId:c,requiredCaseIds:[passing.caseId],records:[passing],minimumRepeats:1});
  assert.equal(summary.decision, 'QUALIFIED');
  const wrongCapability = d30.summarizeRouteQualification({routeKey:passing.routeKey,routeRole:'PRIMARY',familyId:'TPF-01',capabilityId:'other.capability',requiredCaseIds:[passing.caseId],records:[passing],minimumRepeats:1});
  assert.equal(wrongCapability.decision, 'INSUFFICIENT_EVIDENCE');
  const c4 = baseRun({familyId:'TPF-02',capabilityId:'teaching.course.curriculum_structure_analysis',criticality:'C4',promptFamilyVersion:'1.0',promptSha256:d30.getFamilyDefinition('TPF-02').promptSha256});
  const blocked = d30.summarizeRouteQualification({routeKey:c4.routeKey,routeRole:'PRIMARY',familyId:'TPF-02',capabilityId:c4.capabilityId,requiredCaseIds:[c4.caseId],records:[c4],minimumRepeats:1});
  assert.equal(blocked.decision,'BLOCKED');
  const human = [{caseId:c4.caseId,familyId:'TPF-02',capabilityId:c4.capabilityId,routeKey:c4.routeKey,independent:true,reviewerKind:'HUMAN_ACADEMIC',decision:'PASS'}];
  assert.equal(d30.summarizeRouteQualification({routeKey:c4.routeKey,routeRole:'PRIMARY',familyId:'TPF-02',capabilityId:c4.capabilityId,requiredCaseIds:[c4.caseId],records:[c4],humanReviews:human,minimumRepeats:1}).decision,'QUALIFIED');
});

test('C4 required human-review case coverage cannot be satisfied by one unrelated reviewed artifact', () => {
  const family = d30.getFamilyDefinition('TPF-02');
  const capabilityId = 'teaching.course.curriculum_structure_analysis';
  const first = baseRun({familyId:'TPF-02',capabilityId,caseId:'D30-C4-REP',criticality:'C4',promptFamilyVersion:family.version,promptSha256:family.promptSha256});
  const second = baseRun({familyId:'TPF-02',capabilityId,caseId:'D30-C4-EDGE',runId:'00000000-0000-4000-8000-000000000099',criticality:'C4',promptFamilyVersion:family.version,promptSha256:family.promptSha256});
  const oneReview = [{caseId:first.caseId,familyId:'TPF-02',capabilityId,routeKey:first.routeKey,independent:true,reviewerKind:'HUMAN_ACADEMIC',decision:'PASS'}];
  const blocked = d30.summarizeRouteQualification({routeKey:first.routeKey,routeRole:'PRIMARY',familyId:'TPF-02',capabilityId,requiredCaseIds:[first.caseId,second.caseId],requiredHumanReviewCaseIds:[first.caseId,second.caseId],records:[first,second],humanReviews:oneReview,minimumRepeats:1});
  assert.equal(blocked.decision,'BLOCKED');
  assert.deepEqual(blocked.humanReview.missingCaseIds,[second.caseId]);
  const bothReviews = [...oneReview,{caseId:second.caseId,familyId:'TPF-02',capabilityId,routeKey:first.routeKey,independent:true,reviewerKind:'HUMAN_ACADEMIC',decision:'PASS'}];
  const qualified = d30.summarizeRouteQualification({routeKey:first.routeKey,routeRole:'PRIMARY',familyId:'TPF-02',capabilityId,requiredCaseIds:[first.caseId,second.caseId],requiredHumanReviewCaseIds:[first.caseId,second.caseId],records:[first,second],humanReviews:bothReviews,minimumRepeats:1});
  assert.equal(qualified.decision,'QUALIFIED');
});

test('fallback route cannot inherit evidence from a primary or another capability', () => {
  const primary = {routeKey:'p',routeRole:'PRIMARY',familyId:'TPF-01',capabilityId:'cap-a',evidenceCount:2,independentEvidence:true};
  assert.throws(() => d30.assertFallbackIndependent(primary,{routeKey:'f',routeRole:'FALLBACK',familyId:'TPF-01',capabilityId:'cap-a',evidenceCount:0,independentEvidence:false}),/inherit/);
  assert.throws(() => d30.assertFallbackIndependent(primary,{routeKey:'f',routeRole:'FALLBACK',familyId:'TPF-01',capabilityId:'cap-b',evidenceCount:2,independentEvidence:true}),/another capability/);
  assert.equal(d30.assertFallbackIndependent(primary,{routeKey:'f',routeRole:'FALLBACK',familyId:'TPF-01',capabilityId:'cap-a',evidenceCount:2,independentEvidence:true}),true);
});

test('stability gate requires repeated critical cases and rejects decision drift', () => {
  const records = [1,2,3].map((attemptNo) => d30.normalizeRunRecord(baseRun({attemptNo,runId:`00000000-0000-4000-8000-${String(attemptNo).padStart(12,'0')}`})));
  assert.equal(d30.evaluateStability(records,{repeatedCaseIds:['D30-TPF-01-001'],minimumRepeats:3}).pass,true);
  const drift = [...records.slice(0,2),d30.normalizeRunRecord(baseRun({attemptNo:3,runId:'00000000-0000-4000-8000-000000000003',validation:{pass:false}}))];
  assert.equal(d30.evaluateStability(drift,{repeatedCaseIds:['D30-TPF-01-001'],minimumRepeats:3}).pass,false);
});

test('cross-family qualification requires all workflow cases, deterministic compatibility evidence and C4 case review coverage', () => {
  const base = {
    sessionId:'00000000-0000-4000-8000-000000000001',
    runId:'00000000-0000-4000-8000-000000000201',
    caseId:'D30-XF-001',familyId:'CROSS_FAMILY',capabilityId:null,routeKey:'CROSS_FAMILY_WORKFLOW',routeRole:'STAGE',
    modelId:'workflow-composite',provider:'central-kiwi',promptFamilyVersion:'v1',promptSha256:'0'.repeat(64),runKind:'CROSS_FAMILY',criticality:'C4',
    attemptNo:1,validation:{pass:true},semanticReview:{pass:true},defects:[],outputArtifact:{handoffCompatible:true},
  };
  const record = d30.normalizeRunRecord(base);
  const blocked = d30.summarizeCrossFamilyQualification({requiredCaseIds:[record.caseId],records:[record],requiredHumanReviewCaseIds:[record.caseId],minimumRepeats:1});
  assert.equal(blocked.decision,'BLOCKED');
  const human = [{caseId:record.caseId,familyId:'CROSS_FAMILY',routeKey:'CROSS_FAMILY_WORKFLOW',independent:true,reviewerKind:'HUMAN_ACADEMIC',decision:'PASS'}];
  const qualified = d30.summarizeCrossFamilyQualification({requiredCaseIds:[record.caseId],records:[record],humanReviews:human,requiredHumanReviewCaseIds:[record.caseId],minimumRepeats:1});
  assert.equal(qualified.decision,'QUALIFIED');
});

test('PPL empirical comparison is matched and gate-based rather than a fake scalar score', () => {
  const ids=['s1','s2'];
  const one=[qualityRecord('s1',{gates:{coverage:true,coherence:false,validators:true,anchoringResistance:true,stability:true},defects:[{severity:'P1'}],cost:1,latency:100}),qualityRecord('s2',{gates:true,cost:1,latency:100})];
  const progressive=[qualityRecord('s1',{gates:true,cost:1.1,latency:110}),qualityRecord('s2',{gates:true,cost:1.1,latency:110})];
  const improved=d30.comparePplStrategies({matchedScenarioIds:ids,oneShotRecords:one,progressiveRecords:progressive});
  assert.equal(improved.materialQualityValue,true);
  assert.equal(improved.decision,'PROGRESSIVE_QUALIFIED');
  const efficient=d30.comparePplStrategies({matchedScenarioIds:ids,oneShotRecords:ids.map((id)=>qualityRecord(id,{gates:true,cost:2,latency:200})),progressiveRecords:ids.map((id)=>qualityRecord(id,{gates:true,cost:1,latency:100}))});
  assert.equal(efficient.meaningfulEfficiency,true);
  assert.equal(efficient.decision,'PROGRESSIVE_QUALIFIED');
  const noValue=d30.comparePplStrategies({matchedScenarioIds:ids,oneShotRecords:ids.map((id)=>qualityRecord(id,{gates:true,cost:1,latency:100})),progressiveRecords:ids.map((id)=>qualityRecord(id,{gates:true,cost:1.2,latency:120}))});
  assert.equal(noValue.decision,'REDUCE_PREPARATION_PROFILE');
  assert.equal(d30.comparePplStrategies({matchedScenarioIds:ids,oneShotRecords:one,progressiveRecords:[progressive[0]]}).decision,'INSUFFICIENT_EVIDENCE');
});

test('production qualification report requires route, PPL and cross-family evidence and never pulls D31 authorization forward', () => {
  const routes=[{decision:'QUALIFIED',familyId:'TPF-01',capabilityId:'cap',routeKey:'p',routeRole:'PRIMARY'}];
  const ppl={decision:'PROGRESSIVE_QUALIFIED'};
  const missingCrossFamily=d30.buildProductionQualificationReport(routes,ppl);
  assert.equal(missingCrossFamily.productionQualified,false);
  assert.equal(missingCrossFamily.crossFamilyQualified,false);
  const report=d30.buildProductionQualificationReport(routes,ppl,{crossFamilySummary:{decision:'QUALIFIED',familyId:'CROSS_FAMILY',routeKey:'CROSS_FAMILY_WORKFLOW',routeRole:'STAGE'}});
  assert.equal(report.productionQualified,true);
  assert.equal(report.productionAuthorized,false);
  assert.equal(report.authorizationGate,'D31');
});

test('prompt governance requires behavior brief, preserves frozen identity and stops on architecture conflicts', () => {
  const family=d30.getFamilyDefinition('TPF-01');
  const audit=d30.staticPromptAudit({familyId:'TPF-01',manifestVersion:d30.PROMPT_MANIFEST_VERSION,manifestSha256:d30.PROMPT_MANIFEST_SHA256,familyVersion:family.version,promptSha256:family.promptSha256,constitutionVersion:d30.CONSTITUTION_VERSION,capabilityIds:['cap'],outputSchemaVersion:'1',evaluationSuiteVersion:d30.EVALUATION_SUITE_VERSION});
  assert.equal(audit.pass,true);
  assert.throws(()=>d30.assertAuthoringTransition('BEHAVIOR_BRIEF_APPROVED','FROZEN_VERSION',{behaviorBrief:{},evaluationPassed:true}),/Behavior Brief/);
  assert.throws(()=>d30.assertNoStopCondition(['constitution_conflict']),/return to design/i);
  assert.equal(d30.classifyFailureRootCause('authority_contract'),'authority_contract');
});

test('prompt maintenance dependency order is semantic, not numeric', () => {
  const order=['TPF-01','TPF-02','TPF-04','TPF-03','TPF-05','TPF-06','TPF-07','TPF-18','TPF-08','TPF-09','TPF-10','TPF-11','TPF-12','TPF-13','TPF-14','TPF-15','TPF-16','TPF-17','TPF-19','TPF-20'];
  assert.equal(d30.assertDependencyOrder(order),true);
  assert.throws(()=>d30.assertDependencyOrder([...order].sort()),/must precede/);
  const context=d30.buildPromptMaintenanceContext('TPF-20');
  assert.equal(context.currentPromptBodyHashVerified,true);
  assert.equal(context.promptTextReturned,false);
});

test('safe review evidence rejects hidden/private reasoning fields', () => {
  assert.deepEqual(d30.sanitizeOutputArtifact({answer:'x',findings:['a']}),{answer:'x',findings:['a']});
  assert.throws(()=>d30.sanitizeOutputArtifact({chain_of_thought:'secret'}),/prohibited private-reasoning field|hidden chain-of-thought/i);
  assert.throws(()=>d30.normalizeRunRecord(baseRun({outputArtifact:{private_scratchpad:'secret'}})),/private-reasoning|hidden chain-of-thought/i);
});

test('TPF-16 blind-first controls are enforced by the already-owned D20 runtime', () => {
  assert.throws(()=>sanitizeAcademicInput({marking_context:{},original_marking:{criterion_judgments:[]}},'independent_pass_a'),/Blind independent Pass A/);
  assert.equal(validatePassAControls({artifact_controls:{original_credit_seen:false,overall_result_seen:false,raw_appeal_text_seen:false,review_direction_policy_seen:false,downstream_consequence_seen:false,freeze_before_comparison_required:true},criterion_independent_judgments:[]}),null);
  assert.equal(validatePassBControls({blind_first:{attempted:true,achieved:true,pass_a_frozen_before_comparison:true,independent_pass_a_ref:'pass-a'},review_outcome:{official_mark_not_committed:true,deterministic_reaggregation_required_if_changed:true,gradebook_commit_external:true,audit_history_preserve_original:true}}),null);
});

test('qualification invocation uses the frozen prompt runtime and TPF-20 PPL metadata', () => {
  const control=createTeachingPromptControlPlane();
  const sample=d30.TPF20_CORPUS.find((item)=>item.stage==='PRECLASS');
  const invocation=d30.buildQualificationInvocation(control,sample);
  assert.equal(invocation.prompt.family_id,'TPF-20');
  assert.equal(invocation.prompt.family_version,'1.0');
  assert.equal(invocation.prompt.frozen_binding.promptSourceSha256,d30.getFamilyDefinition('TPF-20').promptSha256);
  assert.equal(invocation.preparation.route_posture,'bounded_interpretive');
  assert.equal(invocation.preparation.stage,'Active');
});

test('fallback failure simulation preserves affinity and applies bounded recovery policy', () => {
  const rows=d30.simulateOrchestratorFailures([
    {routeKey:'p',condition:'QUOTA_EXHAUSTED'},
    {routeKey:'f',condition:'AUTH'},
    {routeKey:'x',condition:'MODEL_TRANSIENT',generationAffinityPreserved:true},
  ]);
  assert.equal(rows[0].rotateCredential,true);
  assert.equal(rows[0].circuitBreak,true);
  assert.equal(rows[1].retryAllowed,false);
  assert.equal(rows[2].generationAffinityPreserved,true);
});

test('D30 migration is service-only evidence state and hard-blocks production authorization before D31', () => {
  const sql=read('migrations/20261004_teaching_d30_canonical_qualification.sql');
  for (const name of ['d30_qualification_sessions','d30_case_results','d30_human_reviews','d30_defects','d30_route_decisions','d30_prompt_governance','d30_ppl_comparisons']) assert.match(sql,new RegExp(name));
  assert.match(sql,/capability_id text not null default ''/i);
  assert.match(sql,/output_artifact jsonb/i);
  assert.match(sql,/production_authorized boolean not null default false check \(production_authorized = false\)/i);
  assert.match(sql,/authorization_gate text not null default 'D31' check \(authorization_gate = 'D31'\)/i);
  assert.match(sql,/enable row level security/gi);
  assert.match(sql,/revoke all[\s\S]*from anon, authenticated/i);
  assert.doesNotMatch(sql,/\bgradebook\b[\s\S]*insert into|\bassessment_results\b[\s\S]*insert into/i);
});
