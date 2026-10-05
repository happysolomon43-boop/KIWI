'use strict';

function decorateD08Service(base, { repository } = {}) {
  if (!base || !repository || typeof repository.getPlanReview !== 'function') {
    throw new TypeError('D08 review-experience decorator requires the accepted D08 service and repository.');
  }

  async function getPlanReview(user, courseId) {
    const review = await base.getPlanReview(user, courseId);
    if (!review.plan) return review;
    const setup = await repository.getPlanReview(user.id, courseId);
    return Object.freeze({
      ...review,
      plan: Object.freeze({
        ...review.plan,
        reviewSummary: setup.plan?.review_summary || null,
        intelligence: Object.freeze({
          source: 'TPF-03_COURSE_PLAN_GENERATION',
          provisionalAtGeneration: true,
          deterministicValidationRequired: true,
          authoritativeAfterCommit: true,
        }),
      }),
      reviewExperience: Object.freeze({
        studentReviewRequiredBeforeActivation: true,
        finalAcceptanceOwner: 'D10_COURSE_LIFECYCLE',
        noSeparateHiddenAcceptanceState: true,
      }),
    });
  }

  return Object.freeze({ ...base, getPlanReview });
}

module.exports = { decorateD08Service };
