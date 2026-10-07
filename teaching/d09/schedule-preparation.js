'use strict';

const PREACTIVATION_STATES = new Set(['DRAFT', 'READY', 'PLANNING', 'SETUP']);
const NO_INITIAL_INSTRUCTION = 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION';
const DEFAULT_LOAD_BATCH_SIZE = 8;

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
  maxBatchSize = DEFAULT_LOAD_BATCH_SIZE,
} = {}) {
  let context = initialContext;
  if (!missingInstructionalLoads(context).length) return context;
  if (!intelligence || typeof intelligence.execute !== 'function') {
    throw fail('Instructional-load estimation is required before this timetable can be created.', 'TEACHING_D09_LOAD_ESTIMATION_UNAVAILABLE', 503);
  }
  if (!repository || typeof repository.saveInstructionalLoadEstimates !== 'function') {
    throw fail('Scheduler instructional-load persistence is unavailable.', 'TEACHING_D09_LOAD_PERSISTENCE_UNAVAILABLE', 503);
  }
  if (typeof requireReadyContext !== 'function') {
    throw new TypeError('D09 load preparation requires requireReadyContext().');
  }

  let guard = 0;
  while (true) {
    const missing = missingInstructionalLoads(context);
    if (!missing.length) return context;
    if (++guard > 128) {
      throw fail('Instructional-load preparation did not converge.', 'TEACHING_D09_LOAD_ESTIMATION_NO_PROGRESS', 500);
    }

    const requested = requireReadyContext(context, courseId);
    let batchSize = Math.min(Math.max(1, Number(maxBatchSize) || DEFAULT_LOAD_BATCH_SIZE), missing.length);
    let completed = false;

    while (!completed) {
      const batch = missing.slice(0, batchSize);
      const refs = targetRefs(batch);
      let result;
      try {
        result = await intelligence.execute({
          course: requested.course,
          context,
          taskMode: 'instructional_load_estimation',
          instructionalLoadTargetRefs: refs,
        });
      } catch (error) {
        if (isTruncationFailure(error) && batchSize > 1) {
          batchSize = Math.max(1, Math.ceil(batchSize / 2));
          continue;
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

      if (result?.accepted !== true && isTruncationFailure(result) && batchSize > 1) {
        batchSize = Math.max(1, Math.ceil(batchSize / 2));
        continue;
      }

      const estimates = extractInstructionalLoadEstimates(result, context, refs);
      await repository.saveInstructionalLoadEstimates({
        studentId: user.id,
        estimates,
        sourceExecutionRef: extractExecutionRef(result),
      });

      const previousMissingCount = missing.length;
      context = await repository.getSchedulingContext(user.id, courseId);
      const nextMissingCount = missingInstructionalLoads(context).length;
      if (nextMissingCount >= previousMissingCount) {
        throw fail('Instructional-load preparation made no persisted progress.', 'TEACHING_D09_LOAD_ESTIMATION_NO_PROGRESS', 500);
      }
      completed = true;
    }
  }
}

module.exports = {
  PREACTIVATION_STATES,
  NO_INITIAL_INSTRUCTION,
  DEFAULT_LOAD_BATCH_SIZE,
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
