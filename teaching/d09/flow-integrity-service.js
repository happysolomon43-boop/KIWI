'use strict';

const { computeSchedule } = require('./scheduler');
const { assertCurrentCoursePlan } = require('./contracts');
const { buildPreparationEvent } = require('../preparation/events');
const { TEACHING_EVENTS } = require('../events/names');

const PREACTIVATION_STATES = new Set(['DRAFT', 'READY', 'PLANNING', 'SETUP']);
const NO_INITIAL_INSTRUCTION = 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION';

function fail(message, code, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function treatment(unit) {
  return String(unit?.metadata?.instructional_treatment || 'FULL_INSTRUCTION');
}

function instructionalUnits(context) {
  const units = [];
  for (const bundle of context?.courses || []) {
    for (const unit of bundle.units || []) {
      if (treatment(unit) === NO_INITIAL_INSTRUCTION) continue;
      units.push({ bundle, unit });
    }
  }
  return units;
}

function missingInstructionalLoads(context) {
  return instructionalUnits(context).filter(({ unit }) => (Number(unit.instructional_load_max_minutes) || 0) <= 0);
}

function scopeRef(courseId, unitId) {
  return `course:${courseId}:learning-unit:${unitId}`;
}

function planningContextAt(context, serverNow) {
  const semesterStart = Date.parse(context.semester?.starts_at || '');
  const nowMs = Date.parse(serverNow);
  if (!Number.isFinite(semesterStart) || !Number.isFinite(nowMs) || nowMs <= semesterStart) return context;
  const elapsedBlock = Object.freeze({
    block_kind: 'HARD_UNAVAILABLE',
    starts_at: new Date(semesterStart).toISOString(),
    ends_at: new Date(nowMs).toISOString(),
    label: 'Elapsed semester time',
    reason: 'New timetable proposals cannot schedule academic obligations in elapsed time.',
    derived_by: 'D09_SERVER_TIME_FLOOR',
  });
  return Object.freeze({ ...context, blocks: Object.freeze([...(context.blocks || []), elapsedBlock]) });
}

function extractExecutionRef(result) {
  return result?.executionId || result?.execution_id || result?.correlationId || result?.correlation_id || null;
}

function extractInstructionalLoadEstimates(result, context) {
  if (!result || result.accepted !== true) {
    throw fail('KIWI could not validate instructional-load estimates for this Course Plan.', 'TEACHING_D09_LOAD_ESTIMATION_REJECTED', 422, {
      reason: result?.reason || result?.rejectionReason || null,
    });
  }
  const output = result.validatedResult?.output || result.output || result.validatedResult || null;
  const rows = output?.capacity_analysis?.instructional_load_estimates;
  if (!Array.isArray(rows)) {
    throw fail('Validated TPF-10 output did not contain instructional-load estimates.', 'TEACHING_D09_LOAD_ESTIMATES_REQUIRED', 422);
  }
  const targets = new Map();
  for (const { bundle, unit } of missingInstructionalLoads(context)) {
    targets.set(scopeRef(bundle.course.course_id, unit.learning_unit_id), { bundle, unit });
  }
  const estimates = [];
  const seen = new Set();
  for (const row of rows) {
    const ref = String(row?.scope_ref || '');
    const target = targets.get(ref);
    if (!target || seen.has(ref)) throw fail('TPF-10 returned an unexpected or duplicate instructional-load target.', 'TEACHING_D09_LOAD_SCOPE_INVALID', 422);
    seen.add(ref);
    const range = row.effort_range || {};
    const minMinutes = Math.ceil(Number(range.min));
    const maxMinutes = Math.ceil(Number(range.max));
    if (range.unit !== 'minutes' || !Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes) || minMinutes <= 0 || maxMinutes < minMinutes) {
      throw fail('TPF-10 returned an unsafe instructional-load range.', 'TEACHING_D09_LOAD_RANGE_INVALID', 422);
    }
    estimates.push(Object.freeze({
      courseId: String(target.bundle.course.course_id),
      coursePlanId: String(target.bundle.plan.course_plan_id),
      coursePlanVersion: Number(target.bundle.plan.version_no),
      learningUnitId: String(target.unit.learning_unit_id),
      minMinutes,
      maxMinutes,
      estimateBasis: Object.freeze((row.estimate_basis || []).map(String)),
      uncertainty: String(row.uncertainty || 'high'),
      scopeRef: ref,
    }));
  }
  if (estimates.length !== targets.size) {
    throw fail('TPF-10 omitted one or more Learning Unit workload estimates.', 'TEACHING_D09_LOAD_ESTIMATE_OMITTED', 422);
  }
  return Object.freeze(estimates);
}

function scheduleClassFacts(schedule, serverNow) {
  const nowMs = Date.parse(serverNow);
  const classes = (schedule || []).filter((slot) => String(slot.kind || slot.slot_kind) === 'CLASS');
  return Object.freeze({
    classCount: classes.length,
    futureClassCount: classes.filter((slot) => Date.parse(slot.endsAt || slot.ends_at) > nowMs).length,
    elapsedClassCount: classes.filter((slot) => Date.parse(slot.endsAt || slot.ends_at) <= nowMs).length,
  });
}

function slotsForCourse(schedule, courseId) {
  return (schedule || []).filter((slot) => String(slot.courseId || slot.course_id || '') === String(courseId));
}

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

  async function ensureInstructionalLoads(user, courseId, initialContext) {
    let context = initialContext;
    const missing = missingInstructionalLoads(context);
    if (!missing.length) return context;
    if (!intelligence || typeof intelligence.execute !== 'function') {
      throw fail('Instructional-load estimation is required before this timetable can be created.', 'TEACHING_D09_LOAD_ESTIMATION_UNAVAILABLE', 503);
    }
    const requested = requireReadyContext(context, courseId);
    const result = await intelligence.execute({
      course: requested.course,
      context,
      taskMode: 'instructional_load_estimation',
    });
    const estimates = extractInstructionalLoadEstimates(result, context);
    if (typeof repository.saveInstructionalLoadEstimates !== 'function') {
      throw fail('Scheduler instructional-load persistence is unavailable.', 'TEACHING_D09_LOAD_PERSISTENCE_UNAVAILABLE', 503);
    }
    await repository.saveInstructionalLoadEstimates({
      studentId: user.id,
      estimates,
      sourceExecutionRef: extractExecutionRef(result),
    });
    context = await repository.getSchedulingContext(user.id, courseId);
    const remaining = missingInstructionalLoads(context);
    if (remaining.length) {
      throw fail('One or more Learning Units still have no safe instructional-load range.', 'TEACHING_D09_LOAD_ESTIMATION_INCOMPLETE', 422, {
        learningUnitIds: remaining.map(({ unit }) => String(unit.learning_unit_id)),
      });
    }
    return context;
  }

  function semesterHasActivatedCourses(context) {
    return (context?.courses || []).some((bundle) => !PREACTIVATION_STATES.has(String(bundle.course?.lifecycle_state || 'DRAFT')));
  }

  async function attachInheritedDefaultForScheduling(user, courseId, context) {
    if (!context?.inheritedDefault) return context;
    if (semesterHasActivatedCourses(context)) {
      throw fail(
        'This shared Semester already contains an active Course. Adding another Course requires the governed scheduling-change path.',
        'TEACHING_D09_ACTIVE_SEMESTER_REQUIRES_GOVERNED_RECALCULATION'
      );
    }
    const inherited = context.inheritedCourseBundle || null;
    if (!inherited) throw fail('The requested Course could not inherit the current Semester scheduling context.', 'TEACHING_D09_DEFAULT_SEMESTER_CONTEXT_REQUIRED');
    assertCurrentCoursePlan(inherited.course, inherited.plan, inherited.scopeChanges);
    if (typeof repository.attachCourseToSemester !== 'function') {
      throw fail('Shared Semester inheritance is temporarily unavailable.', 'TEACHING_D09_DEFAULT_SEMESTER_ATTACH_UNAVAILABLE', 503);
    }
    await repository.attachCourseToSemester({
      studentId: user.id,
      courseId,
      semesterId: context.semester.semester_id,
    });
    return repository.getSchedulingContext(user.id, courseId);
  }

  async function getScheduleReview(user, courseId) {
    const review = await base.getScheduleReview(user, courseId);
    const scopedSlots = Array.isArray(review.courseSlots) ? review.courseSlots : slotsForCourse(review.slots, courseId);
    const classFacts = scheduleClassFacts(scopedSlots, review.serverNow || serverNow());
    const elapsedSlotCount = scopedSlots.filter((slot) => Date.parse(slot.endsAt) <= Date.parse(review.serverNow || serverNow())).length;
    const selectedCourseActive=['ACTIVE','PAUSED'].includes(String(review.requestedCourse?.lifecycleState||'DRAFT'));
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
    context = await ensureInstructionalLoads(user, courseId, context);
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

  async function recalculateAfterCoursePlanChange(user, courseId) {
    let context = await repository.getSchedulingContext(user.id, courseId);
    if (!context.semester || !context.profile) {
      return Object.freeze({ recalculated:false, reason:'SCHEDULE_INPUTS_REQUIRED' });
    }
    if (semesterHasActivatedCourses(context)) {
      return Object.freeze({ recalculated:false, reason:'ACTIVE_SEMESTER_REQUIRES_GOVERNED_RECALCULATION' });
    }
    try {
      if (context.inheritedDefault) context = await attachInheritedDefaultForScheduling(user, courseId, context);
      requireReadyContext(context, courseId);
      for (const bundle of context.courses || []) assertCurrentCoursePlan(bundle.course, bundle.plan, bundle.scopeChanges);
      context = await ensureInstructionalLoads(user, courseId, context);
      const nowIso = serverNow();
      const derived = planningContextAt(context, nowIso);
      const result = computeSchedule(derived, { now: nowIso });
      const requestedInstructionalCount = instructionalUnits(context)
        .filter(({ bundle }) => String(bundle.course.course_id) === String(courseId)).length;
      const classFacts = scheduleClassFacts(slotsForCourse(result.schedule, courseId), nowIso);
      if (requestedInstructionalCount > 0 && classFacts.classCount === 0) {
        return Object.freeze({ recalculated:false, reason:'TEACHING_D09_EMPTY_INSTRUCTIONAL_TIMETABLE' });
      }
      if (classFacts.elapsedClassCount > 0) {
        return Object.freeze({ recalculated:false, reason:'TEACHING_D09_ELAPSED_TIMETABLE_REJECTED' });
      }
      const saved = await commitWithPpl((tx) => repository.saveProposalUsing(tx, {
        studentId: user.id,
        courseId,
        context,
        result,
        source: 'COURSE_PLAN_AUTO_RECALC',
      }));
      return Object.freeze({
        recalculated:true,
        timetableVersionId:saved.timetable?.timetable_version_id || null,
        timetableVersion:saved.timetable?.version_no == null ? null : Number(saved.timetable.version_no),
        outcome:saved.feasibility?.outcome || result.outcome || null,
      });
    } catch (error) {
      return Object.freeze({ recalculated:false, reason:error?.code || 'COURSE_PLAN_AUTO_RECALC_FAILED' });
    }
  }

  async function proposeTimetable(user, courseId) {
    let context = await repository.getSchedulingContext(user.id, courseId);
    if (context.inheritedDefault) context = await attachInheritedDefaultForScheduling(user, courseId, context);
    requireReadyContext(context, courseId);
    const lifecycle = String(context.course.lifecycle_state || 'DRAFT');
    if (lifecycle === 'ACTIVE') {
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
    context = await ensureInstructionalLoads(user, courseId, context);
    const nowIso = serverNow();
    const derived = planningContextAt(context, nowIso);
    const result = computeSchedule(derived, { now: nowIso });
    const classFacts = scheduleClassFacts(slotsForCourse(result.schedule, courseId), nowIso);
    const requestedInstructionalCount = instructionalUnits(context).filter(({ bundle }) => String(bundle.course.course_id) === String(courseId)).length;
    if (requestedInstructionalCount > 0 && classFacts.classCount === 0) {
      throw fail('The Scheduler produced no instructional Classes for a Course that requires instruction.', 'TEACHING_D09_EMPTY_INSTRUCTIONAL_TIMETABLE', 422, { reasons: result.reasons || [] });
    }
    if (classFacts.elapsedClassCount > 0) {
      throw fail('The proposed timetable contains elapsed Classes and must be recalculated from server time.', 'TEACHING_D09_ELAPSED_TIMETABLE_REJECTED', 422);
    }
    await commitWithPpl((tx) => repository.saveProposalUsing(tx, {
      studentId: user.id,
      courseId,
      context,
      result,
      source: 'DETERMINISTIC_INITIAL',
    }));
    return getScheduleReview(user, courseId);
  }

  return Object.freeze({
    ...base,
    getScheduleReview,
    recalculateAfterCoursePlanChange,
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
