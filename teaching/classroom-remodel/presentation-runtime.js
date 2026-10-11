'use strict';
const failureForRetry=code=>Object.assign(new Error(code),{code});
const {TEACHING_EVENTS}=require('../events/names');
const {RECONCILIATION_DISPOSITIONS:R}=require('../runtime/constants');
const {createClassroomPresentationRepository}=require('../repositories/classroom-presentation');
const {createClassroomPresentationService}=require('./presentation-service');
function createClassroomPresentationRuntime({query,withTransaction,randomUUID,d14Repository,eventStore,outboxStore,eventRuntime,publishedEvents,d11Repository,d12Repository,d11Service,d14Service,d16Service,d17Service,...options}={}){
 const releaseControl=require('./release-control').createClassroomReleaseControl({withTransaction,trustRoots:options.releaseTrustRoots||{}});
 if(d11Repository?.connectClassroomAdmission)d11Repository.connectClassroomAdmission(releaseControl.admissionUsing);
 const repository=createClassroomPresentationRepository({query,withTransaction,randomUUID,d14Repository,dueEventStore:eventStore,outboxStore,releaseControl});
 const presenter=options.presenter||(options.orchestrator&&options.requirementsReader?require('./presentation-intelligence').createClassroomPresentationIntelligence({orchestrator:options.orchestrator,repository,d11Repository,requirementsReader:options.requirementsReader}):null);
 const continuity=d11Repository?require('../repositories/classroom-continuity').createClassroomContinuityRepository({query,withTransaction,randomUUID,presentationRepository:repository}):null;
 if(continuity)d11Repository.connectClassroomContinuity(continuity);
 const service=createClassroomPresentationService({...options,presenter,repository,continuity});
 if(!eventRuntime||!publishedEvents)throw new TypeError('Presentation requires the existing durable runtime');
 for(const type of [TEACHING_EVENTS.CLASSROOM_PORTION_RELEASE_DUE,TEACHING_EVENTS.CLASSROOM_DELIVERY_END_DUE])eventRuntime.register(type,{
  reconcile:async event=>{if(!event.payload?.student_id||!event.payload?.class_id)return {disposition:R.SUPERSEDED,reason:'CLASSROOM_EVENT_OWNER_MISSING'};return {disposition:R.ACTIONABLE};},
  handle:async event=>{const {student_id:studentId,class_id:classId}=event.payload;const result=type===TEACHING_EVENTS.CLASSROOM_PORTION_RELEASE_DUE?await repository.release(studentId,classId,{event}):await repository.reconcile(studentId,classId);return {safeMetadata:{released:result.released===true,held:result.held===true,reason:result.reason||null}};},
 });
 if(continuity)eventRuntime.register(TEACHING_EVENTS.CLASSROOM_CLOSURE_RECONCILIATION_DUE,{
  reconcile:async event=>event.payload?.student_id&&event.payload?.class_id?{disposition:R.ACTIONABLE}:{disposition:R.SUPERSEDED,reason:'CLASSROOM_EVENT_OWNER_MISSING'},
  handle:async event=>{
   const {student_id:studentId,class_id:classId}=event.payload;
   await continuity.latestRecord(studentId,classId);
   if(!d11Service||!d14Service)return {safeMetadata:{held:true,reason:'CLASSROOM_RECONCILIATION_OWNERS_UNAVAILABLE'}};
   const summary=await d11Service.processClassClosureArtifacts(event);
   if(summary.held)throw failureForRetry(summary.reason);
   const note=await d14Service.runStudyStage({studentId,classId,stage:'POST_CLASS'});
   return {safeMetadata:{held:['ROUTE_HELD','RECONCILIATION_HELD'].includes(note.state),published:note.published===true}};
  },
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
 const revisionRepository=options.tasks&&d11Repository&&d12Repository?require('../repositories/classroom-revisions').createClassroomRevisionRepository({presentationRepository:repository,d11Repository,d12Repository,randomUUID}):null;
 if(revisionRepository)repository.connectRevisions(revisionRepository);
 let taskRuntime=null;
 if(options.tasks){
  const supplied=options.tasks;const intelligence=options.orchestrator&&typeof supplied.requirementsReader==='function'?require('./task-intelligence').createClassroomTaskIntelligence({orchestrator:options.orchestrator,d11Repository,requirementsReader:supplied.requirementsReader,directiveReader:supplied.directiveReader}):null;
  const cfg={...supplied,coordinator:supplied.coordinator||intelligence?.coordinator,turnProvider:supplied.turnProvider||intelligence?.turnProvider},qualified=cfg.qualified===true&&!!d12Repository&&typeof cfg.coordinator?.interpret==='function'&&typeof cfg.reviewer?.accept==='function'&&typeof cfg.turnProvider?.generate==='function'&&typeof cfg.turnReviewer?.accept==='function'&&typeof cfg.turnReviewer?.select==='function'&&typeof cfg.turnReviewer?.acceptQuestion==='function'&&typeof cfg.coordinator?.design==='function'&&typeof cfg.reviewer?.acceptDesign==='function'&&typeof cfg.adjustmentProvider?.replan==='function';
  if(!d12Repository)throw new TypeError('Task runtime requires the existing D12 repository');
  const taskRepository=require('../repositories/classroom-tasks').createClassroomTaskRepository({presentationRepository:repository,d12Repository,randomUUID,qualified});repository.connectTasks(taskRepository);
  const taskService=require('./task-service').createClassroomTaskService({...cfg,repository:taskRepository,presentationRepository:repository,presentationService:service,revisionRepository});
  for(const type of [TEACHING_EVENTS.CLASSROOM_TASK_ADJUSTMENT_DUE,TEACHING_EVENTS.CLASSROOM_TASK_EVALUATION_DUE,TEACHING_EVENTS.CLASSROOM_TASK_WINDOW_EXPIRY_DUE,TEACHING_EVENTS.CLASSROOM_TASK_FEEDBACK_DUE,TEACHING_EVENTS.CLASSROOM_TASK_SUPPORT_DUE,TEACHING_EVENTS.CLASSROOM_TASK_TURN_DUE])eventRuntime.register(type,{reconcile:async event=>event.payload?.student_id&&event.payload?.class_id?{disposition:R.ACTIONABLE}:{disposition:R.SUPERSEDED,reason:'CLASSROOM_TASK_EVENT_OWNER_MISSING'},handle:async event=>{const p=event.payload,args={studentId:p.student_id,classId:p.class_id,admissionId:p.admission_id,taskId:p.task_id,requestId:p.request_id,turnId:p.turn_id};const result=type===TEACHING_EVENTS.CLASSROOM_TASK_ADJUSTMENT_DUE?await taskService.adjust(args):type===TEACHING_EVENTS.CLASSROOM_TASK_EVALUATION_DUE?await taskService.process(args):type===TEACHING_EVENTS.CLASSROOM_TASK_WINDOW_EXPIRY_DUE?await repository.reconcile(args.studentId,args.classId):type===TEACHING_EVENTS.CLASSROOM_TASK_TURN_DUE?await taskService.pump(args):await taskService.prepareHandling(args);return {safeMetadata:{held:result?.held===true,pending:result?.pending===true}};}});
  taskRuntime={repository:taskRepository,service:taskService,qualified};
 }
 const planning=continuity&&options.planning&&options.orchestrator?require('./delivery7-intelligence').createDelivery7Intelligence({...options.planning,downstreamOwners:{d16:d16Service,d17:d17Service},orchestrator:options.orchestrator,d11Repository,continuityRepository:continuity}):null;

 eventRuntime.register(TEACHING_EVENTS.CLASSROOM_PRE_CLOSURE_DUE,{
  reconcile:async event=>event.payload?.student_id&&event.payload?.class_id?
    {disposition:R.ACTIONABLE}:{disposition:R.SUPERSEDED,reason:'CLASSROOM_PRE_CLOSE_OWNER_MISSING'},
  handle:async event=>{
    const outcome=await require('./pre-closure').prepareBeforeEnd({studentId:event.payload.student_id,
     classId:event.payload.class_id,event,repository,service,d11Repository,
     closing:options.planning?.closing||null});
    return {safeMetadata:{held:outcome.held===true,reason:outcome.reason||null,
     prepared:outcome.prepared===true,closureCommitted:false}};
  }
 });
 const registrations=[];
 for(const type of [TEACHING_EVENTS.CLASS_ENDED,TEACHING_EVENTS.BREAK_STARTED,TEACHING_EVENTS.ASSESSMENT_STARTED,TEACHING_EVENTS.CLASSROOM_INSTRUCTION_READY])if(type)registrations.push(publishedEvents.register(type,{subscriberId:'classroom-delivery-safety-'+type,handle:async event=>{
  const studentId=event.actorId||event.payload?.student_id,classId=event.payload?.class_id;if(!studentId||!classId)return {noop:true};
  try{return await repository.reconcile(studentId,classId);}catch(error){if(error.code==='CLASSROOM_DELIVERY_NOT_PREPARED'&&type===TEACHING_EVENTS.CLASSROOM_INSTRUCTION_READY){if(typeof options.initialPace!=='string')return {held:true,reason:'CLASSROOM_INITIAL_PACE_NOT_ADOPTED'};return service.prepare({studentId,classId,pace:options.initialPace});}if(['CLASSROOM_SESSION_NOT_REMODELED','CLASSROOM_DELIVERY_NOT_PREPARED','CLASSROOM_SESSION_NOT_FOUND'].includes(error.code))return {noop:true};throw error;}
 }}));
 return Object.freeze({repository,service,releaseControl,continuity,planning,messages:messageRuntime,tasks:taskRuntime,revisions:revisionRepository,registrations,activation:'INACTIVE',productionQualified:false});
}
module.exports={createClassroomPresentationRuntime};
