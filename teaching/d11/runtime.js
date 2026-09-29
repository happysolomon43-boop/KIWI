'use strict';

const { TEACHING_EVENTS } = require('../events/names');
const { EVENT_CATEGORIES, RECONCILIATION_DISPOSITIONS } = require('../runtime/constants');

function scheduledEvent({eventType,eventId,studentId,classRow,dueAt,payload={}}) {
  const occurredAt=new Date().toISOString();
  return {
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
    effectiveAt:new Date(dueAt).toISOString(),
    dueAt:new Date(dueAt).toISOString(),
    correlationId:null,
    causationId:null,
    idempotencyKey:eventId,
    payload:{class_id:classRow.class_id,course_id:classRow.course_id,schedule_version:Number(classRow.schedule_version),...payload},
    auditRefs:[],
    provenanceRefs:[
      'class:'+classRow.class_id,
      ...(classRow.source_timetable_version_id?['timetable:'+classRow.source_timetable_version_id]:[]),
    ],
  };
}

async function seedClassRuntime({repository,dueEventStore,studentId,classRow,causationId=null}) {
  const prep=await repository.ensurePreparationWorkspace({studentId,classId:classRow.class_id,correlationId:causationId});
  const startId='d11-class-start:'+classRow.class_id+':schedule-v'+classRow.schedule_version;
  const endId='d11-class-end:'+classRow.class_id+':schedule-v'+classRow.schedule_version;
  await dueEventStore.enqueue(scheduledEvent({
    eventType:TEACHING_EVENTS.CLASS_START_DUE,eventId:startId,studentId,classRow,dueAt:classRow.scheduled_start_at,
    payload:{preparation_workspace_id:prep?.workspace?.workspace_id || null},
  }));
  await dueEventStore.enqueue(scheduledEvent({
    eventType:TEACHING_EVENTS.CLASS_END_DUE,eventId:endId,studentId,classRow,dueAt:classRow.scheduled_end_at,
    payload:{kind:'SCHEDULED_END'},
  }));
  return Object.freeze({classId:classRow.class_id,startEventId:startId,endEventId:endId,preparationWorkspaceId:prep?.workspace?.workspace_id || null});
}

function registerD11Runtime({
  publishedEvents,
  eventRuntime,
  dueEventStore,
  repository,
  service,
  clock=()=>new Date(),
}={}) {
  if(!publishedEvents||typeof publishedEvents.register!=='function') throw new TypeError('D11 runtime requires published-event registry.');
  if(!eventRuntime||typeof eventRuntime.register!=='function') throw new TypeError('D11 runtime requires durable event runtime.');
  if(!dueEventStore||typeof dueEventStore.enqueue!=='function') throw new TypeError('D11 runtime requires due-event store.');
  if(!repository||typeof repository.getClassContext!=='function') throw new TypeError('D11 runtime requires repository.');
  if(!service||typeof service.startController!=='function') throw new TypeError('D11 runtime requires service.');

  const publishedRegistration=publishedEvents.register(TEACHING_EVENTS.COURSE_ACTIVATED,{
    subscriberId:'d11-course-activation-preclass-seed',
    handle:async(event)=>{
      const studentId=event.actorId;
      if(!studentId) return Object.freeze({accepted:true,seeded:0,reason:'COURSE_ACTIVATED_EVENT_HAS_NO_STUDENT_ACTOR'});
      const classes=await repository.listClassesForCourse(studentId,event.aggregateId);
      const seeded=[];
      for(const classRow of classes) {
        seeded.push(await seedClassRuntime({repository,dueEventStore,studentId,classRow,causationId:event.eventId}));
      }
      return Object.freeze({accepted:true,seeded:seeded.length,classRuntime:Object.freeze(seeded)});
    },
  });
  const requestDecisionRegistration=publishedEvents.register(TEACHING_EVENTS.REQUEST_DECIDED,{
    subscriberId:'d11-governed-request-planning-signal',
    handle:async(event)=>{
      const request=await repository.getGovernedRequest(event.payload?.request_id || event.aggregateId);
      if(!request?.course_id) return Object.freeze({accepted:true,noop:true,reason:'REQUEST_HAS_NO_COURSE'});
      const refreshed=await service.refreshCoursePreparation(request.student_id,request.course_id,{
        correlationId:event.correlationId || event.eventId,
        interruptActive:false,
      });
      return Object.freeze({
        accepted:true,
        planningSignalUpdated:true,
        courseId:request.course_id,
        refreshed:refreshed.length,
        targetStateNotAssumedApplied:true,
      });
    },
  });

  const requestAppliedRegistration=publishedEvents.register(TEACHING_EVENTS.REQUEST_APPLIED,{
    subscriberId:'d11-request-applied-materiality',
    handle:async(event)=>{
      const studentId=event.actorId;
      const courseId=event.payload?.course_id;
      if(!studentId||!courseId) return Object.freeze({accepted:true,noop:true,reason:'REQUEST_APPLIED_CONTEXT_MISSING'});
      const refreshed=await service.refreshCoursePreparation(studentId,courseId,{
        correlationId:event.correlationId || event.eventId,
        interruptActive:true,
      });
      const classes=await repository.listClassesForCourse(studentId,courseId);
      const seeded=[];
      for(const classRow of classes){
        seeded.push(await seedClassRuntime({repository,dueEventStore,studentId,classRow,causationId:event.eventId}));
      }
      return Object.freeze({
        accepted:true,
        appliedMaterialityReconciled:true,
        courseId,
        refreshed:refreshed.length,
        scheduled:seeded.length,
      });
    },
  });

  eventRuntime.register(TEACHING_EVENTS.CLASS_START_DUE,{
    reconcile:async(event)=>{
      const studentId=event.actor_id;
      const context=await repository.getClassContext(studentId,event.aggregate_id);
      if(!context?.classRow) return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_NO_LONGER_EXISTS'};
      if(Number(context.classRow.schedule_version)!==Number(event.aggregate_version)) {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_SCHEDULE_VERSION_CHANGED'};
      }
      if(String(context.classRow.course_lifecycle_state)!=='ACTIVE'||String(context.classRow.lifecycle_state)==='CANCELLED') {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_OR_COURSE_NOT_ACTIVE'};
      }
      if(context.session) return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'CONTROLLER_ALREADY_STARTED'};
      if(!context.blueprint) {
        await repository.ensurePreparationWorkspace({studentId,classId:event.aggregate_id,correlationId:event.event_id});
        return {
          disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,
          reason:'VALIDATED_BLUEPRINT_NOT_AVAILABLE_ROUTE_HELD',
          metadata:{blueprint_missing:true,model_work_started:false,route_qualification:'UNQUALIFIED_UNTIL_D30'},
        };
      }
      return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE};
    },
    handle:async(event)=>{
      const state=await service.startController({id:event.actor_id},event.aggregate_id,event.event_id,event.idempotency_key);
      return {safeMetadata:{class_id:event.aggregate_id,controller_version:state.controller?.stateVersion || null}};
    },
  });

  eventRuntime.register(TEACHING_EVENTS.BREAK_END_DUE,{
    reconcile:async(event)=>{
      const context=await repository.getClassContext(event.actor_id,event.aggregate_id);
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
      const result=await service.resumeBreakFromDueEvent({
        eventId:event.event_id,
        actorId:event.actor_id,
        aggregateId:event.aggregate_id,
        aggregateVersion:event.aggregate_version,
        idempotencyKey:event.idempotency_key,
      });
      return {safeMetadata:{
        class_id:event.aggregate_id,
        idempotent:Boolean(result?.idempotent),
        controller_version:result?.session?.state_version==null?null:Number(result.session.state_version),
      }};
    },
  });

  eventRuntime.register(TEACHING_EVENTS.CLASS_END_DUE,{
    reconcile:async(event)=>{
      const context=await repository.getClassContext(event.actor_id,event.aggregate_id);
      if(!context?.session) return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'NO_LIVE_CONTROLLER_AT_CLASS_END'};
      if(context.session.lifecycle_state==='CLOSED') return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'CLASS_ALREADY_CLOSED'};
      const kind=String(event.payload?.kind||'SCHEDULED_END');
      if(kind==='SCHEDULED_END') {
        if(Number(context.classRow.schedule_version)!==Number(event.aggregate_version)) {
          return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_SCHEDULE_VERSION_CHANGED'};
        }
      } else if(kind==='OVERTIME_CEILING') {
        if(!context.session.overtime_ceiling_at||new Date(context.session.overtime_ceiling_at).getTime()!==new Date(event.due_at).getTime()) {
          return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'OVERTIME_CEILING_CHANGED'};
        }
      }
      return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE,metadata:{kind}};
    },
    handle:async(event,reconciliation)=>{
      const context=await repository.getClassContext(event.actor_id,event.aggregate_id);
      const kind=String(event.payload?.kind||reconciliation?.metadata?.kind||'SCHEDULED_END');
      if(kind==='SCHEDULED_END'&&context.session.overtime_ceiling_at&&new Date(context.session.overtime_ceiling_at)>new Date(context.classRow.scheduled_end_at)) {
        if(!context.session.overtime_started_at) {
          const changed=await service.markOvertimeStarted({id:event.actor_id},event.aggregate_id,{
            expectedVersion:Number(context.session.state_version),
          });
          return {safeMetadata:{class_id:event.aggregate_id,overtime_started:true,controller_version:changed.controller.stateVersion}};
        }
        return {safeMetadata:{class_id:event.aggregate_id,overtime_active:true}};
      }
      const closed=await service.closeClass({id:event.actor_id},event.aggregate_id,{
        expectedVersion:Number(context.session.state_version),
        reason:kind==='OVERTIME_CEILING'?'OVERTIME_CEILING_REACHED':'SCHEDULED_END',
        force:true,
        sourceEventRef:event.event_id,
        idempotencyKey:event.idempotency_key,
      });
      return {safeMetadata:{class_id:event.aggregate_id,closed:true,closure_fact_id:closed.closureFact.closure_fact_id}};
    },
  });

  return Object.freeze({
    publishedRegistration,
    requestDecisionRegistration,
    requestAppliedRegistration,
    dueEventTypes:Object.freeze([TEACHING_EVENTS.CLASS_START_DUE,TEACHING_EVENTS.BREAK_END_DUE,TEACHING_EVENTS.CLASS_END_DUE]),
    serverTimeAuthoritative:true,
    modelRouteQualification:'UNQUALIFIED_UNTIL_D30',
    clock,
  });
}

module.exports={scheduledEvent,seedClassRuntime,registerD11Runtime};
