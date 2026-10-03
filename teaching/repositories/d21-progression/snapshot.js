'use strict';

const { authoritativeVersionDigest, gradeScaleOutcome, asArray, upper } = require('../../d21/contracts');

function install(proto) {
  proto.latestPlanBundle = async function latestPlanBundle(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const plans = await q(runner,
      'select * from public.teaching_course_plans where student_id=$1 and course_id=$2 order by version_no desc limit 1',
      [studentId, courseId],
    );
    const plan = plans.rows?.[0] || null;
    if (!plan) return { plan: null, learningUnits: [], coverage: [] };
    const [units, coverage] = await Promise.all([
      q(runner, 'select * from public.teaching_learning_units where student_id=$1 and course_plan_id=$2 order by created_at,learning_unit_id', [studentId, plan.course_plan_id]),
      q(runner, 'select * from public.teaching_course_coverage where student_id=$1 and course_plan_id=$2 order by coverage_entry_id', [studentId, plan.course_plan_id]),
    ]);
    return { plan, learningUnits: units.rows || [], coverage: coverage.rows || [] };
  };

  proto.latestCourseResult = async function latestCourseResult(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const { rows } = await q(runner,
      'select * from public.teaching_course_result_snapshots where student_id=$1 and course_id=$2 order by version_no desc limit 1',
      [studentId, courseId],
    );
    return rows?.[0] || null;
  };

  proto.latestTopicScores = async function latestTopicScores(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const { rows = [] } = await q(runner, `
      select distinct on(topic_id) *
        from public.teaching_topic_score_snapshots
       where student_id=$1 and course_id=$2
       order by topic_id,version_no desc`,
    [studentId, courseId]);
    return rows;
  };

  proto.latestKnowledgeForUnits = async function latestKnowledgeForUnits(studentId, learningUnitRefs, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const refs = [...new Set(asArray(learningUnitRefs).map(String).filter(Boolean))];
    if (!refs.length) return [];
    const { rows = [] } = await q(runner, `
      select distinct on(learning_unit_id) *
        from public.teaching_student_knowledge_state_versions
       where student_id=$1 and learning_unit_id=any($2::text[])
       order by learning_unit_id,version_no desc`,
    [studentId, refs]);
    return rows;
  };

  proto.unresolvedAssignmentIntegrity = async function unresolvedAssignmentIntegrity(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const { rows = [] } = await q(runner, `
      with latest as (
        select distinct on(r.submission_id)
               r.integrity_review_id,r.submission_id,r.assignment_id,r.review_version,
               r.rule_alignment,r.capability_evidence,r.verification_state,r.authoritative_outcome
          from public.teaching_assignment_integrity_reviews r
          join public.teaching_assignments a on a.assignment_id=r.assignment_id and a.student_id=r.student_id
         where r.student_id=$1 and a.course_id=$2
         order by r.submission_id,r.review_version desc
      )
      select * from latest
       where verification_state in ('REQUIRED','PENDING','REVIEW_NEEDED')
          or rule_alignment='UNRESOLVED'
          or capability_evidence='UNRESOLVED'`,
    [studentId, courseId]);
    return rows;
  };

  proto.loadProgressionSnapshot = async function loadProgressionSnapshot(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const c = await requireCourse(studentId, courseId, runner);
    const attempt = await ensureInitialAttempt(studentId, courseId, runner);
    const plan = await latestPlanBundle(studentId, courseId, runner);
    const unitRefs = plan.learningUnits.map((row) => String(row.learning_unit_id));
    const [progressionPolicy, courseResult, topicScores, assessments, assessmentResults, openAppeals, invalidAttempts, knowledgeStates, integrity] = await Promise.all([
      currentPolicy(studentId, courseId, null, runner),
      latestCourseResult(studentId, courseId, runner),
      latestTopicScores(studentId, courseId, runner),
      q(runner, 'select * from public.teaching_assessments where student_id=$1 and course_id=$2 order by created_at,assessment_id', [studentId, courseId]).then((r) => r.rows || []),
      q(runner, 'select * from public.teaching_assessment_results where student_id=$1 and course_id=$2 order by created_at,assessment_result_id', [studentId, courseId]).then((r) => r.rows || []),
      q(runner, `select ga.* from public.teaching_grade_appeals ga
                   join public.teaching_assessment_results ar on ar.assessment_result_id=ga.assessment_result_id and ar.student_id=ga.student_id
                  where ga.student_id=$1 and ar.course_id=$2 and ga.appeal_state<>'RESOLVED'
                  order by ga.submitted_at`, [studentId, courseId]).then((r) => r.rows || []),
      q(runner, `select at.* from public.teaching_assessment_attempts at
                   join public.teaching_assessments a on a.assessment_id=at.assessment_id and a.student_id=at.student_id
                  where at.student_id=$1 and a.course_id=$2
                    and (at.attempt_state='INVALIDATED' or at.result_state in ('INVALIDATED','VOID') or at.invalidation_reason is not null)
                  order by at.created_at`, [studentId, courseId]).then((r) => r.rows || []),
      latestKnowledgeForUnits(studentId, unitRefs, runner),
      unresolvedAssignmentIntegrity(studentId, courseId, runner),
    ]);
    return Object.freeze({
      course: c,
      attempt,
      coursePlan: plan.plan,
      learningUnits: Object.freeze(plan.learningUnits),
      coverage: Object.freeze(plan.coverage),
      progressionPolicy,
      courseResult,
      topicScores: Object.freeze(topicScores),
      assessments: Object.freeze(assessments),
      assessmentResults: Object.freeze(assessmentResults),
      openAppeals: Object.freeze(openAppeals),
      invalidAssessmentAttempts: Object.freeze(invalidAttempts),
      knowledgeStates: Object.freeze(knowledgeStates),
      unresolvedIntegrityIssues: Object.freeze(integrity),
    });
  };

  proto.stateDigest = function stateDigest(snapshot) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    return sha(authoritativeVersionDigest(snapshot));
  };

  proto.progressionHistory = async function progressionHistory(studentId, courseId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const [outcomes, pathways, resits] = await Promise.all([
      q(runner, 'select * from public.teaching_progression_outcomes where student_id=$1 and course_id=$2 order by version_no,created_at', [studentId, courseId]),
      q(runner, 'select * from public.teaching_progression_pathways where student_id=$1 and course_id=$2 order by created_at,pathway_id', [studentId, courseId]),
      q(runner, `select count(*)::int used
                   from public.teaching_assessment_attempts at
                   join public.teaching_assessments a on a.assessment_id=at.assessment_id and a.student_id=at.student_id
                  where at.student_id=$1 and a.course_id=$2 and upper(a.assessment_type)='RESIT'
                    and at.attempt_state in ('ACTIVE','SUBMITTED','EXPIRED','INVALIDATED')`, [studentId, courseId]),
    ]);
    const pathwayRows = pathways.rows || [];
    return {
      outcomes: outcomes.rows || [],
      pathways: pathwayRows,
      standardResitAttemptsUsed: Number(resits.rows?.[0]?.used || 0),
      reasonableRecoveryFailed: pathwayRows.some((row) => row.pathway_type === 'RECOVERY' && row.pathway_state === 'FAILED'),
    };
  };

  proto.commitOutcome = async function commitOutcome({
    studentId, courseId, attemptId, policyId, policyVersion,
    sourceCourseResultId = null, sourceCourseResultVersion = 0, sourceGradebookEntryIds = [],
    sourceStateDigest, outcome, certification, weakness, reasonCodes = [], idempotencyKey,
  }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    return withTransaction(async (tx) => {
      const priorIdem = await q(tx,
        'select * from public.teaching_progression_outcomes where student_id=$1 and idempotency_key=$2 limit 1',
        [studentId, idempotencyKey],
      );
      if (priorIdem.rows?.[0]) return Object.freeze({ outcome: priorIdem.rows[0], idempotent: true });
      const priorDigest = await q(tx,
        'select * from public.teaching_progression_outcomes where student_id=$1 and attempt_id=$2 and source_state_digest=$3 limit 1',
        [studentId, attemptId, sourceStateDigest],
      );
      if (priorDigest.rows?.[0]) return Object.freeze({ outcome: priorDigest.rows[0], idempotent: true });

      const live = await loadProgressionSnapshot(studentId, courseId, tx);
      if (String(live.attempt?.attempt_id) !== String(attemptId)) {
        fail('Course Attempt changed before progression commit.', 'TEACHING_D21_STALE_COURSE_ATTEMPT');
      }
      if (String(live.progressionPolicy?.progression_policy_id || '') !== String(policyId)
          || Number(live.progressionPolicy?.version_no || 0) !== Number(policyVersion)) {
        fail('Progression Policy changed before outcome commit.', 'TEACHING_D21_STALE_POLICY');
      }
      if (stateDigest(live) !== String(sourceStateDigest)) {
        fail('Authoritative Course/Gradebook/SKM state changed before progression commit.', 'TEACHING_D21_STALE_PROGRESSION_INPUT');
      }
      if (sourceCourseResultId != null) {
        if (String(live.courseResult?.course_result_snapshot_id || '') !== String(sourceCourseResultId)
            || Number(live.courseResult?.version_no || 0) !== Number(sourceCourseResultVersion)) {
          fail('D20 Course Result changed before progression commit.', 'TEACHING_D21_STALE_GRADEBOOK_RESULT');
        }
      }

      const last = await q(tx,
        'select * from public.teaching_progression_outcomes where student_id=$1 and attempt_id=$2 order by version_no desc limit 1 for update',
        [studentId, attemptId],
      );
      const previous = last.rows?.[0] || null;
      const version = Number(previous?.version_no || 0) + 1;
      const { rows } = await q(tx, `
        insert into public.teaching_progression_outcomes(
          progression_outcome_id,student_id,course_id,attempt_id,progression_policy_id,progression_policy_version,
          version_no,source_course_result_id,source_course_result_version,source_gradebook_entry_ids,source_state_digest,
          outcome,certification_snapshot,weakness_snapshot,reason_codes,supersedes_outcome_id,idempotency_key
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17)
        returning *`,
      [
        randomUUID(), studentId, courseId, attemptId, policyId, Number(policyVersion), version,
        sourceCourseResultId, Number(sourceCourseResultVersion || 0), json(sourceGradebookEntryIds || []),
        sourceStateDigest, outcome, json(certification || {}), json(weakness || {}), json(reasonCodes || []),
        previous?.progression_outcome_id || null, idempotencyKey,
      ]);
      return Object.freeze({ outcome: rows[0], previous, idempotent: false });
    });

  };
}

module.exports = { install };
