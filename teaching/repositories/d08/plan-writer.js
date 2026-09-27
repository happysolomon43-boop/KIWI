'use strict';

const { materializePlanGraph } = require('./plan-graph');
const { materializePlanCoverage } = require('./plan-coverage');

function createPlanWriter(ctx) {
  const { q, withTransaction, randomUUID, clock, json } = ctx;

  async function createPlanVersion({ studentId, course, setup, plan, scopeChecksum, sourceInventoryDigest, generationProvenance, scopeDiffSummary }) {
    return withTransaction(async (tx) => {
      const locked = await q(tx, `select * from public.teaching_courses where student_id=$1 and course_id=$2 for update`, [studentId, course.course_id]);
      if (!locked.rows?.[0]) {
        const error = new Error('Teaching Course not found.');
        error.status = 404;
        error.code = 'TEACHING_COURSE_NOT_FOUND';
        throw error;
      }
      const latest = await q(tx, `select * from public.teaching_course_plans where student_id=$1 and course_id=$2 order by version_no desc limit 1`, [studentId, course.course_id]);
      const previousPlan = latest.rows?.[0] || null;
      const version = previousPlan ? Number(previousPlan.version_no) + 1 : 1;
      const coursePlanId = randomUUID();
      const now = clock();
      const snapshotRef = String(locked.rows[0].subject_snapshot_ref || course.subject_snapshot_ref || '');
      if (!snapshotRef) { const error = new Error('Course source snapshot is required before Course Plan persistence.'); error.code='TEACHING_D08_SOURCE_SNAPSHOT_REQUIRED'; throw error; }
      const inserted = await q(tx, `
        insert into public.teaching_course_plans(
          course_plan_id,student_id,course_id,version_no,plan_state,scope_checksum,source_snapshot_ref,
          generation_provenance,supersedes_course_plan_id,created_by,curriculum_audit_id,plan_contract_version,
          source_inventory_digest,scope_diff_summary,review_summary
        ) values($1,$2,$3,$4,'REVIEW_READY',$5,$6,$7::jsonb,$8,'teaching.curriculum.course_plan_generation',$9,$10,$11,$12::jsonb,$13)
        returning *
      `, [coursePlanId, studentId, course.course_id, version, scopeChecksum, snapshotRef, json(generationProvenance), previousPlan?.course_plan_id || null, setup.curriculumAudit.curriculum_audit_id, 'd08.course-plan.v1', sourceInventoryDigest, json(scopeDiffSummary || {}), plan.planning_summary]);

      const graph = await materializePlanGraph(ctx, tx, { studentId, coursePlanId, setup, plan });
      await materializePlanCoverage(ctx, tx, { studentId, course, coursePlanId, setup, plan, graph, previousPlan, version, now });

      const pendingScope = await q(tx, `
        select * from public.teaching_course_scope_changes s
        where s.student_id=$1 and s.course_id=$2 and s.requires_plan_version=true
          and s.candidate_snapshot_ref=$3
          and s.review_status='ACCEPTED_PENDING_REPLAN'
          and not exists(select 1 from public.teaching_course_scope_change_applications a where a.scope_change_id=s.scope_change_id)
        order by s.detected_at desc
      `, [studentId, course.course_id, snapshotRef]);
      for (const change of pendingScope.rows || []) {
        await q(tx, `insert into public.teaching_course_scope_change_applications(application_id,student_id,scope_change_id,course_plan_id,applied_at) values($1,$2,$3,$4,$5)`, [randomUUID(), studentId, change.scope_change_id, coursePlanId, now]);
        await q(tx, `update public.teaching_course_scope_changes set review_status='APPLIED',decided_at=coalesce(decided_at,$4) where student_id=$1 and course_id=$2 and scope_change_id=$3`, [studentId, course.course_id, change.scope_change_id, now]);
      }

      if (previousPlan) await q(tx, `update public.teaching_course_plans set plan_state='SUPERSEDED' where student_id=$1 and course_plan_id=$2`, [studentId, previousPlan.course_plan_id]);
      await q(tx, `update public.teaching_courses set state_version=state_version+1,updated_at=$3 where student_id=$1 and course_id=$2`, [studentId, course.course_id, now]);
      await q(tx, `
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,authoritative_owner,
          state_version_ref,reason,before_ref,after_ref,provenance_refs,safe_metadata
        ) values($1,$2,$3,'SYSTEM',null,'COURSE_PLAN_VERSION_CREATED','COURSE_PLAN',$4,'Course Plan/Coverage',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
      `, [randomUUID(), studentId, now, coursePlanId, `course-plan:${coursePlanId}:v${version}`, previousPlan ? 'Versioned Course Plan update after reviewed scope/planning change.' : 'Course Plan version 1 created from validated Curriculum Audit.', json(previousPlan ? { course_plan_id: previousPlan.course_plan_id, version_no: previousPlan.version_no } : {}), json({ course_plan_id: coursePlanId, version_no: version, scope_checksum: scopeChecksum }), json(generationProvenance.provenance_refs || []), json({ source_inventory_digest: sourceInventoryDigest, curriculum_audit_id: setup.curriculumAudit.curriculum_audit_id })]);
      return inserted.rows[0];
    });
  }

  return Object.freeze({ createPlanVersion });
}

module.exports = { createPlanWriter };
