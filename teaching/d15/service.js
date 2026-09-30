'use strict';

const {
  resolveAttendancePolicy,classifyArrival,finalizeAttendance,evaluateAttendanceConcern,concernIncidentCode,fail,
}=require('./contracts');
const { TEACHING_EVENTS }=require('../events/names');
const { EVENT_CATEGORIES }=require('../runtime/constants');

function createD15Service({
  repository,d11Repository=null,d11Service=null,schedulerRecoveryOwner=null,dueEventStore=null,
  clock=()=>new Date(),randomUUID,
}={}){
  if(!repository||typeof repository.getClass!=='function') throw new TypeError('D15 requires its Attendance Ledger repository.');
  if(typeof randomUUID!=='function') throw new TypeError('D15 requires randomUUID().');
  const now=()=>{const v=clock();return v instanceof Date?v:new Date(v);};

  function policy(){ return resolveAttendancePolicy(); }
  function publicRecord(row){
    if(!row) return null;
    return Object.freeze({
      attendanceRecordId:row.attendance_record_id,attendanceObligationId:row.attendance_obligation_id,
      academicObligationRef:row.academic_obligation_ref,versionNo:Number(row.version_no),courseId:row.course_id,classId:row.class_id,
      scheduledStartAt:row.scheduled_start_at,scheduledEndAt:row.scheduled_end_at,obligationState:row.obligation_state,
      obligationDisposition:row.obligation_disposition||null,outcome:row.outcome,presenceState:row.presence_state,
      arrivedAt:row.arrived_at||null,exitedAt:row.exited_at||null,graceMinutes:Number(row.grace_minutes),
      lateMinutes:row.late_minutes==null?null:Number(row.late_minutes),materialLateness:Boolean(row.material_lateness),
      missedMinutes:Number(row.missed_minutes)||0,recoveryState:row.recovery_state,behaviorRelevant:Boolean(row.behavior_relevant),
      interruptionKind:row.interruption_kind||null,policyVersion:row.policy_snapshot?.lateness?.policyVersion||null,
      correction:row.correction_kind?Object.freeze({kind:row.correction_kind,reason:row.correction_reason||null,sourceRequestId:row.source_request_id||null}):null,
      recordedAt:row.recorded_at,assessmentAttemptCreated:false,gradebookMutated:false,skmMutated:false,
    });
  }

  function scheduledFinalizeEvent({studentId,classRow,causationId=null}){
    const eventId=`d15-attendance-finalize:${classRow.class_id}:schedule-v${Number(classRow.schedule_version)}`;
    const dueAt=new Date(classRow.scheduled_end_at).toISOString();
    const occurredAt=now().toISOString();
    return Object.freeze({
      eventId,schemaVersion:1,eventType:TEACHING_EVENTS.ATTENDANCE_FINALIZATION_DUE,
      eventCategory:EVENT_CATEGORIES.SCHEDULED_DUE_EVENT,triggerType:'system_time',source:'attendance',origin:'d15',actorId:studentId,
      aggregateType:'CLASS',aggregateId:classRow.class_id,aggregateVersion:Number(classRow.schedule_version),
      occurredAt,effectiveAt:dueAt,dueAt,correlationId:eventId,causationId,idempotencyKey:eventId,
      payload:{student_id:studentId,class_id:classRow.class_id,course_id:classRow.course_id,schedule_version:Number(classRow.schedule_version)},
      auditRefs:[],provenanceRefs:[`class:${classRow.class_id}`,...(classRow.source_timetable_version_id?[`timetable:${classRow.source_timetable_version_id}`]:[])],
    });
  }

  async function ensureStartRecord({studentId,classId,sourceEventId=null,causationId=null}){
    const klass=await repository.getClass(studentId,classId);
    if(!klass) throw fail('Teaching Class not found for attendance.','TEACHING_D15_CLASS_NOT_FOUND',404);
    const ids=repository.obligationIdentity(klass), obligation=repository.obligationFromClass(klass), p=policy();
    const current=await repository.latestRecord(studentId,ids.attendanceObligationId);
    if(current) return {record:current,classRow:klass,idempotent:true};
    const result=finalizeAttendance({
      obligationState:obligation.obligationState,obligationDisposition:obligation.obligationDisposition,
      scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,policy:p,
    });
    const initialOutcome=obligation.obligationState==='REQUIRED'?'PENDING':result.outcome;
    const appended=await repository.appendVersion({
      studentId,courseId:klass.course_id,classId:klass.class_id,...ids,scheduleVersion:klass.schedule_version,
      sourceTimetableVersionId:klass.source_timetable_version_id,sourceTimetableSlotId:klass.source_timetable_slot_id,
      scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,obligationState:obligation.obligationState,
      obligationDisposition:obligation.obligationDisposition,outcome:initialOutcome,presenceState:'UNESTABLISHED',
      graceMinutes:result.graceMinutes,lateMinutes:null,materialLateness:false,missedMinutes:0,behaviorRelevant:false,
      recoveryState:'NONE',participationEvidence:[],policySnapshot:p,recoveryFacts:{class_clock_shifts_for_lateness:false,automatic_overtime_for_lateness:false},
      sourceEventId,provenanceRefs:[`class:${klass.class_id}`,...(klass.source_timetable_version_id?[`timetable:${klass.source_timetable_version_id}`]:[])],
      idempotencyKey:`d15-start:${klass.class_id}:schedule-v${Number(klass.schedule_version)}`,
    });
    if(dueEventStore&&obligation.obligationState==='REQUIRED') await dueEventStore.enqueue(scheduledFinalizeEvent({studentId,classRow:klass,causationId}));
    return {record:appended.row,classRow:klass,idempotent:appended.idempotent};
  }

  async function onClassStarted(event){
    const studentId=event.payload?.student_id||event.actor_id||event.actorId;
    const classId=event.payload?.class_id||event.aggregate_id||event.aggregateId;
    const result=await ensureStartRecord({studentId,classId,sourceEventId:event.event_id||event.eventId,causationId:event.event_id||event.eventId});
    return Object.freeze({record:publicRecord(result.record),serverTimeAuthoritative:true});
  }

  async function invokeLateReplan(user,classId,attendance){
    if(!d11Service||typeof d11Service.replanLesson!=='function') return Object.freeze({status:'OWNER_UNAVAILABLE',owner:'D11'});
    try{
      const value=await d11Service.replanLesson(user,classId,{trigger:'D15_LATE_ARRIVAL',attendance});
      return Object.freeze({status:'APPLIED_BY_D11',owner:'D11',controller:value?.controller||null});
    }catch(error){
      if(['TEACHING_D11_MODEL_ROUTE_UNQUALIFIED','TEACHING_D11_REPLAN_NO_TIME','TEACHING_D11_REPLAN_NOT_ACCEPTED'].includes(error?.code)){
        return Object.freeze({status:'ROUTE_HELD_OR_NOT_FEASIBLE',owner:'D11',reason:error.code});
      }
      throw error;
    }
  }

  async function observeJoin(user,classId,{interactionId=null,occurredAt=null}={}){
    const seeded=await ensureStartRecord({studentId:user.id,classId,sourceEventId:null});
    const klass=seeded.classRow, ids=repository.obligationIdentity(klass), p=policy();
    const current=await repository.latestRecord(user.id,ids.attendanceObligationId);
    if(current?.correction_kind&&['ATTENDANCE_REVIEW_CORRECTION','EMERGENCY_ABSENCE'].includes(current.correction_kind)){
      return Object.freeze({record:publicRecord(current),replan:Object.freeze({status:'NOT_APPLICABLE_AFTER_AUTHORIZED_CORRECTION'})});
    }
    const at=occurredAt||now().toISOString();
    const arrival=classifyArrival({scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,arrivedAt:at,policy:p});
    const resume=current?.outcome==='INTERRUPTED';
    const key=resume?`d15-resume:${current.attendance_record_id}`:`d15-join:${interactionId||classId+':'+Number(klass.schedule_version)}`;
    const appended=await repository.appendVersion({
      studentId:user.id,courseId:klass.course_id,classId:klass.class_id,...ids,scheduleVersion:klass.schedule_version,
      sourceTimetableVersionId:klass.source_timetable_version_id,sourceTimetableSlotId:klass.source_timetable_slot_id,
      scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,obligationState:'REQUIRED',outcome:arrival.outcome,
      presenceState:'PRESENT',arrivedAt:current?.arrived_at||at,exitedAt:null,graceMinutes:arrival.graceMinutes,lateMinutes:arrival.lateMinutes,
      materialLateness:arrival.materialLateness,missedMinutes:arrival.outcome==='LATE'?arrival.lateMinutes:0,behaviorRelevant:arrival.outcome==='LATE',
      interruptionKind:null,recoveryState:arrival.outcome==='LATE'?'DIAGNOSIS_REQUIRED':'NONE',participationEvidence:current?.participation_evidence||[],
      policySnapshot:p,recoveryFacts:{late_arrival:arrival.outcome==='LATE',d11_replan_required:arrival.outcome==='LATE',automatic_overtime:false},
      provenanceRefs:[`class:${classId}`,...(interactionId?[`interaction:${interactionId}`]:[])],idempotencyKey:key,
    });
    const replan=arrival.outcome==='LATE'?await invokeLateReplan(user,classId,publicRecord(appended.row)):Object.freeze({status:'NOT_REQUIRED'});
    return Object.freeze({record:publicRecord(appended.row),replan});
  }

  async function observeInteraction(user,classId,{interactionId,kind,occurredAt=null}={}){
    const normalized=String(kind||'').toUpperCase();
    if(!['LEAVE','TECHNICAL_ISSUE','READY','FINISHED','ASK_TEACHER','NEED_HELP'].includes(normalized)) return null;
    const seeded=await ensureStartRecord({studentId:user.id,classId});
    const klass=seeded.classRow, ids=repository.obligationIdentity(klass), current=await repository.latestRecord(user.id,ids.attendanceObligationId);
    if(!current) return null;
    if(['READY','FINISHED','ASK_TEACHER','NEED_HELP'].includes(normalized)) return publicRecord(current);
    const evidence=await repository.evidenceForClass(user.id,classId);
    const p=current.policy_snapshot?.lateness?current.policy_snapshot:policy();
    if(normalized==='TECHNICAL_ISSUE'){
      const appended=await repository.appendVersion({
        studentId:user.id,courseId:klass.course_id,classId:klass.class_id,...ids,scheduleVersion:klass.schedule_version,
        sourceTimetableVersionId:klass.source_timetable_version_id,sourceTimetableSlotId:klass.source_timetable_slot_id,
        scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,obligationState:'REQUIRED',outcome:'INTERRUPTED',
        presenceState:'INTERRUPTED',arrivedAt:current.arrived_at||evidence.join?.created_at||null,exitedAt:null,graceMinutes:Number(current.grace_minutes),
        lateMinutes:current.late_minutes,materialLateness:Boolean(current.material_lateness),missedMinutes:Number(current.missed_minutes)||0,
        behaviorRelevant:false,interruptionKind:'NETWORK_OR_CLIENT_UNVERIFIED',recoveryState:current.recovery_state||'NONE',
        participationEvidence:evidence.participation,policySnapshot:p,recoveryFacts:{...(current.recovery_facts||{}),system_protected:false,verification_required_for_system_cause:true},
        provenanceRefs:[`class:${classId}`,`interaction:${interactionId}`],idempotencyKey:`d15-interruption:${interactionId}`,
      });
      return publicRecord(appended.row);
    }
    const final=finalizeAttendance({
      scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,arrivedAt:current.arrived_at||evidence.join?.created_at||null,
      exitedAt:occurredAt||now().toISOString(),participationEvidence:evidence.participation,policy:p,
    });
    const appended=await repository.appendVersion({
      studentId:user.id,courseId:klass.course_id,classId:klass.class_id,...ids,scheduleVersion:klass.schedule_version,
      sourceTimetableVersionId:klass.source_timetable_version_id,sourceTimetableSlotId:klass.source_timetable_slot_id,
      scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,obligationState:'REQUIRED',outcome:final.outcome,presenceState:final.presenceState,
      arrivedAt:current.arrived_at||evidence.join?.created_at||null,exitedAt:occurredAt||now().toISOString(),graceMinutes:final.graceMinutes,
      lateMinutes:final.lateMinutes,materialLateness:final.materialLateness,missedMinutes:final.missedMinutes,behaviorRelevant:final.behaviorRelevant,
      recoveryState:final.recoveryState,participationEvidence:evidence.participation,policySnapshot:p,
      recoveryFacts:{early_departure:true,diagnosis_required:final.recoveryState==='DIAGNOSIS_REQUIRED'},
      provenanceRefs:[`class:${classId}`,`interaction:${interactionId}`],idempotencyKey:`d15-leave:${interactionId}`,
    });
    return publicRecord(appended.row);
  }

  async function commitRecoveryEffect(record){
    if(!record||Number(record.missed_minutes)<=0||record.outcome==='SYSTEM_PROTECTED') return null;
    if(!schedulerRecoveryOwner||typeof schedulerRecoveryOwner.recordAttendanceRecoveryNeed!=='function') return Object.freeze({owner:'D09',status:'HANDOFF_RECORDED_ONLY'});
    return schedulerRecoveryOwner.recordAttendanceRecoveryNeed({
      studentId:record.student_id,courseId:record.course_id,classId:record.class_id,
      attendanceRecordId:record.attendance_record_id,missedMinutes:Number(record.missed_minutes),
      reason:record.outcome,sourceTimetableVersionId:record.source_timetable_version_id,
    });
  }

  async function evaluateConcern(record){
    if(!record?.course_id) return null;
    const p=policy().concern;
    const records=await repository.listLatest(record.student_id,{courseId:record.course_id,limit:p.rollingObligations});
    const evaluation=evaluateAttendanceConcern(records,p);
    if(!evaluation.triggered) return evaluation;
    const refs=records.filter((r)=>concernIncidentCode(r)).map((r)=>`attendance:${r.attendance_record_id}`);
    await repository.recordConcern({
      studentId:record.student_id,courseId:record.course_id,evaluation,recordRefs:refs,
      explanationFacts:{repeated_lateness:records.some((r)=>r.outcome==='LATE'),missed_instruction_minutes:records.reduce((n,r)=>n+Number(r.missed_minutes||0),0),timetable_review_required:true},
      idempotencyKey:`d15-concern:${record.course_id}:${evaluation.policyVersion}:${refs.sort().join('|')}`,
    });
    return evaluation;
  }

  async function finalizeClass({studentId,classId,sourceEventId=null}={}){
    const seeded=await ensureStartRecord({studentId,classId,sourceEventId});
    const klass=seeded.classRow,ids=repository.obligationIdentity(klass),current=await repository.latestRecord(studentId,ids.attendanceObligationId);
    if(current?.correction_kind&&['ATTENDANCE_REVIEW_CORRECTION','EMERGENCY_ABSENCE'].includes(current.correction_kind)){
      await commitRecoveryEffect(current);
      await evaluateConcern(current);
      return Object.freeze({record:publicRecord(current),correctionPreserved:true});
    }
    const evidence=await repository.evidenceForClass(studentId,classId);
    const p=current?.policy_snapshot?.lateness?current.policy_snapshot:policy();
    const systemProtected=(evidence.interruptions||[]).some((row)=>row.verified===true);
    const approvedEarly=current?.correction_kind==='EARLY_DISMISSAL'||Boolean(current?.recovery_facts?.approved_early_dismissal);
    const final=finalizeAttendance({
      obligationState:current?.obligation_state||repository.obligationFromClass(klass).obligationState,
      obligationDisposition:current?.obligation_disposition||repository.obligationFromClass(klass).obligationDisposition,
      scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,
      arrivedAt:current?.arrived_at||evidence.join?.created_at||null,
      exitedAt:current?.exited_at||(approvedEarly?current?.recovery_facts?.requested_leave_at:null)||evidence.leave?.created_at||null,
      participationEvidence:evidence.participation,interruption:systemProtected?{systemProtected:true}:current?.outcome==='INTERRUPTED'?{studentOrNetwork:true,resolved:false}:null,
      policy:p,
    });
    const appended=await repository.appendVersion({
      studentId,courseId:klass.course_id,classId:klass.class_id,...ids,scheduleVersion:klass.schedule_version,
      sourceTimetableVersionId:klass.source_timetable_version_id,sourceTimetableSlotId:klass.source_timetable_slot_id,
      scheduledStartAt:klass.scheduled_start_at,scheduledEndAt:klass.scheduled_end_at,
      obligationState:current?.obligation_state||'REQUIRED',obligationDisposition:current?.obligation_disposition||null,outcome:final.outcome,presenceState:final.presenceState,
      arrivedAt:current?.arrived_at||evidence.join?.created_at||null,exitedAt:current?.exited_at||evidence.leave?.created_at||null,
      graceMinutes:final.graceMinutes,lateMinutes:final.lateMinutes,materialLateness:final.materialLateness,missedMinutes:final.missedMinutes,
      behaviorRelevant:approvedEarly?false:final.behaviorRelevant,interruptionKind:systemProtected?'KIWI_SYSTEM_VERIFIED':current?.interruption_kind||null,
      recoveryState:final.recoveryState,participationEvidence:evidence.participation,policySnapshot:p,
      recoveryFacts:{diagnosis_required:final.recoveryState==='DIAGNOSIS_REQUIRED',makeup_must_start_with_diagnosis:final.recoveryState==='DIAGNOSIS_REQUIRED',
        automatic_overtime:false,assessment_attempt_truth_unchanged:true,approved_early_dismissal:approvedEarly},
      sourceEventId,provenanceRefs:[`class:${classId}`,...evidence.participation.map((x)=>x.ref)],
      idempotencyKey:`d15-finalize:${classId}:schedule-v${Number(klass.schedule_version)}`,
    });
    await commitRecoveryEffect(appended.row);
    const concern=await evaluateConcern(appended.row);
    return Object.freeze({record:publicRecord(appended.row),concern});
  }

  async function protectSystemInterruption(input={}){
    if(!input.studentId||!input.classId||!input.incidentRef) throw fail('Trusted system interruption identity is required.','TEACHING_D15_SYSTEM_INTERRUPTION_INVALID',400);
    await repository.recordSystemInterruption(input);
    return finalizeClass({studentId:input.studentId,classId:input.classId,sourceEventId:`system-incident:${input.incidentRef}`});
  }

  async function inactivityDue(event){
    const studentId=event.payload?.student_id||event.actor_id, classId=event.payload?.class_id||event.aggregate_id;
    const context=d11Repository&&typeof d11Repository.getClassContext==='function'?await d11Repository.getClassContext(studentId,classId):null;
    if(!context?.session||context.session.lifecycle_state==='CLOSED') return Object.freeze({action:'NOOP',reason:'NO_ACTIVE_CLASS'});
    const mode=String(context.session.instructional_substate||'');
    if(['INDEPENDENT_PRACTICE','BREAK'].includes(mode)) return Object.freeze({action:'NOOP',reason:'SILENCE_EXPECTED_IN_CURRENT_MODE'});
    const expected=Boolean(event.payload?.interaction_expected);
    if(!expected) return Object.freeze({action:'NOOP',reason:'NO_AUTHORITATIVE_INTERACTION_EXPECTATION'});
    const ids=repository.obligationIdentity(context.classRow);const current=await repository.latestRecord(studentId,ids.attendanceObligationId);
    if(!current) return Object.freeze({action:'NOOP',reason:'ATTENDANCE_NOT_STARTED'});
    const appended=await repository.appendVersion({
      studentId,courseId:context.classRow.course_id,classId,...ids,scheduleVersion:context.classRow.schedule_version,
      sourceTimetableVersionId:context.classRow.source_timetable_version_id,sourceTimetableSlotId:context.classRow.source_timetable_slot_id,
      scheduledStartAt:context.classRow.scheduled_start_at,scheduledEndAt:context.classRow.scheduled_end_at,obligationState:current.obligation_state,
      outcome:'INTERRUPTED',presenceState:'INTERRUPTED',arrivedAt:current.arrived_at,exitedAt:null,graceMinutes:Number(current.grace_minutes),
      lateMinutes:current.late_minutes,materialLateness:Boolean(current.material_lateness),missedMinutes:Number(current.missed_minutes)||0,
      behaviorRelevant:false,interruptionKind:'UNEXPLAINED_INACTIVITY_CHECK',recoveryState:current.recovery_state,participationEvidence:current.participation_evidence||[],
      policySnapshot:current.policy_snapshot,recoveryFacts:{...(current.recovery_facts||{}),still_working_prompt_required:true,tab_focus_used_as_proof:false},
      sourceEventId:event.event_id,provenanceRefs:[`class:${classId}`,`controller:${context.session.class_session_id}@${context.session.state_version}`],
      idempotencyKey:event.idempotency_key||`d15-inactivity:${event.event_id}`,
    });
    return Object.freeze({action:'STILL_WORKING_PROMPT',record:publicRecord(appended.row),absenceDeclared:false});
  }

  async function courseRecord(user,courseId){
    const rows=await repository.listLatest(user.id,{courseId});
    const concern=await repository.latestConcern(user.id,courseId);
    const obligations=rows.filter((r)=>r.obligation_state==='REQUIRED');
    return Object.freeze({
      courseId,records:Object.freeze(rows.map(publicRecord)),
      summary:Object.freeze({
        obligations:obligations.length,onTime:obligations.filter((r)=>r.outcome==='ON_TIME').length,late:obligations.filter((r)=>r.outcome==='LATE').length,
        partial:obligations.filter((r)=>r.outcome==='PARTIAL').length,unexcusedAbsence:obligations.filter((r)=>r.outcome==='UNEXCUSED_ABSENCE').length,
        excusedAbsence:obligations.filter((r)=>r.outcome==='EXCUSED_ABSENCE').length,approvedLeave:obligations.filter((r)=>r.outcome==='APPROVED_LEAVE').length,
        systemProtected:obligations.filter((r)=>r.outcome==='SYSTEM_PROTECTED').length,attendanceScore:null,naivePercentageSuppressed:true,
      }),
      concern:concern?Object.freeze({state:concern.concern_state,policyVersion:concern.policy_version,incidentCount:Number(concern.incident_count),
        actions:concern.actions||[],explanationFacts:concern.explanation_facts||{},subjectMarkReduction:false}):null,
      authority:Object.freeze({owner:'Attendance Ledger',serverTimeAuthoritative:true,browserClassifiesAttendance:false,gradebookMutation:false,skmMutation:false}),
    });
  }

  async function globalRecord(user){
    const rows=await repository.listLatest(user.id,{limit:500});
    const byCourse=new Map();
    for(const row of rows){const list=byCourse.get(row.course_id)||[];list.push(publicRecord(row));byCourse.set(row.course_id,list);}
    return Object.freeze({records:Object.freeze(rows.map(publicRecord)),courses:Object.freeze([...byCourse.entries()].map(([courseId,records])=>Object.freeze({courseId,records:Object.freeze(records)}))),attendanceScore:null});
  }

  async function classHistory(user,classId){return Object.freeze((await repository.listHistory(user.id,classId)).map(publicRecord));}

  async function makeupReadiness(user,classId){
    const current=await repository.latestRecordForClass(user.id,classId);
    if(!current) throw fail('Attendance record not found.','TEACHING_D15_RECORD_NOT_FOUND',404);
    const needs=Number(current.missed_minutes)>0&&current.outcome!=='SYSTEM_PROTECTED';
    const signals=d11Repository&&typeof d11Repository.getPlanningSignals==='function'
      ? await (async()=>{const klass=await repository.getClass(user.id,classId);return klass?d11Repository.getPlanningSignals(user.id,klass):null;})():null;
    return Object.freeze({classId,attendanceRecordId:current.attendance_record_id,diagnosisRequired:needs,
      makeupStrategy:needs?'DIAGNOSTIC_FIRST':'NONE',lessonPlannerOwner:'D11',attendanceOwner:'D15',
      possibleOutcomes:needs?Object.freeze(['FULL_INSTRUCTION','SUBSET_INSTRUCTION','TARGETED_PRACTICE','INDEPENDENT_VERIFICATION']):Object.freeze([]),
      planningSignalsAvailable:Boolean(signals),blindReplayAllowed:false});
  }

  async function deferralState(user,classId){
    const count=await repository.deferralCount(user.id,classId);
    return Object.freeze({classId,approvedSingleClassDeferrals:count,academicObligationStillTracked:true,
      timetableReviewRecommended:count>0,indefiniteAutomatedDeferralAllowed:false,behaviorInference:false});
  }

  return Object.freeze({
    onClassStarted,ensureStartRecord,observeJoin,observeInteraction,finalizeClass,protectSystemInterruption,inactivityDue,
    courseRecord,globalRecord,classHistory,makeupReadiness,deferralState,publicRecord,
  });
}
module.exports={createD15Service};
