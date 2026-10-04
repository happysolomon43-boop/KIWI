'use strict';

const D29_CONTRACT_VERSION = 'teaching.d29.academic-qa.v1';
const D29_EVIDENCE_SCHEMA_VERSION = 'teaching.d29.evidence.v1';
const D29_TASK_IDS = Object.freeze([
  'TCH-0069',
  ...Array.from({ length: 41 }, (_, index) => `TCH-${String(629 + index).padStart(4, '0')}`),
  'TCH-0679', 'TCH-0737', 'TCH-0765', 'TCH-0766', 'TCH-0787', 'TCH-0901', 'TCH-0917', 'TCH-0918',
]);

const RESULT_STATES = Object.freeze(['PASS', 'FAIL', 'EXPECTED_SKIP', 'BLOCKED']);
const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  'scenarioId', 'taskIds', 'invariantIds', 'fixtureVersion', 'actorScope', 'timeAssumptions',
  'trigger', 'expectedOwnerTransition', 'expectedPersistence', 'expectedSecurity',
  'expectedReplay', 'actualResult', 'result',
]);

const PRODUCTION_READINESS_THRESHOLDS = Object.freeze({
  liveClassLatencyP95Ms: 12000,
  autosaveReliabilityMinimum: 0.999,
  assessmentPersistenceMinimum: 0.9999,
  unresolvedP0Maximum: 0,
  unresolvedP1Maximum: 0,
  schedulerFailureRateMaximum: 0.001,
  gradingDisagreementRequiresReview: true,
  minimumLatencySamplesForPercentileClaim: 20,
});

const SCENARIO_FAMILIES = Object.freeze({
  DATASET: 'DATASET', JOURNEY: 'JOURNEY', INVARIANT: 'INVARIANT', SECURITY: 'SECURITY',
  AUDIT: 'AUDIT', RELIABILITY: 'RELIABILITY', PPL: 'PPL', RECOVERY: 'RECOVERY', UX: 'UX',
});

const TASK_SCENARIOS = Object.freeze(Object.fromEntries(D29_TASK_IDS.map((taskId) => [taskId, Object.freeze({
  taskId,
  scenarioPrefix: `D29-${taskId.slice(4)}`,
  requiresAuthoritativeState: true,
  requiresAuditEvidence: true,
  uiOnlyPassForbidden: true,
})])));

module.exports = {
  D29_CONTRACT_VERSION, D29_EVIDENCE_SCHEMA_VERSION, D29_TASK_IDS, RESULT_STATES, SEVERITIES,
  REQUIRED_EVIDENCE_FIELDS, PRODUCTION_READINESS_THRESHOLDS, SCENARIO_FAMILIES, TASK_SCENARIOS,
};
