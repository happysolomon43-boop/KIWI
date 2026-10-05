'use strict';

function decorateD10Service(base, { repository } = {}) {
  if (!base || !repository || typeof repository.getActivationFacts !== 'function') {
    throw new TypeError('D10 flow-integrity decorator requires the accepted D10 service and repository.');
  }

  async function getActivationReview(user, courseId) {
    const review = await base.getActivationReview(user, courseId);
    const facts = await repository.getActivationFacts(user.id, courseId);
    const integrity = facts.timetableIntegrity || null;
    return Object.freeze({
      ...review,
      timetableIntegrity: integrity ? Object.freeze({
        instructionalUnitCount: Number(integrity.instructionalUnitCount) || 0,
        estimatedInstructionalMinutes: Number(integrity.estimatedInstructionalMinutes) || 0,
        totalSlotCount: Number(integrity.totalSlotCount) || 0,
        classSlotCount: Number(integrity.classSlotCount) || 0,
        futureClassSlotCount: Number(integrity.futureClassSlotCount) || 0,
        elapsedSlotCount: Number(integrity.elapsedSlotCount) || 0,
        serverNow: integrity.serverNow || review.serverNow,
        blockers: Object.freeze([...(integrity.blockers || [])]),
      }) : null,
      reviewContract: Object.freeze({
        sequence: Object.freeze(['COURSE_PLAN', 'TIMETABLE', 'ACADEMIC_RULES', 'FINAL_REVIEW', 'ACTIVATION']),
        readyIsFinalReviewAcceptance: true,
        activationStartsOfficialAcademicObligations: true,
        serverTruthOnly: true,
      }),
    });
  }

  return Object.freeze({ ...base, getActivationReview });
}

module.exports = { decorateD10Service };
