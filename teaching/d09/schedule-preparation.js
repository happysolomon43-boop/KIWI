'use strict';

const { computeSchedule } = require('./scheduler');

const PREACTIVATION_STATES = new Set(['DRAFT', 'READY', 'PLANNING', 'SETUP']);
const NO_INITIAL_INSTRUCTION = 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION';
const DEFAULT_LOAD_BATCH_SIZE = 20;
const DEFAULT_LOAD_CONCURRENCY = 2;
const SCHEDULER_EXCLUDED_LIFECYCLES = new Set([
  'PAUSED','TEACHING_ENDED','FINALIZING','INCOMPLETE','COMPLETED','ARCHIVED',
]);
const GOVERNED_SCHEDULE_LIFECYCLES = new Set(['ACTIVE','PAUSED','INCOMPLETE']);

function fail(message, code, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function isGovernedSchedulingLifecycle(state) {
  return GOVERNED_SCHEDULE_LIFECYCLES.has(String(state || 'DRAFT'));
}

function isSchedulableLifecycle(state) {
  return !SCHEDULER_EXCLUDED_LIFECYCLES.has(String(state || 'DRAFT'));
}

function schedulableScheduleContext(context, { includeCourseId = null } = {}) {
  const included = (context?.courses || []).filter((bundle) => {
    const id = String(bundle.course?.course_id || '');
    if (includeCourseId != null && id === String(includeCourseId)) return true;
    return isSchedulableLifecycle(bundle.course?.lifecycle_state);
  });
  return Object.freeze({
    ...(context || {}),
    courses: Object.freeze(included),
  });
}

function activeAuthorityScheduleContext(context) {
  const included = (context?.courses || []).filter((bundle) =>
    String(bundle.course?.lifecycle_state || '') === 'ACTIVE'
  );
  return Object.freeze({
    ...(context || {}),
    courses: Object.freeze(included),
  });
}

function timetableRefScheduleContext(context, timetable) {
  const refs = Array.isArray(timetable?.course_plan_refs) ? timetable.course_plan_refs : [];
  const refByCourse = new Map(refs.map((ref) => [String(ref.course_id || ''), ref]));
  const included = (context?.courses || []).filter((bundle) => {
    const ref = refByCourse.get(String(bundle.course?.course_id || ''));
    return Boolean(
      ref
      && String(ref.course_plan_id || '') === String(bundle.plan?.course_plan_id || '')
      && Number(ref.version_no) === Number(bundle.plan?.version_no)
      && Number(ref.state_version) === Number(bundle.course?.state_version)
    );
  });
  return Object.freeze({
    ...(context || {}),
    courses: Object.freeze(included),
  });
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

function computeSharedSemesterSchedule(context, { now, includeCourseId = null } = {}) {
  const nowIso = now instanceof Date ? now.toISOString() : String(now || new Date().toISOString());
  const eligible = schedulableScheduleContext(context, { includeCourseId });
  const planningContext = planningContextAt(eligible, nowIso);
  return Object.freeze({
    planningContext,
    result: computeSchedule(planningContext, { now: nowIso }),
  });
}

function extractExecutionRef(result) {
  return result?.executionId || result?.execution_id || result?.correlationId || result?.correlation_id || null;
}

function resultFailureCode(value) {
  return String(
    value?.code ||
    value?.safeFailureCode ||
    value?.safe_failure_code ||
    value?.reason ||
    value?.rejectionReason ||
    value?.rejection_reason ||
    value?.finishReason ||
    value?.finish_reason ||
    ''
  );
}

function isTruncationFailure(value) {
  const code = resultFailureCode(value).toUpperCase();
  const message = String(value?.message || '').toUpperCase();
  return code.includes('TRUNCAT') || code.includes('MAX_TOKENS') || message.includes('MAX_TOKENS') || message.includes('INCOMPLETE TEACHING ARTIFACT');
}

function expectedTargets(context, targetScopeRefs = null) {
  const allowed = targetScopeRefs == null ? null : new Set(targetScopeRefs.map(String));
  const targets = new Map();
  for (const { bundle, unit } of missingInstructionalLoads(context)) {
    const ref = scopeRef(bundle.course.course_id, unit.learning_unit_id);
    if (allowed && !allowed.has(ref)) continue;
    targets.set(ref, { bundle, unit });
  }
  if (allowed) {
    for (const ref of allowed) {
      if (!targets.has(ref)) {
        throw fail('Instructional-load target changed before AI estimation.', 'TEACHING_D09_LOAD_TARGET_STALE', 409, { scopeRef: ref });
      }
    }
  }
  return targets;
}

function extractInstructionalLoadEstimates(result, context, targetScopeRefs = null) {
  if (!result || result.accepted !== true) {
    const reason = resultFailureCode(result) || null;
    throw fail(
      isTruncationFailure(result)
        ? 'KIWI could not finish a bounded workload-estimation batch. The timetable was not changed.'
        : 'KIWI could not validate instructional-load estimates for this Course Plan.',
      isTruncationFailure(result) ? 'TEACHING_D09_LOAD_ESTIMATION_TRUNCATED' : 'TEACHING_D09_LOAD_ESTIMATION_REJECTED',
      422,
      { reason }
    );
  }
  const output = result.validatedResult?.output || result.output || result.validatedResult || null;
  const rows = output?.capacity_analysis?.instructional_load_estimates;
  if (!Array.isArray(rows)) {
    throw fail('Validated TPF-10 output did not contain instructional-load estimates.', 'TEACHING_D09_LOAD_ESTIMATES_REQUIRED', 422);
  }
  const targets = expectedTargets(context, targetScopeRefs);
  const estimates = [];
  const seen = new Set();
  for (const row of rows) {
    const ref = String(row?.scope_ref || '');
    const target = targets.get(ref);
    if (!target || seen.has(ref)) {
      throw fail('TPF-10 returned an unexpected or duplicate instructional-load target.', 'TEACHING_D09_LOAD_SCOPE_INVALID', 422);
    }
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

function targetRefs(items) {
  return Object.freeze(items.map(({ bundle, unit }) => scopeRef(bundle.course.course_id, unit.learning_unit_id)));
}

async function ensureInstructionalLoads({
  user,
  courseId,
  initialContext,
  intelligence,
  repository,
  requireReadyContext,
  anchorCourseId = courseId,
  maxBatchSize = DEFAULT_LOAD_BATCH_SIZE,
  concurrency = DEFAULT_LOAD_CONCURRENCY,
} = {}) {
  const context = initialContext;
  const missing = missingInstructionalLoads(context);
  const requestedScopeRefs = new Set(targetRefs(missing));
  if (!missing.length) return context;
  if (!intelligence || typeof intelligence.execute !== 'function') {
    throw fail('Instructional-load estimation is required before this timetable can be created.', 'TEACHING_D09_LOAD_ESTIMATION_UNAVAILABLE', 503);
  }
  if (!repository || typeof repository.saveInstructionalLoadEstimates !== 'function') {
    throw fail('Scheduler instructional-load persistence is unavailable.', 'TEACHING_D09_LOAD_PERSISTENCE_UNAVAILABLE', 503);
  }
  if (typeof requireReadyContext !== 'function') {
    throw new TypeError('D09 load preparation requires requireReadyContext().');
  }

  const requested = requireReadyContext(context, anchorCourseId);
  const batchSize = Math.max(1, Number(maxBatchSize) || DEFAULT_LOAD_BATCH_SIZE);
  const batches = [];
  for (let index = 0; index < missing.length; index += batchSize) {
    batches.push(targetRefs(missing.slice(index, index + batchSize)));
  }

  async function executeRefs(refs) {
    let result;
    try {
      result = await intelligence.execute({
        course: requested.course,
        context,
        taskMode: 'instructional_load_estimation',
        instructionalLoadTargetRefs: refs,
      });
    } catch (error) {
      if (isTruncationFailure(error) && refs.length > 1) {
        const midpoint = Math.ceil(refs.length / 2);
        await executeRefs(Object.freeze(refs.slice(0, midpoint)));
        await executeRefs(Object.freeze(refs.slice(midpoint)));
        return;
      }
      if (isTruncationFailure(error)) {
        throw fail(
          'KIWI could not finish workload preparation even for one Learning Unit. The timetable was not changed.',
          'TEACHING_D09_LOAD_ESTIMATION_TRUNCATED',
          422,
          { reason: resultFailureCode(error) || 'MAX_TOKENS' }
        );
      }
      throw error;
    }

    if (result?.accepted !== true && isTruncationFailure(result) && refs.length > 1) {
      const midpoint = Math.ceil(refs.length / 2);
      await executeRefs(Object.freeze(refs.slice(0, midpoint)));
      await executeRefs(Object.freeze(refs.slice(midpoint)));
      return;
    }

    const estimates = extractInstructionalLoadEstimates(result, context, refs);
    await repository.saveInstructionalLoadEstimates({
      studentId: user.id,
      estimates,
      sourceExecutionRef: extractExecutionRef(result),
    });
  }

  let nextBatch = 0;
  const worker = async () => {
    while (true) {
      const index = nextBatch++;
      if (index >= batches.length) return;
      await executeRefs(batches[index]);
    }
  };
  const workerCount = Math.min(
    batches.length,
    Math.max(1, Math.min(3, Number(concurrency) || DEFAULT_LOAD_CONCURRENCY))
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const refreshed = await repository.getSchedulingContext(user.id, courseId);
  const remaining = missingInstructionalLoads(refreshed).filter(({ bundle, unit }) =>
    requestedScopeRefs.has(scopeRef(bundle.course.course_id, unit.learning_unit_id))
  );
  if (remaining.length) {
    throw fail('One or more Learning Units still have no safe instructional-load range.', 'TEACHING_D09_LOAD_ESTIMATION_INCOMPLETE', 422, {
      learningUnitIds: remaining.map(({ unit }) => String(unit.learning_unit_id)),
    });
  }
  return refreshed;
}

module.exports = {
  PREACTIVATION_STATES,
  NO_INITIAL_INSTRUCTION,
  DEFAULT_LOAD_BATCH_SIZE,
  DEFAULT_LOAD_CONCURRENCY,
  SCHEDULER_EXCLUDED_LIFECYCLES,
  GOVERNED_SCHEDULE_LIFECYCLES,
  isGovernedSchedulingLifecycle,
  isSchedulableLifecycle,
  schedulableScheduleContext,
  activeAuthorityScheduleContext,
  timetableRefScheduleContext,
  computeSharedSemesterSchedule,
  fail,
  treatment,
  instructionalUnits,
  missingInstructionalLoads,
  scopeRef,
  planningContextAt,
  extractExecutionRef,
  extractInstructionalLoadEstimates,
  scheduleClassFacts,
  slotsForCourse,
  resultFailureCode,
  isTruncationFailure,
  ensureInstructionalLoads,
};
