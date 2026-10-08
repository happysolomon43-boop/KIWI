'use strict';
const {TEACHING_EVENTS}=require('../events/names');
const {RECONCILIATION_DISPOSITIONS}=require('../runtime/constants');

function registerD14Runtime({publishedEvents,service,eventRuntime=null,repository=null}={}){
  if(!publishedEvents||!service)throw new TypeError('D14 runtime dependencies required.');
  const registrations=[
    publishedEvents.register(TEACHING_EVENTS.LESSON_PLAN_APPROVED,{
      subscriberId:'d14-preclass-note-preparation',
      handle:async(event)=>service.runStudyStage({studentId:event.actorId||event.payload?.student_id,classId:event.payload?.class_id,stage:'PRE_CLASS'}),
    }),
    publishedEvents.register(TEACHING_EVENTS.CLASS_ENDED,{
      subscriberId:'d14-postclass-note-reconciliation',
      handle:async(event)=>{
        const studentId=event.actorId||event.payload?.student_id,classId=event.payload?.class_id;
        await service.retireOutstandingHelp({studentId,classId});
        return service.runStudyStage({studentId,classId,stage:'POST_CLASS'});
      },
    }),
    publishedEvents.register(TEACHING_EVENTS.CLASS_HELP_REQUESTED,{
      subscriberId:'d14-durable-raised-hand-teacher',
      handle:async(event)=>service.processHelp({studentId:event.actorId||event.payload?.student_id,classId:event.payload?.class_id,helpRequestId:event.payload?.help_request_id}),
    }),
  ];
  if(eventRuntime&&repository){
    eventRuntime.register(TEACHING_EVENTS.CLASS_HELP_REVIEW_DUE,{
      reconcile:async(event)=>{
        const studentId=event.actor_id||event.payload?.student_id;
        const id=event.payload?.help_request_id;
        if(!studentId||!id)return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'MISSING_HELP_ID'};
        const help=await repository.getHelp(studentId,id);
        if(!help||help.class_id!==event.payload?.class_id
          ||help.status!=='DEFERRED'
          ||Number(help.attempts)!==Number(event.payload?.attempts)
          ||new Date(help.next_review_at).getTime()!==new Date(event.due_at).getTime())
          return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'HELP_REQUEST_NO_LONGER_DUE'};
        return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE};
      },
      handle:async(event)=>{
        const result=await service.processHelp({studentId:event.actor_id||event.payload?.student_id,classId:event.payload?.class_id,helpRequestId:event.payload?.help_request_id});
        return {safeMetadata:{help_status:result.status||null,help_request_id:event.payload?.help_request_id}};
      },
    });
  }
  return Object.freeze({registrations:Object.freeze(registrations)});
}
module.exports={registerD14Runtime};
