'use strict';
const {TEACHING_EVENTS}=require('../events/names');
const {RECONCILIATION_DISPOSITIONS}=require('../runtime/constants');

function registerD17Runtime({eventRuntime,repository,service}={}){
  if(!eventRuntime||typeof eventRuntime.register!=='function'||!repository||!service)throw new TypeError('D17 runtime requires durable event runtime, repository and service.');
  return eventRuntime.register(TEACHING_EVENTS.ASSESSMENT_EXPIRY_DUE,{
    reconcile:async(event)=>{const studentId=event.actorId||event.payload?.student_id,attemptId=event.payload?.assessment_attempt_id||event.aggregateId,a=await repository.attempt(studentId,attemptId);if(!a)return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'ASSESSMENT_ATTEMPT_NOT_FOUND'};if(a.attempt_state!=='ACTIVE')return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:`ATTEMPT_${a.attempt_state}`};const due=new Date(event.dueAt||event.due_at||event.payload?.expires_at),current=new Date(a.expires_at);if(!Number.isFinite(due.getTime())||due.getTime()!==current.getTime())return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'ASSESSMENT_EXPIRY_CHANGED'};return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE,metadata:{expires_at:a.expires_at}};},
    handle:async(event)=>{const studentId=event.actorId||event.payload?.student_id,attemptId=event.payload?.assessment_attempt_id||event.aggregateId,result=await service.expire(studentId,attemptId,`d17-expiry-event:${event.eventId||event.event_id||attemptId}`);return {safeMetadata:{attempt_state:result.attempt.attempt_state,finalization_version:result.attempt.finalization_version}};},
  });
}
module.exports={registerD17Runtime};