'use strict';

const { computeSchedule } = require('./scheduler');
const { buildPreparationEvent } = require('../preparation/events');
const { TEACHING_EVENTS } = require('../events/names');

const {
  PREACTIVATION_STATES,
  fail,
  instructionalUnits,
  missingInstructionalLoads,
  planningContextAt,
  extractInstructionalLoadEstimates,
  scheduleClassFacts,
  slotsForCourse,
  ensureInstructionalLoads,
} = require('./schedule-preparation');

function decorateD09Service(base, {
  repository,
  transactionalMutation,
  randomUUID,
  clock = () => new Date(),
  intelligence = null,
} = {}) {
  if (!base || !repository || !transactionalMutation || typeof transactionalMutation.mutateAndPublish !== 'function') {
    throw new TypeError('D09 flow-integrity decorator requires the accepted D09 service, repository and transactional mutation boundary.');
  }
  const serverNow = () => {
    const value = clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  };

  function pplEvent(result, correlationId) {
    const p = result.ppl;
    return buildPreparationEvent({
      eventId: randomUUID(),
      eventType: p.isNew ? TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED : TEACHING_EVENTS.PREPARATION_INPUT_CHANGED,
      workspaceId: p.workspaceId,
      workspaceVersion: p.workspaceVersion,
      occurredAt: serverNow(),
      correlationId,
      changedDependencyRefs: p.changedRefs,
      payload: { target_ref: 'semester-schedule', idempotency_scope_ref: result.profile?.profile_id || result.timetable?.timetable_version_id || correlationId },
      provenanceRefs: p.changedRefs,
    });
  }

  async function commitWithPpl(mutate) {
    const correlationId = randomUUID();
    const wrapped = await transactionalMutation.mutateAndPublish({
      mutate,
      buildEvent: (result) => pplEvent(result, correlationId),
    });
    return wrapped.mutationResult;
  }

  function requireReadyContext(context, courseId) {
    if (!context.semester) throw fail('Save the semester and availability before creating a timetable.', 'TEACHING_D09_SEMESTER_REQUIRED');
    if (!context.profile) throw fail('A current availability/scheduling profile is required.', 'TEACHING_D09_SCHEDULE_PROFILE_REQUIRED');
    const requested = (context.courses || []).find((bundle) => String(bundle.course.course_id) === String(courseId));
    if (!requested) throw fail('The requested Course has no current Course Plan to schedule.', 'TEACHING_D09_CURRENT_COURSE_PLAN_REQUIRED');
    return requested;
  }

  async function prepareInstructionalLoads(user, courseId, initialContext) {
    return ensureInstructionalLoads({
      user,
      courseId,
      initialContext,
      intelligence,
      repository,
      requireReadyContext,
    });
  }

  async function getScheduleReview(user, courseId) {
    const review = await base.getScheduleReview(user, courseId);
    const scopedSlots = Array.isArray(review.courseSlots) ? review.courseSlots : slotsForCourse(review.slots, courseId);
    const classFacts = scheduleClassFacts(scopedSlots, review.serverNow || serverNow());
    const elapsedSlotCount = scopedSlots.filter((slot) => Date.parse(slot.endsAt) <= Date.parse(review.serverNow || serverNow())).length;
    const selectedCourseActive=String(review.requestedCourse?.lifecycleState||'DRAFT')==='ACTIVE';
    const recoveryRequired = Boolean(
      selectedCourseActive &&
      review.timetable &&
      review.timetable.state === 'APPROVED' &&
      classFacts.futureClassCount === 0
    );
    return Object.freeze({
      ...review,
      scheduleIntegrity: Object.freeze({
        ...classFacts,
        elapsedSlotCount,
        recoveryRequired,
        reserveOnly: Boolean(scopedSlots.length && classFacts.classCount === 0),
      }),
      scheduleHealth: Object.freeze({
        ...(review.scheduleHealth || {}),
        recoveryRequired,
        systemFailureProtected: recoveryRequired,
      }),
    });
  }

  async function recoverSystemInvalidTimetable(user, courseId, existingContext = null) {
    let context = existingContext || await repository.getSchedulingContext(user.id, courseId);
    requireReadyContext(context, courseId);
    if (String(context.course.lifecycle_state) !== 'ACTIVE') {
      throw fail('Timetable system-failure recovery is only for an Active Course.', 'TEACHING_D09_RECOVERY_ACTIVE_ONLY');
    }
    const latest = await repository.latestTimetable(user.id, context.semester.semester_id);
    const nowIso = serverNow();
    const existingFacts = scheduleClassFacts(slotsForCourse(latest.slots || [], courseId), nowIso);
    if (existingFacts.futureClassCount > 0) return getScheduleReview(user, courseId);
    if (!instructionalUnits(context).length) {
      throw fail('This Course has no instructional Learning Units to recover.', 'TEACHING_D09_RECOVERY_NO_INSTRUCTION_REQUIRED', 409);
    }
    context = await prepareInstructionalLoads(user, courseId, context);
    const derived = planningContextAt(context, nowIso);
    const result = computeSchedule(derived, { now: nowIso });
    const classFacts = scheduleClassFacts(slotsForCourse(result.schedule, courseId), nowIso);
    if (result.outcome !== 'FEASIBLE' || classFacts.futureClassCount <= 0 || classFacts.elapsedClassCount > 0) {
      throw fail('KIWI cannot safely repair this timetable inside the remaining semester capacity.', 'TEACHING_D09_SYSTEM_RECOVERY_INFEASIBLE', 422, {
        outcome: result.outcome,
        reasons: result.reasons || [],
        alternatives: result.alternatives || [],
      });
    }
    const recovered = await commitWithPpl(async (tx) => {
      const saved = await repository.saveProposalUsing(tx, {
        studentId: user.id,
        courseId,
        context,
        result,
        source: 'SYSTEM_FAILURE_RECOVERY',
      });
      const approved = await repository.approveTimetableUsing(tx, {
        studentId: user.id,
        timetableVersionId: saved.timetable.timetable_version_id,
      });
      const activation = typeof repository.getCourseActivationUsing === 'function'
        ? await repository.getCourseActivationUsing(tx, user.id, courseId)
        : null;
      if (!activation) throw fail('Active Course activation record is missing.', 'TEACHING_D09_RECOVERY_ACTIVATION_MISSING', 409);
      const classes = await repository.materializeApprovedTimetableUsing(tx, {
        studentId: user.id,
        semesterId: context.semester.semester_id,
        timetable: approved,
        slots: saved.slots,
        activationId: activation.activation_id,
        requestId: null,
      });
      if (!classes.length) throw fail('Recovered timetable did not materialize any Classes.', 'TEACHING_D09_RECOVERY_CLASS_MATERIALIZATION_FAILED', 500);
      return { ...saved, timetable: approved, classes, ppl: saved.ppl };
    });
    return Object.freeze({
      ...(await getScheduleReview(user, courseId)),
      recovery: Object.freeze({
        recovered: true,
        source: 'KIWI_SYSTEM_FAILURE_RECOVERY',
        timetableVersionId: recovered.timetable.timetable_version_id,
        materializedClasses: recovered.classes.length,
        studentPenaltyAllowed: false,
      }),
    });
  }

  async function proposeTimetable(user, courseId) {
    const context = await repository.getSchedulingContext(user.id, courseId);
    const lifecycle = String(context.course?.lifecycle_state || 'DRAFT');
    if (lifecycle === 'ACTIVE') {
      if (!context.semester) throw fail('Save the semester and availability before repairing a timetable.', 'TEACHING_D09_SEMESTER_REQUIRED');
      const latest = await repository.latestTimetable(user.id, context.semester.semester_id);
      const existingFacts = scheduleClassFacts(slotsForCourse(latest.slots || [], courseId), serverNow());
      if (existingFacts.futureClassCount <= 0) {
        return recoverSystemInvalidTimetable(user, courseId, context);
      }
      throw fail('This active Course already has a current future timetable. Use the formal Request workflow for schedule changes.', 'TEACHING_D09_ACTIVE_TIMETABLE_CHANGE_REQUIRES_REQUEST');
    }
    if (!PREACTIVATION_STATES.has(lifecycle)) {
      throw fail('Course timetables in this lifecycle state change only through the governed Request workflow.', 'TEACHING_D09_PREACTIVATION_PROPOSAL_ONLY');
    }
    return base.proposeTimetable(user, courseId);
  }

  return Object.freeze({
    ...base,
    getScheduleReview,
    proposeTimetable,
    recoverSystemInvalidTimetable,
  });
}

module.exports = {
  PREACTIVATION_STATES,
  missingInstructionalLoads,
  planningContextAt,
  extractInstructionalLoadEstimates,
  scheduleClassFacts,
  slotsForCourse,
  decorateD09Service,
};
