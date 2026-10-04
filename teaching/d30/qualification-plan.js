'use strict';

const { FULL_DISTINCT_CORPUS, CROSS_FAMILY_CORPUS, MODEL_ELIGIBLE_CAPABILITIES } = require('./corpus');
const { buildCandidateManifest } = require('./route-policy');

const REPEAT_REQUIRED_CLASSES = Object.freeze(new Set([
  'injection', 'authority_attack', 'uncertainty', 'counterfactual', 'source_conflict', 'regression',
  'protected_content', 'stale_input', 'latency_stability', 'stability',
]));

function selectRepeatedCaseIds(cases = []) {
  const selected = cases.filter((item) => REPEAT_REQUIRED_CLASSES.has(item.caseClass)).map((item) => item.id);
  if (selected.length) return Object.freeze(selected);
  return Object.freeze(cases.slice(0, Math.min(3, cases.length)).map((item) => item.id));
}

function buildCapabilityCaseGroups() {
  const groups = [];
  for (const capability of MODEL_ELIGIBLE_CAPABILITIES) {
    const cases = FULL_DISTINCT_CORPUS.filter((item) => item.capabilityId === capability.id);
    if (!cases.length) throw new Error(`D30 corpus has no cases for model-eligible capability ${capability.id}.`);
    if (capability.prompt_family_id === 'TPF-20') {
      for (const stage of ['PRECLASS','RECONCILIATION','END_TO_END']) {
        const stageCases = cases.filter((item) => item.stage === stage);
        if (!stageCases.length) throw new Error(`TPF-20 ${stage} case group is empty.`);
        groups.push(Object.freeze({ capability, familyId:capability.prompt_family_id, stage, cases:Object.freeze(stageCases) }));
      }
    } else {
      groups.push(Object.freeze({ capability, familyId:capability.prompt_family_id, stage:null, cases:Object.freeze(cases) }));
    }
  }
  return Object.freeze(groups);
}

function buildQualificationPlan({ orchestrator } = {}) {
  if (!orchestrator?.plan) throw new TypeError('D30 qualification plan requires central KIWI AI Orchestrator plan().');
  const groups = buildCapabilityCaseGroups();
  const targets = [];
  for (const group of groups) {
    const manifest = buildCandidateManifest(orchestrator, {
      capabilityId:group.capability.id,
      familyId:group.familyId,
      stage:group.stage,
    });
    if (!manifest.candidates.length) throw new Error(`No candidate route exists for ${group.capability.id}.`);
    for (const candidate of manifest.candidates) {
      targets.push(Object.freeze({
        targetKey:[group.capability.id,group.stage || 'DEFAULT',candidate.role,candidate.routeKey].join('::'),
        capabilityId:group.capability.id,
        familyId:group.familyId,
        criticality:group.cases[0].criticality,
        stage:group.stage,
        routePosture:manifest.routePosture,
        centralTaskId:manifest.centralTaskId,
        routeKey:candidate.routeKey,
        routeRole:candidate.role,
        provider:candidate.provider,
        modelId:candidate.modelId,
        reasoning:candidate.reasoning,
        taskClass:candidate.taskClass,
        requiredCaseIds:Object.freeze(group.cases.map((item) => item.id)),
        repeatedCaseIds:selectRepeatedCaseIds(group.cases),
        independentQualificationRequired:true,
        productionAuthorized:false,
        authorizationGate:'D31',
      }));
    }
  }
  const uniqueTargets = new Set(targets.map((target) => target.targetKey));
  if (uniqueTargets.size !== targets.length) throw new Error('D30 qualification target identity collision.');
  const capabilityCoverage = new Set(targets.map((target) => target.capabilityId));
  if (capabilityCoverage.size !== MODEL_ELIGIBLE_CAPABILITIES.length) throw new Error('D30 qualification plan does not cover every model-eligible capability.');
  const fallbackTargets = targets.filter((target) => target.routeRole === 'FALLBACK');
  return Object.freeze({
    generatedAt:new Date().toISOString(),
    capabilityCount:MODEL_ELIGIBLE_CAPABILITIES.length,
    targetCount:targets.length,
    primaryTargetCount:targets.filter((target) => target.routeRole === 'PRIMARY').length,
    fallbackTargetCount:fallbackTargets.length,
    stageTargetCount:targets.filter((target) => target.stage).length,
    targets:Object.freeze(targets),
    crossFamilyWorkflowCases:CROSS_FAMILY_CORPUS,
    everyFallbackIndependent:fallbackTargets.every((target) => target.independentQualificationRequired === true),
  });
}

module.exports = {
  REPEAT_REQUIRED_CLASSES,
  selectRepeatedCaseIds,
  buildCapabilityCaseGroups,
  buildQualificationPlan,
};