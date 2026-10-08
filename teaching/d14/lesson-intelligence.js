'use strict';
const {raiseHandRequest,normalizeProposal}=require('./help-intelligence');
const {VISUAL_INSTRUCTION}=require('./visual-intent');
function lessonTeacherRequest({studentId,classId,context,turnKey,visualCapabilities}) {
  // Reuse TPF-08's bounded T1 Teacher proposal, without a student-question lane.
  const request=raiseHandRequest({studentId,classId,helpRequest:{interaction_id:'unused',help_request_id:turnKey},context,visualCapabilities});
  request.trigger={type:'committed_domain_event',ref:turnKey,source:'teaching.d14',actor_id:studentId,event_id:turnKey};
  request.idempotencyKey=turnKey;
  request.resultContract.output_schema_id='d14.lesson_teacher_turn';
  request.outputSchema.id='d14.lesson_teacher_turn';
  request.taskMode='D14_CURRENT_LESSON_TEACHER_TURN';
  request.contextSpec.untrusted_refs=[];
  request.directive.bounded_actions=['explain the current approved lesson objective using a short grounded Teacher turn and optionally one useful representation'];
  request.academicInput={instruction:'Prepare a short Teacher explanation for the current instructional activity, using the approved lesson blueprint and current learning unit. Return JSON decision=ANSWER_NOW, teacherMessage, reason, delayMinutes=0, visualRequest. If the lesson evidence is insufficient, return DECLINE with a reason. Do not invent subject facts or reveal assessed answers. Use a visual only when it improves understanding. '+VISUAL_INSTRUCTION,visual_capabilities:visualCapabilities||{},class_id:classId,class_mode:context.session.instructional_substate,active_learning_unit_id:context.session.progress_state?.current_learning_unit_ref||null};
  return request;
}
function createD14LessonIntelligence({orchestrator,visualCapabilities=()=>null}={}) {
  return Object.freeze({async decide(args){
    const result=await orchestrator.execute(lessonTeacherRequest({...args,visualCapabilities:visualCapabilities()}));
    const value=result?.accepted&&result?.provisional?normalizeProposal(result.validatedResult?.output):null;
    if(!value)throw Object.assign(new Error('Teacher lesson turn unavailable.'),{code:'TEACHING_D14_LESSON_AI_UNAVAILABLE'});
    return value;
  }});
}
module.exports={lessonTeacherRequest,createD14LessonIntelligence};
