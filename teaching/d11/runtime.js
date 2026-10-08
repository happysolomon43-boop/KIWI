'use strict';

const { TEACHING_EVENTS } = require('../events/names');
const { EVENT_CATEGORIES, RECONCILIATION_DISPOSITIONS } = require('../runtime/constants');

function eventField(event,camel,snake) {
  return event?.[camel] ?? event?.[snake] ?? null;
}

function scheduledEvent({eventType,eventId,studentId,classRow,dueAt,payload={}}) {
  const at=new Date(dueAt);
  if(!Number.isFinite(at.getTime())) throw new TypeError('D11 scheduled event dueAt is invalid.');
  const occurredAt=new Date().toISOString();
  return Object.freeze({
    eventId,
    schemaVersion:1,
    eventType,
    eventCategory:EVENT_CATEGORIES.SCHEDULED_DUE_EVENT,
    triggerType:'system_time',
    source:'teaching.d11',
    origin:'d11',
    actorId:studentId,
    aggregateType:'CLASS',
    aggregateId:classRow.class_id,
    aggregateVersion:Number(classRow.schedule_version),
    occurredAt,
    effectiveAt:at.toISOString(),
    dueAt:at.toISOString(),
    correlationId:eventId,
    causationId:null,
    idempotencyKey:eventId,
    payload:Object.freeze({
      student_id:studentId,
      class_id:classRow.class_id,
      course_id:classRow.course_id,
      schedule_version:Number(classRow.schedule_version),
      timetable_version_id:classRow.source_timetable_version_id || null,
      ...payload,
    }),
    auditRefs:Object.freeze([]),
    provenanceRefs:Object.freeze([
      'class:'+classRow.class_id,
      ...(classRow.source_timetable_version_id?['timetable:'+classRow.source_timetable_version_id]:[]),
    ]),
  });
}

async function seedClassRuntime({
  repository,dueEventStore,studentId,classRow,causationId=null,
  expectedTimetableVersionId=null,expectedScheduleVersion=null,
}) {
  const prep=await repository.ensurePreparationWorkspace({
    studentId,
    classId:classRow.class_id,
    correlationId:causationId,
    ...(expectedTimetableVersionId!=null?{
      expectedTimetableVersionId,expectedScheduleVersion,
    }:{}),
  });
  if(!prep)return Object.freeze({
    classId:classRow.class_id,skipped:true,reason:'AUTHORITATIVE_CLASS_SUPERSEDED',
  });
  const startId='d11-class-start:'+classRow.class_id+':schedule-v'+Number(classRow.schedule_version);
  const endId='d11-class-end:'+classRow.class_id+':schedule-v'+Number(classRow.schedule_version);
  await dueEventStore.enqueue(scheduledEvent({
    eventType:TEACHING_EVENTS.CLASS_START_DUE,
    eventId:startId,
    studentId,
    classRow,
    dueAt:classRow.scheduled_start_at,
    payload:{preparation_workspace_id:prep?.workspace?.workspace_id || null,kind:'SCHEDULED_START'},
  }));
  await dueEventStore.enqueue(scheduledEvent({
    eventType:TEACHING_EVENTS.CLASS_END_DUE,
    eventId:endId,
    studentId,
    classRow,
    dueAt:classRow.scheduled_end_at,
    payload:{kind:'SCHEDULED_END'},
  }));
  return Object.freeze({
    classId:classRow.class_id,
    startEventId:startId,
    endEventId:endId,
    preparationWorkspaceId:prep?.workspace?.workspace_id || null,
  });
}

function registerD11Runtime({
  publishedEvents,
  eventRuntime,
  dueEventStore,
  repository,
  service,
  outboxStore = null,
  attendanceService = null,
}={}) {
  if(!publishedEvents||typeof publishedEvents.register!=='function') throw new TypeError('D11 runtime requires published-event registry.');
  if(!eventRuntime||typeof eventRuntime.register!=='function') throw new TypeError('D11 runtime requires durable event runtime.');
  if(!dueEventStore||typeof dueEventStore.enqueue!=='function') throw new TypeError('D11 runtime requires due-event store.');
  if(!repository||typeof repository.getClassContext!=='function') throw new TypeError('D11 runtime requires repository.');
  if(!service||typeof service.startController!=='function') throw new TypeError('D11 runtime requires service.');

  const registrations=[];

  registrations.push(publishedEvents.register(TEACHING_EVENTS.COURSE_ACTIVATED,{
    subscriberId:'d11-course-activation-preclass-seed',
    handle:async(event)=>{
      const studentId=event.actorId;
      const courseId=event.payload?.course_id || event.aggregateId;
      if(!studentId||!courseId) return Object.freeze({accepted:true,noop:true,reason:'COURSE_ACTIVATED_CONTEXT_MISSING'});
      const classes=await repository.listClassesForCourse(studentId,courseId);
      const seeded=[];
      for(const classRow of classes) {
        seeded.push(await seedClassRuntime({
          repository,dueEventStore,studentId,classRow,causationId:event.eventId,
        }));
      }
      return Object.freeze({accepted:true,seeded:seeded.length,classRuntime:Object.freeze(seeded)});
    },
  }));

  registrations.push(publishedEvents.register(TEACHING_EVENTS.REQUEST_DECIDED,{
    subscriberId:'d11-request-decision-planning-signal',
    handle:async(event)=>{
      const studentId=event.actorId;
      const requestId=event.payload?.request_id || event.aggregateId;
      if(!studentId||!requestId) return Object.freeze({accepted:true,noop:true,reason:'REQUEST_DECIDED_CONTEXT_MISSING'});
      const request=await repository.getGovernedRequest(requestId);
      if(!request?.course_id) return Object.freeze({accepted:true,noop:true,reason:'REQUEST_DECIDED_COURSE_MISSING'});
      const refreshed=await service.refreshCoursePreparation(studentId,request.course_id,{
        correlationId:event.correlationId || event.eventId,
        interruptActive:false,
      });
      return Object.freeze({
        accepted:true,
        planning_signal_only:true,
        authoritative_target_applied:false,
        refreshed:refreshed.length,
      });
    },
  }));

  // Legacy request events contain target_version_after; new events also bind
  // timetable_version_id explicitly. Both are only routing hints, not authority.
  function appliedTimetableRef(event){
    const direct=event.payload?.timetable_version_id;
    if(typeof direct==='string'&&direct.trim())return direct.trim();
    const legacy=/^timetable:([^:]+):version:[0-9]+$/.exec(String(event.payload?.target_version_after||''));
    return legacy?.[1]||null;
  }

  registrations.push(publishedEvents.register(TEACHING_EVENTS.REQUEST_APPLIED,{
    subscriberId:'d11-request-applied-materiality',
    handle:async(event)=>{
      const studentId=event.actorId;
      const courseId=event.payload?.course_id;
      if(!studentId||!courseId) return Object.freeze({accepted:true,noop:true,reason:'REQUEST_APPLIED_CONTEXT_MISSING'});
      const timetableVersionId=appliedTimetableRef(event);
      // Preserve the original Course's live-session invalidation/materiality.
      // Its absence of Classes must NOT suppress newly materialized Classes
      // belonging to other Courses on the same approved timetable.
      const refreshed=await service.refreshCoursePreparation(studentId,courseId,{
        correlationId:event.correlationId || event.eventId,
        interruptActive:true,
      });
      const scheduleRequest=new Set([
        'SINGLE_CLASS_RESCHEDULE','PERMANENT_AVAILABILITY_CHANGE','ACADEMIC_BREAK',
        'COURSE_PAUSE','COURSE_RESUME','COURSE_CANCELLATION',
      ]).has(String(event.payload?.request_type||''));
      const legacyRequestId=event.payload?.request_id;
      if(timetableVersionId || scheduleRequest && legacyRequestId){
        if(!outboxStore||typeof outboxStore.append!=='function'
          ||(timetableVersionId
            ?typeof repository.listClassesForApprovedTimetable!=='function'
            :typeof repository.listClassesForAppliedScheduleRequest!=='function')){
          const error=new Error('D11 durable timetable-wide preparation reconciliation is unavailable.');
          error.code='TEACHING_D11_TIMETABLE_RECONCILIATION_UNAVAILABLE';
          throw error;
        }
        const classes=timetableVersionId
          ?await repository.listClassesForApprovedTimetable(studentId,timetableVersionId)
          :await repository.listClassesForAppliedScheduleRequest(studentId,legacyRequestId);
        for(const classRow of classes){
          const classTimetableVersionId=classRow.source_timetable_version_id;
          const id='d11-class-preparation-reconcile:'+event.eventId+':'+classRow.class_id;
          const timestamp=new Date().toISOString();
          await outboxStore.append({
            eventId:id,schemaVersion:1,
            eventType:TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE,
            eventCategory:EVENT_CATEGORIES.OPERATIONAL_RECOVERY_EVENT,
            triggerType:'workflow_continuation',
            source:'teaching.d11',origin:'d11',
            actorId:studentId,aggregateType:'CLASS',
            aggregateId:classRow.class_id,aggregateVersion:Number(classRow.schedule_version),
            occurredAt:timestamp,effectiveAt:timestamp,
            correlationId:event.correlationId||event.eventId,causationId:event.eventId,
            idempotencyKey:id,
            payload:{class_id:classRow.class_id,course_id:classRow.course_id,
              timetable_version_id:classTimetableVersionId,schedule_version:Number(classRow.schedule_version),
              reason:'APPROVED_TIMETABLE_RECONCILIATION'},
            auditRefs:[],provenanceRefs:['timetable:'+classTimetableVersionId,'class:'+classRow.class_id],
          });
        }
        return Object.freeze({accepted:true,refreshed:refreshed.length,
          queuedClassReconciliations:classes.length,timetableVersionId:timetableVersionId||null});
      }
      const classes=await repository.listClassesForCourse(studentId,courseId);
      const seeded=[];
      for(const classRow of classes){
        seeded.push(await seedClassRuntime({repository,dueEventStore,studentId,classRow,causationId:event.eventId}));
      }
      return Object.freeze({accepted:true,refreshed:refreshed.length,seeded:seeded.length});
    },
  }));

  // Each Class owns an independent, replay-safe and bounded reconciliation.
  // Validate the CURRENT Class, Course and approved timetable before any
  // workspace creation or Class start/end events. A replaced Class is a NOOP.
  registrations.push(publishedEvents.register(TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE,{
    subscriberId:'d11-approved-class-preparation-reconcile',
    handle:async(event)=>{
      const studentId=event.actorId,classId=event.payload?.class_id||event.aggregateId;
      const timetableVersionId=String(event.payload?.timetable_version_id||'');
      if(!studentId||!classId||!timetableVersionId){
        return Object.freeze({accepted:true,noop:true,reason:'CLASS_RECONCILIATION_CONTEXT_MISSING'});
      }
      const context=await repository.getClassContext(studentId,classId);
      const klass=context?.classRow;
      if(!klass||klass.student_id!==studentId||klass.class_id!==classId
        ||klass.source_timetable_version_id!==timetableVersionId
        ||Number(klass.schedule_version)!==Number(event.payload?.schedule_version)
        ||klass.source_timetable_state!=='APPROVED'
        ||klass.course_lifecycle_state!=='ACTIVE'
        ||klass.lifecycle_state!=='SCHEDULED'
        ||!Number.isFinite(Date.parse(klass.scheduled_start_at))
        ||Date.parse(klass.scheduled_start_at)<=Date.now()){
        return Object.freeze({accepted:true,noop:true,reason:'CLASS_NOT_CURRENTLY_PREPARABLE'});
      }
      const result=await seedClassRuntime({
        repository,dueEventStore,studentId,classRow:klass,causationId:event.eventId,
        expectedTimetableVersionId:timetableVersionId,
        expectedScheduleVersion:Number(event.payload?.schedule_version),
      });
      return result.skipped?Object.freeze({accepted:true,noop:true,reason:result.reason})
        :Object.freeze({accepted:true,seeded:true,classId,workspaceId:result.preparationWorkspaceId});
    },
  }));

  registrations.push(publishedEvents.register(TEACHING_EVENTS.CLASS_ENDED,{
    subscriberId:'d11-postclass-artifacts',
    handle:(event)=>service.processClassClosureArtifacts(event),
  }));

  for(const eventType of [TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,TEACHING_EVENTS.PREPARATION_INPUT_CHANGED]) {
    registrations.push(publishedEvents.register(eventType,{
      subscriberId:'d11-progressive-preparation',
      handle:(event)=>service.handlePreparationEvent(event),
    }));
  }

  eventRuntime.register(TEACHING_EVENTS.CLASS_START_DUE,{
    reconcile:async(event)=>{
      const studentId=event.payload?.student_id || event.actor_id;
      const classId=event.payload?.class_id || event.aggregate_id;
      const context=await repository.getClassContext(studentId,classId);
      if(!context?.classRow) return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_NO_LONGER_EXISTS'};
      if(Number(context.classRow.schedule_version)!==Number(event.payload?.schedule_version ?? event.aggregate_version)) {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_SCHEDULE_VERSION_CHANGED'};
      }
      if(String(context.classRow.course_lifecycle_state)!=='ACTIVE'||String(context.classRow.lifecycle_state)==='CANCELLED') {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_OR_COURSE_NOT_ACTIVE'};
      }
      if(context.session) return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'CONTROLLER_ALREADY_STARTED'};
      if(Date.now()>=Date.parse(context.classRow.scheduled_end_at)) {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_START_WINDOW_EXPIRED'};
      }
      return {
        disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE,
        metadata:{
          blueprint_available:Boolean(context.blueprint),
          model_route_required_for_t0_start:false,
        },
      };
    },
    handle:async(event)=>{
      const studentId=event.payload?.student_id || event.actor_id;
      const classId=event.payload?.class_id || event.aggregate_id;
      const state=await service.startController(
        {id:studentId},
        classId,
        event.event_id,
        event.idempotency_key,
        {allowRouteHeldStart:true}
      );
      const attendance = attendanceService && typeof attendanceService.onClassStarted === 'function'
        ? await attendanceService.onClassStarted(event)
        : null;
      return {safeMetadata:{
        class_id:classId,
        controller_version:state.controller?.stateVersion || null,
        lesson_blueprint_bound:Boolean(state.controller?.lessonBlueprintId),
        attendance_record_id:attendance?.record?.attendanceRecordId || null,
        attendance_owner:attendance ? 'D15' : null,
      }};
    },
  });

  eventRuntime.register(TEACHING_EVENTS.BREAK_END_DUE,{
    reconcile:async(event)=>{
      const studentId=event.payload?.student_id || event.actor_id;
      const classId=event.payload?.class_id || event.aggregate_id;
      const context=await repository.getClassContext(studentId,classId);
      if(!context?.session) return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CONTROLLER_NO_LONGER_EXISTS'};
      if(context.session.lifecycle_state==='CLOSED') return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'CLASS_ALREADY_CLOSED'};
      if(context.session.instructional_substate!=='BREAK') return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'BREAK_ALREADY_ENDED'};
      if(String(context.session.class_session_id)!==String(event.payload?.class_session_id||'')) {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'BREAK_SESSION_CHANGED'};
      }
      if(Number(context.session.state_version)!==Number(event.payload?.expected_controller_version)) {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'BREAK_CONTROLLER_VERSION_CHANGED'};
      }
      return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE};
    },
    handle:async(event)=>{
      const result=await service.resumeBreakFromDueEvent(event);
      return {safeMetadata:{
        class_id:event.payload?.class_id || event.aggregate_id,
        idempotent:Boolean(result?.idempotent),
        controller_version:result?.session?.state_version==null?null:Number(result.session.state_version),
      }};
    },
  });

  eventRuntime.register(TEACHING_EVENTS.CLASS_END_DUE,{
    reconcile:async(event)=>{
      const studentId=event.payload?.student_id || event.actor_id;
      const classId=event.payload?.class_id || event.aggregate_id;
      const context=await repository.getClassContext(studentId,classId);
      if(!context?.classRow) return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_NO_LONGER_EXISTS'};
      if(Number(context.classRow.schedule_version)!==Number(event.payload?.schedule_version ?? event.aggregate_version)) {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_SCHEDULE_VERSION_CHANGED'};
      }
      if(!context.session) return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'NO_LIVE_CONTROLLER_AT_CLASS_END'};
      if(context.session.lifecycle_state==='CLOSED') return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'CLASS_ALREADY_CLOSED'};
      if(String(event.payload?.kind||'SCHEDULED_END')==='OVERTIME_CEILING') {
        if(!context.session.overtime_ceiling_at || new Date(context.session.overtime_ceiling_at).getTime()!==new Date(event.due_at).getTime()) {
          return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'OVERTIME_CEILING_CHANGED'};
        }
      }
      return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE};
    },
    handle:async(event)=>{
      const result=await service.handleClassEndDue(event);
      return {safeMetadata:{
        class_id:event.payload?.class_id || event.aggregate_id,
        deferred:Boolean(result?.deferred),
        closed:Boolean(result?.closureFact),
      }};
    },
  });

  return Object.freeze({
    publishedRegistrations:Object.freeze(registrations),
    dueEventTypes:Object.freeze([
      TEACHING_EVENTS.CLASS_START_DUE,
      TEACHING_EVENTS.BREAK_END_DUE,
      TEACHING_EVENTS.CLASS_END_DUE,
    ]),
    serverTimeAuthoritative:true,
    modelRouteQualification:'UNQUALIFIED_UNTIL_D30',
  });
}

module.exports={scheduledEvent,seedClassRuntime,registerD11Runtime,eventField};
