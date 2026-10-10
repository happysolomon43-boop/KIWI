'use strict';
const {protectedMode}=require('../classroom-remodel/protected-activity');

const { classClosureTranslation } = require('./fact-pack');
const { validateStageOutput, noteRequest } = require('./study-note');
const { validateBlock } = require('./board');
const MODES=Object.freeze({OPENING:'Teaching',DIAGNOSTIC:'Teaching',INSTRUCTION:'Teaching',GUIDED_PRACTICE:'Guided Practice',INDEPENDENT_PRACTICE:'Independent Practice',CLASSWORK:'Classwork — Graded',ASSESSMENT:'Test / Assessment',BREAK:'Break',REMEDIATION:'Teaching',CLOSURE:'Class Summary',INTERRUPTED:'Interrupted'});
const RESTRICTED=new Set(['ASSESSMENT','CLASSWORK']);
// A raised hand is for a running instructional activity, not a generic active
// controller, closed Class, break or assessment. Keep server projection and
// the signal mutation on the same allowlist.
const HELP_INSTRUCTIONAL_MODES=new Set(['OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','REMEDIATION']);
const SIGNALS=new Set(['ASK_TEACHER','NEED_HELP','READY','FINISHED','BREAK_REQUEST','EARLY_DISMISSAL_REQUEST','TECHNICAL_ISSUE','LEAVE']);
function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
function createD14Service({repository,d11Repository,d11Service,d12Service,attendanceService=null,studyIntelligence=null,helpIntelligence=null,lessonIntelligence=null,visualService=null,cardSetReader=null,sourceReader=null,clock=()=>new Date(),randomUUID}={}){
  if(!repository||!d11Repository||!d11Service||!d12Service||!randomUUID)throw new TypeError('D14 requires the existing D11/D12 owners and its artifact repository.');
  async function context(studentId,classId){const value=await d11Repository.getClassContext(studentId,classId);if(!value)fail('TEACHING_D14_CLASS_NOT_FOUND',404);return value;}
  async function listClasses(user,courseId){
    const course=await repository.identity(user.id,courseId);if(!course)fail('TEACHING_D14_COURSE_NOT_FOUND',404);
    const classes=await repository.listClasses(user.id,courseId),instant=clock(),at=(instant instanceof Date?instant:new Date(instant)).getTime();
    const isPast=(row)=>String(row.session_state||'').toUpperCase()==='ACTIVE'?false:Date.parse(row.scheduled_end_at)<=at||['COMPLETED','CLOSED'].includes(String(row.lifecycle_state||'').toUpperCase())||String(row.session_state||'').toUpperCase()==='CLOSED';
    const enriched=classes.map(row=>{
      const starts=Date.parse(row.scheduled_start_at),ends=Date.parse(row.scheduled_end_at);
      const sessionState=String(row.session_state||'').toUpperCase();
      const canEnter=String(course.lifecycle_state||'').toUpperCase()==='ACTIVE'
        && row.lifecycle_state!=='CANCELLED'&&Number.isFinite(starts)&&Number.isFinite(ends)
        && at>=starts&&(at<ends||sessionState==='ACTIVE')&&sessionState!=='CLOSED';
      return Object.freeze({...row,can_enter:canEnter,entry_opens_at:row.scheduled_start_at,
        has_authoritative_session:Boolean(sessionState),historical_unstarted:isPast(row)&&!sessionState&&!row.attendance_outcome});
    });
    return Object.freeze({course,serverNow:new Date(at).toISOString(),classes:Object.freeze(enriched),upcoming:Object.freeze(enriched.filter(row=>!isPast(row))),history:Object.freeze(enriched.filter(isPast).sort((a,b)=>Date.parse(b.scheduled_start_at)-Date.parse(a.scheduled_start_at)))});
  }
  async function snapshot(user,classId){
    const d11=await d11Service.getClass(user,classId);
    const source=await context(user.id,classId);
    const currentTime=clock().getTime(),starts=Date.parse(source.classRow.scheduled_start_at),ends=Date.parse(source.classRow.scheduled_end_at);
    const mode=source.session?.lifecycle_state==='CLOSED'?'CLOSURE':source.session?.instructional_substate||(currentTime>=ends?'UNSTARTED_PAST':currentTime>=starts?'START_DELAYED':'PRE_CLASS');
    const protectedModeKey=protectedMode(source.session);
    const restricted=Boolean(protectedModeKey);
    const [identity,scenes,notes,studyNote,teacherMessage,firstEntry,conversation,helpRequests]=await Promise.all([
      repository.identity(user.id,source.classRow.course_id),
      restricted?[]:repository.board(user.id,source.session?.class_session_id),
      restricted?[]:repository.notebook(user.id,classId),
      repository.latestNote(user.id,classId),
      restricted?null:repository.latestTeacherMessage(user.id,classId),
      repository.firstEntry(user.id,classId),
      restricted?[]:typeof repository.conversation==='function'?repository.conversation(user.id,classId):[],
      restricted?[]:typeof repository.helpRequests==='function'?repository.helpRequests(user.id,classId):[],
    ]);
    const closed=source.session?.lifecycle_state==='CLOSED';
    let summary=null,closureFacts=null;
    if(closed){
      try{summary=await d11Service.getSummary(user,classId);}catch(error){if(error.status!==404)throw error;}
      const closure=await d11Repository.getClosureFact(user.id,classId);
      if(closure)closureFacts=classClosureTranslation(closure).factPack;
    }
    const currentLu=source.session?.progress_state?.current_learning_unit_ref||null;
    const planned=Array.isArray(source.blueprint?.planned_learning_unit_refs)?source.blueprint.planned_learning_unit_refs:[];
    const objective=source.blueprint?.objective_summary||null;
    const serverNow=clock();
    const now=serverNow.getTime(),start=new Date(source.classRow.scheduled_start_at).getTime(),end=new Date(source.classRow.scheduled_end_at).getTime();
    const arrived=firstEntry?new Date(firstEntry.created_at).getTime():null;
    const lateMinutes=arrived==null?0:Math.max(0,Math.floor((arrived-start)/60000));
    const coreMinimum=(source.blueprint?.blueprint_payload?.objectives||[]).filter((o)=>o.criticality==='CORE').reduce((n,o)=>n+Number(o.minimum_safe_minutes||0),0);
    const entry=source.session?.lifecycle_state==='CLOSED'?null:{lateMinutes,minutesRemaining:Math.max(0,Math.ceil((end-now)/60000)),veryLate:lateMinutes>0&&coreMinimum>0&&(end-arrived)/60000<coreMinimum,formalAttendanceDetermined:false};
    const interruption=source.session?.instructional_substate==='INTERRUPTED'?{
      cause:source.session.interruption_metadata?.cause==='SYSTEM'?'SYSTEM':'UNDETERMINED',academicPenalty:false,
      resumeState:source.session.resume_instructional_substate||'INSTRUCTION',canResume:Boolean(source.session.resume_instructional_substate),
    }:null;
    return Object.freeze({classroomEngine:source.session?.classroom_engine||'LEGACY',class:d11.class,controller:d11.controller,time:d11.time,serverNow:serverNow.toISOString(),identity:identity||{course_title:'Course',teacher_name:'KIWI Teacher'},
      mode:MODES[mode]||(mode==='UNSTARTED_PAST'?'Class did not start':mode==='START_DELAYED'?'Start pending':'Before Class'),modeKey:mode,protectedModeKey,focus:true,objective:restricted?null:objective,teacherMessage:teacherMessage?.message||null,entry,interruption,hasEntered:Boolean(firstEntry),
      canStartClass:!source.session&&currentTime>=starts&&currentTime<ends&&source.classRow.lifecycle_state!=='CANCELLED'&&source.classRow.course_lifecycle_state==='ACTIVE'
        &&source.classRow.source_timetable_state!=='SUPERSEDED',
      requiredMaterials:!restricted&&Array.isArray(source.blueprint?.blueprint_payload?.required_materials)?source.blueprint.blueprint_payload.required_materials.map(String).slice(0,12):[],
      learningUnitId:restricted?null:currentLu&&planned.includes(currentLu)?currentLu:(planned[0]||null),
      board:scenes.map((s)=>({...s,items:s.items.map((item)=>validateBlock({type:item.type,content:item.content})&&item)})),
      boardHistoryAllowed:!restricted,notebook:notes,notebookAllowed:!restricted,summary,closureFacts,
      teacherConversation:conversation,helpRequests,teacherMessagingAllowed:source.session?.classroom_engine!=='CLASSROOM_V1'&&HELP_INSTRUCTIONAL_MODES.has(mode)&&!closed&&source.session?.lifecycle_state==='ACTIVE'
        &&source.classRow.lifecycle_state==='SCHEDULED'
        &&source.classRow.course_lifecycle_state==='ACTIVE'
        &&source.classRow.source_timetable_state==='APPROVED'
        &&!RESTRICTED.has(mode)&&!['BREAK','INTERRUPTED'].includes(mode),
      studyNote:studyNote?.state==='VALIDATED_PRIVATE'?{state:'PRIVATE_VALIDATED_AWAITING_D27',published:false}:studyNote?{state:studyNote.state,published:false}:null,
      assessmentTakeover:mode==='ASSESSMENT',assessmentOwner:'D17',classworkOwner:'D16',
      transcriptSecondary:true,controlsEnabled:source.session?.lifecycle_state==='ACTIVE',academicStateFromBrowser:false});
  }
  async function notebook(user,classId,input={}){
    const ctx=await context(user.id,classId);if(protectedMode(ctx.session))fail('TEACHING_D14_NOTEBOOK_RESTRICTED',403);
    const content=String(input.content||'').trim();if(!content||content.length>10000)fail('TEACHING_D14_NOTEBOOK_CONTENT_INVALID',400);
    const boardItemId=input.boardItemId?String(input.boardItemId):null;
    const idempotencyKey=String(input.idempotencyKey||'');if(!idempotencyKey||idempotencyKey.length>160)fail('TEACHING_D14_IDEMPOTENCY_REQUIRED',400);
    let sourceRef=input.sourceRef||null;if(sourceRef){try{require('../classroom-remodel/contracts').versionRef(sourceRef);if(!['chapter','portion','message'].includes(sourceRef.kind))throw Error();}catch{fail('TEACHING_D14_NOTEBOOK_REFERENCE_INVALID',422);}}
    const row=await repository.addNotebook({studentId:user.id,classId,content,sourceKind:boardItemId?'BOARD_REFERENCE':'PERSONAL',boardItemId,idempotencyKey,sourceRef});
    return {notebookItemId:row.notebook_item_id,content:row.content,sourceRef:row.source_ref||null,boardItemId:row.board_item_id,versionNo:Number(row.version_no)};
  }
  async function signal(user,classId,input={}){
    const ctx=await context(user.id,classId);const kind=String(input.kind||'').toUpperCase();
    if(!SIGNALS.has(kind))fail('TEACHING_D14_SIGNAL_INVALID',400);
    if(!ctx.session)fail('TEACHING_D14_CONTROLLER_NOT_STARTED',409);
    if(ctx.session?.lifecycle_state==='CLOSED'&&kind!=='LEAVE')fail('TEACHING_D14_CLASS_CLOSED');
    if(ctx.session?.instructional_substate==='ASSESSMENT'&&!['TECHNICAL_ISSUE','LEAVE'].includes(kind))fail('TEACHING_D14_ASSESSMENT_CONTROL_RESTRICTED',403);
    if(['ASK_TEACHER','NEED_HELP'].includes(kind)&&(
      !ctx.session||ctx.session.lifecycle_state!=='ACTIVE'
      ||ctx.classRow?.lifecycle_state!=='SCHEDULED'
      ||(ctx.classRow?.course_lifecycle_state&&ctx.classRow.course_lifecycle_state!=='ACTIVE')
      ||(ctx.classRow?.source_timetable_state&&ctx.classRow.source_timetable_state!=='APPROVED')
      ||!HELP_INSTRUCTIONAL_MODES.has(ctx.session.instructional_substate)
    ))fail('TEACHING_D14_TEACHER_MESSAGES_PAUSED',403);
    const body=input.body==null?null:String(input.body).trim();if(body?.length>2000)fail('TEACHING_D14_SIGNAL_TOO_LONG',400);
    if(['ASK_TEACHER','NEED_HELP'].includes(kind)&&!body)fail('TEACHING_D14_TEACHER_MESSAGE_REQUIRED',400);
    const key=String(input.idempotencyKey||'');if(!key||key.length>160)fail('TEACHING_D14_IDEMPOTENCY_REQUIRED',400);
    const row=await repository.recordInteraction({studentId:user.id,classId,session:ctx.session,kind,body,idempotencyKey:key});
    const attendance=attendanceService&&typeof attendanceService.observeInteraction==='function'
      ? await attendanceService.observeInteraction(user,classId,{interactionId:row.interaction_id,kind:row.interaction_kind,occurredAt:row.created_at})
      : null;
    return {interactionId:row.interaction_id,helpRequestId:row.help_request_id||null,kind:row.interaction_kind,acceptedAt:row.created_at,academicResponse:false,controllerMutation:false,status:row.help_request_id?'HELP_RAISED':'RECORDED_FOR_TEACHER',attendance};
  }
  async function retireOutstandingHelp({studentId,classId}) {
    if(!studentId||!classId)return {retired:0};
    return {retired:typeof repository.retireOutstandingHelp==='function'?await repository.retireOutstandingHelp(studentId,classId):0};
  }
  async function processHelp({studentId,classId,helpRequestId}={}) {
    if(!studentId||!classId||!helpRequestId)fail('TEACHING_D14_HELP_CONTEXT_REQUIRED',400);
    const request=await repository.claimHelp(studentId,helpRequestId);
    if(!request)return {accepted:true,noop:true,reason:'HELP_NOT_DUE_OR_ALREADY_DECIDED'};
    const finish=async(status,reason,minutes=0,scheduleVersion=1)=>{
      const nextReviewAt=status==='DEFERRED'?new Date(clock().getTime()+minutes*60000).toISOString():null;
      const row=await repository.finalizeHelp({studentId,helpRequestId,status,reason,nextReviewAt,scheduleVersion});
      return {accepted:true,status:row?.status||status,helpRequestId};
    };
    let ctx;
    try{ctx=await context(studentId,classId);}catch(error){return finish('CANCELLED','This Class is no longer available.');}
    if(ctx.session?.classroom_engine==='CLASSROOM_V1')return finish('CANCELLED','Persistent classroom messages are not enabled for this session.');
    const mode=ctx.session?.instructional_substate;
    const active=ctx.session?.lifecycle_state==='ACTIVE'&&ctx.classRow?.lifecycle_state==='SCHEDULED'
      &&ctx.classRow?.course_lifecycle_state==='ACTIVE'&&ctx.classRow?.source_timetable_state==='APPROVED';
    if(!active||ctx.session?.class_session_id!==request.class_session_id
      ||Number(ctx.session?.state_version)!==Number(request.controller_version)){
      return finish('CANCELLED','The Class moved on before this question could be answered. You can raise your hand again.',0,ctx.classRow?.schedule_version);
    }
    if(!HELP_INSTRUCTIONAL_MODES.has(mode)){
      if(mode==='BREAK'&&Number(request.attempts)<3)
        return finish('DEFERRED','The Teacher will return after the pause.',2,ctx.classRow.schedule_version);
      return finish('CANCELLED','This Class activity cannot accept Teacher answers. You can ask again when teaching resumes.',0,ctx.classRow.schedule_version);
    }
    if(Number(request.attempts)>3)return finish('UNAVAILABLE','Your question could not be answered automatically. Please ask again during a suitable part of the lesson.',0,ctx.classRow.schedule_version);
    if(!helpIntelligence?.decide)
      return finish('UNAVAILABLE','AI Teacher replies are not available in this Class right now.',0,ctx.classRow.schedule_version);
    let result;
    try{result=await helpIntelligence.decide({studentId,classId,helpRequest:request,context:ctx});}
    catch(error){
      if(Number(request.attempts)<3)
        return finish('DEFERRED','The Teacher is temporarily unavailable. Your question will be retried.',1,ctx.classRow.schedule_version);
      return finish('UNAVAILABLE','The Teacher could not prepare a validated response. Please raise your hand again later.',0,ctx.classRow.schedule_version);
    }
    if(result.decision==='DEFER'){
      if(Number(request.attempts)>=3)return finish('UNAVAILABLE','The lesson has moved on. Please raise your hand again if you still need help.',0,ctx.classRow.schedule_version);
      return finish('DEFERRED',result.reason||'The Teacher will return to your question shortly.',result.delayMinutes||1,ctx.classRow.schedule_version);
    }
    if(result.decision==='DECLINE')return finish('DECLINED',result.reason||'This question cannot be answered in the current Class.',0,ctx.classRow.schedule_version);
    if(result.decision!=='ANSWER_NOW'||!result.teacherMessage)return finish('UNAVAILABLE','Teacher response was not validated.',0,ctx.classRow.schedule_version);
    try{
      const published=await repository.publishTeacherTurn({
        studentId,classId,expectedControllerVersion:request.controller_version,
        blocks:result.visualRequest&&visualService?await visualService.prepare({studentId,classId,context:ctx,visualRequest:result.visualRequest,turnKey:'d14-help-answer:'+helpRequestId}):[],
        message:result.teacherMessage,idempotencyKey:'d14-help-answer:'+helpRequestId,helpRequestId,
        expectedBlueprintId:ctx.blueprint?.lesson_blueprint_id||null,
        expectedBlueprintVersion:ctx.blueprint?.version_no==null?null:Number(ctx.blueprint.version_no),
        expectedScheduleVersion:ctx.classRow.schedule_version,
        expectedCourseStateVersion:ctx.classRow.course_state_version,
        expectedPlanId:ctx.plan?.course_plan_id||null,
        expectedPlanVersion:ctx.plan?.version_no==null?null:Number(ctx.plan.version_no),
      });
      return {accepted:true,status:'ANSWERED',helpRequestId,communicationId:published.communication_id};
    }catch(error){
      if(['TEACHING_D14_HELP_STALE','TEACHING_D14_TEACHER_TURN_STALE','TEACHING_D14_PARENT_AUTHORITY_REVOKED'].includes(error?.code))
        return finish('CANCELLED','The current Class activity changed before the answer could be published.',0,ctx.classRow.schedule_version);
      if(Number(request.attempts)<3)
        return finish('DEFERRED','Your answer could not be safely published yet. KIWI will retry.',1,ctx.classRow.schedule_version);
      return finish('UNAVAILABLE','Your answer could not be safely published. Please ask again.',0,ctx.classRow.schedule_version);
    }
  }
  async function processLessonTurn({studentId,classId,sessionId,controllerVersion}) {
    if(!lessonIntelligence)return {accepted:true,noop:true,reason:'TEACHER_ROUTE_HELD'};
    const ctx=await context(studentId,classId);
    if(ctx.session?.classroom_engine==='CLASSROOM_V1')return {accepted:true,noop:true,reason:'DURABLE_CLASSROOM_PRESENTATION_OWNER'};
    const {permitted}=require('./visual-service');
    if(!permitted(ctx)||ctx.session.class_session_id!==sessionId||Number(ctx.session.state_version)!==Number(controllerVersion))return {accepted:true,noop:true,reason:'LESSON_MOVED_ON'};
    const key='d14-instruction:'+sessionId+':v'+controllerVersion;
    if(await repository.teacherTurn(studentId,key))return {accepted:true,noop:true};
    const result=await lessonIntelligence.decide({studentId,classId,context:ctx,turnKey:key});
    if(result.decision!=='ANSWER_NOW')return {accepted:true,noop:true,reason:'LESSON_EVIDENCE_INSUFFICIENT'};
    try{
      const blocks=result.visualRequest&&visualService?await visualService.prepare({studentId,classId,context:ctx,visualRequest:result.visualRequest,turnKey:key}):[];
      await repository.publishTeacherTurn({studentId,classId,message:result.teacherMessage,blocks:[...(result.boardBlocks||[]),...blocks],idempotencyKey:key,expectedControllerVersion:controllerVersion,expectedBlueprintId:ctx.blueprint.lesson_blueprint_id,expectedBlueprintVersion:ctx.blueprint.version_no,expectedScheduleVersion:ctx.classRow.schedule_version,expectedCourseStateVersion:ctx.classRow.course_state_version,expectedPlanId:ctx.plan?.course_plan_id||null,expectedPlanVersion:ctx.plan?.version_no||null});
      return {accepted:true,published:true};
    }catch(error){if(['TEACHING_D14_HELP_STALE','TEACHING_D14_TEACHER_TURN_STALE','TEACHING_D14_PARENT_AUTHORITY_REVOKED'].includes(error.code))return {accepted:true,noop:true,reason:'LESSON_MOVED_ON'};throw error;}
  }
  async function visualAsset(user,classId,assetId){
    const row=await repository.visualAsset(user.id,classId,assetId);
    if(!row)fail('TEACHING_D14_VISUAL_NOT_FOUND',404);
    return row;
  }
  async function enter(user,classId){
    const ctx=await context(user.id,classId);
    if(ctx.classRow.lifecycle_state==='CANCELLED')fail('TEACHING_D14_CLASS_CANCELLED',409);
    if(ctx.classRow.course_lifecycle_state!=='ACTIVE')fail('TEACHING_D14_COURSE_NOT_ACTIVE',409);
    if(ctx.classRow.source_timetable_state&&ctx.classRow.source_timetable_state!=='APPROVED'&&!ctx.session)
      fail('TEACHING_D14_CLASS_TIMETABLE_SUPERSEDED',409);
    if(ctx.session?.lifecycle_state==='CLOSED')fail('TEACHING_D14_CLASS_ALREADY_ENDED',409);
    const now=clock().getTime(),start=Date.parse(ctx.classRow.scheduled_start_at),end=Date.parse(ctx.classRow.scheduled_end_at);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail('TEACHING_D14_INVALID_CLASS_SCHEDULE',409);
    if(now<start)fail('TEACHING_D14_CLASS_NOT_STARTED',409);
    if(now>=end&&ctx.session?.lifecycle_state!=='ACTIVE')fail('TEACHING_D14_CLASS_ALREADY_ENDED',409);
    const row=await repository.recordInteraction({studentId:user.id,classId,session:ctx.session,kind:'JOIN',body:null,idempotencyKey:`d14-join:${classId}`});
    const attendance=attendanceService&&typeof attendanceService.observeJoin==='function'
      ? await attendanceService.observeJoin(user,classId,{interactionId:row.interaction_id,occurredAt:row.created_at})
      : null;
    if(lessonIntelligence&&repository.queueInstruction)await repository.queueInstruction(user.id,classId);
    return {enteredAt:row.created_at,formalAttendanceDetermined:Boolean(attendance?.record),attendance};
  }
  async function respond(user,classId,input={}){
    if(!input.learningUnitId||!input.responsePayload)fail('TEACHING_D14_RESPONSE_INVALID',400);
    return d12Service.captureResponse(user,classId,input);
  }
  async function runStudyStage({studentId,classId,stage}){
    const ctx=await context(studentId,classId);
    if(!ctx.blueprint||ctx.blueprint.blueprint_state!=='VALIDATED')return {state:'ROUTE_HELD',reason:'APPROVED_LESSON_PLAN_REQUIRED'};
    const previous=await repository.latestNote(studentId,classId);
    const closure=stage==='POST_CLASS'?await d11Repository.getClosureFact(studentId,classId):null;
    if(stage==='POST_CLASS'&&!closure)fail('TEACHING_D14_CLOSURE_REQUIRED');
    const summary=stage==='POST_CLASS'?await d11Repository.latestSummary(studentId,classId):null;
    if(stage==='POST_CLASS'&&!summary)return {state:'RECONCILIATION_HELD',reason:'FINAL_CLASS_SUMMARY_REQUIRED'};
    if(!cardSetReader||!sourceReader){
      const reason='D27_CARD_SET_OR_APPROVED_SOURCE_UNAVAILABLE';
      const binding={classRef:`${classId}@${ctx.classRow.schedule_version}`,lessonPlanRef:`${ctx.blueprint.lesson_blueprint_id}@${ctx.blueprint.version_no}`,closureRef:closure?.closure_fact_id||null,cardSetRef:null};
      const state=stage==='PRE_CLASS'?'ROUTE_HELD':'RECONCILIATION_HELD';
      await repository.saveNote({studentId,classId,state,stage,binding,validation:{blocked:reason},closureFactId:closure?.closure_fact_id||null,idempotencyKey:`d14-note-held:${stage}:${binding.lessonPlanRef}:${binding.closureRef||'pre'}`});
      return {state,reason,published:false};
    }
    const [cardSet,sourceSnapshot]=await Promise.all([cardSetReader({studentId,classId,stage}),sourceReader({studentId,classId})]);
    const planned=ctx.blueprint.planned_learning_unit_refs||[];
    const completed=new Set(closure?.fact_pack?.completed_objective_refs||[]);
    const actual=[...new Set((ctx.blueprint.blueprint_payload?.objectives||[]).filter((o)=>completed.has(o.id)).map((o)=>o.learning_unit_ref))];
    const request=noteRequest({stage,context:ctx,cardSet,sourceSnapshot,closure,summary,priorNote:previous,plannedLearningUnits:planned,actualTaughtLearningUnits:actual});
    const key=`d14-note:${classId}:${stage}:${request.binding.lessonPlanRef}:${request.binding.cardSetRef}:${request.binding.closureRef||'pre'}`;
    if(!studyIntelligence){
      const row=await repository.saveNote({studentId,classId,state:stage==='PRE_CLASS'?'ROUTE_HELD':'RECONCILIATION_HELD',stage,binding:request.binding,idempotencyKey:key});
      return {state:row.state,routeQualification:'UNQUALIFIED_UNTIL_D30',published:false};
    }
    // No database transaction spans the central Teaching Orchestrator call.
    const result=await studyIntelligence.execute(request);
    const current=await context(studentId,classId);
    const fresh=noteRequest({stage,context:current,cardSet:await cardSetReader({studentId,classId,stage}),sourceSnapshot:await sourceReader({studentId,classId}),closure:stage==='POST_CLASS'?await d11Repository.getClosureFact(studentId,classId):null,summary:stage==='POST_CLASS'?await d11Repository.latestSummary(studentId,classId):null,priorNote:previous,plannedLearningUnits:planned,actualTaughtLearningUnits:actual});
    if(JSON.stringify(fresh.binding)!==JSON.stringify(request.binding))fail('TEACHING_D14_STALE_NOTE_RESULT');
    const output=result?.validatedResult?.output;
    if(!result?.accepted||!output)return {state:'ROUTE_HELD',reason:'MODEL_RESULT_NOT_ACCEPTED'};
    const validation=validateStageOutput({output,stage,binding:request.binding,plannedLearningUnits:planned,actualTaughtLearningUnits:actual,sourceRefs:sourceSnapshot.spans,cardSet,priorNote:previous});
    const row=await repository.saveNote({studentId,classId,state:stage==='PRE_CLASS'?'PREPARED_NOT_PUBLISHABLE':'VALIDATED_PRIVATE',stage,binding:request.binding,payload:output,validation,closureFactId:closure?.closure_fact_id||null,idempotencyKey:key});
    return {state:row.state,published:false,noteVersionId:row.note_version_id};
  }
  return Object.freeze({listClasses,snapshot,notebook,signal,retireOutstandingHelp,processHelp,processLessonTurn,visualAsset,enter,respond,runStudyStage,publishTeacherTurn:repository.publishTeacherTurn});
}
module.exports={createD14Service,MODES};
