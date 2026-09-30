'use strict';

const { TEACHING_EVENTS }=require('../events/names');
const { RECONCILIATION_DISPOSITIONS }=require('../runtime/constants');

function registerD15Runtime({eventRuntime,publishedEvents=null,repository,service}={}){
  if(!eventRuntime||typeof eventRuntime.register!=='function') throw new TypeError('D15 runtime requires durable Teaching event runtime.');
  if(!repository||typeof repository.getClass!=='function') throw new TypeError('D15 runtime requires Attendance repository.');
  if(!service||typeof service.finalizeClass!=='function') throw new TypeError('D15 runtime requires Attendance service.');

  const registrations=[];
  if(publishedEvents&&typeof publishedEvents.register==='function'){
    registrations.push(publishedEvents.register(TEACHING_EVENTS.REQUEST_APPLIED,{
      subscriberId:'d15-attendance-request-effects',
      handle:(event)=>service.onAttendanceRequestApplied(event),
    }));
    registrations.push(publishedEvents.register(TEACHING_EVENTS.CLASS_ENDED,{
      subscriberId:'d15-attendance-class-closure-reconciliation',
      handle:async(event)=>{
        const studentId=event.actorId||event.actor_id||event.payload?.student_id;
        const classId=event.payload?.class_id||event.aggregateId||event.aggregate_id;
        if(!studentId||!classId) return Object.freeze({accepted:true,noop:true,reason:'CLASS_ENDED_ATTENDANCE_CONTEXT_MISSING'});
        const result=await service.finalizeClass({studentId,classId,sourceEventId:event.eventId||event.event_id});
        return Object.freeze({accepted:true,attendanceRecordId:result.record?.attendanceRecordId||null,outcome:result.record?.outcome||null});
      },
    }));
  }

  eventRuntime.register(TEACHING_EVENTS.ATTENDANCE_FINALIZATION_DUE,{
    reconcile:async(event)=>{
      const studentId=event.payload?.student_id||event.actor_id;
      const classId=event.payload?.class_id||event.aggregate_id;
      const klass=await repository.getClass(studentId,classId);
      if(!klass){
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_NO_LONGER_EXISTS'};
      }
      if(Number(klass.schedule_version)!==Number(event.payload?.schedule_version??event.aggregate_version)){
        return {
          disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE,
          reason:'ATTENDANCE_OBLIGATION_RESCHEDULED',
          metadata:{supersede_obligation:true,system_protected:false,absence_created:false},
        };
      }
      if(['CANCELLED','SYSTEM_CANCELLED'].includes(String(klass.lifecycle_state))){
        return {
          disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE,
          reason:'ATTENDANCE_OBLIGATION_NO_LONGER_EXISTS',
          metadata:{
            supersede_obligation:true,
            system_protected:String(klass.lifecycle_state)==='SYSTEM_CANCELLED',
            absence_created:false,
          },
        };
      }
      return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE};
    },
    handle:async(event,reconciliation)=>{
      if(reconciliation?.metadata?.supersede_obligation){
        const result=await service.supersedeObligationFromDueEvent(event,{
          systemProtected:Boolean(reconciliation.metadata.system_protected),
        });
        return {safeMetadata:{
          class_id:event.payload?.class_id||event.aggregate_id,
          obligation_superseded:true,
          outcome:result.record?.outcome||null,
          absence_created:false,
          gradebook_mutated:false,
          skm_mutated:false,
        }};
      }
      const result=await service.finalizeClass({
        studentId:event.payload?.student_id||event.actor_id,
        classId:event.payload?.class_id||event.aggregate_id,
        sourceEventId:event.event_id,
      });
      return {safeMetadata:{
        class_id:event.payload?.class_id||event.aggregate_id,
        outcome:result.record?.outcome||null,
        attendance_record_id:result.record?.attendanceRecordId||null,
        gradebook_mutated:false,
        skm_mutated:false,
      }};
    },
  });

  eventRuntime.register(TEACHING_EVENTS.ACTIVITY_TIMER_EXPIRED,{
    reconcile:async(event)=>{
      const studentId=event.payload?.student_id||event.actor_id;
      const classId=event.payload?.class_id||event.aggregate_id;
      const klass=await repository.getClass(studentId,classId);
      if(!klass||['CANCELLED','SYSTEM_CANCELLED'].includes(String(klass.lifecycle_state))){
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'CLASS_NOT_ACTIVE_FOR_INACTIVITY_CHECK'};
      }
      return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE};
    },
    handle:async(event)=>{
      const result=await service.inactivityDue(event);
      return {safeMetadata:{
        action:result.action,
        absence_declared:false,
        tab_focus_used_as_proof:false,
      }};
    },
  });

  return Object.freeze({
    publishedRegistrations:Object.freeze(registrations),
    dueEventTypes:Object.freeze([
      TEACHING_EVENTS.ATTENDANCE_FINALIZATION_DUE,
      TEACHING_EVENTS.ACTIVITY_TIMER_EXPIRED,
    ]),
    serverTimeAuthoritative:true,
    browserAttendanceAuthority:false,
  });
}

module.exports={registerD15Runtime};