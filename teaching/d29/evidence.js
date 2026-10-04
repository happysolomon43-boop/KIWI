'use strict';
const { D29_TASK_IDS, REQUIRED_EVIDENCE_FIELDS, RESULT_STATES, PRODUCTION_READINESS_THRESHOLDS } = require('./contracts');

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function validateEvidence(input = {}) {
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    const value = input[field];
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) fail('TEACHING_D29_EVIDENCE_INCOMPLETE', `Missing D29 evidence field: ${field}`);
  }
  if (!RESULT_STATES.includes(input.result)) fail('TEACHING_D29_RESULT_INVALID', 'Unknown D29 evidence result.');
  for (const taskId of input.taskIds) if (!D29_TASK_IDS.includes(taskId)) fail('TEACHING_D29_TASK_OUT_OF_SCOPE', `Task ${taskId} is outside D29.`);
  if (input.result === 'PASS') {
    if (!input.authoritativeStateVerified) fail('TEACHING_D29_UI_ONLY_PASS_FORBIDDEN', 'A D29 PASS requires authoritative state evidence.');
    if (!input.auditVerified) fail('TEACHING_D29_AUDIT_REQUIRED', 'A D29 PASS requires audit evidence.');
    if (input.securityApplicable !== false && !input.securityVerified) fail('TEACHING_D29_SECURITY_REQUIRED', 'Applicable D29 security evidence is required.');
  }
  if (['EXPECTED_SKIP', 'BLOCKED'].includes(input.result) && !input.reasonCode) fail('TEACHING_D29_REASON_REQUIRED', `${input.result} requires a reason code.`);
  return Object.freeze({ ...input, schemaVersion: 'teaching.d29.evidence.v1', recordedAt: input.recordedAt || new Date().toISOString() });
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.map(Number).sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}
function evaluateReadiness({ evidence = [], defects = [], metrics = {} } = {}) {
  const covered = new Set(evidence.filter((item) => item.result === 'PASS').flatMap((item) => item.taskIds || []));
  const missingTasks = D29_TASK_IDS.filter((id) => !covered.has(id));
  const unresolvedCritical = defects.filter((d) => !d.resolved && ['P0', 'P1'].includes(d.severity));
  const failures = evidence.filter((item) => ['FAIL', 'BLOCKED'].includes(item.result));
  const latencySamples = metrics.liveClassLatencyMs || [];
  const latencyClaimSufficient = latencySamples.length >= PRODUCTION_READINESS_THRESHOLDS.minimumLatencySamplesForPercentileClaim;
  const liveClassP95Ms = percentile(latencySamples, 95);
  const metricFailures = [];
  const requiredMetricKeys = ['liveClassLatencyMs', 'autosaveReliability', 'assessmentPersistence', 'schedulerFailureRate', 'gradingDisagreementsReviewed'];
  const missingMetrics = requiredMetricKeys.filter((key) => metrics[key] == null);
  if (!latencyClaimSufficient) metricFailures.push('LIVE_CLASS_LATENCY_SAMPLE_SIZE');
  if (latencyClaimSufficient && liveClassP95Ms > PRODUCTION_READINESS_THRESHOLDS.liveClassLatencyP95Ms) metricFailures.push('LIVE_CLASS_LATENCY_P95');
  if (metrics.autosaveReliability != null && metrics.autosaveReliability < PRODUCTION_READINESS_THRESHOLDS.autosaveReliabilityMinimum) metricFailures.push('AUTOSAVE_RELIABILITY');
  if (metrics.assessmentPersistence != null && metrics.assessmentPersistence < PRODUCTION_READINESS_THRESHOLDS.assessmentPersistenceMinimum) metricFailures.push('ASSESSMENT_PERSISTENCE');
  if (metrics.schedulerFailureRate != null && metrics.schedulerFailureRate > PRODUCTION_READINESS_THRESHOLDS.schedulerFailureRateMaximum) metricFailures.push('SCHEDULER_FAILURE_RATE');
  if (metrics.gradingDisagreementsReviewed !== true) metricFailures.push('GRADING_DISAGREEMENT_REVIEW');
  const accepted = missingTasks.length === 0 && unresolvedCritical.length === 0 && failures.length === 0 && missingMetrics.length === 0 && metricFailures.length === 0;
  return Object.freeze({ accepted, missingTasks, unresolvedCritical, failures, missingMetrics, metricFailures, latencyClaimSufficient, liveClassP95Ms, d30Qualified: false, d31ReleaseAuthorized: false });
}
module.exports = { validateEvidence, evaluateReadiness, percentile };
