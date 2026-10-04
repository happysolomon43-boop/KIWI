'use strict';

const {
  FULL_DISTINCT_CORPUS,
  CROSS_FAMILY_CORPUS,
} = require('./corpus');
const { buildQualificationPlan } = require('./qualification-plan');
const { createD30QualificationRunner } = require('./runner');
const { summarizeRouteQualification, assertFallbackIndependent, buildProductionQualificationReport } = require('./qualification');
const { buildHumanReviewQueue } = require('./human-review');

function indexCases(cases = FULL_DISTINCT_CORPUS) {
  return new Map(cases.map((item) => [item.id, item]));
}

function reviewsForTarget(humanReviews, target) {
  return (humanReviews || []).filter((review) =>
    review.familyId === target.familyId &&
    review.routeKey === target.routeKey &&
    (review.capabilityId == null || review.capabilityId === '' || review.capabilityId === target.capabilityId)
  );
}

function recordsForTarget(records, target) {
  return records.filter((record) =>
    record.familyId === target.familyId &&
    record.capabilityId === target.capabilityId &&
    record.routeKey === target.routeKey &&
    record.routeRole === target.routeRole
  );
}

function buildTargetSummaries({ plan, records, humanReviews = [] } = {}) {
  const summaries = [];
  for (const target of plan.targets) {
    summaries.push(summarizeRouteQualification({
      routeKey:target.routeKey,
      routeRole:target.routeRole,
      familyId:target.familyId,
      capabilityId:target.capabilityId,
      requiredCaseIds:target.requiredCaseIds,
      repeatedCaseIds:target.repeatedCaseIds,
      minimumRepeats:3,
      records:recordsForTarget(records,target),
      humanReviews:reviewsForTarget(humanReviews,target),
      consequential:target.criticality === 'C4',
    }));
  }
  for (const summary of summaries.filter((item) => item.routeRole === 'FALLBACK')) {
    const primary = summaries.find((item) =>
      item.familyId === summary.familyId &&
      item.capabilityId === summary.capabilityId &&
      item.routeRole === 'PRIMARY'
    );
    if (primary) assertFallbackIndependent(primary, summary);
  }
  return Object.freeze(summaries);
}

function createD30QualificationCoordinator({
  baseOrchestrator,
  repository,
  semanticReviewer,
  invariantEvidenceProvider,
  crossFamilyExecutor,
  logger = console,
} = {}) {
  if (!baseOrchestrator?.run || !baseOrchestrator?.plan) throw new TypeError('D30 coordinator requires central KIWI AI Orchestrator.');
  if (!repository?.beginSession || !repository?.recordCaseResult) throw new TypeError('D30 coordinator requires durable D30 repository.');
  const runner = createD30QualificationRunner({ baseOrchestrator, repository, semanticReviewer, invariantEvidenceProvider });
  const caseIndex = indexCases();

  async function executeTarget(sessionId, target) {
    const records = [];
    for (const caseId of target.requiredCaseIds) {
      const caseSpec = caseIndex.get(caseId);
      if (!caseSpec) throw new Error(`D30 target references unknown case ${caseId}.`);
      const record = await runner.executeCase({ sessionId, caseSpec, routeKey:target.routeKey, routeRole:target.routeRole, attemptNo:1 });
      records.push(record);
    }
    for (const caseId of target.repeatedCaseIds) {
      const caseSpec = caseIndex.get(caseId);
      for (let attemptNo = 2; attemptNo <= 3; attemptNo += 1) {
        records.push(await runner.executeCase({ sessionId, caseSpec, routeKey:target.routeKey, routeRole:target.routeRole, attemptNo }));
      }
    }
    return records;
  }

  async function executeCrossFamily(sessionId) {
    if (typeof crossFamilyExecutor !== 'function') return Object.freeze([]);
    const records = [];
    for (const caseSpec of CROSS_FAMILY_CORPUS) {
      records.push(await runner.executeCrossFamilyCase({ sessionId, caseSpec, executeWorkflow:crossFamilyExecutor }));
    }
    return Object.freeze(records);
  }

  async function execute({ sourceSha, environment = 'INTEGRATION', metadata = {}, targetPredicate = null } = {}) {
    await repository.assertReady();
    const sessionId = await repository.beginSession({ sourceSha, environment, metadata });
    const plan = buildQualificationPlan({ orchestrator:baseOrchestrator });
    const targets = typeof targetPredicate === 'function' ? plan.targets.filter(targetPredicate) : plan.targets;
    const records = [];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      logger?.log?.(`[D30] qualifying ${index + 1}/${targets.length}: ${target.targetKey}`);
      records.push(...await executeTarget(sessionId,target));
    }
    records.push(...await executeCrossFamily(sessionId));
    const humanReviewQueue = buildHumanReviewQueue(records);
    const provisionalSummaries = buildTargetSummaries({ plan:{...plan,targets:Object.freeze(targets)}, records, humanReviews:[] });
    for (const summary of provisionalSummaries) await repository.recordRouteDecision({ sessionId, summary });
    const report = buildProductionQualificationReport(provisionalSummaries, null);
    await repository.completeSession(sessionId, report);
    return Object.freeze({ sessionId, plan:Object.freeze({...plan,targets:Object.freeze(targets)}), records:Object.freeze(records), humanReviewQueue, routeSummaries:provisionalSummaries, report });
  }

  async function finalize({ sessionId, plan, records, humanReviews = [], pplComparison = null } = {}) {
    const summaries = buildTargetSummaries({ plan, records, humanReviews });
    for (const summary of summaries) await repository.recordRouteDecision({ sessionId, summary });
    const report = buildProductionQualificationReport(summaries, pplComparison);
    await repository.completeSession(sessionId, report);
    return Object.freeze({ routeSummaries:summaries, report, humanReviewQueue:buildHumanReviewQueue(records) });
  }

  return Object.freeze({ executeTarget, executeCrossFamily, execute, finalize });
}

module.exports = {
  indexCases,
  recordsForTarget,
  reviewsForTarget,
  buildTargetSummaries,
  createD30QualificationCoordinator,
};