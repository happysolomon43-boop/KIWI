'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  resolveAttendancePolicy,graceMinutesFor,classifyArrival,hasMeaningfulParticipation,
  finalizeAttendance,evaluateAttendanceConcern,
}=require('../../../teaching/d15/contracts');
const {createD15Service}=require('../../../teaching/d15/service');
const {registerD15Runtime}=require('../../../teaching/d15/runtime');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');

const START='2026-09-30T10:00:00.000Z';
const END='2026-09-30T11:00:00.000Z';
const at=(minutes)=>new Date(Date.parse(START)+minutes*60000).toISOString();

function rowFrom(input,version,id){
  return {
    attendance_record_id:id,
    student_id:input.studentId,
    course_id:input.courseId,
    class_id:input.classId,
    attendance_obligation_id:input.attendanceObligationId,
    academic_obligation_ref:input.academicObligationRef,
    version_no:version,
    schedule_version:input.scheduleVersion,
    source_timetable_version_id:input.sourceTimetableVersionId||null,
    source_timetable_slot_id:input.sourceTimetableSlotId||null,
    scheduled_start_at:input.scheduledStartAt,
    scheduled_end_at:input.scheduledEndAt,
    obligation_state:input.obligationState,
    obligation_disposition:input.obligationDisposition||null,
    outcome:input.outcome,
    presence_state:input.presenceState,
    arrived_at:input.arrivedAt||null,
    exited_at:input.exitedAt||null,
    grace_minutes:input.graceMinutes,
    late_minutes:input.lateMinutes,
    material_lateness:Boolean(input.materialLateness),
    missed_minutes:input.missedMinutes||0,
    behavior_relevant:Boolean(input.behaviorRelevant),
    interruption_kind:input.interruptionKind||null,
    recovery_state:input.recoveryState||'NONE',
    participation_evidence:input.participationEvidence||[],
    policy_snapshot:input.policySnapshot||resolveAttendancePolicy(),
    recovery_facts:input.recoveryFacts||{},
    source_event_id:input.sourceEventId||null,
    source_request_id:input.sourceRequestId||null,
    correction_kind:input.correctionKind||null,
    correction_reason:input.correctionReason||null,
    supersedes_record_id:null,
    provenance_refs:input.provenanceRefs||[],
    idempotency_key:input.idempotencyKey,
    recorded_at:'2026-09-30T11:00:00.000Z',
  };
}

function harness({classPatch={},contextPatch={}}={}){
  const klass={
    class_id:'cl1',course_id:'co1',student_id:'u1',schedule_version:1,
    source_timetable_version_id:'tt1',source_timetable_slot_id:'slot1',
    scheduled_start_at:START,scheduled_end_at:END,lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',
    ...classPatch,
  };
  const versions=[]; const keys=new Map(); const queued=[]; const recovery=[]; const concerns=[];
  let evidence={join:null,leave:null,participation:[],session:null,interruptions:[]};
  let context={classRow:klass,session:{class_session_id:'s1',state_version:1,lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION'},...contextPatch};
  let ids=0;
  const repository={
    getClass:async()=>klass,
    obligationIdentity:()=>({attendanceObligationId:`class:${klass.class_id}:schedule-v${klass.schedule_version}`,academicObligationRef:`timetable-slot:${klass.source_timetable_slot_id}`}),
    obligationFromClass:()=>{
      const no=['CANCELLED','SYSTEM_CANCELLED'].includes(String(klass.lifecycle_state));
      return {obligationState:no?'NO_OBLIGATION':'REQUIRED',obligationDisposition:klass.lifecycle_state==='SYSTEM_CANCELLED'?'SYSTEM_PROTECTED':klass.lifecycle_state==='CANCELLED'?'RESCHEDULED':null};
    },
    latestRecord:async()=>versions.at(-1)||null,
    latestRecordForClass:async()=>versions.at(-1)||null,
    appendVersion:async(input)=>{
      if(keys.has(input.idempotencyKey)) return {row:keys.get(input.idempotencyKey),idempotent:true};
      const row=rowFrom(input,versions.length+1,`a${++ids}`); if(versions.length)row.supersedes_record_id=versions.at(-1).attendance_record_id;
      versions.push(row);keys.set(input.idempotencyKey,row);return {row,idempotent:false};
    },
    evidenceForClass:async()=>evidence,
    listLatest:async()=>[...versions].reverse().slice(0,6),
    latestConcern:async()=>concerns.at(-1)||null,
    recordConcern:async(input)=>{const value={attendance_concern_id:`q${concerns.length+1}`,concern_state:'OPEN',policy_version:input.evaluation.policyVersion,incident_count:input.evaluation.incidentCount,actions:input.evaluation.actions,explanation_facts:input.explanationFacts};concerns.push(value);return value;},
    resolveConcern:async(input)=>{const value={attendance_concern_id:`q${concerns.length+1}`,concern_state:'RESOLVED',policy_version:input.evaluation.policyVersion,incident_count:input.evaluation.incidentCount,actions:input.evaluation.actions,explanation_facts:input.explanationFacts};concerns.push(value);return value;},
    recordSystemInterruption:async()=>({verified:true}),
    deferralCount:async()=>2,
  };
  const replans=[];
  const d11Service={replanLesson:async(_user,_classId,input)=>{replans.push(input);return {controller:{stateVersion:2}};}};
  const d11Repository={getClassContext:async()=>context,getPlanningSignals:async()=>({source:'d11'})};
  const schedulerRecoveryOwner={recordAttendanceRecoveryNeed:async(input)=>{recovery.push(input);return {changed:true,targetMinutes:input.missedMinutes};}};
  const dueEventStore={enqueue:async(event)=>{queued.push(event);return {inserted:true,event};}};
  const service=createD15Service({repository,d11Repository,d11Service,schedulerRecoveryOwner,dueEventStore,clock:()=>new Date(at(30)),randomUUID:()=>`uuid-${++ids}`});
  return {service,repository,klass,versions,queued,recovery,concerns,replans,setEvidence:(value)=>{evidence=value;},setContext:(value)=>{context=value;}};
}

test('D06 attendance policies are the accepted versioned decisions',()=>{
  const p=resolveAttendancePolicy();
  assert.equal(p.lateness.policyVersion,'lateness.v1');
  assert.equal(p.lateness.authoritativeClock,'SERVER');
  assert.equal(p.lateness.materialLatenessRatio,0.25);
  assert.equal(p.concern.policyVersion,'attendance-concern.v1');
  assert.equal(p.concern.behaviorRelevantIncidents,3);
  assert.equal(p.concern.rollingObligations,6);
  assert.equal(p.concern.subjectMarkReduction,false);
  assert.equal(p.concern.probationEnabled,false);
});

test('grace is duration-aware and capped at five minutes',()=>{
  assert.equal(graceMinutesFor({scheduledStartAt:START,scheduledEndAt:at(30)}),3);
  assert.equal(graceMinutesFor({scheduledStartAt:START,scheduledEndAt:END}),5);
  assert.equal(graceMinutesFor({scheduledStartAt:START,scheduledEndAt:at(120)}),5);
});

test('exact scheduled boundary is on time',()=>assert.equal(classifyArrival({scheduledStartAt:START,scheduledEndAt:END,arrivedAt:START}).outcome,'ON_TIME'));
test('inside grace is on time',()=>assert.equal(classifyArrival({scheduledStartAt:START,scheduledEndAt:END,arrivedAt:at(4)}).outcome,'ON_TIME'));
test('exact grace threshold edge is on time',()=>assert.equal(classifyArrival({scheduledStartAt:START,scheduledEndAt:END,arrivedAt:at(5)}).outcome,'ON_TIME'));
test('outside grace is late',()=>assert.equal(classifyArrival({scheduledStartAt:START,scheduledEndAt:END,arrivedAt:at(6)}).outcome,'LATE'));
test('material lateness uses the configured quarter-duration ratio',()=>assert.equal(classifyArrival({scheduledStartAt:START,scheduledEndAt:END,arrivedAt:at(15)}).materialLateness,true));

test('class starts without a browser join and remains pending until finalization',async()=>{
  const h=harness(); const result=await h.service.ensureStartRecord({studentId:'u1',classId:'cl1',sourceEventId:'start'});
  assert.equal(result.record.outcome,'PENDING');assert.equal(h.queued.length,1);assert.equal(h.queued[0].eventType,TEACHING_EVENTS.ATTENDANCE_FINALIZATION_DUE);
});

test('no arrival at finalization is unexcused absence with diagnosis-first recovery',()=>{
  const final=finalizeAttendance({scheduledStartAt:START,scheduledEndAt:END});
  assert.equal(final.outcome,'UNEXCUSED_ABSENCE');assert.equal(final.recoveryState,'DIAGNOSIS_REQUIRED');assert.equal(final.behaviorRelevant,true);
});

test('approved leave is behavior protected but still represents missed learning',()=>{
  const final=finalizeAttendance({scheduledStartAt:START,scheduledEndAt:END,approvedOutcome:'APPROVED_LEAVE'});
  assert.equal(final.outcome,'APPROVED_LEAVE');assert.equal(final.behaviorRelevant,false);assert.equal(final.missedMinutes,60);assert.equal(final.recoveryState,'DIAGNOSIS_REQUIRED');
});

test('excused absence removes behavioral penalty without inventing recovered learning',()=>{
  const final=finalizeAttendance({scheduledStartAt:START,scheduledEndAt:END,approvedOutcome:'EXCUSED_ABSENCE'});
  assert.equal(final.outcome,'EXCUSED_ABSENCE');assert.equal(final.behaviorRelevant,false);assert.equal(final.missedMinutes,60);
});

test('no-obligation reschedule cannot become absence',()=>{
  const final=finalizeAttendance({obligationState:'NO_OBLIGATION',obligationDisposition:'RESCHEDULED',scheduledStartAt:START,scheduledEndAt:END});
  assert.equal(final.outcome,'RESCHEDULED');assert.equal(final.missedMinutes,0);assert.equal(final.behaviorRelevant,false);
});

test('system-protected interruption produces no attendance or recovery penalty',()=>{
  const final=finalizeAttendance({scheduledStartAt:START,scheduledEndAt:END,arrivedAt:at(8),interruption:{systemProtected:true}});
  assert.equal(final.outcome,'SYSTEM_PROTECTED');assert.equal(final.missedMinutes,0);assert.equal(final.behaviorRelevant,false);assert.equal(final.recoveryState,'NONE');
});

test('opening the Classroom alone is not meaningful participation',()=>assert.equal(hasMeaningfulParticipation([{kind:'JOIN'}]),false));
test('normal academic/Classroom interaction can establish meaningful participation',()=>assert.equal(hasMeaningfulParticipation([{kind:'STUDENT_RESPONSE'}]),true));

test('early departure records partial attendance and missed teaching time',()=>{
  const final=finalizeAttendance({scheduledStartAt:START,scheduledEndAt:END,arrivedAt:START,exitedAt:at(40),participationEvidence:[{kind:'STUDENT_RESPONSE'}]});
  assert.equal(final.outcome,'PARTIAL');assert.equal(final.missedMinutes,20);assert.equal(final.recoveryState,'DIAGNOSIS_REQUIRED');
});

test('late arrival invokes D11 replan and never grants automatic overtime',async()=>{
  const h=harness();await h.service.ensureStartRecord({studentId:'u1',classId:'cl1'});
  const result=await h.service.observeJoin({id:'u1'},'cl1',{interactionId:'join-1',occurredAt:at(8)});
  assert.equal(result.record.outcome,'LATE');assert.equal(result.replan.owner,'D11');assert.equal(h.replans.length,1);
  assert.equal(h.versions.at(-1).recovery_facts.automatic_overtime,false);
});

test('quick reconnect resumes an interrupted attendance record without declaring absence',async()=>{
  const h=harness();await h.service.ensureStartRecord({studentId:'u1',classId:'cl1'});await h.service.observeJoin({id:'u1'},'cl1',{interactionId:'join-1',occurredAt:START});
  h.setEvidence({join:{created_at:START},leave:null,participation:[],session:null,interruptions:[]});
  await h.service.observeInteraction({id:'u1'},'cl1',{interactionId:'tech-1',kind:'TECHNICAL_ISSUE',occurredAt:at(10)});
  const resumed=await h.service.observeJoin({id:'u1'},'cl1',{interactionId:'join-2',occurredAt:at(11)});
  assert.notEqual(resumed.record.outcome,'UNEXCUSED_ABSENCE');assert.equal(resumed.record.presenceState,'PRESENT');
});

test('independent-work silence does not imply absence',async()=>{
  const h=harness({contextPatch:{session:{class_session_id:'s1',state_version:1,lifecycle_state:'ACTIVE',instructional_substate:'INDEPENDENT_PRACTICE'}}});
  await h.service.ensureStartRecord({studentId:'u1',classId:'cl1'});
  const result=await h.service.inactivityDue({event_id:'e1',payload:{student_id:'u1',class_id:'cl1',interaction_expected:true}});
  assert.equal(result.action,'NOOP');assert.equal(result.reason,'SILENCE_EXPECTED_IN_CURRENT_MODE');
});

test('contextual inactivity enters still-working interruption path, not absence',async()=>{
  const h=harness();await h.service.ensureStartRecord({studentId:'u1',classId:'cl1'});await h.service.observeJoin({id:'u1'},'cl1',{interactionId:'join-1',occurredAt:START});
  const result=await h.service.inactivityDue({event_id:'e1',idempotency_key:'idle-1',payload:{student_id:'u1',class_id:'cl1',interaction_expected:true}});
  assert.equal(result.action,'STILL_WORKING_PROMPT');assert.equal(result.absenceDeclared,false);assert.equal(result.record.outcome,'INTERRUPTED');
  assert.equal(h.versions.at(-1).recovery_facts.tab_focus_used_as_proof,false);
});

test('three configured behavior-relevant incidents in six obligations trigger concern without marks',()=>{
  const records=[
    {obligation_state:'REQUIRED',outcome:'LATE',material_lateness:false},
    {obligation_state:'REQUIRED',outcome:'UNEXCUSED_ABSENCE'},
    {obligation_state:'REQUIRED',outcome:'PARTIAL',behavior_relevant:true},
    {obligation_state:'REQUIRED',outcome:'ON_TIME'},
  ];
  const result=evaluateAttendanceConcern(records);
  assert.equal(result.triggered,true);assert.equal(result.incidentCount,3);assert.equal(result.subjectMarkReduction,false);assert.equal(result.probationEnabled,false);
});

test('approved/system outcomes do not count toward Attendance Concern',()=>{
  const result=evaluateAttendanceConcern([
    {obligation_state:'REQUIRED',outcome:'EXCUSED_ABSENCE'},
    {obligation_state:'REQUIRED',outcome:'APPROVED_LEAVE'},
    {obligation_state:'REQUIRED',outcome:'SYSTEM_PROTECTED'},
  ]);
  assert.equal(result.triggered,false);assert.equal(result.incidentCount,0);
});

test('verified KIWI outage supersedes prior absence and reverses recovery target',async()=>{
  const h=harness();await h.service.ensureStartRecord({studentId:'u1',classId:'cl1'});
  h.setEvidence({join:null,leave:null,participation:[],session:{lifecycle_state:'CLOSED'},interruptions:[]});
  const absent=await h.service.finalizeClass({studentId:'u1',classId:'cl1',sourceEventId:'end'});
  assert.equal(absent.record.outcome,'UNEXCUSED_ABSENCE');assert.equal(h.recovery.at(-1).missedMinutes,60);
  const protectedResult=await h.service.protectSystemInterruption({studentId:'u1',classId:'cl1',incidentRef:'incident-1',startsAt:at(20)});
  assert.equal(protectedResult.record.outcome,'SYSTEM_PROTECTED');assert.equal(protectedResult.record.missedMinutes,0);assert.equal(h.recovery.at(-1).missedMinutes,0);
});

test('authorized correction cannot be overwritten by replayed join classification',async()=>{
  const h=harness();await h.service.ensureStartRecord({studentId:'u1',classId:'cl1'});
  const corrected=rowFrom({studentId:'u1',courseId:'co1',classId:'cl1',attendanceObligationId:'class:cl1:schedule-v1',academicObligationRef:'timetable-slot:slot1',scheduleVersion:1,sourceTimetableVersionId:'tt1',sourceTimetableSlotId:'slot1',scheduledStartAt:START,scheduledEndAt:END,obligationState:'REQUIRED',outcome:'EXCUSED_ABSENCE',presenceState:'UNESTABLISHED',graceMinutes:5,missedMinutes:60,behaviorRelevant:false,recoveryState:'DIAGNOSIS_REQUIRED',correctionKind:'ATTENDANCE_REVIEW_CORRECTION',correctionReason:'Approved review',policySnapshot:resolveAttendancePolicy(),idempotencyKey:'correction'},2,'corrected');
  h.versions.push(corrected);
  const count=h.versions.length;const replay=await h.service.observeJoin({id:'u1'},'cl1',{interactionId:'old-join',occurredAt:at(9)});
  assert.equal(replay.record.outcome,'EXCUSED_ABSENCE');assert.equal(h.versions.length,count);
});

test('makeup readiness is diagnostic-first and does not let D15 author the Lesson Blueprint',async()=>{
  const h=harness();await h.service.ensureStartRecord({studentId:'u1',classId:'cl1'});h.setEvidence({join:null,leave:null,participation:[],session:{lifecycle_state:'CLOSED'},interruptions:[]});await h.service.finalizeClass({studentId:'u1',classId:'cl1'});
  const value=await h.service.makeupReadiness({id:'u1'},'cl1');assert.equal(value.diagnosisRequired,true);assert.equal(value.makeupStrategy,'DIAGNOSTIC_FIRST');assert.equal(value.lessonPlannerOwner,'D11');assert.equal(value.blindReplayAllowed,false);
});

test('deferral state tracks the same obligation without inferring motive',async()=>{
  const h=harness();const value=await h.service.deferralState({id:'u1'},'cl1');assert.equal(value.approvedSingleClassDeferrals,2);assert.equal(value.indefiniteAutomatedDeferralAllowed,false);assert.equal(value.behaviorInference,false);
});

test('student-facing course record suppresses gamified percentage and cross-domain mutations',async()=>{
  const h=harness();await h.service.ensureStartRecord({studentId:'u1',classId:'cl1'});const value=await h.service.courseRecord({id:'u1'},'co1');
  assert.equal(value.summary.attendanceScore,null);assert.equal(value.summary.naivePercentageSuppressed,true);assert.equal(value.authority.gradebookMutation,false);assert.equal(value.authority.skmMutation,false);
  assert.equal(value.records[0].assessmentAttemptCreated,false);
});

test('runtime owns finalization/inactivity and subscribes to Request application/Class closure',()=>{
  const due=new Map(),published=[];
  const eventRuntime={register:(type,handler)=>due.set(type,handler)};
  const publishedEvents={register:(type,handler)=>{published.push([type,handler.subscriberId]);return true;}};
  const repository={getClass:async()=>({schedule_version:1,lifecycle_state:'SCHEDULED'})};
  const service={finalizeClass:async()=>({record:null}),inactivityDue:async()=>({action:'NOOP'}),supersedeObligationFromDueEvent:async()=>({record:null}),onAttendanceRequestApplied:async()=>({accepted:true})};
  const runtime=registerD15Runtime({eventRuntime,publishedEvents,repository,service});
  assert.ok(due.has(TEACHING_EVENTS.ATTENDANCE_FINALIZATION_DUE));assert.ok(due.has(TEACHING_EVENTS.ACTIVITY_TIMER_EXPIRED));
  assert.ok(published.some(([type])=>type===TEACHING_EVENTS.REQUEST_APPLIED));assert.ok(published.some(([type])=>type===TEACHING_EVENTS.CLASS_ENDED));
  assert.equal(runtime.browserAttendanceAuthority,false);
});
