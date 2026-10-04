'use strict';

const crypto = require('node:crypto');
const {
  D30_CONTRACT_VERSION,
  EVALUATION_SUITE_VERSION,
  PROMPT_MANIFEST_VERSION,
  PROMPT_MANIFEST_SHA256,
  CONSTITUTION_VERSION,
  QUALIFICATION_DECISIONS,
  ROUTE_ROLES,
  RUN_KINDS,
  assertNoHiddenChainOfThought,
} = require('./contracts');
const { requireIndependentHumanReview, seriousDefects } = require('./validators');

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? {})).digest('hex');
}

function normalizeRunRecord(input = {}) {
  const required = ['sessionId','caseId','familyId','routeKey','routeRole','modelId','provider','promptFamilyVersion','promptSha256'];
  const missing = required.filter((key) => !String(input[key] ?? '').trim());
  if (missing.length) throw new Error(`Incomplete D30 run provenance: ${missing.join(', ')}`);
  const routeRole = String(input.routeRole).toUpperCase();
  if (!ROUTE_ROLES.includes(routeRole)) throw new Error(`Unsupported D30 route role: ${input.routeRole}`);
  const runKind = String(input.runKind || 'GOLDEN').toUpperCase();
  if (!RUN_KINDS.includes(runKind)) throw new Error(`Unsupported D30 run kind: ${runKind}`);
  if (!String(input.promptSha256).match(/^[0-9a-f]{64}$/)) throw new Error('D30 prompt SHA-256 is invalid.');
  const record = {
    runId: String(input.runId || crypto.randomUUID()),
    sessionId: String(input.sessionId),
    caseId: String(input.caseId),
    familyId: String(input.familyId),
    capabilityId: input.capabilityId == null ? null : String(input.capabilityId),
    routeKey: String(input.routeKey),
    routeRole,
    routePosture: input.routePosture == null ? null : String(input.routePosture),
    modelId: String(input.modelId),
    provider: String(input.provider),
    centralTaskId: input.centralTaskId == null ? null : String(input.centralTaskId),
    modelSettingsHash: String(input.modelSettingsHash || sha256Json(input.modelSettings || {})),
    constitutionVersion: String(input.constitutionVersion || CONSTITUTION_VERSION),
    promptManifestVersion: String(input.promptManifestVersion || PROMPT_MANIFEST_VERSION),
    promptManifestSha256: String(input.promptManifestSha256 || PROMPT_MANIFEST_SHA256),
    promptFamilyVersion: String(input.promptFamilyVersion),
    promptSha256: String(input.promptSha256),
    outputSchemaId: input.outputSchemaId == null ? null : String(input.outputSchemaId),
    outputSchemaVersion: input.outputSchemaVersion == null ? null : String(input.outputSchemaVersion),
    evaluationSuiteVersion: String(input.evaluationSuiteVersion || EVALUATION_SUITE_VERSION),
    contractVersion: String(input.contractVersion || D30_CONTRACT_VERSION),
    runKind,
    criticality: String(input.criticality || 'C3').toUpperCase(),
    attemptNo: Number(input.attemptNo || 1),
    validation: input.validation || {},
    semanticReview: input.semanticReview || null,
    latencyMs: Number(input.latencyMs || 0),
    inputTokens: Number(input.inputTokens || 0),
    outputTokens: Number(input.outputTokens || 0),
    estimatedCostUsd: Number(input.estimatedCostUsd || 0),
    retryCount: Number(input.retryCount || 0),
    timedOut: Boolean(input.timedOut),
    fallbackUsed: Boolean(input.fallbackUsed),
    defects: Array.isArray(input.defects) ? input.defects : [],
    executionMetadata: input.executionMetadata || {},
    createdAt: input.createdAt || new Date().toISOString(),
  };
  assertNoHiddenChainOfThought(record);
  return Object.freeze(record);
}

function stableGroupKey(record) {
  return `${record.caseId}::${record.routeKey}::${record.capabilityId || '-'}`;
}

function evaluateStability(records = [], { repeatedCaseIds = [], minimumRepeats = 3 } = {}) {
  const groups = new Map();
  for (const record of records) {
    const key = stableGroupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const failures = [];
  for (const caseId of repeatedCaseIds) {
    const matching = [...groups.entries()].filter(([key]) => key.startsWith(`${caseId}::`));
    if (!matching.length) failures.push({ caseId, code:'STABILITY_CASE_MISSING' });
    for (const [key, runs] of matching) {
      const decisions = new Set(runs.map((run) => Boolean(run.validation?.pass) && seriousDefects(run.defects).length === 0));
      if (runs.length < minimumRepeats) failures.push({ caseId, key, code:'STABILITY_REPEATS_INSUFFICIENT', observed:runs.length, required:minimumRepeats });
      if (decisions.size > 1) failures.push({ caseId, key, code:'STABILITY_DECISION_DRIFT' });
    }
  }
  return Object.freeze({ pass:failures.length === 0, minimumRepeats, failures:Object.freeze(failures) });
}

function summarizeRouteQualification({
  routeKey,
  routeRole,
  familyId,
  capabilityIds = [],
  requiredCaseIds = [],
  records = [],
  humanReviews = [],
  repeatedCaseIds = [],
  minimumRepeats = 3,
  consequential = false,
} = {}) {
  if (!routeKey || !familyId) throw new Error('Route qualification requires routeKey and familyId.');
  const role = String(routeRole || '').toUpperCase();
  if (!ROUTE_ROLES.includes(role)) throw new Error(`Invalid route role: ${routeRole}`);
  const normalized = records.map(normalizeRunRecord).filter((record) => record.routeKey === routeKey && record.familyId === familyId);
  const coveredCases = new Set(normalized.map((record) => record.caseId));
  const coveredCapabilities = new Set(normalized.map((record) => record.capabilityId).filter(Boolean));
  const missingCases = requiredCaseIds.filter((id) => !coveredCases.has(id));
  const missingCapabilities = capabilityIds.filter((id) => !coveredCapabilities.has(id));
  const defects = normalized.flatMap((record) => record.defects || []);
  const blockingDefects = seriousDefects(defects);
  const semanticMissing = normalized.filter((record) => record.semanticReview?.pass !== true).map((record) => record.runId);
  const validationFailures = normalized.filter((record) => record.validation?.pass !== true).map((record) => record.runId);
  const criticality = normalized.find((record) => record.criticality)?.criticality || 'C3';
  const human = requireIndependentHumanReview({ criticality, consequential, humanReviews });
  const stability = evaluateStability(normalized, { repeatedCaseIds, minimumRepeats });
  const independentEvidence = role !== 'FALLBACK' || normalized.every((record) => record.routeRole === 'FALLBACK' && record.fallbackUsed !== true);
  const evidenceComplete = normalized.length > 0 && !missingCases.length && !missingCapabilities.length;
  const qualified = evidenceComplete && !blockingDefects.length && !semanticMissing.length && !validationFailures.length && human.satisfied && stability.pass && independentEvidence;
  const decision = qualified ? 'QUALIFIED' : normalized.length === 0 ? 'INSUFFICIENT_EVIDENCE' : 'BLOCKED';
  return Object.freeze({
    routeKey,
    routeRole:role,
    familyId,
    decision,
    specificationComplete:true,
    productionQualified:qualified,
    productionAuthorized:false,
    authorizationGate:'D31',
    evidenceCount:normalized.length,
    missingCaseIds:Object.freeze(missingCases),
    missingCapabilityIds:Object.freeze(missingCapabilities),
    blockingDefects:Object.freeze(blockingDefects),
    semanticReviewMissingRunIds:Object.freeze(semanticMissing),
    validationFailureRunIds:Object.freeze(validationFailures),
    humanReview:human,
    stability,
    independentEvidence,
  });
}

function assertFallbackIndependent(primarySummary, fallbackSummary) {
  if (!fallbackSummary || fallbackSummary.routeRole !== 'FALLBACK') throw new Error('Fallback qualification must have its own FALLBACK summary.');
  if (!fallbackSummary.independentEvidence || fallbackSummary.evidenceCount <= 0) {
    const error = new Error('Fallback route cannot inherit primary qualification evidence.');
    error.code = 'TEACHING_D30_FALLBACK_INDEPENDENT_EVIDENCE_REQUIRED';
    throw error;
  }
  if (primarySummary?.routeKey === fallbackSummary.routeKey) throw new Error('Primary and fallback qualification cannot be the same route identity.');
  return true;
}

function sum(records, key) { return records.reduce((total, item) => total + Number(item[key] || 0), 0); }
function average(records, key) { return records.length ? sum(records, key) / records.length : null; }

function summarizePplArm(records = []) {
  const serious = records.flatMap((record) => record.defects || []).filter((item) => ['P0','P1'].includes(item.severity));
  const gates = ['coverage','coherence','validators','anchoringResistance','stability'];
  const gatePasses = Object.fromEntries(gates.map((gate) => [gate, records.length > 0 && records.every((record) => record.qualityGates?.[gate] === true)]));
  return Object.freeze({
    sampleCount:records.length,
    seriousDefectCount:serious.length,
    gatePasses:Object.freeze(gatePasses),
    averageCostUsd:average(records,'estimatedCostUsd'),
    averageLatencyMs:average(records,'latencyMs'),
  });
}

function comparePplStrategies({ matchedScenarioIds = [], oneShotRecords = [], progressiveRecords = [] } = {}) {
  const oneShotIds = new Set(oneShotRecords.map((record) => record.scenarioId));
  const progressiveIds = new Set(progressiveRecords.map((record) => record.scenarioId));
  const missingOneShot = matchedScenarioIds.filter((id) => !oneShotIds.has(id));
  const missingProgressive = matchedScenarioIds.filter((id) => !progressiveIds.has(id));
  const oneShot = summarizePplArm(oneShotRecords);
  const progressive = summarizePplArm(progressiveRecords);
  const qualityGateNames = Object.keys(oneShot.gatePasses);
  const qualityRegressions = qualityGateNames.filter((gate) => oneShot.gatePasses[gate] && !progressive.gatePasses[gate]);
  const qualityImprovements = qualityGateNames.filter((gate) => !oneShot.gatePasses[gate] && progressive.gatePasses[gate]);
  const seriousDefectImprovement = progressive.seriousDefectCount < oneShot.seriousDefectCount;
  const materialQualityValue = qualityRegressions.length === 0 && (seriousDefectImprovement || qualityImprovements.length > 0);
  const equivalentQuality = qualityRegressions.length === 0 && progressive.seriousDefectCount <= oneShot.seriousDefectCount && qualityGateNames.every((gate) => progressive.gatePasses[gate] === oneShot.gatePasses[gate]);
  const meaningfulEfficiency = equivalentQuality && progressive.averageCostUsd != null && oneShot.averageCostUsd != null && progressive.averageLatencyMs != null && oneShot.averageLatencyMs != null && progressive.averageCostUsd < oneShot.averageCostUsd && progressive.averageLatencyMs < oneShot.averageLatencyMs;
  const complete = matchedScenarioIds.length > 0 && !missingOneShot.length && !missingProgressive.length;
  const progressiveQualified = complete && (materialQualityValue || meaningfulEfficiency) && progressive.seriousDefectCount === 0;
  return Object.freeze({
    decision: !complete ? 'INSUFFICIENT_EVIDENCE' : progressiveQualified ? 'PROGRESSIVE_QUALIFIED' : 'REDUCE_PREPARATION_PROFILE',
    matchedScenarioCount:matchedScenarioIds.length,
    missingOneShot:Object.freeze(missingOneShot),
    missingProgressive:Object.freeze(missingProgressive),
    oneShot,
    progressive,
    qualityImprovements:Object.freeze(qualityImprovements),
    qualityRegressions:Object.freeze(qualityRegressions),
    seriousDefectImprovement,
    materialQualityValue,
    equivalentQuality,
    meaningfulEfficiency,
    activationAllowed:progressiveQualified,
  });
}

function buildProductionQualificationReport(routeSummaries = [], pplComparison = null) {
  const invalid = routeSummaries.filter((summary) => !QUALIFICATION_DECISIONS.includes(summary.decision));
  if (invalid.length) throw new Error('Qualification report contains invalid decision status.');
  const unresolved = routeSummaries.filter((summary) => summary.decision !== 'QUALIFIED');
  const pplQualified = pplComparison == null || pplComparison.decision === 'PROGRESSIVE_QUALIFIED';
  return Object.freeze({
    contractVersion:D30_CONTRACT_VERSION,
    evaluationSuiteVersion:EVALUATION_SUITE_VERSION,
    specificationComplete:true,
    productionQualified:routeSummaries.length > 0 && unresolved.length === 0 && pplQualified,
    productionAuthorized:false,
    authorizationGate:'D31',
    unresolvedRouteCount:unresolved.length,
    pplQualified,
    routes:Object.freeze(routeSummaries),
    pplComparison,
    generatedAt:new Date().toISOString(),
  });
}

module.exports = {
  sha256Json,
  normalizeRunRecord,
  evaluateStability,
  summarizeRouteQualification,
  assertFallbackIndependent,
  summarizePplArm,
  comparePplStrategies,
  buildProductionQualificationReport,
};