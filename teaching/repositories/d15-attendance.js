'use strict';

const { resolveAttendancePolicy, assertOutcome, fail } = require('../d15/contracts');

function createD15AttendanceRepository({ query, withTransaction, randomUUID, clock = () => new Date() } = {}) {
  if (typeof query !== 'function' || typeof withTransaction !== 'function' || typeof randomUUID !== 'function') {
    throw new TypeError('D15 Attendance repository requires query, withTransaction and randomUUID.');
  }

  const q = (runner, sql, params = []) => runner && typeof runner.query === 'function'
    ? runner.query(sql, params)
    : query(sql, params);
  const json = (value) => JSON.stringify(value ?? null);
  const now = () => {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  };

  async function assertReady() {
    const { rows } = await query(`select
      to_regclass('public.teaching_attendance_records') attendance_records,
      to_regclass('public.teaching_attendance_concerns') attendance_concerns,
      to_regclass('public.teaching_attendance_system_interruptions') system_interruptions`);
    if (Object.values(rows?.[0] || {}).some((value) => value == null)) {
      const error = new Error('Teaching D15 Attendance schema is not ready.');
      error.code = 'TEACHING_D15_SCHEMA_NOT_READY';
      throw error;
    }
    return true;
  }

  async function getClass(studentId, classId, runner = null, lock = false) {
    const suffix = lock ? ' for update of c,co' : '';
    const { rows } = await q(runner, `select c.*,co.lifecycle_state course_lifecycle_state,
      co.state_version course_state_version,co.semester_id
      from public.teaching_classes c
      join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id
      where c.student_id=$1 and c.class_id=$2${suffix}`, [studentId, classId]);
    return rows?.[0] || null;
  }

  function obligationIdentity(classRow) {
    if (!classRow) throw fail('Class is required for attendance obligation.', 'TEACHING_D15_CLASS_REQUIRED', 404);
    return Object.freeze({
      attendanceObligationId: `class:${classRow.class_id}:schedule-v${Number(classRow.schedule_version)}`,
      academicObligationRef: classRow.source_timetable_slot_id
        ? `timetable-slot:${classRow.source_timetable_slot_id}`
        : `class:${classRow.class_id}`,
    });
  }

  function obligationFromClass(classRow) {
    const lifecycle = String(classRow.lifecycle_state || 'SCHEDULED').toUpperCase();
    const course = String(classRow.course_lifecycle_state || '').toUpperCase();
    const noObligation = ['CANCELLED','SYSTEM_CANCELLED'].includes(lifecycle)
      || ['PAUSED','TEACHING_ENDED','FINALIZING','INCOMPLETE','COMPLETED','ARCHIVED'].includes(course);
    return Object.freeze({
      obligationState: noObligation ? 'NO_OBLIGATION' : 'REQUIRED',
      obligationDisposition: lifecycle === 'SYSTEM_CANCELLED'
        ? 'SYSTEM_PROTECTED'
        : lifecycle === 'CANCELLED'
          ? 'RESCHEDULED'
          : null,
    });
  }

  async function latestRecord(studentId, attendanceObligationId, runner = null, lock = false) {
    if (lock) {
      await q(runner, 'select pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${studentId}:${attendanceObligationId}`,
      ]);
    }
    const { rows } = await q(runner, `select * from public.teaching_attendance_records
      where student_id=$1 and attendance_obligation_id=$2
      order by version_no desc limit 1`, [studentId, attendanceObligationId]);
    return rows?.[0] || null;
  }

  async function latestRecordForClass(studentId, classId, runner = null) {
    const { rows } = await q(runner, `select distinct on (attendance_obligation_id) *
      from public.teaching_attendance_records
      where student_id=$1 and class_id=$2
      order by attendance_obligation_id,version_no desc,recorded_at desc`, [studentId, classId]);
    return (rows || []).sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))[0] || null;
  }

  async function latestRecordByRequest(studentId, requestId, runner = null) {
    const { rows } = await q(runner, `select * from public.teaching_attendance_records
      where student_id=$1 and source_request_id=$2 order by recorded_at desc,version_no desc limit 1`, [studentId, requestId]);
    return rows?.[0] || null;
  }

  async function auditUsing(tx, {
    studentId, action, entityId, stateVersionRef = null, reason = null,
    beforeRef = {}, afterRef = {}, provenanceRefs = [], safeMetadata = {},
  }) {
    await q(tx, `insert into public.teaching_academic_audit_log(
      audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,authoritative_owner,
      state_version_ref,reason,before_ref,after_ref,provenance_refs,safe_metadata
    ) values($1,$2,$3,'SYSTEM',null,$4,'ATTENDANCE_RECORD',$5,'attendance',$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)`, [
      randomUUID(), studentId, now(), action, entityId, stateVersionRef, reason,
      json(beforeRef), json(afterRef), json(provenanceRefs), json(safeMetadata),
    ]);
  }

  async function appendVersionUsing(tx, input) {
    const existing = await q(tx, `select * from public.teaching_attendance_records
      where student_id=$1 and idempotency_key=$2 limit 1`, [input.studentId, input.idempotencyKey]);
    if (existing.rows?.[0]) return Object.freeze({ row: existing.rows[0], idempotent: true });

    const current = await latestRecord(input.studentId, input.attendanceObligationId, tx, true);
    const versionNo = current ? Number(current.version_no) + 1 : 1;
    const supersedes = current?.attendance_record_id || null;
    const id = randomUUID();
    const { rows } = await q(tx, `insert into public.teaching_attendance_records(
      attendance_record_id,student_id,course_id,class_id,attendance_obligation_id,academic_obligation_ref,version_no,
      schedule_version,source_timetable_version_id,source_timetable_slot_id,scheduled_start_at,scheduled_end_at,
      obligation_state,obligation_disposition,outcome,presence_state,arrived_at,exited_at,grace_minutes,late_minutes,
      material_lateness,missed_minutes,behavior_relevant,interruption_kind,recovery_state,participation_evidence,
      policy_snapshot,recovery_facts,source_event_id,source_request_id,correction_kind,correction_reason,
      supersedes_record_id,provenance_refs,idempotency_key,recorded_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
      $26::jsonb,$27::jsonb,$28::jsonb,$29,$30,$31,$32,$33,$34::jsonb,$35,$36) returning *`, [
      id,input.studentId,input.courseId,input.classId,input.attendanceObligationId,input.academicObligationRef,versionNo,
      Number(input.scheduleVersion),input.sourceTimetableVersionId||null,input.sourceTimetableSlotId||null,
      input.scheduledStartAt,input.scheduledEndAt,input.obligationState,input.obligationDisposition||null,
      assertOutcome(input.outcome),input.presenceState,input.arrivedAt||null,input.exitedAt||null,
      Number(input.graceMinutes)||0,input.lateMinutes==null?null:Number(input.lateMinutes),Boolean(input.materialLateness),
      Number(input.missedMinutes)||0,Boolean(input.behaviorRelevant),input.interruptionKind||null,
      input.recoveryState||'NONE',json(input.participationEvidence||[]),json(input.policySnapshot||{}),
      json(input.recoveryFacts||{}),input.sourceEventId||null,input.sourceRequestId||null,input.correctionKind||null,
      input.correctionReason||null,supersedes,json(input.provenanceRefs||[]),input.idempotencyKey,now(),
    ]);
    const row = rows[0];

    await auditUsing(tx, {
      studentId: input.studentId,
      action: input.correctionKind ? 'attendance.correct' : 'attendance.record',
      entityId: row.attendance_record_id,
      stateVersionRef: `${row.attendance_obligation_id}@${row.version_no}`,
      reason: input.correctionReason || input.obligationDisposition || input.outcome,
      beforeRef: current ? {
        attendance_record_id:current.attendance_record_id,
        outcome:current.outcome,
        version_no:Number(current.version_no),
      } : {},
      afterRef: {
        attendance_record_id:row.attendance_record_id,
        outcome:row.outcome,
        version_no:Number(row.version_no),
      },
      provenanceRefs: input.provenanceRefs || [],
      safeMetadata: {
        class_id:input.classId,
        policy_version:input.policySnapshot?.lateness?.policyVersion||null,
        source_request_id:input.sourceRequestId||null,
        gradebook_mutated:false,
        skm_mutated:false,
      },
    });
    return Object.freeze({ row, idempotent: false });
  }

  async function appendVersion(input) {
    return withTransaction((tx) => appendVersionUsing(tx, input));
  }

  async function evidenceForClass(studentId, classId, runner = null) {
    const [interactions, responses, sessions, interruptions] = await Promise.all([
      q(runner, `select interaction_id,interaction_kind,created_at
        from public.teaching_classroom_interactions
        where student_id=$1 and class_id=$2 order by created_at,interaction_id`, [studentId,classId]),
      q(runner, `select sr.response_id,sr.submitted_at
        from public.teaching_student_responses sr
        join public.teaching_class_sessions cs on cs.class_session_id=sr.class_session_id and cs.student_id=sr.student_id
        where sr.student_id=$1 and cs.class_id=$2 order by sr.submitted_at,sr.response_id`, [studentId,classId]).catch(() => ({rows:[]})),
      q(runner, `select class_session_id,lifecycle_state,instructional_substate,started_at,closed_at,state_version
        from public.teaching_class_sessions where student_id=$1 and class_id=$2
        order by started_at desc limit 1`, [studentId,classId]),
      q(runner, `select * from public.teaching_attendance_system_interruptions
        where student_id=$1 and class_id=$2 order by starts_at`, [studentId,classId]),
    ]);

    const rows = interactions.rows || [];
    const join = rows.find((row) => row.interaction_kind === 'JOIN') || null;
    const leave = [...rows].reverse().find((row) => row.interaction_kind === 'LEAVE') || null;
    const participation = [];
    for (const row of rows) {
      if (['READY','FINISHED','ASK_TEACHER','NEED_HELP'].includes(row.interaction_kind)) {
        participation.push({kind:row.interaction_kind,ref:`interaction:${row.interaction_id}`,at:row.created_at});
      }
    }
    for (const row of responses.rows || []) {
      participation.push({kind:'STUDENT_RESPONSE',ref:`response:${row.response_id}`,at:row.submitted_at});
    }
    const session = sessions.rows?.[0] || null;
    if (session?.lifecycle_state === 'CLOSED') {
      participation.push({kind:'CLASS_CLOSURE',ref:`class-session:${session.class_session_id}`,at:session.closed_at});
    }
    return Object.freeze({
      join,
      leave,
      interactions:Object.freeze(rows),
      participation:Object.freeze(participation),
      session,
      interruptions:Object.freeze(interruptions.rows || []),
    });
  }

  async function listLatest(studentId, { courseId = null, limit = 200 } = {}) {
    const params = [studentId];
    const where = ['student_id=$1'];
    if (courseId) {
      params.push(courseId);
      where.push(`course_id=$${params.length}`);
    }
    params.push(Math.max(1, Math.min(Number(limit) || 200, 500)));
    const { rows } = await query(`select * from (
      select distinct on (attendance_obligation_id) *
      from public.teaching_attendance_records
      where ${where.join(' and ')}
      order by attendance_obligation_id,version_no desc
    ) latest order by scheduled_start_at desc limit $${params.length}`, params);
    return rows || [];
  }

  async function listHistory(studentId, classId) {
    const { rows } = await query(`select * from public.teaching_attendance_records
      where student_id=$1 and class_id=$2
      order by attendance_obligation_id,version_no`, [studentId,classId]);
    return rows || [];
  }

  async function latestConcern(studentId, courseId, runner = null) {
    const { rows } = await q(runner, `select * from public.teaching_attendance_concerns
      where student_id=$1 and course_id=$2 order by opened_at desc,attendance_concern_id desc limit 1`, [studentId,courseId]);
    return rows?.[0] || null;
  }

  async function recordConcernStateUsing(tx, {
    studentId, courseId, state, evaluation, recordRefs = [], explanationFacts = {}, idempotencyKey,
  }) {
    const normalized = String(state || '').toUpperCase();
    if (!['OPEN','RESOLVED'].includes(normalized)) {
      throw fail('Invalid Attendance Concern state.', 'TEACHING_D15_CONCERN_STATE_INVALID', 400);
    }
    const existing = await q(tx, `select * from public.teaching_attendance_concerns
      where student_id=$1 and idempotency_key=$2 limit 1`, [studentId,idempotencyKey]);
    if (existing.rows?.[0]) return existing.rows[0];

    const id = randomUUID();
    const at = now();
    const { rows } = await q(tx, `insert into public.teaching_attendance_concerns(
      attendance_concern_id,student_id,course_id,policy_version,concern_state,incident_record_refs,
      evaluated_obligations,incident_count,actions,explanation_facts,subject_mark_reduction,idempotency_key,opened_at,resolved_at
    ) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,false,$11,$12,$13) returning *`, [
      id,studentId,courseId,evaluation.policyVersion,normalized,json(recordRefs),
      evaluation.evaluatedObligations,evaluation.incidentCount,json(evaluation.actions||[]),
      json(explanationFacts),idempotencyKey,at,normalized==='RESOLVED'?at:null,
    ]);
    await auditUsing(tx, {
      studentId,
      action: normalized === 'OPEN' ? 'attendance.concern.open' : 'attendance.concern.resolve',
      entityId:id,
      stateVersionRef:evaluation.policyVersion,
      reason:normalized === 'OPEN' ? 'Configured repeated-attendance pattern' : 'Current rolling attendance window no longer meets configured concern trigger',
      afterRef:{state:normalized,incident_count:evaluation.incidentCount,actions:evaluation.actions||[]},
      provenanceRefs:recordRefs,
      safeMetadata:{subject_mark_reduction:false,attendance_probation:false},
    });
    return rows[0];
  }

  async function recordConcern(input) {
    return withTransaction((tx) => recordConcernStateUsing(tx, {...input,state:'OPEN'}));
  }

  async function resolveConcern(input) {
    return withTransaction((tx) => recordConcernStateUsing(tx, {...input,state:'RESOLVED'}));
  }

  async function recordSystemInterruption({
    studentId,classId,incidentRef,startsAt,endsAt=null,sourceAuthority='KIWI_RUNTIME',safeMetadata={},
  }) {
    return withTransaction(async (tx) => {
      const klass = await getClass(studentId,classId,tx,true);
      if (!klass) throw fail('Class not found for system interruption.', 'TEACHING_D15_CLASS_NOT_FOUND', 404);
      const existing = await q(tx, `select * from public.teaching_attendance_system_interruptions
        where student_id=$1 and class_id=$2 and incident_ref=$3`, [studentId,classId,incidentRef]);
      if (existing.rows?.[0]) return existing.rows[0];
      const id = randomUUID();
      const { rows } = await q(tx, `insert into public.teaching_attendance_system_interruptions(
        interruption_id,student_id,class_id,incident_ref,starts_at,ends_at,source_authority,verified,safe_metadata
      ) values($1,$2,$3,$4,$5,$6,$7,true,$8::jsonb) returning *`, [
        id,studentId,classId,incidentRef,startsAt,endsAt,sourceAuthority,json(safeMetadata),
      ]);
      await auditUsing(tx, {
        studentId,
        action:'attendance.system_interruption.record',
        entityId:id,
        reason:'Verified KIWI/platform interruption',
        afterRef:{class_id:classId,incident_ref:incidentRef},
        provenanceRefs:[`system-incident:${incidentRef}`],
      });
      return rows[0];
    });
  }

  async function deferralCount(studentId, classId) {
    const { rows } = await query(`select count(*)::int count
      from public.teaching_request_applications a
      join public.teaching_requests r on r.request_id=a.request_id and r.student_id=a.student_id
      where r.student_id=$1 and r.request_type='SINGLE_CLASS_RESCHEDULE'
        and r.requested_change->>'classId'=$2`, [studentId,classId]);
    return Number(rows?.[0]?.count) || 0;
  }

  function fullScheduledMinutes(klass) {
    return Math.max(0, Math.ceil((Date.parse(klass.scheduled_end_at) - Date.parse(klass.scheduled_start_at)) / 60000));
  }

  async function applyRequestUsing(tx, request, change) {
    if (!['EMERGENCY_ABSENCE','EARLY_DISMISSAL','ATTENDANCE_REVIEW_CORRECTION'].includes(request.request_type)) {
      throw fail('D15 cannot apply this Request type.', 'TEACHING_D15_REQUEST_TYPE_INVALID', 409);
    }
    const classId = String(change.classId || '');
    const klass = await getClass(request.student_id,classId,tx,true);
    if (!klass) throw fail('Attendance Request Class no longer exists.', 'TEACHING_D15_CLASS_NOT_FOUND', 404);

    const ids = obligationIdentity(klass);
    const current = await latestRecord(request.student_id,ids.attendanceObligationId,tx,true);
    const policy = current?.policy_snapshot || resolveAttendancePolicy();
    const base = current || {
      obligation_state:'REQUIRED',obligation_disposition:null,outcome:'PENDING',presence_state:'UNESTABLISHED',
      arrived_at:null,exited_at:null,grace_minutes:0,late_minutes:null,material_lateness:false,
      missed_minutes:0,behavior_relevant:false,interruption_kind:null,recovery_state:'NONE',
      participation_evidence:[],recovery_facts:{},
    };

    let next = {
      studentId:request.student_id,
      courseId:klass.course_id,
      classId:klass.class_id,
      ...ids,
      scheduleVersion:klass.schedule_version,
      sourceTimetableVersionId:klass.source_timetable_version_id,
      sourceTimetableSlotId:klass.source_timetable_slot_id,
      scheduledStartAt:klass.scheduled_start_at,
      scheduledEndAt:klass.scheduled_end_at,
      obligationState:base.obligation_state,
      obligationDisposition:base.obligation_disposition,
      outcome:base.outcome||'PENDING',
      presenceState:base.presence_state,
      arrivedAt:base.arrived_at,
      exitedAt:base.exited_at,
      graceMinutes:Number(base.grace_minutes)||0,
      lateMinutes:base.late_minutes,
      materialLateness:Boolean(base.material_lateness),
      missedMinutes:Number(base.missed_minutes)||0,
      behaviorRelevant:Boolean(base.behavior_relevant),
      interruptionKind:base.interruption_kind,
      recoveryState:base.recovery_state||'NONE',
      participationEvidence:base.participation_evidence||[],
      policySnapshot:policy,
      recoveryFacts:base.recovery_facts||{},
      sourceRequestId:request.request_id,
      correctionKind:request.request_type,
      correctionReason:change.explanation||request.explanation||request.decision?.explanation||request.request_type,
      provenanceRefs:[`request:${request.request_id}`,`class:${classId}`],
      idempotencyKey:`d15-request:${request.request_id}:${request.state_version}`,
    };

    const fullMinutes = fullScheduledMinutes(klass);
    if (request.request_type === 'EMERGENCY_ABSENCE') {
      next = {
        ...next,
        outcome:'EXCUSED_ABSENCE',
        presenceState:'UNESTABLISHED',
        lateMinutes:null,
        materialLateness:false,
        missedMinutes:fullMinutes,
        behaviorRelevant:false,
        recoveryState:'DIAGNOSIS_REQUIRED',
        recoveryFacts:{reason:'EMERGENCY_ABSENCE',diagnosis_required:true,proof_required:false},
      };
    } else if (request.request_type === 'EARLY_DISMISSAL') {
      next = {
        ...next,
        exitedAt:change.requestedLeaveAt,
        behaviorRelevant:false,
        recoveryFacts:{
          ...(base.recovery_facts||{}),
          approved_early_dismissal:true,
          requested_leave_at:change.requestedLeaveAt,
        },
      };
    } else {
      const requested = assertOutcome(change.requestedOutcome);
      if (['PENDING','NO_OBLIGATION','RESCHEDULED'].includes(requested)) {
        throw fail('Requested retrospective outcome is not a valid correction target.', 'TEACHING_D15_CORRECTION_OUTCOME_INVALID', 422);
      }
      const noMiss = ['ON_TIME','SYSTEM_PROTECTED'].includes(requested);
      const fullMiss = ['EXCUSED_ABSENCE','APPROVED_LEAVE','UNEXCUSED_ABSENCE'].includes(requested);
      const correctedMissed = noMiss ? 0 : fullMiss ? fullMinutes : Number(base.missed_minutes)||0;
      next = {
        ...next,
        outcome:requested,
        lateMinutes:requested==='ON_TIME'?0:base.late_minutes,
        materialLateness:requested==='ON_TIME'||requested==='SYSTEM_PROTECTED'?false:Boolean(base.material_lateness),
        missedMinutes:correctedMissed,
        behaviorRelevant:['LATE','PARTIAL','UNEXCUSED_ABSENCE'].includes(requested),
        interruptionKind:requested==='SYSTEM_PROTECTED'?'AUTHORIZED_SYSTEM_PROTECTION':base.interruption_kind,
        recoveryState:correctedMissed>0&&requested!=='SYSTEM_PROTECTED'?'DIAGNOSIS_REQUIRED':'NONE',
        recoveryFacts:{
          ...(base.recovery_facts||{}),
          retrospective_correction:true,
          corrected_outcome:requested,
          diagnosis_required:correctedMissed>0&&requested!=='SYSTEM_PROTECTED',
        },
      };
    }

    const appended = await appendVersionUsing(tx,next);
    return {
      targetVersionAfter:`attendance:${appended.row.attendance_obligation_id}:version:${appended.row.version_no}`,
      safeMetadata:{
        attendance_record_id:appended.row.attendance_record_id,
        outcome:appended.row.outcome,
        correction:true,
        recovery_reconciliation_required:true,
        gradebook_mutated:false,
        skm_mutated:false,
      },
    };
  }

  return Object.freeze({
    assertReady,
    getClass,
    obligationIdentity,
    obligationFromClass,
    latestRecord,
    latestRecordForClass,
    latestRecordByRequest,
    appendVersionUsing,
    appendVersion,
    evidenceForClass,
    listLatest,
    listHistory,
    latestConcern,
    recordConcernStateUsing,
    recordConcern,
    resolveConcern,
    recordSystemInterruption,
    deferralCount,
    applyRequestUsing,
    auditUsing,
  });
}

module.exports={createD15AttendanceRepository};