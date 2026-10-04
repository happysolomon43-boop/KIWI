'use strict';

const { DECISION, DEFECT_SEVERITY, normalizeRunRecord } = require('./contracts');

function percentile(values, p) { if (!values.length) return null; const a=[...values].sort((x,y)=>x-y); return a[Math.min(a.length-1,Math.floor((a.length-1)*p))]; }
function hasBlockingDefect(records) { return records.some(r => (r.defects||[]).some(d => ['P0','P1'].includes(d.severity))); }

function summarizeRoute(records = [], { criticality = 'C3', requiredCaseIds = [], humanReviews = [], minStabilityRuns = 2 } = {}) {
  const normalized = records.map(normalizeRunRecord);
  const covered = new Set(normalized.map(r => r.caseId));
  const missing = requiredCaseIds.filter(id => !covered.has(id));
  const blocking = hasBlockingDefect(normalized);
  const c4HumanSatisfied = criticality !== 'C4' || humanReviews.some(r => r && r.independent === true && r.decision === 'PASS');
  const stableCases = new Map();
  for (const r of normalized) stableCases.set(r.caseId, (stableCases.get(r.caseId)||0)+1);
  const stabilitySatisfied = requiredCaseIds.every(id => (stableCases.get(id)||0) >= minStabilityRuns);
  const validatorsPass = normalized.every(r => r.validation && r.validation.schemaValid !== false && r.validation.invariantsValid !== false);
  const decision = missing.length || blocking || !c4HumanSatisfied || !stabilitySatisfied || !validatorsPass ? DECISION.BLOCKED : DECISION.QUALIFIED;
  return Object.freeze({ decision, evidenceCount:normalized.length, missingCaseIds:Object.freeze(missing), blockingDefect:blocking, c4HumanSatisfied, stabilitySatisfied, validatorsPass, p50LatencyMs:percentile(normalized.map(r=>r.latencyMs),.5), p95LatencyMs:percentile(normalized.map(r=>r.latencyMs),.95), totalEstimatedCostUsd:normalized.reduce((n,r)=>n+r.estimatedCostUsd,0), totalRetries:normalized.reduce((n,r)=>n+r.retryCount,0), timeoutCount:normalized.filter(r=>r.timeout).length });
}

function assertIndependentFallback(primarySummary, fallbackSummary) {
  if (!fallbackSummary || fallbackSummary.evidenceCount === 0) { const e=new Error('Fallback cannot inherit primary qualification.'); e.code='TEACHING_D30_FALLBACK_EVIDENCE_REQUIRED'; throw e; }
  return primarySummary !== fallbackSummary;
}

function comparePreparationProfiles(oneShot = {}, progressive = {}) {
  const qualityDelta = Number(progressive.qualityScore||0)-Number(oneShot.qualityScore||0);
  const defectDelta = Number(oneShot.seriousDefectRate||0)-Number(progressive.seriousDefectRate||0);
  const costRatio = Number(oneShot.costUsd||0) > 0 ? Number(progressive.costUsd||0)/Number(oneShot.costUsd) : null;
  const latencyRatio = Number(oneShot.latencyMs||0) > 0 ? Number(progressive.latencyMs||0)/Number(oneShot.latencyMs) : null;
  const materialQualityGain = qualityDelta >= 0.03 || defectDelta >= 0.01;
  const equivalentEfficient = qualityDelta >= -0.01 && defectDelta >= -0.005 && ((costRatio !== null && costRatio <= 0.8) || (latencyRatio !== null && latencyRatio <= 0.8));
  return Object.freeze({ qualityDelta, defectDelta, costRatio, latencyRatio, progressiveJustified: materialQualityGain || equivalentEfficient, recommendation:(materialQualityGain||equivalentEfficient)?'KEEP_PROGRESSIVE':'REDUCE_PREPARATION_PROFILE' });
}

function buildProductionQualificationReport(routeResults = []) {
  const routes = routeResults.map(r => Object.freeze({ ...r, productionAuthorized:false, authorizationGate:'D31' }));
  return Object.freeze({ specificationComplete:true, productionQualified:routes.length>0 && routes.every(r=>r.decision===DECISION.QUALIFIED), productionAuthorized:false, authorizationGate:'D31', routes:Object.freeze(routes), generatedAt:new Date().toISOString() });
}

function classifyFailure({ severity, rootCause }) { if (!DEFECT_SEVERITY.includes(severity)) throw new Error('Invalid defect severity'); return Object.freeze({ severity, rootCause:String(rootCause||'model_limitation') }); }

module.exports = { percentile, hasBlockingDefect, summarizeRoute, assertIndependentFallback, comparePreparationProfiles, buildProductionQualificationReport, classifyFailure };
