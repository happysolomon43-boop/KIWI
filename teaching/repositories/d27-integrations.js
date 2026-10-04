'use strict';

function createD27IntegrationRepository({ query, withTransaction, randomUUID, clock = () => new Date() } = {}) {
  if (typeof query !== 'function' || typeof withTransaction !== 'function' || typeof randomUUID !== 'function') {
    throw new TypeError('D27 repository requires query, withTransaction and randomUUID.');
  }

  async function assertReady() {
    const { rows = [] } = await query(`SELECT
      to_regclass('public.teaching_integration_events') integration_events,
      to_regclass('public.teaching_integration_audit') integration_audit,
      to_regclass('public.teaching_study_card_references') study_references,
      to_regclass('public.teaching_study_card_candidates') study_candidates`);
    if (Object.values(rows[0] || {}).some((value) => value == null)) {
      const error = new Error('D27 integration schema is not installed.');
      error.code = 'TEACHING_D27_SCHEMA_MISSING';
      throw error;
    }
    return true;
  }

  async function enqueueEvent(event) {
    const { rows = [] } = await query(`INSERT INTO public.teaching_integration_events(
      event_id,student_id,event_type,schema_version,source_owner,source_entity_type,source_entity_id,source_version,
      occurred_at,correlation_id,causation_id,idempotency_key,policy_version,privacy_class,payload,status
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,'PENDING')
    ON CONFLICT(student_id,idempotency_key) DO NOTHING RETURNING *`, [
      event.eventId,event.studentId,event.eventType,event.schemaVersion,event.source.owner,event.source.entityType,
      event.source.entityId,event.source.version,event.occurredAt,event.correlationId,event.causationId,
      event.idempotencyKey,event.policyVersion,event.privacyClass,JSON.stringify(event.payload || {}),
    ]);
    if (rows[0]) return Object.freeze({ row: rows[0], inserted: true });
    const existing = await query(`SELECT * FROM public.teaching_integration_events
      WHERE student_id=$1 AND idempotency_key=$2 LIMIT 1`, [event.studentId,event.idempotencyKey]);
    return Object.freeze({ row: existing.rows?.[0] || null, inserted: false });
  }

  async function getEvent(studentId, eventId) {
    const { rows = [] } = await query(`SELECT * FROM public.teaching_integration_events
      WHERE student_id=$1 AND event_id=$2 LIMIT 1`, [studentId,eventId]);
    return rows[0] || null;
  }

  async function markEvent({ studentId, eventId, status, replayed = false, at = clock().toISOString() }) {
    const { rows = [] } = await query(`UPDATE public.teaching_integration_events
      SET status=$3,
          replay_count=replay_count + CASE WHEN $4::boolean THEN 1 ELSE 0 END,
          last_replayed_at=CASE WHEN $4::boolean THEN $5::timestamptz ELSE last_replayed_at END
      WHERE student_id=$1 AND event_id=$2 RETURNING *`, [studentId,eventId,status,replayed,at]);
    return rows[0] || null;
  }

  async function recordAudit(input) {
    const { rows = [] } = await query(`INSERT INTO public.teaching_integration_audit(
      audit_id,student_id,integration_name,action,source_ref,target_ref,feature_flag,decision,outcome,error_code,occurred_at
    ) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11) RETURNING *`, [
      input.auditId || randomUUID(),input.studentId,input.integrationName,input.action,
      JSON.stringify(input.sourceRef || {}),JSON.stringify(input.targetRef || {}),Boolean(input.featureFlag),
      input.decision,input.outcome,input.errorCode || null,input.occurredAt || clock().toISOString(),
    ]);
    return rows[0];
  }

  async function getCourseStudyContext(studentId, { courseId, classId, learningUnitId }) {
    const { rows = [] } = await query(`SELECT c.course_id,c.student_id,c.subject_id,c.lifecycle_state,c.subject_snapshot_ref,c.source_version_ref,
      c.state_version course_state_version,cl.class_id,cl.schedule_version class_state_version,
      lu.learning_unit_id,lu.title learning_unit_title,lu.intended_competence,lu.metadata learning_unit_metadata,
      cp.course_plan_id,cp.version_no course_plan_version
      FROM public.teaching_courses c
      JOIN public.teaching_classes cl ON cl.course_id=c.course_id AND cl.class_id=$3
      JOIN public.teaching_course_plans cp ON cp.course_id=c.course_id AND cp.student_id=c.student_id
      JOIN public.teaching_learning_units lu ON lu.course_plan_id=cp.course_plan_id AND lu.learning_unit_id=$4
      WHERE c.student_id=$1 AND c.course_id=$2
      ORDER BY cp.version_no DESC LIMIT 1`, [studentId,courseId,classId,learningUnitId]);
    return rows[0] || null;
  }

  async function getCourseSubjectContext(studentId, courseId) {
    const { rows = [] } = await query(`SELECT course_id,student_id,subject_id,lifecycle_state,subject_snapshot_ref,source_version_ref,state_version
      FROM public.teaching_courses WHERE student_id=$1 AND course_id=$2 LIMIT 1`, [studentId,courseId]);
    return rows[0] || null;
  }

  async function upsertStudyReference(input) {
    const { rows = [] } = await query(`INSERT INTO public.teaching_study_card_references(
      reference_id,student_id,course_id,class_id,learning_unit_id,subject_id,card_id,card_version,knowledge_type,relevance_reason,source_version,created_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(student_id,class_id,learning_unit_id,card_id) DO UPDATE SET
      card_version=EXCLUDED.card_version,knowledge_type=EXCLUDED.knowledge_type,relevance_reason=EXCLUDED.relevance_reason,
      source_version=EXCLUDED.source_version
    RETURNING *`, [
      input.referenceId || randomUUID(),input.studentId,input.courseId,input.classId,input.learningUnitId,input.subjectId,
      input.cardId,input.cardVersion,input.knowledgeType,input.relevanceReason,input.sourceVersion,input.createdAt || clock().toISOString(),
    ]);
    return rows[0];
  }

  async function listStudyReferences(studentId, { courseId = null, classId = null, learningUnitId = null } = {}) {
    const { rows = [] } = await query(`SELECT * FROM public.teaching_study_card_references
      WHERE student_id=$1 AND($2::text IS NULL OR course_id=$2) AND($3::text IS NULL OR class_id=$3)
      AND($4::text IS NULL OR learning_unit_id=$4)
      ORDER BY created_at,reference_id`, [studentId,courseId,classId,learningUnitId]);
    return rows;
  }

  async function insertCandidate(input) {
    const { rows = [] } = await query(`INSERT INTO public.teaching_study_card_candidates(
      candidate_id,student_id,course_id,class_id,learning_unit_id,subject_id,knowledge_type,front_content,back_content,content_hash,
      provenance_refs,source_version,validation,status,created_at,updated_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,'VALIDATED',$14,$15)
    ON CONFLICT(student_id,learning_unit_id,content_hash) DO NOTHING RETURNING *`, [
      input.candidateId,input.studentId,input.courseId,input.classId,input.learningUnitId,input.subjectId,input.knowledgeType,
      input.frontContent,input.backContent,input.contentHash,JSON.stringify(input.provenanceRefs),input.sourceVersion,
      JSON.stringify(input.validation),input.createdAt,input.updatedAt,
    ]);
    if (rows[0]) return Object.freeze({ row: rows[0], inserted: true });
    const existing = await query(`SELECT * FROM public.teaching_study_card_candidates
      WHERE student_id=$1 AND learning_unit_id=$2 AND content_hash=$3 LIMIT 1`, [input.studentId,input.learningUnitId,input.contentHash]);
    return Object.freeze({ row: existing.rows?.[0] || null, inserted: false });
  }

  async function getCandidate(studentId, candidateId) {
    const { rows = [] } = await query(`SELECT * FROM public.teaching_study_card_candidates
      WHERE student_id=$1 AND candidate_id=$2 LIMIT 1`, [studentId,candidateId]);
    return rows[0] || null;
  }

  async function transitionCandidate({ studentId, candidateId, expectedVersion, fromStatus, toStatus, promotedCardId = null, at = clock().toISOString() }) {
    return withTransaction(async (tx) => {
      const runner = typeof tx === 'function' ? tx : tx.query.bind(tx);
      const current = await runner(`SELECT * FROM public.teaching_study_card_candidates
        WHERE student_id=$1 AND candidate_id=$2 FOR UPDATE`, [studentId,candidateId]);
      const row = current.rows?.[0];
      if (!row) return null;
      if (Number(row.version) !== Number(expectedVersion) || String(row.status) !== String(fromStatus)) {
        const error = new Error('Study card candidate changed before transition.');
        error.code = 'TEACHING_D27_CANDIDATE_VERSION_STALE';
        error.status = 409;
        error.currentVersion = row.version;
        error.currentStatus = row.status;
        throw error;
      }
      const result = await runner(`UPDATE public.teaching_study_card_candidates SET
        status=$3,promoted_card_id=$4,promoted_at=CASE WHEN $3='PROMOTED' THEN $5::timestamptz ELSE NULL END,
        version=version+1,updated_at=$5 WHERE student_id=$1 AND candidate_id=$2 RETURNING *`,
        [studentId,candidateId,toStatus,promotedCardId,at]);
      return result.rows?.[0] || null;
    });
  }

  return Object.freeze({
    assertReady,enqueueEvent,getEvent,markEvent,recordAudit,getCourseStudyContext,getCourseSubjectContext,
    upsertStudyReference,listStudyReferences,insertCandidate,getCandidate,transitionCandidate,
  });
}

module.exports = { createD27IntegrationRepository };
