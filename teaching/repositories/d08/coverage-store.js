'use strict';

function createCoverageStore({ q, withTransaction, randomUUID, clock, json }) {
  async function saveCoverageAudit({ studentId, courseId, planId, kind, result, courseStateVersion }) {
    return withTransaction(async (tx) => {
      if (!['PRE_ACTIVATION','END_OF_COURSE','SCOPE_CHANGE'].includes(String(kind))) {
        const error = new Error('Invalid Coverage Audit kind.');
        error.code = 'TEACHING_D08_COVERAGE_AUDIT_KIND_INVALID';
        throw error;
      }
      const locked = await q(tx, `select * from public.teaching_courses where student_id=$1 and course_id=$2 for update`, [studentId, courseId]);
      const course = locked.rows?.[0];
      if (!course) {
        const error = new Error('Teaching Course not found.');
        error.status = 404;
        error.code = 'TEACHING_COURSE_NOT_FOUND';
        throw error;
      }
      if (String(course.state_version) !== String(courseStateVersion)) {
        const error = new Error('Course state changed before Coverage Audit persistence.');
        error.status = 409;
        error.code = 'TEACHING_D08_STALE_COURSE_STATE';
        throw error;
      }
      const now = clock();
      const coverageAuditId = randomUUID();
      const policyVersion = result.policyVersion || result.policy_version || 'coverage-reconciliation.v1';
      const outcome = result.outcome || result.status;
      const studentSummary = outcome === 'PASS'
        ? (kind === 'END_OF_COURSE' ? 'Every required item has an accepted instructional completion basis.' : 'Every required item is accounted for in the Course Plan.')
        : (kind === 'END_OF_COURSE' ? 'Required Course content remains instructionally incomplete.' : 'Required Course content remains unresolved.');
      const { rows } = await q(tx, `
        insert into public.teaching_coverage_audits(
          coverage_audit_id,student_id,course_id,course_plan_id,audit_kind,outcome,policy_version,machine_result,student_summary,state_version_ref,created_at
        ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) returning *
      `, [coverageAuditId, studentId, courseId, planId, kind, outcome, policyVersion, json(result), studentSummary, `course:${courseId}:state:${courseStateVersion}`, now]);
      await q(tx, `
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,action,entity_type,entity_id,authoritative_owner,state_version_ref,reason,
          after_ref,provenance_refs,safe_metadata
        ) values($1,$2,$3,'SYSTEM','COURSE_COVERAGE_AUDITED','COURSE_COVERAGE_AUDIT',$4,'Course Coverage Ledger',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)
      `, [
        randomUUID(), studentId, now, coverageAuditId, `course-plan:${planId}`, `${kind} ${outcome}`,
        json({ outcome }), json([`course-plan:${planId}`]), json({ kind, policy_version: policyVersion }),
      ]);
      return rows[0];
    });
  }

  return Object.freeze({ saveCoverageAudit });
}

module.exports = { createCoverageStore };
