'use strict';
const {TEACHING_EVENTS}=require('../events/names');
const {RECONCILIATION_DISPOSITIONS:R}=require('../runtime/constants');
const {createClassroomPresentationRepository}=require('../repositories/classroom-presentation');
const {createClassroomPresentationService}=require('./presentation-service');
function createClassroomPresentationRuntime({query,withTransaction,randomUUID,d14Repository,eventStore,outboxStore,eventRuntime,publishedEvents,d11Repository,preparationIntelligence,...options}={}){
 const repository=createClassroomPresentationRepository({query,withTransaction,randomUUID,d14Repository,dueEventStore:eventStore,outboxStore});
 const presenter=options.presenter||(preparationIntelligence&&options.requirementsReader?require('./presentation-intelligence').createClassroomPresentationIntelligence({intelligence:preparationIntelligence,d11Repository,requirementsReader:options.requirementsReader}):null);
 const service=createClassroomPresentationService({...options,presenter,repository});
 if(!eventRuntime||!publishedEvents)throw new TypeError('Presentation requires the existing durable runtime');
 for(const type of [TEACHING_EVENTS.CLASSROOM_PORTION_RELEASE_DUE,TEACHING_EVENTS.CLASSROOM_DELIVERY_END_DUE])eventRuntime.register(type,{
  reconcile:async event=>{if(!event.payload?.student_id||!event.payload?.class_id)return {disposition:R.SUPERSEDED,reason:'CLASSROOM_EVENT_OWNER_MISSING'};return {disposition:R.ACTIONABLE};},
  handle:async event=>{const {student_id:studentId,class_id:classId}=event.payload;const result=type===TEACHING_EVENTS.CLASSROOM_PORTION_RELEASE_DUE?await repository.release(studentId,classId,{event}):await repository.reconcile(studentId,classId);return {safeMetadata:{released:result.released===true,held:result.held===true,reason:result.reason||null}};},
 });
 const registrations=[];
 for(const type of [TEACHING_EVENTS.CLASS_ENDED,TEACHING_EVENTS.BREAK_STARTED,TEACHING_EVENTS.ASSESSMENT_STARTED,TEACHING_EVENTS.CLASSROOM_INSTRUCTION_READY])if(type)registrations.push(publishedEvents.register(type,{subscriberId:'classroom-delivery-safety-'+type,handle:async event=>{
  const studentId=event.actorId||event.payload?.student_id,classId=event.payload?.class_id;if(!studentId||!classId)return {noop:true};
  try{return await repository.reconcile(studentId,classId);}catch(error){if(['CLASSROOM_SESSION_NOT_REMODELED','CLASSROOM_DELIVERY_NOT_PREPARED','CLASSROOM_SESSION_NOT_FOUND'].includes(error.code))return {noop:true};throw error;}
 }}));
 return Object.freeze({repository,service,registrations,activation:'INACTIVE',productionQualified:false});
}
module.exports={createClassroomPresentationRuntime};
