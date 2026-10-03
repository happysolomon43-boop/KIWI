'use strict';

const { authoritativeVersionDigest, gradeScaleOutcome, asArray, upper } = require('../../d21/contracts');

function install(proto) {
  proto.destinationPrerequisites = async function destinationPrerequisites(studentId, destinationLearningUnitIds, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const refs = [...new Set(asArray(destinationLearningUnitIds).map(String).filter(Boolean))];
    if (!refs.length) return [];
    const { rows = [] } = await q(runner, `
      select d.learning_unit_id,d.prerequisite_learning_unit_id,d.dependency_kind,d.rationale,
             s.knowledge_state_version_id,s.version_no,s.base_state,s.overlays,s.contradiction_state
        from public.teaching_learning_unit_dependencies d
        join public.teaching_learning_units target on target.learning_unit_id=d.learning_unit_id and target.student_id=d.student_id
        left join lateral (
          select k.* from public.teaching_student_knowledge_state_versions k
           where k.student_id=d.student_id and k.learning_unit_id=d.prerequisite_learning_unit_id
           order by k.version_no desc limit 1
        ) s on true
       where d.student_id=$1 and d.learning_unit_id=any($2::text[])
       order by d.learning_unit_id,d.prerequisite_learning_unit_id`,
    [studentId, refs]);
    return rows;
  };

  proto.semesterCourses = async function semesterCourses(studentId, semesterId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, commitGpaSnapshot, semesterRecord } = this;
    await requireSemester(studentId, semesterId, runner);
    const base = await q(runner,
      'select * from public.teaching_courses where student_id=$1 and semester_id=$2 order by created_at,course_id',
      [studentId, semesterId],
    );
    for (const c of base.rows || []) await ensureInitialAttempt(studentId, c.course_id, runner);
    const { rows = [] } = await q(runner, `
      select c.course_id,c.title,c.subject_id,c.semester_id,
             a.attempt_id,a.root_course_id,a.attempt_no,a.attempt_kind,
             pp.academic_credits,pp.progression_policy_id,pp.version_no progression_policy_version,
             po.progression_outcome_id,po.outcome progression_outcome,po.version_no progression_outcome_version,
             cr.course_result_snapshot_id,cr.score_percentage,cr.version_no result_version,cr.result_state,
             gp.grade_scale_policy
        from public.teaching_courses c
        join public.teaching_course_attempts a on a.student_id=c.student_id and a.course_id=c.course_id
        left join lateral (
          select p.* from public.teaching_progression_policies p
           where p.student_id=c.student_id and p.course_id=c.course_id and p.scope_kind='COURSE' and p.policy_state='LOCKED'
           order by p.version_no desc limit 1
        ) pp on true
        left join lateral (
          select o.* from public.teaching_progression_outcomes o
           where o.student_id=c.student_id and o.course_id=c.course_id and o.attempt_id=a.attempt_id
           order by o.version_no desc limit 1
        ) po on true
        left join lateral (
          select r.* from public.teaching_course_result_snapshots r
           where r.student_id=c.student_id and r.course_id=c.course_id order by r.version_no desc limit 1
        ) cr on true
        left join lateral (
          select g.* from public.teaching_grading_policies g
           where g.student_id=c.student_id and g.course_id=c.course_id and g.policy_state='LOCKED'
           order by g.version_no desc limit 1
        ) gp on true
       where c.student_id=$1 and c.semester_id=$2
       order by c.created_at,c.course_id`,
    [studentId, semesterId]);
    return rows;
  };

  proto.commitGpaSnapshot = async function commitGpaSnapshot({ studentId, semesterId, policyId, policyVersion, calculation, sourceStateDigest, idempotencyKey }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, semesterRecord } = this;
    return withTransaction(async (tx) => {
      const prior = await q(tx,
        'select * from public.teaching_semester_gpa_snapshots where student_id=$1 and idempotency_key=$2 limit 1',
        [studentId, idempotencyKey],
      );
      if (prior.rows?.[0]) return Object.freeze({ gpa: prior.rows[0], idempotent: true });
      const policy = await currentPolicy(studentId, null, semesterId, tx);
      if (!policy || String(policy.progression_policy_id) !== String(policyId) || Number(policy.version_no) !== Number(policyVersion)) {
        fail('Semester GPA Policy changed before GPA commit.', 'TEACHING_D21_STALE_GPA_POLICY');
      }
      const liveRows = await semesterCourses(studentId, semesterId, tx);
      const byCourse = new Map(liveRows.map((row) => [String(row.course_id), row]));
      const passOutcomes = new Set(['CLEAN_PASS','PASS_REMEDIATION_REQUIRED','PASS']);
      const liveEligibleCourseIds = [...byCourse.values()]
        .filter((row) => passOutcomes.has(String(row.progression_outcome || '').toUpperCase()))
        .map((row) => String(row.course_id))
        .sort();
      const calculatedCourseIds = (calculation.entries || []).map((entry) => String(entry.courseId)).sort();
      if (JSON.stringify(liveEligibleCourseIds) !== JSON.stringify(calculatedCourseIds)) {
        fail('Semester eligible Course set changed before GPA commit.', 'TEACHING_D21_STALE_GPA_INPUT', 409, {
          liveEligibleCourseIds,
          calculatedCourseIds,
        });
      }
      for (const entry of calculation.entries || []) {
        const live = byCourse.get(String(entry.courseId));
        if (!live
            || String(live.course_result_snapshot_id || '') !== String(entry.sourceCourseResultId || '')
            || Number(live.result_version || 0) !== Number(entry.sourceCourseResultVersion || 0)
            || String(live.progression_outcome || '') !== String(entry.progressionOutcome || '')
            || Number(live.academic_credits ?? 0) !== Number(entry.academicCredits ?? 0)) {
          fail('Semester Gradebook/progression inputs changed before GPA commit.', 'TEACHING_D21_STALE_GPA_INPUT', 409, { courseId: entry.courseId });
        }
      }
      const duplicate = await q(tx,
        'select * from public.teaching_semester_gpa_snapshots where student_id=$1 and semester_id=$2 and source_state_digest=$3 limit 1',
        [studentId, semesterId, sourceStateDigest],
      );
      if (duplicate.rows?.[0]) return Object.freeze({ gpa: duplicate.rows[0], idempotent: true });
      const last = await q(tx,
        'select * from public.teaching_semester_gpa_snapshots where student_id=$1 and semester_id=$2 order by version_no desc limit 1 for update',
        [studentId, semesterId],
      );
      const previous = last.rows?.[0] || null;
      const version = Number(previous?.version_no || 0) + 1;
      const { rows } = await q(tx, `insert into public.teaching_semester_gpa_snapshots(
        semester_gpa_snapshot_id,student_id,semester_id,progression_policy_id,progression_policy_version,version_no,
        gpa_value,numerator,denominator,weighting_mode,calculation_entries,source_state_digest,
        supersedes_gpa_snapshot_id,idempotency_key
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) returning *`,
      [randomUUID(), studentId, semesterId, policyId, Number(policyVersion), version, calculation.gpa,
        calculation.numerator, calculation.denominator, calculation.weightingMode, json(calculation.entries || []), sourceStateDigest,
        previous?.semester_gpa_snapshot_id || null, idempotencyKey]);
      return Object.freeze({ gpa: rows[0], previous, idempotent: false });
    });
  };

  proto.semesterRecord = async function semesterRecord(studentId, semesterId) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot } = this;
    const semester = await requireSemester(studentId, semesterId);
    const courses = await semesterCourses(studentId, semesterId);
    const { rows: gpas = [] } = await query(
      'select * from public.teaching_semester_gpa_snapshots where student_id=$1 and semester_id=$2 order by version_no desc limit 1',
      [studentId, semesterId],
    );
    const activePaths = await query(`select distinct on(course_id) course_id,pathway_id,pathway_type,pathway_state
      from public.teaching_progression_pathways
      where student_id=$1 and course_id in (select course_id from public.teaching_courses where student_id=$1 and semester_id=$2)
      order by course_id,created_at desc`,
    [studentId, semesterId]);
    const pathByCourse = new Map((activePaths.rows || []).map((row) => [String(row.course_id), row]));
    const projected = courses.map((row) => {
      const scale = row.score_percentage == null ? null : gradeScaleOutcome(Number(row.score_percentage), row.grade_scale_policy || {});
      const path = pathByCourse.get(String(row.course_id)) || null;
      return Object.freeze({
        course_id: row.course_id,
        title: row.title,
        attempt_id: row.attempt_id,
        root_course_id: row.root_course_id,
        attempt_no: Number(row.attempt_no || 1),
        attempt_kind: row.attempt_kind,
        score_percentage: row.score_percentage == null ? null : Number(row.score_percentage),
        grade: scale?.grade || null,
        grade_point: scale?.gradePoint ?? null,
        academic_credits: row.academic_credits == null ? null : Number(row.academic_credits),
        progression_outcome: row.progression_outcome || null,
        pathway_type: path?.pathway_type || null,
        pathway_state: path?.pathway_state || null,
        source_course_result_id: row.course_result_snapshot_id || null,
        source_course_result_version: Number(row.result_version || 0),
      });
    });
    return Object.freeze({
      semester: Object.freeze({ semester_id: semester.semester_id, name: semester.name, starts_at: semester.starts_at, ends_at: semester.ends_at, timezone: semester.timezone }),
      semesterId,
      courses: Object.freeze(projected),
      gpa: gpas[0] || null,
      authority: Object.freeze({ grades: 'D20', progression: 'D21', gpa: 'D21_DERIVED_FROM_D20' }),
    });
  };
}

module.exports = { install };
