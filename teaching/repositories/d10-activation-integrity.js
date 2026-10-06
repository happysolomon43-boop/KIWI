'use strict';

const { createD10LifecycleRequestRepository: createBaseD10LifecycleRequestRepository } = require('./d10-lifecycle-requests');

function activationIntegrityBlockers(integrity = {}) {
  const blockers = [];
  if (Number(integrity.instructionalUnitCount) > 0 && Number(integrity.estimatedInstructionalMinutes) <= 0) {
    blockers.push('INSTRUCTIONAL_LOAD_ESTIMATION_REQUIRED');
  }
  if (Number(integrity.instructionalUnitCount) > 0 && Number(integrity.classSlotCount) <= 0) {
    blockers.push('TIMETABLE_REQUIRES_INSTRUCTIONAL_CLASSES');
  }
  if (Number(integrity.classSlotCount) > 0 && Number(integrity.futureClassSlotCount) <= 0) {
    blockers.push('TIMETABLE_REQUIRES_FUTURE_CLASS');
  }
  if (Number(integrity.elapsedSlotCount) > 0) {
    blockers.push('TIMETABLE_ELAPSED_REPLAN_REQUIRED');
  }
  if (Number(integrity.reserveBeforeFirstClassCount) > 0) {
    blockers.push('TIMETABLE_RESERVE_BEFORE_FIRST_CLASS');
  }
  return Object.freeze(blockers);
}

function createD10LifecycleRequestRepository(options = {}) {
  const base = createBaseD10LifecycleRequestRepository(options);
  const { query, withTransaction, clock = () => new Date() } = options;
  if (typeof query !== 'function' || typeof withTransaction !== 'function') {
    throw new TypeError('D10 activation-integrity wrapper requires query and withTransaction.');
  }
  const q = (runner, sql, params = []) => runner
    ? (typeof runner === 'function' ? runner(sql, params) : runner.query(sql, params))
    : query(sql, params);
  const now = () => { const value = clock(); return value instanceof Date ? value : new Date(value); };

  function blocked(message, blockers, integrity = null) {
    const error = new Error(message);
    error.code = 'TEACHING_D10_ACTIVATION_BLOCKED';
    error.status = 409;
    error.details = { blockers: [...new Set(blockers)], ...(integrity ? { timetableIntegrity: integrity } : {}) };
    return error;
  }

  async function timetableIntegrityUsing(runner, { studentId, coursePlanId, timetableVersionId } = {}) {
    if (!coursePlanId || !timetableVersionId) return Object.freeze({
      instructionalUnitCount: 0,
      estimatedInstructionalMinutes: 0,
      totalSlotCount: 0,
      classSlotCount: 0,
      futureClassSlotCount: 0,
      elapsedSlotCount: 0,
      reserveBeforeFirstClassCount: 0,
      earliestClassStartAt: null,
      blockers: Object.freeze([]),
    });
    const at = now().toISOString();
    const [{ rows: unitRows = [] }, { rows: slotRows = [] }] = await Promise.all([
      q(runner, `
        select
          count(*) filter (where coalesce(metadata->>'instructional_treatment','FULL_INSTRUCTION') <> 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION')::int instructional_unit_count,
          coalesce(sum(coalesce(instructional_load_max_minutes,0)) filter (where coalesce(metadata->>'instructional_treatment','FULL_INSTRUCTION') <> 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION'),0)::int estimated_instructional_minutes
        from public.teaching_learning_units
        where student_id=$1 and course_plan_id=$2
      `, [studentId, coursePlanId]),
      q(runner, `
        select
          count(*)::int total_slot_count,
          count(*) filter (where slot_kind='CLASS')::int class_slot_count,
          count(*) filter (where slot_kind='CLASS' and ends_at>$3)::int future_class_slot_count,
          count(*) filter (where ends_at<=$3)::int elapsed_slot_count,
          min(starts_at) filter (where slot_kind='CLASS') earliest_class_start_at,
          count(*) filter (
            where slot_kind in ('ASSESSMENT_RESERVE','REVISION_RESERVE')
              and starts_at < (
                select min(s2.starts_at)
                from public.teaching_timetable_slots s2
                where s2.student_id=$1
                  and s2.timetable_version_id=$2
                  and s2.slot_kind='CLASS'
              )
          )::int reserve_before_first_class_count
        from public.teaching_timetable_slots
        where student_id=$1 and timetable_version_id=$2
      `, [studentId, timetableVersionId, at]),
    ]);
    const unit = unitRows[0] || {};
    const slot = slotRows[0] || {};
    const integrity = {
      instructionalUnitCount: Number(unit.instructional_unit_count) || 0,
      estimatedInstructionalMinutes: Number(unit.estimated_instructional_minutes) || 0,
      totalSlotCount: Number(slot.total_slot_count) || 0,
      classSlotCount: Number(slot.class_slot_count) || 0,
      futureClassSlotCount: Number(slot.future_class_slot_count) || 0,
      elapsedSlotCount: Number(slot.elapsed_slot_count) || 0,
      reserveBeforeFirstClassCount: Number(slot.reserve_before_first_class_count) || 0,
      earliestClassStartAt: slot.earliest_class_start_at || null,
      serverNow: at,
    };
    return Object.freeze({ ...integrity, blockers: activationIntegrityBlockers(integrity) });
  }

  async function getActivationFacts(studentId, courseId) {
    const facts = await base.getActivationFacts(studentId, courseId);
    const integrity = facts.plan && facts.timetable
      ? await timetableIntegrityUsing(null, {
          studentId,
          coursePlanId: facts.plan.course_plan_id,
          timetableVersionId: facts.timetable.timetable_version_id,
        })
      : null;
    const blockers = [...(facts.blockers || []), ...(integrity?.blockers || [])];
    return Object.freeze({ ...facts, timetableIntegrity: integrity, blockers: Object.freeze([...new Set(blockers)]) });
  }

  async function assertActivationTimetableUsing(tx, input = {}) {
    const expected = input.expected || {};
    if (!expected.planId || !expected.timetableVersionId) return null;
    const integrity = await timetableIntegrityUsing(tx, {
      studentId: input.studentId,
      coursePlanId: expected.planId,
      timetableVersionId: expected.timetableVersionId,
    });
    if (integrity.blockers.length) {
      throw blocked('Course cannot activate with an invalid timetable. Recalculate the timetable before starting the Course.', integrity.blockers, integrity);
    }
    return integrity;
  }

  async function activateCourseUsing(tx, input = {}) {
    await assertActivationTimetableUsing(tx, input);
    const prepareScheduleUsing = input.prepareScheduleUsing || input.activateScheduleUsing;
    const materializeScheduleUsing = input.materializeScheduleUsing;
    const activated = await base.activateCourseUsing(tx, {
      ...input,
      activateScheduleUsing: prepareScheduleUsing,
    });

    // The production teaching_classes.activation_id FK is immediate and
    // non-deferrable. The base D10 transaction inserts the activation parent
    // before returning here, so Class materialization must happen at this
    // boundary rather than inside the pre-activation Scheduler callback.
    if (typeof materializeScheduleUsing !== 'function') return activated;
    const classes = await materializeScheduleUsing(
      tx,
      activated.facts,
      activated.activationId,
      activated.schedule
    );
    return Object.freeze({
      ...activated,
      schedule: Object.freeze({
        ...activated.schedule,
        classes: Object.freeze([...(classes || [])]),
      }),
    });
  }
  async function activateCourse(input = {}) { return withTransaction((tx) => activateCourseUsing(tx, input)); }

  return Object.freeze({ ...base, timetableIntegrityUsing, getActivationFacts, activateCourseUsing, activateCourse });
}

module.exports = { activationIntegrityBlockers, createD10LifecycleRequestRepository };
