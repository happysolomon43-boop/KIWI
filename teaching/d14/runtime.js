'use strict';
const {TEACHING_EVENTS}=require('../events/names');
function registerD14Runtime({publishedEvents,service}={}){
  if(!publishedEvents||!service)throw new TypeError('D14 runtime dependencies required.');
  const registrations=[
    publishedEvents.register(TEACHING_EVENTS.LESSON_PLAN_APPROVED,{
      subscriberId:'d14-preclass-note-preparation',
      handle:async(event)=>service.runStudyStage({studentId:event.actorId||event.payload?.student_id,classId:event.payload?.class_id,stage:'PRE_CLASS'}),
    }),
    publishedEvents.register(TEACHING_EVENTS.CLASS_ENDED,{
      subscriberId:'d14-postclass-note-reconciliation',
      handle:async(event)=>service.runStudyStage({studentId:event.actorId||event.payload?.student_id,classId:event.payload?.class_id,stage:'POST_CLASS'}),
    }),
  ];
  return Object.freeze({registrations:Object.freeze(registrations)});
}
module.exports={registerD14Runtime};
