'use strict';
const {raiseHandRequest,normalizeProposal}=require('./help-intelligence');
const {VISUAL_INSTRUCTION}=require('./visual-intent');
const {validateBlock}=require('./board');
const BOARD_TYPES=new Set(['text','equation','worked_solution','comparison']);
// Structured board notation is optional for older TPF-08 implementations.
// Unsafe or malformed optional blocks are discarded; a verified spoken
// explanation remains usable and will be published as a text Board item.
function normalizeLessonBoardBlocks(value) {
  if(!Array.isArray(value)||value.length>4)return Object.freeze([]);
  try {
    return Object.freeze(value.map(block=>{
      if(!BOARD_TYPES.has(block?.type))throw new TypeError('Unsupported instructional board notation.');
      const safe=validateBlock(block);
      if(['text','equation'].includes(safe.type)&&!safe.content.text.trim())
        throw new TypeError('Board notation must contain meaningful text.');
      if(safe.type==='worked_solution'&&!safe.content.steps.length)
        throw new TypeError('Empty worked example.');
      return safe;
    }));
  }catch{return Object.freeze([]);}
}
function normalizeLessonProposal(value) {
  const base=normalizeProposal(value);
  if(!base)return null;
  const raw=value?.structured||value;
  return Object.freeze({...base,boardBlocks:base.decision==='ANSWER_NOW'
    ?normalizeLessonBoardBlocks(raw?.boardBlocks):Object.freeze([])});
}
function lessonTeacherRequest({studentId,classId,context,turnKey,visualCapabilities}) {
  // Reuse TPF-08's bounded T1 Teacher proposal, without a student-question lane.
  const request=raiseHandRequest({studentId,classId,helpRequest:{interaction_id:'unused',help_request_id:turnKey},context,visualCapabilities});
  request.trigger={type:'committed_domain_event',ref:turnKey,source:'teaching.d14',actor_id:studentId,event_id:turnKey};
  request.idempotencyKey=turnKey;
  request.resultContract.output_schema_id='d14.lesson_teacher_turn';
  request.outputSchema.id='d14.lesson_teacher_turn';
  request.taskMode='D14_CURRENT_LESSON_TEACHER_TURN';
  request.contextSpec.untrusted_refs=[];
  request.directive.bounded_actions=['explain the approved objective in a short Teacher turn, and optionally provide up to four independently readable, validated Board notation blocks and one useful visual'];
  request.academicInput={instruction:'Prepare a short spoken Teacher explanation for the current instructional activity, using the approved lesson blueprint and current learning unit. Return JSON decision=ANSWER_NOW, teacherMessage, reason, delayMinutes=0, visualRequest and optional boardBlocks. boardBlocks may contain up to four short, distinct instructional Board blocks: {type:"text",content:{text:"a concise key concept or classroom example"}}, {type:"equation",content:{text:"a grounded mathematical expression"}}, {type:"worked_solution",content:{steps:["grounded explanation steps"]}}, or {type:"comparison",content:{columns:[{text:"first"},{text:"second"}]}}. Keep Board notes separately readable, concise and grounded in the approved lesson, not a repetition of the entire spoken greeting. An ordinary explanation can use text notation; pictures are optional. If evidence is insufficient, return DECLINE with a reason. Never invent subject facts or reveal graded or assessed answers. '+VISUAL_INSTRUCTION,visual_capabilities:visualCapabilities||{},class_id:classId,class_mode:context.session.instructional_substate,active_learning_unit_id:context.session.progress_state?.current_learning_unit_ref||null};
  request.outputSchema.declared_fields=[...request.outputSchema.declared_fields,'boardBlocks'];
  request.outputSchema.validate=async(value)=>{const p=normalizeLessonProposal(value);return p?{ok:true,value:p}:{ok:false,reason:'D14_LESSON_SCHEMA_INVALID'};};
  request.schemaValidator=request.outputSchema.validate;
  request.domainValidator=async(value)=>Boolean(normalizeLessonProposal(value));
  return request;
}
function createD14LessonIntelligence({orchestrator,visualCapabilities=()=>null}={}) {
  return Object.freeze({async decide(args){
    const result=await orchestrator.execute(lessonTeacherRequest({...args,visualCapabilities:visualCapabilities()}));
    const value=result?.accepted&&result?.provisional?normalizeLessonProposal(result.validatedResult?.output):null;
    if(!value)throw Object.assign(new Error('Teacher lesson turn unavailable.'),{code:'TEACHING_D14_LESSON_AI_UNAVAILABLE'});
    return value;
  }});
}
module.exports={lessonTeacherRequest,createD14LessonIntelligence,normalizeLessonProposal,normalizeLessonBoardBlocks};
