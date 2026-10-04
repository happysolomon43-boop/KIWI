'use strict';

const { normalizeHumanReviewSubmission } = require('./human-review');

function reviewGroupKey(item = {}) {
  return [item.caseId || '', item.routeKey || '', item.capabilityId || ''].join('::');
}

function passedHumanReviewRunIds(reviews = []) {
  return new Set(reviews
    .filter((review) =>
      review?.reviewerKind === 'HUMAN_ACADEMIC' &&
      review?.independent === true &&
      review?.decision === 'PASS' &&
      String(review?.runId || '').trim()
    )
    .map((review) => String(review.runId)));
}

function scopeReviewsToCompletedRunGroups(queue = [], reviews = []) {
  const passedRunIds = passedHumanReviewRunIds(reviews);
  const requiredByGroup = new Map();
  for (const item of queue) {
    const groupKey = reviewGroupKey(item);
    if (!requiredByGroup.has(groupKey)) requiredByGroup.set(groupKey, []);
    requiredByGroup.get(groupKey).push(item);
  }

  const completedGroups = new Set();
  for (const [groupKey, items] of requiredByGroup) {
    if (items.length > 0 && items.every((item) => passedRunIds.has(String(item.runId)))) completedGroups.add(groupKey);
  }

  const eligibleReviews = reviews.filter((review) =>
    review?.reviewerKind === 'HUMAN_ACADEMIC' &&
    review?.independent === true &&
    review?.decision === 'PASS' &&
    passedRunIds.has(String(review.runId || '')) &&
    completedGroups.has(reviewGroupKey(review))
  );
  const pendingQueue = queue.filter((item) => !passedRunIds.has(String(item.runId)));

  return Object.freeze({
    eligibleReviews:Object.freeze([...eligibleReviews]),
    pendingQueue:Object.freeze([...pendingQueue]),
    completedGroups:Object.freeze([...completedGroups]),
    passedRunIds:Object.freeze([...passedRunIds]),
  });
}

function createD30BoundedCommand({ coordinator, repository } = {}) {
  if (!coordinator?.reviewQueue || !coordinator?.finalize) throw new TypeError('D30 bounded command requires a qualification coordinator.');
  if (!repository?.recordHumanReview || !repository?.listHumanReviews) throw new TypeError('D30 bounded command requires the durable D30 repository.');

  async function recordHumanReview({ sessionId, submission } = {}) {
    if (!String(sessionId || '').trim()) throw new Error('D30 human review recording requires sessionId.');
    if (!submission || typeof submission !== 'object' || Array.isArray(submission)) throw new Error('D30 human review recording requires a review submission object.');
    const queue = await coordinator.reviewQueue({sessionId});
    const runId = String(submission.runId || '').trim();
    const attemptNo = Number(submission.attemptNo);
    const queueItem = queue.find((item) => String(item.runId) === runId && Number(item.attemptNo) === attemptNo);
    if (!queueItem) {
      const error = new Error(`D30 human review run is not in the current required queue: ${runId || '<missing>'} attempt ${Number.isFinite(attemptNo) ? attemptNo : '<missing>'}.`);
      error.code = 'TEACHING_D30_HUMAN_REVIEW_RUN_NOT_QUEUED';
      throw error;
    }
    const normalized = normalizeHumanReviewSubmission({
      ...submission,
      sessionId:submission.sessionId || sessionId,
    }, queueItem);
    const id = await repository.recordHumanReview(normalized);
    return Object.freeze({
      id,
      ...normalized,
      productionAuthorized:false,
      authorizationGate:'D31',
    });
  }

  async function reviewState({ sessionId, plan = null } = {}) {
    if (!String(sessionId || '').trim()) throw new Error('D30 review state requires sessionId.');
    const [queue, reviews] = await Promise.all([
      coordinator.reviewQueue({sessionId,plan}),
      repository.listHumanReviews(sessionId),
    ]);
    const scoped = scopeReviewsToCompletedRunGroups(queue,reviews);
    return Object.freeze({
      sessionId,
      requiredCount:queue.length,
      passedRunCount:scoped.passedRunIds.length,
      pendingCount:scoped.pendingQueue.length,
      pendingQueue:scoped.pendingQueue,
      eligibleReviews:scoped.eligibleReviews,
      productionAuthorized:false,
      authorizationGate:'D31',
    });
  }

  async function finalize({ sessionId, plan = null, records = null, pplComparison = null, includeCrossFamily = true, closeBlocked = false } = {}) {
    const [queue, reviews] = await Promise.all([
      coordinator.reviewQueue({sessionId,plan}),
      repository.listHumanReviews(sessionId),
    ]);
    const scoped = scopeReviewsToCompletedRunGroups(queue,reviews);
    const result = await coordinator.finalize({
      sessionId,
      plan,
      records,
      humanReviews:scoped.eligibleReviews,
      pplComparison,
      includeCrossFamily,
      closeBlocked,
    });
    return Object.freeze({
      ...result,
      humanReviewQueue:Object.freeze([...queue]),
      pendingHumanReviews:scoped.pendingQueue,
      runScopedHumanReviewComplete:scoped.pendingQueue.length === 0,
      evidenceComplete:result.empiricalExecutionComplete === true && scoped.pendingQueue.length === 0 && result.pplComparison != null && result.pplComparison.decision !== 'INSUFFICIENT_EVIDENCE',
      productionAuthorized:false,
      authorizationGate:'D31',
    });
  }

  return Object.freeze({
    recordHumanReview,
    reviewState,
    finalize,
  });
}

module.exports = {
  reviewGroupKey,
  passedHumanReviewRunIds,
  scopeReviewsToCompletedRunGroups,
  createD30BoundedCommand,
};
