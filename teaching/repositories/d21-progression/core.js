'use strict';

const { authoritativeVersionDigest, gradeScaleOutcome, asArray, upper } = require('../../d21/contracts');

function install(proto) {
  proto.assertReady = async function assertReady() {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const names = [
      'teaching_course_attempts',
      'teaching_progression_policies',
      'teaching_progression_outcomes',
      'teaching_progression_pathways',
      'teaching_progression_pathway_steps',
      'teaching_semester_gpa_snapshots',
    ];
    const { rows = [] } = await query(
      `select table_name from information_schema.tables
        where table_schema='public' and table_name=any($1::text[])`,
      [names],
    );
    if (rows.length !== names.length) {
      fail('D21 progression persistence is not installed.', 'TEACHING_D21_SCHEMA_NOT_READY', 503, {
        expected: names,
        found: rows.map((row) => row.table_name),
      });
    }
    const prep = await query(`select
      to_regclass('teaching_preparation.workspaces') workspaces,
      to_regclass('teaching_preparation.authoritative_input_bundles') bundles,
      to_regclass('teaching_preparation.input_bundle_dependencies') dependencies,
      to_regclass('teaching_preparation.artifact_versions') artifacts,
      to_regclass('teaching_preparation.artifact_components') components,
      to_regclass('teaching_preparation.component_dependencies') component_dependencies,
      to_regclass('teaching_protected.prepared_artifact_payloads') protected_payloads`);
    if (Object.values(prep.rows?.[0] || {}).some((value) => value == null)) {
      fail('D21 requires the accepted PPL persistence baseline.', 'TEACHING_D21_PPL_SCHEMA_NOT_READY', 503);
    }
    return true;
  };

  proto.course = async function course(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const { rows } = await q(runner,
      'select * from public.teaching_courses where student_id=$1 and course_id=$2 limit 1',
      [studentId, courseId],
    );
    return rows?.[0] || null;
  };

  proto.requireCourse = async function requireCourse(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const row = await course(studentId, courseId, runner);
    if (!row) fail('Teaching Course not found.', 'TEACHING_D21_COURSE_NOT_FOUND', 404, { courseId });
    return row;
  };

  proto.requireSemester = async function requireSemester(studentId, semesterId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const { rows } = await q(runner,
      'select * from public.teaching_semesters where student_id=$1 and semester_id=$2 limit 1',
      [studentId, semesterId],
    );
    if (!rows?.[0]) fail('Teaching Semester not found.', 'TEACHING_D21_SEMESTER_NOT_FOUND', 404, { semesterId });
    return rows[0];
  };

  proto.attemptForCourse = async function attemptForCourse(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const { rows } = await q(runner,
      'select * from public.teaching_course_attempts where student_id=$1 and course_id=$2 order by attempt_no desc limit 1',
      [studentId, courseId],
    );
    return rows?.[0] || null;
  };

  proto.ensureInitialAttempt = async function ensureInitialAttempt(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const existing = await attemptForCourse(studentId, courseId, runner);
    if (existing) return existing;
    const c = await requireCourse(studentId, courseId, runner);
    const attemptId = randomUUID();
    const { rows } = await q(runner, `
      insert into public.teaching_course_attempts(
        attempt_id,student_id,course_id,root_course_id,attempt_no,attempt_kind,
        source_course_id,source_attempt_id,source_progression_outcome_id,
        prior_pedagogical_history_ref,idempotency_key
      ) values($1,$2,$3,$3,1,'INITIAL',null,null,null,'{}'::jsonb,$4)
      on conflict(student_id,course_id) do nothing
      returning *`,
    [attemptId, studentId, c.course_id, `d21-initial-attempt:${c.course_id}`]);
    if (rows?.[0]) return rows[0];
    return attemptForCourse(studentId, courseId, runner);
  };

  proto.currentPolicy = async function currentPolicy(studentId, courseId = null, semesterId = null, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    if ((courseId == null) === (semesterId == null)) {
      fail('Exactly one progression policy scope is required.', 'TEACHING_D21_POLICY_SCOPE_INVALID', 400);
    }
    const scope = courseId != null ? 'COURSE' : 'SEMESTER';
    const id = courseId != null ? courseId : semesterId;
    const column = courseId != null ? 'course_id' : 'semester_id';
    const { rows } = await q(runner, `
      select * from public.teaching_progression_policies
       where student_id=$1 and scope_kind=$2 and ${column}=$3 and policy_state='LOCKED'
       order by version_no desc limit 1`,
    [studentId, scope, id]);
    return rows?.[0] || null;
  };

  proto.policyComparable = function policyComparable(row) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    return {
      academic_credits: row?.academic_credits == null ? null : Number(row.academic_credits),
      certification_rules: row?.certification_rules || {},
      pathway_rules: row?.pathway_rules || {},
      resit_policy: row?.resit_policy || {},
      repeat_policy: row?.repeat_policy || {},
      gpa_policy: row?.gpa_policy || {},
      source_policy_refs: row?.source_policy_refs || [],
    };
  };

  proto.lockPolicy = async function lockPolicy({ studentId, courseId = null, semesterId = null, policy, idempotencyKey }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    return withTransaction(async (tx) => {
      if ((courseId == null) === (semesterId == null)) {
        fail('Exactly one progression policy scope is required.', 'TEACHING_D21_POLICY_SCOPE_INVALID', 400);
      }
      if (courseId != null) await requireCourse(studentId, courseId, tx);
      else await requireSemester(studentId, semesterId, tx);

      const priorIdem = await q(tx,
        'select * from public.teaching_progression_policies where student_id=$1 and idempotency_key=$2 limit 1',
        [studentId, idempotencyKey],
      );
      if (priorIdem.rows?.[0]) return Object.freeze({ policy: priorIdem.rows[0], idempotent: true });

      const existing = await currentPolicy(studentId, courseId, semesterId, tx);
      if (existing) {
        const requested = policyComparable(policy);
        const locked = policyComparable(existing);
        if (sha(requested) === sha(locked)) return Object.freeze({ policy: existing, idempotent: true });
        fail('This progression/GPA policy is already locked; changes require an explicit versioned policy-change path.', 'TEACHING_D21_POLICY_ALREADY_LOCKED', 409, {
          progressionPolicyId: existing.progression_policy_id,
          version: existing.version_no,
        });
      }

      const scope = courseId != null ? 'COURSE' : 'SEMESTER';
      const scopeId = courseId != null ? courseId : semesterId;
      const { rows } = await q(tx, `
        insert into public.teaching_progression_policies(
          progression_policy_id,student_id,scope_kind,course_id,semester_id,version_no,policy_state,
          academic_credits,certification_rules,pathway_rules,resit_policy,repeat_policy,gpa_policy,
          source_policy_refs,locked_at,idempotency_key
        ) values($1,$2,$3,$4,$5,1,'LOCKED',$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)
        returning *`,
      [
        randomUUID(), studentId, scope, courseId, semesterId,
        policy.academic_credits ?? null,
        json(policy.certification_rules || {}), json(policy.pathway_rules || {}),
        json(policy.resit_policy || {}), json(policy.repeat_policy || {}), json(policy.gpa_policy || {}),
        json(policy.source_policy_refs || []), clock(), idempotencyKey,
      ]);
      return Object.freeze({ policy: rows[0], idempotent: false, scope: scopeId });
    });

  };
}

module.exports = { install };
