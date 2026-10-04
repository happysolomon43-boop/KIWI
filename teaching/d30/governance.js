'use strict';

const {
  AUTHORING_STATES,
  AUTHORING_WAVES,
  FAILURE_ROOT_CAUSES,
  PROMPT_STOP_CONDITIONS,
  FAMILY_DEFINITIONS,
  PROMPT_MANIFEST_VERSION,
  PROMPT_MANIFEST_SHA256,
  CONSTITUTION_VERSION,
  assertNoHiddenChainOfThought,
} = require('./contracts');

const STATE_ORDER = Object.freeze(new Map(AUTHORING_STATES.map((state, index) => [state, index])));
const HIGH_STAKES_FAMILIES = Object.freeze(new Set(['TPF-02','TPF-04','TPF-06','TPF-09','TPF-11','TPF-12','TPF-13','TPF-14','TPF-15','TPF-16']));

function validateBehaviorBrief(brief = {}) {
  const required = ['familyId','purpose','legitimateContext','forbiddenContext','failureBehavior','outputSemantics','approval'];
  const missing = required.filter((field) => brief[field] == null || (typeof brief[field] === 'string' && !brief[field].trim()));
  if (missing.length) return Object.freeze({ valid:false, errors:Object.freeze(missing.map((field) => `BEHAVIOR_BRIEF_${field.toUpperCase()}_MISSING`)) });
  if (brief.approval !== 'APPROVED') return Object.freeze({ valid:false, errors:Object.freeze(['BEHAVIOR_BRIEF_NOT_APPROVED']) });
  assertNoHiddenChainOfThought(brief);
  return Object.freeze({ valid:true, errors:Object.freeze([]) });
}

function staticPromptAudit(record = {}) {
  const findings = [];
  const family = FAMILY_DEFINITIONS.find((entry) => entry.familyId === record.familyId);
  if (!family) findings.push('UNKNOWN_FAMILY');
  if (record.manifestVersion !== PROMPT_MANIFEST_VERSION || record.manifestSha256 !== PROMPT_MANIFEST_SHA256) findings.push('MANIFEST_IDENTITY_MISMATCH');
  if (family && (record.familyVersion !== family.version || record.promptSha256 !== family.promptSha256)) findings.push('FROZEN_PROMPT_IDENTITY_MISMATCH');
  if (record.constitutionVersion !== CONSTITUTION_VERSION) findings.push('CONSTITUTION_VERSION_MISMATCH');
  if (!Array.isArray(record.capabilityIds) || !record.capabilityIds.length) findings.push('CAPABILITY_MAPPING_MISSING');
  if (!String(record.outputSchemaVersion || '').trim()) findings.push('OUTPUT_SCHEMA_VERSION_MISSING');
  if (!String(record.evaluationSuiteVersion || '').trim()) findings.push('EVALUATION_SUITE_VERSION_MISSING');
  if (record.providerModelAssignmentInsidePrompt === true) findings.push('PROVIDER_MODEL_ASSIGNMENT_INSIDE_PROMPT');
  if (record.thresholdInsidePrompt === true) findings.push('MEASUREMENT_THRESHOLD_INSIDE_PROMPT');
  if (record.sharedRuleDuplication === true) findings.push('SHARED_RULE_DUPLICATION');
  if (record.hiddenReasoningDemand === true) findings.push('HIDDEN_REASONING_DEMAND');
  if (record.silentFrozenPromptMutation === true) findings.push('SILENT_FROZEN_PROMPT_MUTATION');
  if (Array.isArray(record.openDefects) && record.openDefects.some((item) => ['P0','P1'].includes(item.severity) && item.resolved !== true)) findings.push('CRITICAL_DEFECT_OPEN');
  assertNoHiddenChainOfThought({ findings, record: { ...record, promptText: undefined } });
  return Object.freeze({ pass: findings.length === 0, findings:Object.freeze(findings) });
}

function assertAuthoringTransition(current, next, evidence = {}) {
  if (!STATE_ORDER.has(current) || !STATE_ORDER.has(next)) throw new Error('Invalid prompt authoring lifecycle state.');
  if (next !== 'DEPRECATED' && STATE_ORDER.get(next) < STATE_ORDER.get(current)) throw new Error('Prompt authoring lifecycle cannot silently move backward.');
  const brief = validateBehaviorBrief(evidence.behaviorBrief || {});
  if (STATE_ORDER.get(next) >= STATE_ORDER.get('PROMPT_CANDIDATE_DRAFT') && !brief.valid) throw new Error('Approved Behavior Brief is required before prompt candidate authoring.');
  if (['CANDIDATE_APPROVED','FROZEN_VERSION'].includes(next)) {
    if (evidence.evaluationPassed !== true) throw new Error('Candidate/frozen approval requires passed evaluation evidence.');
    if ((evidence.openDefects || []).some((item) => ['P0','P1'].includes(item.severity) && item.resolved !== true)) throw new Error('Candidate/frozen approval is blocked by unresolved P0/P1 defects.');
  }
  return next;
}

function assertNoStopCondition(conditions = []) {
  const normalized = conditions.map(String);
  const hit = normalized.find((condition) => PROMPT_STOP_CONDITIONS.includes(condition));
  if (hit) {
    const error = new Error(`Prompt authoring must return to design: ${hit}`);
    error.code = 'TEACHING_D30_PROMPT_STOP_CONDITION';
    error.stopCondition = hit;
    throw error;
  }
  return true;
}

function classifyFailureRootCause(rootCause) {
  const normalized = String(rootCause || '').trim();
  if (!FAILURE_ROOT_CAUSES.includes(normalized)) throw new Error('Prompt failure must be classified before revision.');
  return normalized;
}

function assertAuthoringWaveOrder(waves = AUTHORING_WAVES) {
  if (!Array.isArray(waves) || waves.length !== AUTHORING_WAVES.length || waves.some((value, index) => value !== AUTHORING_WAVES[index])) {
    throw new Error('Prompt authoring wave order must remain Course Foundation → Learning Engine → Assessment Integrity → Outcomes/Translation.');
  }
  return true;
}

function approvalGate({ familyId, behaviorBrief, evaluationPassed = false, independentReview = null, openDefects = [], fullCorpusEvidence = false } = {}) {
  const family = FAMILY_DEFINITIONS.find((entry) => entry.familyId === familyId);
  if (!family) throw new Error(`Unknown family: ${familyId}`);
  const errors = [];
  const brief = validateBehaviorBrief(behaviorBrief || {});
  if (!brief.valid) errors.push(...brief.errors);
  if (!evaluationPassed) errors.push('EVALUATION_NOT_PASSED');
  if (openDefects.some((item) => ['P0','P1'].includes(item.severity) && item.resolved !== true)) errors.push('CRITICAL_DEFECT_OPEN');
  if (family.criticality === 'C4') {
    if (!fullCorpusEvidence) errors.push('C4_FULL_CORPUS_EVIDENCE_REQUIRED');
    if (!(independentReview?.reviewerKind === 'HUMAN_ACADEMIC' && independentReview?.independent === true && independentReview?.decision === 'PASS')) errors.push('C4_INDEPENDENT_HUMAN_REVIEW_REQUIRED');
  }
  if (HIGH_STAKES_FAMILIES.has(familyId) && independentReview?.combinedWithGeneration === true) errors.push('INDEPENDENCE_COLLAPSED');
  return Object.freeze({ approved:errors.length === 0, criticality:family.criticality, errors:Object.freeze(errors) });
}

function buildFrozenPromptTrace({ familyId, capabilityIds = [], outputSchemaVersion, evaluationSuiteVersion, governanceRecordId, modelProvenance = [] } = {}) {
  const family = FAMILY_DEFINITIONS.find((entry) => entry.familyId === familyId);
  if (!family) throw new Error(`Unknown family: ${familyId}`);
  if (!capabilityIds.length || !outputSchemaVersion || !evaluationSuiteVersion || !governanceRecordId) throw new Error('Frozen prompt traceability is incomplete.');
  return Object.freeze({
    familyId,
    familyVersion:family.version,
    promptSha256:family.promptSha256,
    manifestVersion:PROMPT_MANIFEST_VERSION,
    manifestSha256:PROMPT_MANIFEST_SHA256,
    constitutionVersion:CONSTITUTION_VERSION,
    capabilityIds:Object.freeze([...capabilityIds]),
    outputSchemaVersion:String(outputSchemaVersion),
    evaluationSuiteVersion:String(evaluationSuiteVersion),
    governanceRecordId:String(governanceRecordId),
    modelProvenance:Object.freeze(modelProvenance.map((item) => Object.freeze({ ...item }))),
    frozen:true,
  });
}

module.exports = {
  HIGH_STAKES_FAMILIES,
  validateBehaviorBrief,
  staticPromptAudit,
  assertAuthoringTransition,
  assertNoStopCondition,
  classifyFailureRootCause,
  assertAuthoringWaveOrder,
  approvalGate,
  buildFrozenPromptTrace,
};