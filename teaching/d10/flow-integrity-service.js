'use strict';

const { TEACHING_EVENTS } = require('../events/names');
const { EVENT_CATEGORIES } = require('../runtime/constants');

function decorateD10Service(base, {
  repository,
  d09Repository = null,
  transactionalMutation = null,
  randomUUID = null,
  clock = () => new Date(),
} = {}) {
  if (!base || !repository || typeof repository.getActivationFacts !== 'function') {
    throw new TypeError('D10 flow-integrity decorator requires the accepted D10 service and repository.');
  }

  const serverNow = () => {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  };

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
        reserveBeforeFirstClassCount: Number(integrity.reserveBeforeFirstClassCount) || 0,
        earliestClassStartAt: integrity.earliestClassStartAt || null,
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

  const ownsCorrectActivationBoundary = Boolean(
    d09Repository
    && typeof d09Repository.approveTimetableUsing === 'function'
    && typeof d09Repository.latestTimetable === 'function'
    && typeof d09Repository.materializeApprovedTimetableUsing === 'function'
    && transactionalMutation
    && typeof transactionalMutation.mutateAndPublish === 'function'
    && typeof randomUUID === 'function'
  );

  async function activateCourse(user, courseId) {
    if (!ownsCorrectActivationBoundary) return base.activateCourse(user, courseId);
    const review = await getActivationReview(user, courseId);
    if (!review.canActivate) {
      const error = new Error('Course cannot activate until it is Ready and all prerequisites remain current.');
      error.code = 'TEACHING_D10_ACTIVATION_BLOCKED';
      error.status = 409;
      error.details = { blockers: review.blockingReasons || [] };
      throw error;
    }

    const correlationId = randomUUID();
    await transactionalMutation.mutateAndPublish({
      mutate: (tx) => repository.activateCourseUsing(tx, {
        studentId: user.id,
        courseId,
        expected: {
          planId: review.coursePlan?.coursePlanId,
          timetableVersionId: review.timetable?.timetableVersionId,
        },
        // Phase 1 remains Scheduler-owned: approve and re-read the exact slots.
        // It intentionally does NOT materialize teaching_classes yet because the
        // activation parent row does not exist until D10 commits it.
        prepareScheduleUsing: async (runner, facts) => {
          const timetable = await d09Repository.approveTimetableUsing(runner, {
            studentId: user.id,
            timetableVersionId: facts.timetable.timetable_version_id,
          });
          const latest = await d09Repository.latestTimetable(user.id, facts.semester.semester_id, runner);
          return Object.freeze({ timetable, slots: Object.freeze([...(latest.slots || [])]) });
        },
        // Phase 2 runs only after teaching_course_activations has been inserted
        // by the D10 repository, satisfying the immediate activation_id FK.
        materializeScheduleUsing: async (runner, facts, activationId, schedule) => (
          d09Repository.materializeApprovedTimetableUsing(runner, {
            studentId: user.id,
            semesterId: facts.semester.semester_id,
            timetable: schedule.timetable,
            slots: schedule.slots,
            activationId,
            requestId: null,
          })
        ),
      }),
      buildEvent: (result) => ({
        eventId: randomUUID(),
        schemaVersion: 1,
        eventType: TEACHING_EVENTS.COURSE_ACTIVATED,
        eventCategory: EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,
        triggerType: 'committed_domain_event',
        source: 'course_lifecycle',
        origin: 'd10',
        actorId: user.id,
        aggregateType: 'COURSE',
        aggregateId: courseId,
        aggregateVersion: Number(result.course.state_version),
        occurredAt: new Date(result.activatedAt || serverNow()).toISOString(),
        effectiveAt: new Date(result.activatedAt || serverNow()).toISOString(),
        dueAt: null,
        correlationId,
        causationId: null,
        idempotencyKey: `d10-course-activated:${courseId}:${result.course.state_version}`,
        payload: {
          course_id: courseId,
          activation_id: result.activationId,
          timetable_version_id: result.schedule.timetable.timetable_version_id,
        },
        auditRefs: [],
        provenanceRefs: [
          `course-plan:${result.facts.plan.course_plan_id}`,
          `timetable:${result.schedule.timetable.timetable_version_id}`,
        ],
      }),
    });
    return getActivationReview(user, courseId);
  }

  return Object.freeze({ ...base, getActivationReview, activateCourse });
}

module.exports = { decorateD10Service };
