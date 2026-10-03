'use strict';

const { authoritativeVersionDigest, gradeScaleOutcome, asArray, upper } = require('../../d21/contracts');

function install(proto) {
  proto.pathway = async function pathway(studentId, pathwayId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const { rows } = await q(runner,
      'select * from public.teaching_progression_pathways where student_id=$1 and pathway_id=$2 limit 1',
      [studentId, pathwayId],
    );
    return rows?.[0] || null;
  };

  proto.createPathway = async function createPathway({
    studentId, courseId, attemptId, progressionOutcomeId, type, state,
    learningUnitRefs = [], taskRefs = [], verificationCondition = {}, planPayload = {},
    sourceStateVersions = {}, idempotencyKey,
  }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    return withTransaction(async (tx) => {
      const prior = await q(tx,
        'select * from public.teaching_progression_pathways where student_id=$1 and idempotency_key=$2 limit 1',
        [studentId, idempotencyKey],
      );
      if (prior.rows?.[0]) return prior.rows[0];
      const latest = await q(tx,
        'select * from public.teaching_progression_outcomes where student_id=$1 and course_id=$2 order by version_no desc limit 1 for update',
        [studentId, courseId],
      );
      if (!latest.rows?.[0] || String(latest.rows[0].progression_outcome_id) !== String(progressionOutcomeId)) {
        fail('Progression outcome changed before pathway creation.', 'TEACHING_D21_STALE_PATHWAY_OUTCOME');
      }
      if (String(latest.rows[0].attempt_id) !== String(attemptId)) {
        fail('Course Attempt changed before pathway creation.', 'TEACHING_D21_STALE_COURSE_ATTEMPT');
      }
      const duplicate = await q(tx,
        'select * from public.teaching_progression_pathways where student_id=$1 and progression_outcome_id=$2 and pathway_type=$3 order by created_at desc limit 1',
        [studentId, progressionOutcomeId, type],
      );
      if (duplicate.rows?.[0]) return duplicate.rows[0];

      const units = [...new Set(asArray(learningUnitRefs).map(String).filter(Boolean))];
      const explicitTasks = [...new Set(asArray(taskRefs).map(String).filter(Boolean))];
      const effectiveTasks = explicitTasks.length || type === 'REPEAT' ? explicitTasks : [...units];
      const pathwayId = randomUUID();
      const { rows } = await q(tx, `
        insert into public.teaching_progression_pathways(
          pathway_id,student_id,course_id,attempt_id,progression_outcome_id,pathway_type,pathway_state,state_version,
          required_learning_unit_refs,required_task_refs,verification_condition,verification_ref,plan_payload,
          source_state_versions,idempotency_key
        ) values($1,$2,$3,$4,$5,$6,$7,1,$8::jsonb,$9::jsonb,$10::jsonb,null,$11::jsonb,$12::jsonb,$13)
        returning *`,
      [
        pathwayId, studentId, courseId, attemptId, progressionOutcomeId, type, state,
        json(units), json(effectiveTasks), json(verificationCondition || {}), json(planPayload || {}),
        json(sourceStateVersions || {}), idempotencyKey,
      ]);
      for (const ref of effectiveTasks) {
        await q(tx, `insert into public.teaching_progression_pathway_steps(
            pathway_step_id,student_id,pathway_id,step_kind,reference_id,step_state,state_version,payload,idempotency_key
          ) values($1,$2,$3,'LEARNING_UNIT_REPAIR',$4,'REQUIRED',1,$5::jsonb,$6)
          on conflict(student_id,idempotency_key) do nothing`,
        [randomUUID(), studentId, pathwayId, ref, json({ learning_unit_id: ref, evidence_backed_completion: true }), `d21-pathway-step:${pathwayId}:repair:${ref}`]);
      }
      return rows[0];
    });
  };

  proto.pathwaySteps = async function pathwaySteps(studentId, pathwayId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const p = await pathway(studentId, pathwayId, runner);
    if (!p) return [];
    const { rows = [] } = await q(runner,
      'select * from public.teaching_progression_pathway_steps where student_id=$1 and pathway_id=$2 order by created_at,pathway_step_id',
      [studentId, pathwayId],
    );
    const baseline = p.source_state_versions?.skm_versions || {};
    const refs = rows.filter((row) => row.step_kind === 'LEARNING_UNIT_REPAIR').map((row) => String(row.reference_id));
    const states = await latestKnowledgeForUnits(studentId, refs, runner);
    const byRef = new Map(states.map((state) => [String(state.learning_unit_id), state]));
    return rows.map((row) => {
      if (row.step_kind !== 'LEARNING_UNIT_REPAIR' || row.step_state === 'COMPLETED') return row;
      const state = byRef.get(String(row.reference_id));
      const before = Number(baseline?.[String(row.reference_id)] || 0);
      const overlays = asArray(state?.overlays).map(upper);
      const ready = state && Number(state.version_no || 0) > before
        && ['INDEPENDENT', 'SECURE', 'TRANSFERABLE'].includes(upper(state.base_state))
        && !overlays.includes('BLOCKED') && state.contradiction_state !== true;
      return ready ? { ...row, step_state: 'COMPLETED', projected_from_authoritative_skm: true } : row;
    });
  };

  proto.addPathwayStep = async function addPathwayStep({ studentId, pathwayId, kind, referenceId, state, payload = {}, idempotencyKey }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const prior = await query(
      'select * from public.teaching_progression_pathway_steps where student_id=$1 and idempotency_key=$2 limit 1',
      [studentId, idempotencyKey],
    );
    if (prior.rows?.[0]) return prior.rows[0];
    const p = await pathway(studentId, pathwayId);
    if (!p) fail('Progression pathway not found.', 'TEACHING_D21_PATHWAY_NOT_FOUND', 404);
    const { rows } = await query(`insert into public.teaching_progression_pathway_steps(
      pathway_step_id,student_id,pathway_id,step_kind,reference_id,step_state,state_version,payload,idempotency_key
    ) values($1,$2,$3,$4,$5,$6,1,$7::jsonb,$8) returning *`,
    [randomUUID(), studentId, pathwayId, kind, referenceId, state, json(payload || {}), idempotencyKey]);
    return rows[0];
  };

  proto.updatePathwayState = async function updatePathwayState({ studentId, pathwayId, expectedState, expectedVersion, nextState, verificationRef = null }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const { rows } = await query(`update public.teaching_progression_pathways
      set pathway_state=$5,state_version=state_version+1,verification_ref=coalesce($6,verification_ref),updated_at=now()
      where student_id=$1 and pathway_id=$2 and pathway_state=$3 and state_version=$4
      returning *`,
    [studentId, pathwayId, expectedState, Number(expectedVersion), nextState, verificationRef]);
    if (!rows?.[0]) fail('Progression pathway changed concurrently.', 'TEACHING_D21_PATHWAY_STALE', 409, { pathwayId, expectedState, expectedVersion });
    return rows[0];
  };

  proto.createRepeatAttempt = async function createRepeatAttempt({ studentId, sourceCourseId, sourceAttemptId, sourceOutcomeId, idempotencyKey }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    return withTransaction(async (tx) => {
      const prior = await q(tx,
        'select * from public.teaching_course_attempts where student_id=$1 and idempotency_key=$2 limit 1',
        [studentId, idempotencyKey],
      );
      if (prior.rows?.[0]) {
        return Object.freeze({ repeatCourseId: prior.rows[0].course_id, attempt: prior.rows[0], idempotent: true });
      }
      const sourceCourse = await requireCourse(studentId, sourceCourseId, tx);
      const sourceAttempt = await attemptForCourse(studentId, sourceCourseId, tx);
      if (!sourceAttempt || String(sourceAttempt.attempt_id) !== String(sourceAttemptId)) {
        fail('Source Course Attempt changed before repeat creation.', 'TEACHING_D21_REPEAT_SOURCE_ATTEMPT_STALE');
      }
      const outcome = await q(tx,
        'select * from public.teaching_progression_outcomes where student_id=$1 and progression_outcome_id=$2 and course_id=$3 limit 1 for update',
        [studentId, sourceOutcomeId, sourceCourseId],
      );
      if (!outcome.rows?.[0] || outcome.rows[0].outcome !== 'REPEAT_REQUIRED') {
        fail('Repeat source must be an authoritative Repeat Required outcome.', 'TEACHING_D21_REPEAT_SOURCE_OUTCOME_INVALID');
      }
      const rootCourseId = sourceAttempt.root_course_id || sourceCourseId;
      await q(tx,
        'select attempt_id from public.teaching_course_attempts where student_id=$1 and root_course_id=$2 for update',
        [studentId, rootCourseId],
      );
      const count = await q(tx,
        'select coalesce(max(attempt_no),0)::int as n from public.teaching_course_attempts where student_id=$1 and root_course_id=$2',
        [studentId, rootCourseId],
      );
      const attemptNo = Number(count.rows?.[0]?.n || 0) + 1;
      const repeatCourseId = randomUUID();
      await q(tx, `insert into public.teaching_courses(
        course_id,student_id,subject_id,semester_id,title,lifecycle_state,subject_snapshot_ref,source_version_ref,
        state_version,status_overlays,progression_outcome,activated_at,academic_record_started_at,activation_id
      ) values($1,$2,$3,$4,$5,'DRAFT',$6,$7,1,'{}'::text[],null,null,null,null)`,
      [repeatCourseId, studentId, sourceCourse.subject_id, sourceCourse.semester_id, `${sourceCourse.title} · Repeat ${attemptNo}`, sourceCourse.subject_snapshot_ref, sourceCourse.source_version_ref]);
      const attemptId = randomUUID();
      const attemptInsert = await q(tx, `insert into public.teaching_course_attempts(
        attempt_id,student_id,course_id,root_course_id,attempt_no,attempt_kind,source_course_id,source_attempt_id,
        source_progression_outcome_id,prior_pedagogical_history_ref,idempotency_key
      ) values($1,$2,$3,$4,$5,'REPEAT',$6,$7,$8,$9::jsonb,$10) returning *`,
      [attemptId, studentId, repeatCourseId, rootCourseId, attemptNo, sourceCourseId, sourceAttemptId, sourceOutcomeId,
        json({ source_course_id: sourceCourseId, source_attempt_id: sourceAttemptId, source_progression_outcome_id: sourceOutcomeId, pedagogical_history_retained: true }), idempotencyKey]);

      const sourcePolicy = await currentPolicy(studentId, sourceCourseId, null, tx);
      if (sourcePolicy) {
        await q(tx, `insert into public.teaching_progression_policies(
          progression_policy_id,student_id,scope_kind,course_id,semester_id,version_no,policy_state,academic_credits,
          certification_rules,pathway_rules,resit_policy,repeat_policy,gpa_policy,source_policy_refs,locked_at,idempotency_key
        ) values($1,$2,'COURSE',$3,null,1,'LOCKED',$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)`,
        [randomUUID(), studentId, repeatCourseId, sourcePolicy.academic_credits, json(sourcePolicy.certification_rules), json(sourcePolicy.pathway_rules),
          json(sourcePolicy.resit_policy), json(sourcePolicy.repeat_policy), json(sourcePolicy.gpa_policy),
          json([...(sourcePolicy.source_policy_refs || []), `D21_REPEAT_INHERITED_POLICY:${sourcePolicy.progression_policy_id}:v${sourcePolicy.version_no}`]),
          clock(), `d21-repeat-policy:${attemptId}`]);
      }
      return Object.freeze({ repeatCourseId, attempt: attemptInsert.rows[0], idempotent: false });
    });

  };
}

module.exports = { install };
