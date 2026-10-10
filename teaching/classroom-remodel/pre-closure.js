'use strict';
const {hash}=require('./academic-artifacts');
const {getModeSchema}=require('./mode-schemas');
const {validateDirective}=require('./contracts');
const {value}=require('./presentation-policy');
const held=reason=>Object.freeze({held:true,prepared:false,closureCommitted:false,reason});
function beforeEnd(snapshot,context,policy){
 const now=Date.parse(snapshot?.server_time),end=Date.parse(snapshot?.clocks?.class_end_at);
 const lead=value(policy,'closureLeadMs');
 if(!context?.session||context.session.lifecycle_state!=='ACTIVE'||!Number.isFinite(now)||
   !Number.isFinite(end)||!Number.isSafeInteger(lead)||lead<=0||now>=end||end-now>lead)
   return held('CLASSROOM_PRE_CLOSE_NOT_IN_AUTHORIZED_WINDOW');
 if(['ASSESSMENT','CLASSWORK','BREAK','INTERRUPTED'].includes(context.session.instructional_substate))
   return held('CLASSROOM_PRE_CLOSE_PROTECTED_ACTIVITY');
 if(snapshot?.capabilities?.presentation!==true||!snapshot?.session_id||
   !Number.isSafeInteger(snapshot.controller_version)||!Number.isSafeInteger(snapshot.delivery_version))
   return held('CLASSROOM_PRE_CLOSE_PRESENTATION_UNAVAILABLE');
 return Object.freeze({eligible:true,remainingMs:end-now,leadMs:lead});
}
function closingSource(snapshot,window){
 return Object.freeze({sessionId:snapshot.session_id,classId:snapshot.class_id,
   controllerVersion:snapshot.controller_version,deliveryVersion:snapshot.delivery_version,
   deliveryEpoch:snapshot.delivery_epoch,clockEnd:snapshot.clocks.class_end_at,
   remainingMs:window.remainingMs,position:{...snapshot.position},
   pendingQuestions:(snapshot.messages?.questions||[]).filter(q=>q.state!=='answered')
     .map(q=>({messageId:q.message_id||q.messageId,state:q.state})),
   activeTask:snapshot.active_task?.task_ref||snapshot.active_task?.id||null,
   claimRestrictions:{publicationNotLearning:true,renderingNotUnderstanding:true,
     unresolvedWorkNotCancelled:true,noUnapprovedFollowUp:true,unconfirmedPortionsNotTaught:true}});
}
async function prepareBeforeEnd({studentId,classId,event,repository,service,d11Repository,closing}={}){
 const adopted=closing?.qualified===true&&closing?.binding?.familyId==='TPF-21'&&
  closing.binding.mode==='close_class'&&
  closing.binding.capabilityId==='teaching.lesson.classroom_closure_coordination'&&
  closing.binding.runtimeAuthorized===true&&closing.binding.owner==='D11/Pedagogy'&&
  typeof closing.coordinator?.closeClass==='function'&&
  typeof closing.reviewer?.accept==='function'&&typeof closing.directiveReader==='function';
 if(!adopted)return held('CLASSROOM_CLOSE_CLASS_GOVERNANCE_OR_REVIEW_NOT_ADOPTED');
 const expected=await repository.capture(studentId,classId);
 if(expected.held)return held(expected.reason||'CLASSROOM_PRE_CLOSE_STALE');
 const snapshot=await service.snapshot({id:studentId},classId);
 const context=await d11Repository.getClassContext(studentId,classId);
 const window=beforeEnd(snapshot,context,expected.policy);
 if(!window.eligible)return window;
 const source=closingSource(snapshot,window),inputHash=hash(source);
 const operationKey='classroom-pre-close:'+(event?.event_id||event?.eventId||hash({studentId,classId,inputHash}));
 const generated=await closing.coordinator.closeClass({studentId,classId,mode:'close_class',
   source,inputHash,operationKey});
 const output=generated?.validatedResult?.output;
 if(!generated?.accepted||!generated.executionId||!output)return held('CLASSROOM_CLOSE_CLASS_COORDINATOR_NOT_ACCEPTED');
 const checked=await getModeSchema('coordinator','close_class').validate(output);
 if(!checked.ok||output.status!=='complete')return held('CLASSROOM_CLOSE_CLASS_SCHEMA_OR_RESULT_HELD');
 const review=await closing.reviewer.accept({studentId,classId,inputHash,outputHash:hash(output),
   executionId:generated.executionId,source,output});
 if(!review?.accepted||!review.independent||!review.ownerRef||review.inputHash!==inputHash||
  review.outputHash!==hash(output)||review.executionId!==generated.executionId)
  return held('CLASSROOM_CLOSE_CLASS_INDEPENDENT_REVIEW_REQUIRED');
 const fresh=await service.snapshot({id:studentId},classId);
 const freshContext=await d11Repository.getClassContext(studentId,classId);
 const freshWindow=beforeEnd(fresh,freshContext,expected.policy);
 const identity=source=>{const {remainingMs,...persisted}=source;return persisted;};
 if(!freshWindow.eligible||hash(identity(closingSource(fresh,freshWindow)))!==hash(identity(source)))
  return held('CLASSROOM_CLOSE_CLASS_SOURCE_CHANGED');
 const directive=await closing.directiveReader({studentId,classId,source,output,review,policy:expected.policy});
 validateDirective(directive);
 if(directive.approved_action!=='transition'||directive.academic_mode!=='teaching'||
   directive.evidence_intent!=='instruction_only'||directive.expected_student_action!=='none'||
   directive.time_constraints?.closureLeadMs!==window.leadMs)
   return held('CLASSROOM_CLOSE_CLASS_PRESENTER_DIRECTIVE_UNAUTHORIZED');
 const staged=await service.prepareSpan({studentId,classId,operationKey:operationKey+':presenter',
   directive,types:['text'],assets:[]});
 if(!staged?.accepted)return held(staged?.reason||'CLASSROOM_CLOSE_CLASS_PRESENTER_HELD');
 return {prepared:true,held:false,closureCommitted:false,sourceHash:inputHash,
   reviewRef:review.ownerRef,scheduledFollowUp:false,noAutomaticOvertime:true};
}
module.exports={beforeEnd,closingSource,prepareBeforeEnd};
