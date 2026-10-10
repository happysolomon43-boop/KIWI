'use strict';
const {TEACHING_EVENTS}=require('../events/names');
const {RECONCILIATION_DISPOSITIONS:R}=require('../runtime/constants');
const {createClassroomPresentationRepository}=require('../repositories/classroom-presentation');
const {createClassroomPresentationService}=require('./presentation-service');
function createClassroomPresentationRuntime({query,withTransaction,randomUUID,d14Repository,eventStore,outboxStore,eventRuntime,publishedEvents,d11Repository,...options}={}){
 const repository=createClassroomPresentationRepository({query,withTransaction,randomUUID,d14Repository,dueEventStore:eventStore,outboxStore});
 const presenter=options.presenter||(options.orchestrator&&options.requirementsReader?require('./presentation-intelligence').createClassroomPresentationIntelligence({orchestrator:options.orchestrator,repository,d11Repository,requirementsReader:options.requirementsReader}):null);
 const service=createClassroomPresentationService({...options,presenter,repository});
 if(!eventRuntime||!publishedEvents)throw new TypeError('Presentation requires the existing durable runtime');
 for(const type of [TEACHING_EVENTS.CLASSROOM_PORTION_RELEASE_DUE,TEACHING_EVENTS.CLASSROOM_DELIVERY_END_DUE])eventRuntime.register(type,{
  reconcile:async event=>{if(!event.payload?.student_id||!event.payload?.class_id)return {disposition:R.SUPERSEDED,reason:'CLASSROOM_EVENT_OWNER_MISSING'};return {disposition:R.ACTIONABLE};},
  handle:async event=>{const {student_id:studentId,class_id:classId}=event.payload;const result=type===TEACHING_EVENTS.CLASSROOM_PORTION_RELEASE_DUE?await repository.release(studentId,classId,{event}):await repository.reconcile(studentId,classId);return {safeMetadata:{released:result.released===true,held:result.held===true,reason:result.reason||null}};},
 });
 let messageRuntime=null;
 if(options.messages){
  const messageOptions=options.messages;
  const messageRepository=require('../repositories/classroom-messages').createClassroomMessageRepository({presentationRepository:repository,randomUUID,qualified:messageOptions.qualified===true&&typeof messageOptions.directiveReader==='function'&&!!presenter&&(typeof messageOptions.coordinator?.route==='function'||options.orchestrator&&typeof messageOptions.requirementsReader==='function')});
  repository.connectMessages(messageRepository);
  const coordinator=messageOptions.coordinator||(options.orchestrator&&messageOptions.requirementsReader?require('./message-intelligence').createClassroomMessageIntelligence({orchestrator:options.orchestrator,repository:messageRepository,d11Repository,requirementsReader:messageOptions.requirementsReader}):null);
  const messageService=require('./message-service').createClassroomMessageService({repository:messageRepository,presentationRepository:repository,presentationService:service,coordinator,directiveReader:messageOptions.directiveReader});
  eventRuntime.register(TEACHING_EVENTS.CLASSROOM_MESSAGE_ROUTING_DUE,{reconcile:async event=>event.payload?.student_id&&event.payload?.class_id&&event.payload?.message_id?{disposition:R.ACTIONABLE}:{disposition:R.SUPERSEDED,reason:'CLASSROOM_MESSAGE_EVENT_OWNER_MISSING'},handle:async event=>{const p=event.payload;const result=await messageService.process({studentId:p.student_id,classId:p.class_id,messageId:p.message_id});return {safeMetadata:{pending:result.pending===true}};}});
  publishedEvents.register(TEACHING_EVENTS.CLASSROOM_DELIVERY_CONFIRMED,{subscriberId:'classroom-message-boundary',handle:async event=>{const p=event.payload;return messageService.pump({studentId:event.actorId||p.student_id,classId:p.class_id});}});
  messageRuntime={repository:messageRepository,service:messageService};
 }
 const registrations=[];
 for(const type of [TEACHING_EVENTS.CLASS_ENDED,TEACHING_EVENTS.BREAK_STARTED,TEACHING_EVENTS.ASSESSMENT_STARTED,TEACHING_EVENTS.CLASSROOM_INSTRUCTION_READY])if(type)registrations.push(publishedEvents.register(type,{subscriberId:'classroom-delivery-safety-'+type,handle:async event=>{
  const studentId=event.actorId||event.payload?.student_id,classId=event.payload?.class_id;if(!studentId||!classId)return {noop:true};
  try{return await repository.reconcile(studentId,classId);}catch(error){if(error.code==='CLASSROOM_DELIVERY_NOT_PREPARED'&&type===TEACHING_EVENTS.CLASSROOM_INSTRUCTION_READY){if(typeof options.initialPace!=='string')return {held:true,reason:'CLASSROOM_INITIAL_PACE_NOT_ADOPTED'};return service.prepare({studentId,classId,pace:options.initialPace});}if(['CLASSROOM_SESSION_NOT_REMODELED','CLASSROOM_DELIVERY_NOT_PREPARED','CLASSROOM_SESSION_NOT_FOUND'].includes(error.code))return {noop:true};throw error;}
 }}));
 return Object.freeze({repository,service,messages:messageRuntime,registrations,activation:'INACTIVE',productionQualified:false});
}
module.exports={createClassroomPresentationRuntime};
