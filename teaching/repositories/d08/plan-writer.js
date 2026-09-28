'use strict';

const { digest } = require('../../d08/contracts');
const { materializePlanGraph } = require('./plan-graph');
const { materializePlanCoverage } = require('./plan-coverage');

function createPlanWriter(ctx) {
  const { q, withTransaction, randomUUID, clock, json } = ctx;

  async function createPlanVersion({ studentId, courseId, expectedCourseStateVersion, audit, diagnosticPlan, sourceInventoryDigest, proposal, coverage, generationProvenance, scopeDiff }) {
    return withTransaction(async (tx) => {
      const locked = await q(tx, `select * from public.teaching_courses where student_id=$1 and course_id=$2 for update`, [studentId, courseId]);
      const course = locked.rows?.[0];
      if (!course) {
        const error = new Error('Teaching Course not found.');
        error.status = 404;
        error.code = 'TEACHING_COURSE_NOT_FOUND';
        throw error;
      }
      if (String(course.state_version) !== String(expectedCourseStateVersion)) {
        const error = new Error('Course state changed while the Course Plan was being prepared.');
        error.status = 409;
        error.code = 'TEACHING_D08_STALE_COURSE_STATE';
        throw error;
      }
      if (String(audit.subject_snapshot_ref) !== String(course.subject_snapshot_ref)) {
        const error = new Error('Curriculum Audit snapshot no longer matches the Course.');
        error.status = 409;
        error.code = 'TEACHING_D08_STALE_CURRICULUM_AUDIT';
        throw error;
      }

      const latest = await q(tx, `select * from public.teaching_course_plans where student_id=$1 and course_id=$2 order by version_no desc limit 1 for update`, [studentId, courseId]);
      const previousPlan = latest.rows?.[0] || null;
      if (previousPlan && previousPlan.source_snapshot_ref === course.subject_snapshot_ref && previousPlan.plan_state !== 'REVIEW_REQUIRED') {
        const error = new Error('The current Course scope already has a Course Plan version.');
        error.status = 409;
        error.code = 'TEACHING_D08_PLAN_ALREADY_CURRENT';
        throw error;
      }

      const version = previousPlan ? Number(previousPlan.version_no) + 1 : 1;
      const coursePlanId = randomUUID();
      const now = clock();
      const scopeChecksum = digest({
        source_snapshot_ref: course.subject_snapshot_ref,
        source_inventory_digest: sourceInventoryDigest,
        mappings: proposal.source_mappings,
        units: proposal.learning_units.map((unit) => ({ key: unit.key, treatment: unit.instructional_treatment })),
      });
      const { rows } = await q(tx, `
        insert into public.teaching_course_plans(
          course_plan_id,student_id,course_id,version_no,plan_state,scope_checksum,source_snapshot_ref,
          generation_provenance,supersedes_course_plan_id,created_by,curriculum_audit_id,plan_contract_version,
          source_inventory_digest,scope_diff_summary,review_summary
        ) values($1,$2,$3,$4,'REVIEW_READY',$5,$6,$7::jsonb,$8,'teaching.curriculum.course_plan_generation',$9,'d08.course-plan.v1',$10,$11::jsonb,$12)
        returning *
      `, [
        coursePlanId, studentId, courseId, version, scopeChecksum, course.subject_snapshot_ref, json(generationProvenance),
        previousPlan?.course_plan_id || null, audit.curriculum_audit_id, sourceInventoryDigest, json(scopeDiff || {}), proposal.summary || null,
      ]);

      const setup = { course, curriculumAudit: audit, diagnosticPlan, vpkDecisions: await currentVpk(q, tx, studentId, courseId), sources: await currentSources(q, tx, studentId, courseId) };
      const graph = await materializePlanGraph(ctx, tx, { studentId, coursePlanId, setup, plan: proposal });
      await materializePlanCoverage(ctx, tx, { studentId, course, coursePlanId, setup, plan: proposal, graph, coverage, previousPlan, version, now });

      const preAuditId = randomUUID();
      const machineResult = {
        kind: 'PRE_ACTIVATION',
        outcome: coverage.outcome,
        requiredCount: coverage.requiredCount,
        mappedCount: coverage.mappedCount,
        excludedCount: coverage.excludedCount,
        unresolvedSourceRefs: coverage.unresolvedSourceRefs,
        policyVersion: coverage.policyVersion,
        diagnosticResolved: true,
      };
      await q(tx, `
        insert into public.teaching_coverage_audits(
          coverage_audit_id,student_id,course_id,course_plan_id,audit_kind,outcome,policy_version,machine_result,student_summary,state_version_ref,created_at
        ) values($1,$2,$3,$4,'PRE_ACTIVATION',$5,$6,$7::jsonb,$8,$9,$10)
      `, [
        preAuditId, studentId, courseId, coursePlanId, coverage.outcome, coverage.policyVersion, json(machineResult),
        coverage.outcome === 'PASS' ? 'Every required meaningful source item is accounted for in the Course Plan.' : 'Required Course content remains unresolved.',
        `course:${courseId}:state:${course.state_version}`, now,
      ]);

      const pendingScope = await q(tx, `
        select * from public.teaching_course_scope_changes s
        where s.student_id=$1 and s.course_id=$2 and s.requires_plan_version=true
          and s.observed_snapshot_ref=$3 and s.status='ADOPTED_PENDING_AUDIT'
          and not exists(select 1 from public.teaching_course_scope_change_applications a where a.scope_change_id=s.scope_change_id)
        order by s.detected_at desc
      `, [studentId, courseId, course.subject_snapshot_ref]);
      for (const change of pendingScope.rows || []) {
        await q(tx, `insert into public.teaching_course_scope_change_applications(application_id,student_id,scope_change_id,course_plan_id,applied_at) values($1,$2,$3,$4,$5)`, [randomUUID(), studentId, change.scope_change_id, coursePlanId, now]);
        await q(tx, `update public.teaching_course_scope_changes set status='APPLIED',applied_at=$4 where student_id=$1 and course_id=$2 and scope_change_id=$3`, [studentId, courseId, change.scope_change_id, now]);
      }

      if (previousPlan) {
        await q(tx, `update public.teaching_course_plans set plan_state='SUPERSEDED' where student_id=$1 and course_plan_id=$2`, [studentId, previousPlan.course_plan_id]);
      }
      await q(tx, `update public.teaching_courses set state_version=state_version+1,updated_at=$3 where student_id=$1 and course_id=$2`, [studentId, courseId, now]);
      await q(tx, `
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,authoritative_owner,
          state_version_ref,reason,before_ref,after_ref,provenance_refs,safe_metadata
        ) values($1,$2,$3,'SYSTEM',null,'COURSE_PLAN_VERSION_CREATED','COURSE_PLAN',$4,'Course Plan/Coverage',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
      `, [
        randomUUID(), studentId, now, coursePlanId, `course-plan:${coursePlanId}:v${version}`,
        previousPlan ? 'Versioned Course Plan update after reviewed scope change.' : 'Course Plan version 1 created from validated Curriculum Audit.',
        json(previousPlan ? { course_plan_id: previousPlan.course_plan_id, version_no: previousPlan.version_no } : {}),
        json({ course_plan_id: coursePlanId, version_no: version, scope_checksum: scopeChecksum, pre_activation_audit_id: preAuditId }),
        json([ `curriculum-audit:${audit.curriculum_audit_id}` ]),
        json({ source_inventory_digest: sourceInventoryDigest, plan_contract_version: 'd08.course-plan.v1' }),
      ]);
      return rows[0];
    });
  }

  async function currentSources(q, tx, studentId, courseId) {
    const { rows = [] } = await q(tx, `select * from public.teaching_source_content_items where student_id=$1 and course_id=$2 and superseded_at is null order by discovered_at,source_content_item_id`, [studentId, courseId]);
    return rows;
  }

  async function currentVpk(q, tx, studentId, courseId) {
    const { rows = [] } = await q(tx, `select * from public.teaching_validated_prior_knowledge_decisions where student_id=$1 and course_id=$2 order by decided_at desc`, [studentId, courseId]);
    return rows;
  }

  return Object.freeze({ createPlanVersion, saveCoursePlan: createPlanVersion });
}

module.exports = { createPlanWriter };
