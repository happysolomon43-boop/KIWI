'use strict';

const { fail } = require('../d16/contracts');

function createD16AssignmentRepository({ query, withTransaction, randomUUID, clock = () => new Date() } = {}) {
  if (typeof query !== 'function' || typeof withTransaction !== 'function' || typeof randomUUID !== 'function') {
    throw new TypeError('D16 Assignment repository requires query, withTransaction and randomUUID.');
  }
  const q = (runner, sql, params = []) => runner && typeof runner.query === 'function' ? runner.query(sql, params) : query(sql, params);
  const json = (value) => JSON.stringify(value ?? null);
  const now = () => { const value = clock(); return value instanceof Date ? value : new Date(value); };

  async function assertReady() {
    const { rows } = await query(`select
      to_regclass('public.teaching_assignments') assignments,
      to_regclass('public.teaching_assignment_submissions') submissions,
      to_regclass('public.teaching_assignment_integrity_reviews') integrity_reviews`);
    if (Object.values(rows?.[0] || {}).some((value) => value == null)) {
      const error = new Error('Teaching D16 Assignment schema is not ready.');
      error.code = 'TEACHING_D16_SCHEMA_NOT_READY';
      throw error;
    }
    return true;
  }

  async function getAssignment(studentId, assignmentId, runner = null) {
    const { rows } = await q(runner, `select * from public.teaching_assignments where student_id=$1 and id=$2`, [studentId, assignmentId]);
    return rows?.[0] || null;
  }

  async function listAssignments(studentId, { courseId = null, limit = 200 } = {}) {
    const params = [studentId];
    const where = ['student_id=$1'];
    if (courseId) { params.push(courseId); where.push(`course_id=$${params.length}`); }
    params.push(Math.max(1, Math.min(Number(limit) || 200, 500)));
    const { rows } = await query(`select * from public.teaching_assignments where ${where.join(' and ')} order by due_at,id limit $${params.length}`, params);
    return rows || [];
  }

  async function latestSubmission(studentId, assignmentId, runner = null, lock = false) {
    if (lock) await q(runner, 'select pg_advisory_xact_lock(hashtextextended($1,0))', [`${studentId}:${assignmentId}:submission`]);
    const { rows } = await q(runner, `select * from public.teaching_assignment_submissions
      where student_id=$1 and assignment_id=$2 order by version desc,accepted_event_at desc,id desc limit 1`, [studentId, assignmentId]);
    return rows?.[0] || null;
  }

  async function appendSubmission(input) {
    if (!input?.idempotencyKey) throw fail('Submission requires an idempotency key.', 'TEACHING_D16_IDEMPOTENCY_REQUIRED', 400);
    return withTransaction(async (tx) => {
      const existing = await q(tx, `select * from public.teaching_assignment_submissions where student_id=$1 and idempotency_key=$2 limit 1`, [input.studentId,input.idempotencyKey]);
      if (existing.rows?.[0]) return Object.freeze({ row: existing.rows[0], idempotent: true });
      const assignment = await getAssignment(input.studentId,input.assignmentId,tx);
      if (!assignment) throw fail('Assignment not found.', 'TEACHING_D16_ASSIGNMENT_NOT_FOUND', 404);
      const current = await latestSubmission(input.studentId,input.assignmentId,tx,true);
      const version = current ? Number(current.version) + 1 : 1;
      const id = randomUUID();
      const acceptedAt = input.acceptedEventAt ? new Date(input.acceptedEventAt) : now();
      const { rows } = await q(tx, `insert into public.teaching_assignment_submissions(
        id,assignment_id,student_id,version,submission_kind,response,submitted_at,accepted_event_at,
        policy_version_at_event,prior_submission_id,idempotency_key,created_at
      ) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12) returning *`, [
        id,input.assignmentId,input.studentId,version,input.submissionKind,json(input.response||{}),input.submittedAt||acceptedAt,
        acceptedAt,input.policyVersionAtEvent,current?.id||null,input.idempotencyKey,now(),
      ]);
      return Object.freeze({ row: rows[0], idempotent: false });
    });
  }

  async function appendIntegrityReview(input) {
    if (!input?.idempotencyKey) throw fail('Integrity review requires an idempotency key.', 'TEACHING_D16_IDEMPOTENCY_REQUIRED', 400);
    return withTransaction(async (tx) => {
      const existing = await q(tx, `select * from public.teaching_assignment_integrity_reviews where student_id=$1 and idempotency_key=$2 limit 1`, [input.studentId,input.idempotencyKey]);
      if (existing.rows?.[0]) return Object.freeze({ row: existing.rows[0], idempotent: true });
      const id = randomUUID();
      const { rows } = await q(tx, `insert into public.teaching_assignment_integrity_reviews(
        id,assignment_id,submission_id,student_id,policy_version_at_event,rule_alignment,capability_evidence,
        contextual_signals,verification_state,verification_target,verification_method,active_formal_assessment,
        authoritative_outcome,idempotency_key,created_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14,$15) returning *`, [
        id,input.assignmentId,input.submissionId,input.studentId,input.policyVersionAtEvent,input.ruleAlignment,
        input.capabilityEvidence,json(input.contextualSignals||[]),input.verificationState||'NOT_REQUIRED',
        input.verificationTarget||null,input.verificationMethod||null,Boolean(input.activeFormalAssessment),
        json(input.authoritativeOutcome||null),input.idempotencyKey,now(),
      ]);
      return Object.freeze({ row: rows[0], idempotent: false });
    });
  }

  return Object.freeze({ assertReady, getAssignment, listAssignments, latestSubmission, appendSubmission, appendIntegrityReview });
}

module.exports = { createD16AssignmentRepository };
