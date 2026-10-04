'use strict';

const D30_TASK_IDS = Object.freeze([
  ...Array.from({ length: 14 }, (_, i) => `TCH-${String(819 + i).padStart(4, '0')}`),
  ...Array.from({ length: 22 }, (_, i) => `TCH-${String(834 + i).padStart(4, '0')}`),
  'TCH-0857', ...Array.from({ length: 7 }, (_, i) => `TCH-${String(860 + i).padStart(4, '0')}`),
  'TCH-0902', 'TCH-0920',
]);

const DEFECT_SEVERITY = Object.freeze(['P0', 'P1', 'P2', 'P3']);
const RUN_KIND = Object.freeze(['isolated_family', 'cross_family', 'tpf20_preclass', 'tpf20_reconciliation', 'tpf20_end_to_end', 'stability', 'fallback_simulation', 'ppl_comparison']);
const DECISION = Object.freeze({ QUALIFIED: 'QUALIFIED', BLOCKED: 'BLOCKED', INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE' });
const AUTHORING_STATES = Object.freeze(['NOT_STARTED','BEHAVIOR_BRIEF_DRAFT','BEHAVIOR_BRIEF_APPROVED','PROMPT_CANDIDATE_DRAFT','EVALUATION_IN_PROGRESS','REVISION_REQUIRED','CANDIDATE_APPROVED','FROZEN_VERSION','DEPRECATED']);
const FAILURE_ROOT_CAUSES = Object.freeze(['wording','context','task_mode_separation','schema','authority_contract','model_limitation','product_ambiguity','flawed_evaluation_expectation']);

function assertNoHiddenChainOfThought(value) {
  const text = JSON.stringify(value || {}).toLowerCase();
  if (/(chain[-_ ]?of[-_ ]?thought|hidden reasoning|private reasoning|scratchpad)/.test(text)) {
    const error = new Error('D30 provenance must not store hidden chain-of-thought.');
    error.code = 'TEACHING_D30_COT_FORBIDDEN';
    throw error;
  }
  return true;
}

function normalizeRunRecord(input = {}) {
  const record = {
    runId: String(input.runId || ''), caseId: String(input.caseId || ''), familyId: String(input.familyId || ''),
    capabilityId: input.capabilityId ? String(input.capabilityId) : null, routeId: String(input.routeId || ''), routeRole: String(input.routeRole || 'primary'),
    modelId: String(input.modelId || ''), modelSettingsHash: String(input.modelSettingsHash || ''), constitutionVersion: String(input.constitutionVersion || ''),
    promptVersion: String(input.promptVersion || ''), schemaVersion: String(input.schemaVersion || ''), suiteVersion: String(input.suiteVersion || 'phase16-v1.4'),
    runKind: String(input.runKind || 'isolated_family'), validation: input.validation || {}, reviewerDecision: input.reviewerDecision || null,
    latencyMs: Number(input.latencyMs || 0), inputTokens: Number(input.inputTokens || 0), outputTokens: Number(input.outputTokens || 0),
    estimatedCostUsd: Number(input.estimatedCostUsd || 0), retryCount: Number(input.retryCount || 0), timeout: Boolean(input.timeout), fallbackUsed: Boolean(input.fallbackUsed),
    defects: Array.isArray(input.defects) ? input.defects : [], createdAt: input.createdAt || new Date().toISOString(),
  };
  if (!record.runId || !record.caseId || !record.familyId || !record.routeId || !record.modelId || !record.promptVersion) throw new Error('Incomplete D30 run provenance.');
  if (!RUN_KIND.includes(record.runKind)) throw new Error(`Unsupported D30 run kind: ${record.runKind}`);
  assertNoHiddenChainOfThought(record);
  return Object.freeze(record);
}

module.exports = { D30_TASK_IDS, DEFECT_SEVERITY, RUN_KIND, DECISION, AUTHORING_STATES, FAILURE_ROOT_CAUSES, assertNoHiddenChainOfThought, normalizeRunRecord };
