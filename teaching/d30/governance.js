'use strict';

const { AUTHORING_STATES, FAILURE_ROOT_CAUSES } = require('./contracts');
const AUTHORING_WAVES = Object.freeze(['Course Foundation','Learning Engine','Assessment Integrity','Outcomes/Translation']);
const STOP_CONDITIONS = Object.freeze(['authority_unclear','safe_context_unavailable','uncertainty_unrepresentable','deterministic_rule_missing','family_overlap','c4_policy_underspecified','prohibited_context_required','direct_mutation_required','constitution_conflict']);

function auditPromptArtifact({ familyId, behaviorBriefApproved, familyVersion, constitutionVersion, capabilityContractVersions = [], schemaVersion, evaluationSuiteVersion, providerModelText = false, hiddenCotDemand = false, unresolvedCriticalDefects = [] } = {}) {
  const findings=[];
  if (!familyId || !familyVersion || !constitutionVersion || !schemaVersion || !evaluationSuiteVersion) findings.push('traceability_incomplete');
  if (!behaviorBriefApproved) findings.push('behavior_brief_not_approved');
  if (!capabilityContractVersions.length) findings.push('capability_contract_missing');
  if (providerModelText) findings.push('provider_model_assignment_inside_prompt');
  if (hiddenCotDemand) findings.push('hidden_chain_of_thought_demand');
  if (unresolvedCriticalDefects.some(d=>['P0','P1'].includes(d.severity))) findings.push('critical_defect_open');
  return Object.freeze({ pass:findings.length===0, findings:Object.freeze(findings) });
}

function transitionAuthoringState(current, next, { behaviorBriefApproved=false, evaluationPassed=false, criticalDefectsOpen=false } = {}) {
  if (!AUTHORING_STATES.includes(current)||!AUTHORING_STATES.includes(next)) throw new Error('Invalid authoring lifecycle state');
  if (['PROMPT_CANDIDATE_DRAFT','EVALUATION_IN_PROGRESS','CANDIDATE_APPROVED','FROZEN_VERSION'].includes(next) && !behaviorBriefApproved) throw new Error('Behavior Brief approval required before prompt authoring.');
  if (['CANDIDATE_APPROVED','FROZEN_VERSION'].includes(next) && (!evaluationPassed || criticalDefectsOpen)) throw new Error('Candidate/frozen approval blocked until evaluation passes and critical defects close.');
  return next;
}

function assertNoStopCondition(conditions=[]) { const hit=conditions.find(x=>STOP_CONDITIONS.includes(x)); if(hit){const e=new Error(`Return to design: ${hit}`);e.code='TEACHING_D30_PROMPT_STOP_CONDITION';throw e;} return true; }
function classifyPromptFailure(rootCause) { if(!FAILURE_ROOT_CAUSES.includes(rootCause)) throw new Error('Prompt failure root cause must be classified before revision.'); return rootCause; }
function assertWaveOrder(waves) { return Array.isArray(waves) && AUTHORING_WAVES.every((w,i)=>waves[i]===w); }

module.exports={ AUTHORING_WAVES, STOP_CONDITIONS, auditPromptArtifact, transitionAuthoringState, assertNoStopCondition, classifyPromptFailure, assertWaveOrder };
