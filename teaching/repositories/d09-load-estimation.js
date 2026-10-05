'use strict';

const { createD09SchedulingRepository: createBaseD09SchedulingRepository } = require('./d09-scheduling');

function fail(message, code, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function createD09SchedulingRepository(options = {}) {
  const base = createBaseD09SchedulingRepository(options);
  const { query, withTransaction, randomUUID, clock = () => new Date() } = options;
  if (typeof query !== 'function' || typeof withTransaction !== 'function' || typeof randomUUID !== 'function') {
    throw new TypeError('D09 load-estimation persistence requires query, withTransaction and randomUUID.');
  }
  const q = (runner, sql, params = []) => runner
    ? (typeof runner === 'function' ? runner(sql, params) : runner.query(sql, params))
    : query(sql, params);
  const at = () => { const value = clock(); return value instanceof Date ? value : new Date(value); };

  async function saveInstructionalLoadEstimatesUsing(runner, { studentId, estimates = [], sourceExecutionRef = null } = {}) {
    if (!Array.isArray(estimates) || !estimates.length) return Object.freeze([]);
    const saved = [];
    for (const estimate of estimates) {
      const courseId = String(estimate?.courseId || '').trim();
      const coursePlanId = String(estimate?.coursePlanId || '').trim();
      const coursePlanVersion = Number(estimate?.coursePlanVersion);
      const learningUnitId = String(estimate?.learningUnitId || '').trim();
      const minMinutes = Math.ceil(Number(estimate?.minMinutes));
      const maxMinutes = Math.ceil(Number(estimate?.maxMinutes));
      if (!courseId || !coursePlanId || !Number.isInteger(coursePlanVersion) || coursePlanVersion < 1 || !learningUnitId || !Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes) || minMinutes <= 0 || maxMinutes < minMinutes) {
        throw fail('Instructional-load estimate is malformed.', 'TEACHING_D09_LOAD_ESTIMATE_INVALID', 422);
      }
      const { rows: currentRows = [] } = await q(runner, `
        select u.*, p.version_no plan_version, p.course_id
          from public.teaching_learning_units u
          join public.teaching_course_plans p on p.course_plan_id=u.course_plan_id and p.student_id=u.student_id
         where u.student_id=$1 and u.course_plan_id=$2 and u.learning_unit_id=$3
           and p.course_id=$4 and p.version_no=$5
           and p.version_no=(
             select max(p2.version_no) from public.teaching_course_plans p2
              where p2.student_id=p.student_id and p2.course_id=p.course_id
           )
         for update
      `, [studentId, coursePlanId, learningUnitId, courseId, coursePlanVersion]);
      const current = currentRows[0];
      if (!current) throw fail('Instructional-load target is stale for the current Course Plan.', 'TEACHING_D09_LOAD_TARGET_STALE', 409);
      if (String(current.metadata?.instructional_treatment || 'FULL_INSTRUCTION') === 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION') {
        throw fail('Validated prior-knowledge units cannot receive initial instructional load.', 'TEACHING_D09_LOAD_TARGET_VPK_INVALID', 409);
      }
      if ((Number(current.instructional_load_max_minutes) || 0) > 0) {
        saved.push(current);
        continue;
      }
      const provenance = {
        owner: 'scheduler',
        capability_id: 'teaching.scheduling.instructional_load_estimation',
        prompt_family_id: 'TPF-10',
        prompt_family_version: '1.1',
        source_execution_ref: sourceExecutionRef,
        estimate_basis: Array.isArray(estimate.estimateBasis) ? estimate.estimateBasis : [],
        uncertainty: estimate.uncertainty || null,
        estimated_at: at().toISOString(),
        calendar_fit_not_authoritative: true,
      };
      const { rows = [] } = await q(runner, `
        update public.teaching_learning_units
           set instructional_load_min_minutes=$4,
               instructional_load_max_minutes=$5,
               metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('instructional_load_estimation',$6::jsonb)
         where student_id=$1 and course_plan_id=$2 and learning_unit_id=$3
         returning *
      `, [studentId, coursePlanId, learningUnitId, minMinutes, maxMinutes, JSON.stringify(provenance)]);
      const row = rows[0];
      if (!row) throw fail('Instructional-load target changed before persistence.', 'TEACHING_D09_LOAD_TARGET_STALE', 409);
      saved.push(row);
      await q(runner, `
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,authoritative_owner,
          state_version_ref,reason,before_ref,after_ref,provenance_refs,safe_metadata
        ) values($1,$2,$3,'SYSTEM',null,'scheduler.instructional_load.estimate','LEARNING_UNIT',$4,'scheduler',
          $5,'TPF-10 validated instructional-load estimate',$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb)
      `, [
        randomUUID(), studentId, at(), learningUnitId, String(current.plan_version),
        JSON.stringify({ min_minutes: current.instructional_load_min_minutes, max_minutes: current.instructional_load_max_minutes }),
        JSON.stringify({ min_minutes: minMinutes, max_minutes: maxMinutes }),
        JSON.stringify(sourceExecutionRef ? [String(sourceExecutionRef)] : []),
        JSON.stringify({ course_id: current.course_id, course_plan_id: coursePlanId, uncertainty: provenance.uncertainty }),
      ]);
    }
    return Object.freeze(saved);
  }

  async function saveInstructionalLoadEstimates(input = {}) {
    return withTransaction((tx) => saveInstructionalLoadEstimatesUsing(tx, input));
  }

  async function getCourseActivationUsing(runner, studentId, courseId) {
    const { rows = [] } = await q(runner, `
      select * from public.teaching_course_activations
       where student_id=$1 and course_id=$2
       order by activated_at desc, created_at desc
       limit 1
    `, [studentId, courseId]);
    return rows[0] || null;
  }
  async function getCourseActivation(studentId, courseId) { return getCourseActivationUsing(null, studentId, courseId); }

  return Object.freeze({ ...base, saveInstructionalLoadEstimates, saveInstructionalLoadEstimatesUsing, getCourseActivation, getCourseActivationUsing });
}

module.exports = { createD09SchedulingRepository };
