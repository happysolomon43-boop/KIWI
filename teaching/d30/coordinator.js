'use strict';

const {
  FULL_DISTINCT_CORPUS,
  CROSS_FAMILY_CORPUS,
} = require('./corpus');
const { buildQualificationPlan } = require('./qualification-plan');
const { createD30QualificationRunner } = require('./runner');
const {
  summarizeRouteQualification,
  summarizeCrossFamilyQualification,
  assertFallbackIndependent,
  buildProductionQualificationReport,
} = require('./qualification');
const { buildHumanReviewQueue } = require('./human-review');
const { createCrossFamilyWorkflowExecutor } = require('./cross-family');
const { runKey } = require('./repository');

const EDGE_REVIEW_CLASSES = Object.freeze([
  'uncertainty','source_conflict','negative','injection','authority_attack','counterfactual','cross_subject','metamorphic',
  'plan_actual_divergence','conflicting_cards','correction','unsupported_bridge','protected_content','stale_input',
]);

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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function requiredHumanReviewCaseIds(target, records, caseIndex = indexCases()) {
  if (String(target.criticality || '').toUpperCase() !== 'C4') return Object.freeze([]);
  const available = recordsForTarget(records, target);
  if (!available.length) return Object.freeze([]);
  const availableIds = new Set(available.map((record) => record.caseId));
  const selected = [];
  const representative = target.requiredCaseIds.find((caseId) => {
    const spec = caseIndex.get(caseId);
    return availableIds.has(caseId) && spec?.caseClass === 'golden';
  }) || target.requiredCaseIds.find((caseId) => availableIds.has(caseId));
  if (representative) selected.push(representative);

  for (const caseClass of EDGE_REVIEW_CLASSES) {
    const edge = target.requiredCaseIds.find((caseId) => availableIds.has(caseId) && caseIndex.get(caseId)?.caseClass === caseClass);
    if (edge) selected.push(edge);
  }

  for (const record of available) {
    const disagreement = record.validation?.pass !== true || record.semanticReview?.pass !== true || (record.defects || []).length > 0;
    if (disagreement) selected.push(record.caseId);
  }
  return Object.freeze(unique(selected));
}

function requiredCrossFamilyReviewCaseIds(records, caseIndex = indexCases()) {
  const available = records.filter((record) => record.familyId === 'CROSS_FAMILY');
  const availableIds = new Set(available.map((record) => record.caseId));
  const selected = [];
  for (const workflowId of [...new Set(CROSS_FAMILY_CORPUS.map((item) => item.workflow.id))]) {
    const representative = CROSS_FAMILY_CORPUS.find((item) => item.workflow.id === workflowId && item.inputFixture?.risk === 'NORMAL_HANDOFF' && availableIds.has(item.id))
      || CROSS_FAMILY_CORPUS.find((item) => item.workflow.id === workflowId && availableIds.has(item.id));
    const adverse = CROSS_FAMILY_CORPUS.find((item) => item.workflow.id === workflowId && item.inputFixture?.risk === 'ADVERSE_OWNER_ESCALATION' && availableIds.has(item.id));
    if (representative) selected.push(representative.id);
    if (adverse) selected.push(adverse.id);
  }
  for (const record of available) {
    if (record.validation?.pass !== true || (record.defects || []).length > 0) selected.push(record.caseId);
  }
  return Object.freeze(unique(selected));
}

function buildTargetSummaries({ plan, records, humanReviews = [], caseIndex = indexCases() } = {}) {
  const summaries = [];
  for (const target of plan.targets) {
    const targetRecords = recordsForTarget(records,target);
    summaries.push(summarizeRouteQualification({
      routeKey:target.routeKey,
      routeRole:target.routeRole,
      familyId:target.familyId,
      capabilityId:target.capabilityId,
      requiredCaseIds:target.requiredCaseIds,
      requiredHumanReviewCaseIds:requiredHumanReviewCaseIds(target,records,caseIndex),
      repeatedCaseIds:target.repeatedCaseIds,
      minimumRepeats:3,
      records:targetRecords,
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

function buildCrossFamilySummary({ records = [], humanReviews = [], caseIndex = indexCases() } = {}) {
  const crossRecords = records.filter((record) => record.familyId === 'CROSS_FAMILY' && record.routeKey === 'CROSS_FAMILY_WORKFLOW');
  return summarizeCrossFamilyQualification({
    requiredCaseIds:CROSS_FAMILY_CORPUS.map((item) => item.id),
    requiredHumanReviewCaseIds:requiredCrossFamilyReviewCaseIds(crossRecords,caseIndex),
    records:crossRecords,
    humanReviews:(humanReviews || []).filter((review) => review.familyId === 'CROSS_FAMILY'),
    repeatedCaseIds:[],
    minimumRepeats:1,
  });
}

function targetWorkItems(target, caseIndex = indexCases()) {
  const items = [];
  for (const caseId of target.requiredCaseIds) {
    const caseSpec = caseIndex.get(caseId);
    if (!caseSpec) throw new Error(`D30 target references unknown case ${caseId}.`);
    items.push(Object.freeze({kind:'ROUTE',target,caseSpec,attemptNo:1}));
  }
  for (const caseId of target.repeatedCaseIds) {
    const caseSpec = caseIndex.get(caseId);
    if (!caseSpec) throw new Error(`D30 stability target references unknown case ${caseId}.`);
    for (let attemptNo = 2; attemptNo <= 3; attemptNo += 1) items.push(Object.freeze({kind:'ROUTE',target,caseSpec,attemptNo}));
  }
  return items;
}

function workItemKey(item) {
  if (item.kind === 'CROSS_FAMILY') return runKey({caseId:item.caseSpec.id,routeKey:'CROSS_FAMILY_WORKFLOW',routeRole:'STAGE',capabilityId:'',attemptNo:item.attemptNo || 1});
  return runKey({caseId:item.caseSpec.id,routeKey:item.target.routeKey,routeRole:item.target.routeRole,capabilityId:item.target.capabilityId,attemptNo:item.attemptNo});
}

function buildWorkItems({ plan, includeCrossFamily = true, caseIndex = indexCases() } = {}) {
  const items = plan.targets.flatMap((target) => targetWorkItems(target,caseIndex));
  if (includeCrossFamily) {
    for (const caseSpec of CROSS_FAMILY_CORPUS) items.push(Object.freeze({kind:'CROSS_FAMILY',caseSpec,attemptNo:1}));
  }
  return Object.freeze(items);
}

function consequentialReviewCaseIds(records = []) {
  return Object.freeze(unique(records.filter((record) =>
    record.familyId === 'TPF-20' && (record.defects || []).some((defect) => ['P0','P1'].includes(defect.severity))
  ).map((record) => record.caseId)));
}

function selectedHumanReviewQueue({ plan, records, caseIndex = indexCases() } = {}) {
  const required = new Set();
  for (const target of plan.targets) {
    for (const caseId of requiredHumanReviewCaseIds(target,records,caseIndex)) {
      for (const record of recordsForTarget(records,target).filter((item) => item.caseId === caseId)) required.add(record.runId);
    }
  }
  const crossRequired = new Set(requiredCrossFamilyReviewCaseIds(records.filter((record) => record.familyId === 'CROSS_FAMILY'),caseIndex));
  for (const record of records.filter((item) => item.familyId === 'CROSS_FAMILY' && crossRequired.has(item.caseId))) required.add(record.runId);
  const consequential = new Set(consequentialReviewCaseIds(records));
  for (const record of records.filter((item) => consequential.has(item.caseId))) required.add(record.runId);
  return buildHumanReviewQueue(records.filter((record) => required.has(record.runId)), { consequentialCaseIds:[...consequential] });
}

async function persistRunDefects(repository, record) {
  for (const defect of record.defects || []) {
    await repository.recordDefect({
      sessionId:record.sessionId,
      caseId:record.caseId,
      familyId:record.familyId,
      capabilityId:record.capabilityId || '',
      routeKey:record.routeKey,
      severity:defect.severity || 'P2',
      code:defect.code || 'UNCLASSIFIED_D30_DEFECT',
      rootCause:defect.rootCause || null,
      description:defect.message || defect.description || defect.code || 'D30 qualification defect',
      regressionAnchorId:defect.regressionAnchorId || null,
      resolved:false,
      evidence:{runId:record.runId,attemptNo:record.attemptNo},
    });
  }
}

function createD30QualificationCoordinator({
  baseOrchestrator,
  repository,
  semanticReviewer,
  invariantEvidenceProvider,
  crossFamilyExecutor = null,
  logger = console,
} = {}) {
  if (!baseOrchestrator?.run || !baseOrchestrator?.plan) throw new TypeError('D30 coordinator requires central KIWI AI Orchestrator.');
  if (!repository?.beginSession || !repository?.recordCaseResult) throw new TypeError('D30 coordinator requires durable D30 repository.');
  const runner = createD30QualificationRunner({ baseOrchestrator, repository, semanticReviewer, invariantEvidenceProvider });
  const caseIndex = indexCases();
  const workflowExecutor = crossFamilyExecutor || createCrossFamilyWorkflowExecutor();

  async function startOrResume({ sourceSha, environment = 'INTEGRATION', metadata = {} } = {}) {
    await repository.assertReady();
    const existing = repository.findResumableSession ? await repository.findResumableSession({sourceSha,environment}) : null;
    if (existing) return Object.freeze({sessionId:String(existing.id),resumed:true,session:existing});
    const sessionId = await repository.beginSession({sourceSha,environment,metadata});
    return Object.freeze({sessionId,resumed:false,session:await repository.getSession?.(sessionId) || null});
  }

  async function executeWorkItem(sessionId, item) {
    let record;
    if (item.kind === 'CROSS_FAMILY') {
      record = await runner.executeCrossFamilyCase({sessionId,caseSpec:item.caseSpec,executeWorkflow:workflowExecutor,attemptNo:item.attemptNo});
    } else {
      record = await runner.executeCase({sessionId,caseSpec:item.caseSpec,routeKey:item.target.routeKey,routeRole:item.target.routeRole,attemptNo:item.attemptNo});
    }
    await persistRunDefects(repository,record);
    return record;
  }

  async function executeBatch({
    sourceSha,
    environment = 'INTEGRATION',
    metadata = {},
    maxRuns = 50,
    targetPredicate = null,
    includeCrossFamily = targetPredicate == null,
  } = {}) {
    if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 500) throw new Error('D30 maxRuns must be an integer from 1 to 500.');
    const session = await startOrResume({sourceSha,environment,metadata});
    const fullPlan = buildQualificationPlan({orchestrator:baseOrchestrator});
    const targets = typeof targetPredicate === 'function' ? fullPlan.targets.filter(targetPredicate) : fullPlan.targets;
    const plan = Object.freeze({...fullPlan,targets:Object.freeze(targets)});
    const completed = repository.listCompletedRunKeys ? await repository.listCompletedRunKeys(session.sessionId) : new Set();
    const workItems = buildWorkItems({plan,includeCrossFamily,caseIndex});
    const pending = workItems.filter((item) => !completed.has(workItemKey(item)));
    const batch = pending.slice(0,maxRuns);
    const records = [];
    for (let index = 0; index < batch.length; index += 1) {
      const item=batch[index];
      const label=item.kind === 'CROSS_FAMILY' ? item.caseSpec.id : `${item.target.targetKey}:${item.caseSpec.id}:a${item.attemptNo}`;
      logger?.log?.(`[D30] empirical ${index+1}/${batch.length}: ${label}`);
      records.push(await executeWorkItem(session.sessionId,item));
    }
    const counts = repository.sessionEvidenceCounts ? await repository.sessionEvidenceCounts(session.sessionId) : null;
    return Object.freeze({
      sessionId:session.sessionId,
      resumed:session.resumed,
      plan,
      executed:Object.freeze(records),
      executedCount:records.length,
      expectedWorkItems:workItems.length,
      pendingBeforeBatch:pending.length,
      pendingAfterBatch:Math.max(0,pending.length-records.length),
      empiricalExecutionComplete:pending.length === records.length,
      counts,
      productionAuthorized:false,
      authorizationGate:'D31',
    });
  }

  async function status({ sessionId, plan = null, includeCrossFamily = true } = {}) {
    const resolvedPlan = plan || buildQualificationPlan({orchestrator:baseOrchestrator});
    const completed = await repository.listCompletedRunKeys(sessionId);
    const workItems = buildWorkItems({plan:resolvedPlan,includeCrossFamily,caseIndex});
    const pending = workItems.filter((item) => !completed.has(workItemKey(item)));
    const counts = await repository.sessionEvidenceCounts(sessionId);
    return Object.freeze({sessionId,expectedWorkItems:workItems.length,completedWorkItems:workItems.length-pending.length,pendingWorkItems:pending.length,empiricalExecutionComplete:pending.length===0,counts});
  }

  async function reviewQueue({ sessionId, plan = null } = {}) {
    const resolvedPlan=plan || buildQualificationPlan({orchestrator:baseOrchestrator});
    const records=await repository.listCaseResults(sessionId);
    return selectedHumanReviewQueue({plan:resolvedPlan,records,caseIndex});
  }

  async function finalize({
    sessionId,
    plan = null,
    records = null,
    humanReviews = null,
    pplComparison = null,
    includeCrossFamily = true,
    closeBlocked = false,
  } = {}) {
    const resolvedPlan=plan || buildQualificationPlan({orchestrator:baseOrchestrator});
    const resolvedRecords=records || await repository.listCaseResults(sessionId);
    const resolvedReviews=humanReviews || await repository.listHumanReviews(sessionId);
    const completion=await status({sessionId,plan:resolvedPlan,includeCrossFamily});
    const summaries=[...buildTargetSummaries({plan:resolvedPlan,records:resolvedRecords,humanReviews:resolvedReviews,caseIndex})];
    const crossFamilySummary=includeCrossFamily ? buildCrossFamilySummary({records:resolvedRecords,humanReviews:resolvedReviews,caseIndex}) : null;
    for (const summary of summaries) await repository.recordRouteDecision({sessionId,summary});
    if (crossFamilySummary) await repository.recordRouteDecision({sessionId,summary:crossFamilySummary});
    const report=buildProductionQualificationReport(summaries,pplComparison,{crossFamilySummary});
    const humanReviewQueue=selectedHumanReviewQueue({plan:resolvedPlan,records:resolvedRecords,caseIndex});
    const reviewKeys=new Set(resolvedReviews.filter((review)=>review.decision==='PASS').map((review)=>`${review.caseId}::${review.routeKey}::${review.capabilityId||''}`));
    const pendingHumanReviews=humanReviewQueue.filter((item)=>!reviewKeys.has(`${item.caseId}::${item.routeKey}::${item.capabilityId||''}`));
    const evidenceComplete=completion.empiricalExecutionComplete && pendingHumanReviews.length===0 && pplComparison != null;
    const shouldClose=report.productionQualified || (closeBlocked && evidenceComplete);
    const sessionStatus=shouldClose ? await repository.completeSession(sessionId,report) : 'RUNNING';
    return Object.freeze({
      routeSummaries:Object.freeze(summaries),
      crossFamilySummary,
      report,
      humanReviewQueue,
      pendingHumanReviews:Object.freeze(pendingHumanReviews),
      empiricalExecutionComplete:completion.empiricalExecutionComplete,
      evidenceComplete,
      sessionStatus,
    });
  }

  return Object.freeze({
    startOrResume,
    executeWorkItem,
    executeBatch,
    status,
    reviewQueue,
    finalize,
  });
}

module.exports = {
  EDGE_REVIEW_CLASSES,
  indexCases,
  recordsForTarget,
  reviewsForTarget,
  requiredHumanReviewCaseIds,
  requiredCrossFamilyReviewCaseIds,
  buildTargetSummaries,
  buildCrossFamilySummary,
  targetWorkItems,
  workItemKey,
  buildWorkItems,
  consequentialReviewCaseIds,
  selectedHumanReviewQueue,
  createD30QualificationCoordinator,
};