'use strict';

const {
  LEARNING_EVIDENCE_DESCRIPTORS,
  ASSISTANCE_LEVELS,
  PRIORITY_ORDER,
  assertTransitionAllowed,
  classTimeEnvelope,
  computeOvertimeCeiling,
  nextInstructionCyclePhase,
  validateLessonBlueprintProposal,
} = require('./contracts');
const { TEACHING_EVENTS } = require('../events/names');
const { EVENT_CATEGORIES } = require('../runtime/constants');

function fail(message, code, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  throw error;
}

function expectedFromContext(context) {
  return Object.freeze({
    courseLifecycleState: context.classRow.course_lifecycle_state,
    courseStateVersion: context.classRow.course_state_version,
    classScheduleVersion: context.classRow.schedule_version,
    timetableVersionId: context.classRow.source_timetable_version_id || null,
    coursePlanId: context.plan?.course_plan_id || null,
    coursePlanVersion: context.plan?.version_no || null,
  });
}

function eventBase({
  eventType,
  eventId,
  studentId,
  classId,
  aggregateVersion,
  dueAt,
  payload = {},
  correlationId = null,
  causationId = null,
  provenanceRefs = [],
}) {
  const now = new Date().toISOString();
  return {
    eventId,
    schemaVersion: 1,
    eventType,
    eventCategory: EVENT_CATEGORIES.SCHEDULED_DUE_EVENT,
    triggerType: 'system_time',
    source: 'teaching.d11',
    origin: 'd11',
    actorId: studentId,
    aggregateType: 'CLASS',
    aggregateId: classId,
    aggregateVersion: Number(aggregateVersion),
    occurredAt: now,
    effectiveAt: dueAt,
    dueAt,
    correlationId,
    causationId,
    idempotencyKey: eventId,
    payload,
    auditRefs: [],
    provenanceRefs,
  };
}

function createD11Service({
  repository,
  intelligence = null,
  withTransaction,
  dueEventStore,
  clock = () => new Date(),
  minimumReserveMinutes = 1,
} = {}) {
  if (!repository || typeof repository.getClassContext !== 'function') throw new TypeError('D11 service requires repository.');
  if (typeof withTransaction !== 'function') throw new TypeError('D11 service requires withTransaction().');
  if (!dueEventStore || typeof dueEventStore.enqueueUsing !== 'function') throw new TypeError('D11 service requires the D02 due-event store.');

  function assertModelRoute() {
    if (!intelligence) {
      fail(
        'Teaching intelligence route is intentionally held until D30 qualification.',
        'TEACHING_D11_MODEL_ROUTE_UNQUALIFIED',
        503
      );
    }
  }

  function assertClassPlanningEligible(context) {
    if (!context?.classRow) fail('Teaching Class not found.', 'TEACHING_D11_CLASS_NOT_FOUND', 404);
    if (!context.plan) fail('Current Course Plan is required.', 'TEACHING_D11_COURSE_PLAN_REQUIRED', 409);
    if (!['ACTIVE','READY'].includes(String(context.classRow.course_lifecycle_state))) {
      fail('Course state does not permit D11 lesson planning.', 'TEACHING_D11_COURSE_STATE_INVALID', 409);
    }
    if (String(context.classRow.lifecycle_state) === 'CANCELLED') {
      fail('Cancelled Class cannot be planned or taught.', 'TEACHING_D11_CLASS_CANCELLED', 409);
    }
  }

  function publicContext(context, now = clock()) {
    if (!context) return null;
    const time = classTimeEnvelope({
      scheduledStartAt: context.classRow.scheduled_start_at,
      scheduledEndAt: context.classRow.scheduled_end_at,
      overtimeCeilingAt: context.session?.overtime_ceiling_at || null,
      serverNow: now,
    });
    return Object.freeze({
      class: Object.freeze({
        classId: context.classRow.class_id,
        courseId: context.classRow.course_id,
        lifecycleState: context.classRow.lifecycle_state,
        scheduleVersion: Number(context.classRow.schedule_version),
        scheduledStartAt: context.classRow.scheduled_start_at,
        scheduledEndAt: context.classRow.scheduled_end_at,
        timezone: context.classRow.timezone,
      }),
      course: Object.freeze({
        lifecycleState: context.classRow.course_lifecycle_state,
        stateVersion: Number(context.classRow.course_state_version),
      }),
      plan: context.plan ? Object.freeze({
        coursePlanId: context.plan.course_plan_id,
        versionNo: Number(context.plan.version_no),
      }) : null,
      blueprint: context.blueprint ? Object.freeze({
        lessonBlueprintId: context.blueprint.lesson_blueprint_id,
        versionNo: Number(context.blueprint.version_no),
        state: context.blueprint.blueprint_state,
        payload: context.blueprint.blueprint_payload,
      }) : null,
      controller: context.session ? Object.freeze({
        classSessionId: context.session.class_session_id,
        lifecycleState: context.session.lifecycle_state,
        instructionalSubstate: context.session.instructional_substate,
        stateVersion: Number(context.session.state_version),
        eventCursor: Number(context.session.event_cursor),
        cyclePhase: context.session.cycle_phase,
        learningEvidenceDescriptor: context.session.current_learning_evidence_descriptor,
        assistanceLevel: context.session.current_assistance_level,
        progressState: context.session.progress_state || {},
        resumeInstructionalSubstate: context.session.resume_instructional_substate || null,
        breakStartedAt: context.session.break_started_at || null,
        breakEndsAt: context.session.break_ends_at || null,
        overtimeStartedAt: context.session.overtime_started_at || null,
        overtimeCeilingAt: context.session.overtime_ceiling_at || null,
        closureReason: context.session.closure_reason || null,
      }) : null,
      time,
      priorityOrder: PRIORITY_ORDER,
      serverAuthoritative: true,
      modelRouteQualification: intelligence ? 'INJECTED_FOR_VALIDATED_EXECUTION' : 'UNQUALIFIED_UNTIL_D30',
    });
  }

  async function getClass(user, classId) {
    const context = await repository.getClassContext(user.id, classId);
    if (!context) fail('Teaching Class not found.', 'TEACHING_D11_CLASS_NOT_FOUND', 404);
    return publicContext(context);
  }

  async function prepareLesson(user, classId) {
    assertModelRoute();
    let context = await repository.getClassContext(user.id, classId);
    assertClassPlanningEligible(context);
    const prep = await repository.ensurePreparationWorkspace({ studentId:user.id, classId });
    context = await repository.getClassContext(user.id, classId);
    const signals = await repository.getPlanningSignals(user.id, context.classRow);

    const result = await intelligence.planLesson({ context, signals });
    if (!result?.accepted || !result.validatedResult) {
      fail('Lesson Planner did not produce an accepted provisional Blueprint.', 'TEACHING_D11_BLUEPRINT_NOT_ACCEPTED', 422);
    }
    const validation = validateLessonBlueprintProposal(result.validatedResult, {
      learningUnits: context.learningUnits,
      scheduledStartAt: context.classRow.scheduled_start_at,
      scheduledEndAt: context.classRow.scheduled_end_at,
      minimumReserveMinutes,
    });
    if (!validation.ok) {
      fail('Lesson Blueprint failed deterministic D11 validation.', validation.reason || 'TEACHING_D11_BLUEPRINT_INVALID', 422, validation);
    }

    const saved = await repository.saveBlueprint({
      studentId:user.id,
      classId,
      expected:expectedFromContext(context),
      blueprint:validation.value,
      validationMetadata:{
        deterministic_validation:'PASS',
        reserve_policy:{minimum_minutes:minimumReserveMinutes},
        orchestrator_execution_id:result.executionId || null,
      },
      generationProvenance:{
        capability_id:'teaching.lesson.pre_class_lesson_planning',
        authority_ceiling:'T3',
        provisional_until_owner_commit:true,
        route_qualification:'D30_OWNED',
      },
      preparationRef:prep?.workspace?.workspace_id || null,
    });
    return publicContext({ ...context, blueprint:saved.blueprint, session:saved.session || context.session });
  }

  async function replanLesson(user, classId) {
    assertModelRoute();
    let context = await repository.getClassContext(user.id, classId);
    assertClassPlanningEligible(context);
    if (!context.session || context.session.lifecycle_state === 'CLOSED') {
      fail('Live replanning requires an active Controller session.', 'TEACHING_D11_CONTROLLER_NOT_ACTIVE', 409);
    }
    if (!context.blueprint) fail('Live replanning requires a current Lesson Blueprint.', 'TEACHING_D11_BLUEPRINT_REQUIRED', 409);
    const time = classTimeEnvelope({
      scheduledStartAt:context.classRow.scheduled_start_at,
      scheduledEndAt:context.classRow.scheduled_end_at,
      overtimeCeilingAt:context.session.overtime_ceiling_at,
      serverNow:clock(),
    });
    if (time.remaining_minutes <= 0) fail('No authoritative Class time remains for replanning.', 'TEACHING_D11_REPLAN_NO_TIME', 409);
    const signals = await repository.getPlanningSignals(user.id, context.classRow);
    const result = await intelligence.replanLesson({ context, signals, remainingMinutes:time.remaining_minutes });
    if (!result?.accepted || !result.validatedResult) {
      fail('Live Lesson replan was not accepted.', 'TEACHING_D11_REPLAN_NOT_ACCEPTED', 422);
    }
    const saved = await repository.saveBlueprint({
      studentId:user.id,
      classId,
      expected:expectedFromContext(context),
      blueprint:result.validatedResult,
      validationMetadata:{
        deterministic_validation:'PASS',
        remaining_minutes:time.remaining_minutes,
        controller_version:Number(context.session.state_version),
        orchestrator_execution_id:result.executionId || null,
      },
      generationProvenance:{
        capability_id:'teaching.lesson.live_lesson_replanning',
        authority_ceiling:'T3',
        provisional_until_owner_commit:true,
      },
      preparationRef:context.workspace?.workspace_id || null,
      expectedControllerVersion:Number(context.session.state_version),
    });
    context = await repository.getClassContext(user.id, classId);
    return publicContext(context);
  }

  async function startController(user, classId, sourceEventRef = null, idempotencyKey = null) {
    const context = await repository.getClassContext(user.id, classId);
    assertClassPlanningEligible(context);
    if (String(context.classRow.course_lifecycle_state) !== 'ACTIVE') {
      fail('Only an Active Course may start a live Class Controller.', 'TEACHING_D11_COURSE_NOT_ACTIVE', 409);
    }
    if (!context.blueprint) fail('A current validated Lesson Blueprint is required before Class start.', 'TEACHING_D11_BLUEPRINT_REQUIRED', 409);
    const now = clock();
    if (now.getTime() < new Date(context.classRow.scheduled_start_at).getTime()) {
      fail('Class cannot start before its authoritative scheduled time.', 'TEACHING_D11_CLASS_START_EARLY', 409);
    }
    const result = await withTransaction((tx)=>repository.ensureControllerStartedUsing(tx,{
      studentId:user.id,classId,expectedBlueprintId:context.blueprint.lesson_blueprint_id,sourceEventRef,idempotencyKey,
    }));
    return publicContext({ ...context, session:result.session });
  }

  async function transition(user, classId, input = {}) {
    const context = await repository.getClassContext(user.id, classId);
    if (!context?.session) fail('Controller has not started.', 'TEACHING_D11_CONTROLLER_NOT_STARTED', 409);
    const toState = String(input.toState || '').toUpperCase();
    assertTransitionAllowed({
      lifecycleState:context.session.lifecycle_state,
      fromState:context.session.instructional_substate,
      toState,
      resumeState:context.session.resume_instructional_substate,
    });
    const time = classTimeEnvelope({
      scheduledStartAt:context.classRow.scheduled_start_at,
      scheduledEndAt:context.classRow.scheduled_end_at,
      overtimeCeilingAt:context.session.overtime_ceiling_at,
      serverNow:clock(),
    });
    if (time.remaining_minutes <= 0 && toState !== 'CLOSURE') {
      fail('Authoritative Class time has elapsed; only Closure is legal.', 'TEACHING_D11_CLASS_TIME_ELAPSED', 409);
    }

    const extra = {};
    let lifecycle = context.session.lifecycle_state;
    if (toState === 'INTERRUPTED') {
      lifecycle = 'INTERRUPTED';
      extra.resume_instructional_substate = context.session.instructional_substate;
    } else if (context.session.instructional_substate === 'INTERRUPTED') {
      lifecycle = 'ACTIVE';
      extra.resume_instructional_substate = null;
    }

    const changed = await withTransaction((tx)=>repository.transitionUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      toState,lifecycleState:lifecycle,resumeState:context.session.resume_instructional_substate,
      reason:String(input.reason || 'Controller transition'),
      actionKind:'STATE_TRANSITION',
      extraUpdates:extra,
    }));
    return publicContext({ ...context, session:changed.session });
  }

  async function advanceInstructionCycle(user, classId, input = {}) {
    const context = await repository.getClassContext(user.id,classId);
    if (!context?.session || context.session.lifecycle_state !== 'ACTIVE') fail('Instruction cycle requires an active Controller.', 'TEACHING_D11_CONTROLLER_NOT_ACTIVE', 409);
    if (['BREAK','ASSESSMENT','INTERRUPTED','CLOSURE'].includes(context.session.instructional_substate)) {
      fail('Instruction cycle phase cannot advance in the current instructional substate.', 'TEACHING_D11_CYCLE_PHASE_BLOCKED', 409);
    }
    const next = nextInstructionCyclePhase(context.session.cycle_phase);
    const changed = await withTransaction((tx)=>repository.transitionUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      toState:context.session.instructional_substate,lifecycleState:context.session.lifecycle_state,
      reason:'Teach → Elicit/Check → Diagnose → Respond → Verify cycle progression',
      actionKind:'INSTRUCTION_CYCLE_ADVANCED',
      safeMetadata:{from_cycle_phase:context.session.cycle_phase,to_cycle_phase:next},
      extraUpdates:{cycle_phase:next},
    }));
    return publicContext({ ...context, session:changed.session });
  }

  async function setEvidenceDescriptor(user,classId,input={}) {
    const context=await repository.getClassContext(user.id,classId);
    if(!context?.session) fail('Controller has not started.','TEACHING_D11_CONTROLLER_NOT_STARTED',409);
    const descriptor=input.descriptor==null?null:String(input.descriptor).toUpperCase();
    if(descriptor!==null&&!LEARNING_EVIDENCE_DESCRIPTORS.includes(descriptor)) {
      fail('Unknown learning/evidence descriptor.','TEACHING_D11_DESCRIPTOR_INVALID',422);
    }
    const assistance=String(input.assistanceLevel || context.session.current_assistance_level || 'NONE').toUpperCase();
    if(!ASSISTANCE_LEVELS.includes(assistance)) fail('Unknown assistance level.','TEACHING_D11_ASSISTANCE_INVALID',422);
    const changed=await withTransaction((tx)=>repository.transitionUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      toState:context.session.instructional_substate,lifecycleState:context.session.lifecycle_state,
      reason:'Optional non-universal learning/evidence descriptor update',
      actionKind:'EVIDENCE_DESCRIPTOR_UPDATED',
      safeMetadata:{descriptor,assistance_level:assistance,descriptor_is_not_skm_state:true},
      extraUpdates:{current_learning_evidence_descriptor:descriptor,current_assistance_level:assistance},
    }));
    return publicContext({...context,session:changed.session});
  }

  async function recordProgress(user,classId,input={}) {
    const context=await repository.getClassContext(user.id,classId);
    if(!context?.session) fail('Controller has not started.','TEACHING_D11_CONTROLLER_NOT_STARTED',409);
    const changed=await withTransaction((tx)=>repository.recordProgressUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      completedSegmentRefs:Array.isArray(input.completedSegmentRefs)?input.completedSegmentRefs:[],
      completedObjectiveRefs:Array.isArray(input.completedObjectiveRefs)?input.completedObjectiveRefs:[],
      evidenceRefs:Array.isArray(input.evidenceRefs)?input.evidenceRefs:[],
      independentEvidenceObjectiveRefs:Array.isArray(input.independentEvidenceObjectiveRefs)?input.independentEvidenceObjectiveRefs:[],
    }));
    return publicContext({...context,session:changed.session});
  }

  async function startBreak(user,classId,input={}) {
    const context=await repository.getClassContext(user.id,classId);
    if(!context?.session||context.session.lifecycle_state!=='ACTIVE') fail('Break requires an active Controller.','TEACHING_D11_CONTROLLER_NOT_ACTIVE',409);
    if(['BREAK','ASSESSMENT','CLOSURE','INTERRUPTED'].includes(context.session.instructional_substate)) fail('Break is not legal in the current substate.','TEACHING_D11_BREAK_STATE_INVALID',409);
    if(context.session.overtime_started_at) fail('Breaks belong inside the scheduled Class block, not overtime.','TEACHING_D11_BREAK_OVERTIME_FORBIDDEN',409);
    const duration=Number(input.durationMinutes);
    if(!Number.isInteger(duration)||duration<=0) fail('Break durationMinutes must be a positive integer.','TEACHING_D11_BREAK_DURATION_INVALID',400);
    const now=clock();
    const endsAt=new Date(now.getTime()+duration*60000);
    if(endsAt.getTime()>new Date(context.classRow.scheduled_end_at).getTime()) fail('Break cannot extend beyond the scheduled Class end.','TEACHING_D11_BREAK_END_INVALID',409);

    const eventId='d11-break-end:'+context.session.class_session_id+':v'+(Number(input.expectedVersion)+1);
    const result=await withTransaction(async(tx)=>{
      const changed=await repository.transitionUsing(tx,{
        studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),toState:'BREAK',lifecycleState:'ACTIVE',
        reason:'Server-authoritative Class break started',actionKind:'BREAK_STARTED',
        extraUpdates:{resume_instructional_substate:context.session.instructional_substate,break_started_at:now,break_ends_at:endsAt},
      });
      await dueEventStore.enqueueUsing(tx.query.bind(tx),eventBase({
        eventType:TEACHING_EVENTS.BREAK_END_DUE,eventId,studentId:user.id,classId,
        aggregateVersion:Number(changed.session.state_version),dueAt:endsAt.toISOString(),
        payload:{class_id:classId,class_session_id:changed.session.class_session_id,expected_controller_version:Number(changed.session.state_version)},
        provenanceRefs:['class:'+classId,'lesson-blueprint:'+context.blueprint.lesson_blueprint_id],
      }));
      return changed;
    });
    return publicContext({...context,session:result.session});
  }

  async function authorizeOvertime(user,classId,input={}) {
    const context=await repository.getClassContext(user.id,classId);
    if(!context?.session||context.session.lifecycle_state!=='ACTIVE') fail('Overtime requires an active Controller.','TEACHING_D11_CONTROLLER_NOT_ACTIVE',409);
    if(context.session.instructional_substate==='BREAK') fail('Overtime cannot be authorized during Break.','TEACHING_D11_OVERTIME_BREAK_FORBIDDEN',409);
    const ceiling=computeOvertimeCeiling({scheduledEndAt:context.classRow.scheduled_end_at,requestedMinutes:Number(input.minutes),serverNow:clock()});
    const now=clock();
    const start=now.getTime()>=new Date(context.classRow.scheduled_end_at).getTime()?now:null;
    const eventId='d11-class-overtime-ceiling:'+context.session.class_session_id+':'+ceiling;
    const changed=await withTransaction(async(tx)=>{
      const result=await repository.transitionUsing(tx,{
        studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
        toState:context.session.instructional_substate,lifecycleState:'ACTIVE',
        reason:'Deterministic overtime ceiling authorized',actionKind:'OVERTIME_AUTHORIZED',
        safeMetadata:{absolute_ceiling_minutes:15,requested_minutes:Number(input.minutes)},
        extraUpdates:{overtime_ceiling_at:ceiling,...(start?{overtime_started_at:start}:{})},
      });
      await dueEventStore.enqueueUsing(tx.query.bind(tx),eventBase({
        eventType:TEACHING_EVENTS.CLASS_END_DUE,eventId,studentId:user.id,classId,
        aggregateVersion:Number(result.session.state_version),dueAt:ceiling,
        payload:{class_id:classId,class_session_id:result.session.class_session_id,kind:'OVERTIME_CEILING'},
        provenanceRefs:['class:'+classId],
      }));
      return result;
    });
    return publicContext({...context,session:changed.session});
  }

  function earlyClosureSatisfied(context) {
    const blueprint=context.blueprint?.blueprint_payload || {};
    const progress=context.session?.progress_state || {};
    const completed=new Set((progress.completed_objective_refs||[]).map(String));
    const independent=new Set((progress.independent_evidence_objective_refs||[]).map(String));
    const core=(blueprint.objectives||[]).filter((o)=>String(o.criticality).toUpperCase()==='CORE');
    return core.length>0&&core.every((o)=>completed.has(String(o.id))&&(!o.independent_evidence_required||independent.has(String(o.id))));
  }

  async function closeClass(user,classId,input={}) {
    let context=await repository.getClassContext(user.id,classId);
    if(!context?.session) fail('Controller has not started.','TEACHING_D11_CONTROLLER_NOT_STARTED',409);
    const now=clock();
    const beforeScheduledEnd=now.getTime()<new Date(context.classRow.scheduled_end_at).getTime();
    if(beforeScheduledEnd&&!earlyClosureSatisfied(context)&&input.force!==true) {
      fail('Early Closure requires completed core objectives and required independent evidence.','TEACHING_D11_EARLY_CLOSE_NOT_READY',409);
    }
    const committed=await repository.commitClosure({
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      reason:String(input.reason || (beforeScheduledEnd?'EARLY_CORE_EVIDENCE_SATISFIED':'CONTROLLER_CLOSURE')),
      sourceEventRef:input.sourceEventRef || null,idempotencyKey:input.idempotencyKey || null,
    });
    context=await repository.getClassContext(user.id,classId);

    let summaryState='ROUTE_HELD', summaryPayload={fact_pack_ref:committed.closureFact.closure_fact_id,translation_pending:true};
    let summaryProv={route_qualification:'UNQUALIFIED_UNTIL_D30',translation_only:true};
    let noteState='ROUTE_HELD', notePayload={fact_pack_ref:committed.closureFact.closure_fact_id,planning_note_pending:true};
    let noteProv={route_qualification:'UNQUALIFIED_UNTIL_D30'};

    if(intelligence) {
      try {
        const translated=await intelligence.translateSummary({context,closureFact:committed.closureFact});
        if(translated?.accepted&&translated.validatedResult) {
          summaryState='TRANSLATED'; summaryPayload=translated.validatedResult;
          summaryProv={execution_id:translated.executionId||null,capability_id:'teaching.lesson.student_facing_class_summary_generation',translation_only:true};
        }
      } catch (_) { summaryState='REVIEW_NEEDED'; }
      try {
        const note=await intelligence.writeTeacherNote({context,closureFact:committed.closureFact});
        if(note?.accepted&&note.validatedResult) {
          noteState='PRIVATE_NOTE'; notePayload=note.validatedResult;
          noteProv={execution_id:note.executionId||null,capability_id:'teaching.lesson.internal_post_class_teacher_note_generation'};
        }
      } catch (_) { noteState='REVIEW_NEEDED'; }
    }

    const [summary,teacherNote]=await Promise.all([
      repository.latestSummary(user.id,classId).then(existing=>existing||repository.persistSummary({
        studentId:user.id,classId,classSessionId:committed.session.class_session_id,
        closureFactId:committed.closureFact.closure_fact_id,state:summaryState,payload:summaryPayload,provenance:summaryProv,
      })),
      repository.latestTeacherNote(user.id,classId).then(existing=>existing||repository.persistTeacherNote({
        studentId:user.id,courseId:context.classRow.course_id,classId,classSessionId:committed.session.class_session_id,
        closureFactId:committed.closureFact.closure_fact_id,state:noteState,payload:notePayload,
        provenanceRefs:['class-closure:'+committed.closureFact.closure_fact_id],generationProvenance:noteProv,
      })),
    ]);

    return Object.freeze({
      ...publicContext({...context,session:committed.session}),
      closureFact:committed.closureFact,
      classSummary:summary,
      teacherNote:teacherNote,
    });
  }

  async function getSummary(user,classId) {
    const summary=await repository.latestSummary(user.id,classId);
    if(!summary) fail('Class Summary not found.','TEACHING_D11_SUMMARY_NOT_FOUND',404);
    return Object.freeze({
      classSummaryId:summary.class_summary_id,
      classId:summary.class_id,
      versionNo:Number(summary.version_no),
      state:summary.summary_state,
      payload:summary.summary_payload,
      createdAt:summary.created_at,
      translationOnly:true,
    });
  }

  async function getTeacherNote(user,classId) {
    const note=await repository.latestTeacherNote(user.id,classId);
    if(!note) fail('Teacher Note not found.','TEACHING_D11_TEACHER_NOTE_NOT_FOUND',404);
    return Object.freeze({
      teacherNoteId:note.teacher_note_id,
      classId:note.class_id,
      versionNo:Number(note.version_no),
      state:note.note_state,
      payload:note.note_payload,
      provenanceRefs:note.provenance_refs,
      createdAt:note.created_at,
      visibility:'PRIVATE_INTERNAL',
      gradebookOwner:false,
      skmOwner:false,
    });
  }

  return Object.freeze({
    getClass,
    prepareLesson,
    replanLesson,
    startController,
    transition,
    advanceInstructionCycle,
    setEvidenceDescriptor,
    recordProgress,
    startBreak,
    authorizeOvertime,
    closeClass,
    getSummary,
    getTeacherNote,
    publicContext,
    earlyClosureSatisfied,
  });
}

module.exports={createD11Service,eventBase};
