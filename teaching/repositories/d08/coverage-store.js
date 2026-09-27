'use strict';

function createCoverageStore({ q, withTransaction, randomUUID, clock, json }) {
  async function saveCoverageAudit({ studentId, courseId, coursePlanId, reconciliation, studentSummary }) {
    return withTransaction(async (tx) => {
      const now = clock();
      const coverageAuditId = randomUUID();
      const { rows } = await q(tx, `
        insert into public.teaching_coverage_audits(
          coverage_audit_id,student_id,course_id,course_plan_id,audit_stage,status,policy_version,machine_result,student_summary,created_at
        ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) returning *
      `, [coverageAuditId, studentId, courseId, coursePlanId, reconciliation.stage, reconciliation.status, reconciliation.policy_version, json(reconciliation), studentSummary, now]);
      await q(tx, `
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,action,entity_type,entity_id,authoritative_owner,state_version_ref,reason,
          after_ref,provenance_refs,safe_metadata
        ) values($1,$2,$3,'SYSTEM','COURSE_COVERAGE_AUDITED','COURSE_COVERAGE_AUDIT',$4,'Course Coverage Ledger',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)
      `, [randomUUID(), studentId, now, coverageAuditId, `course-plan:${coursePlanId}`, `${reconciliation.stage} ${reconciliation.status}`, json({ status: reconciliation.status }), json([`course-plan:${coursePlanId}`]), json({ stage: reconciliation.stage, policy_version: reconciliation.policy_version })]);
      return rows[0];
    });
  }
  return Object.freeze({ saveCoverageAudit });
}

module.exports = { createCoverageStore };
