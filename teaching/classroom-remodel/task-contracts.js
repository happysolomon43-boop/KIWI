'use strict';
const c=require('./contracts'),d=require('./domain-contracts');
const {failure,value}=require('./presentation-policy');
const {hash}=require('./academic-artifacts');
const VERSION='classroom-tasks.v1';
function policy(p){if(!require('./state-policy').capabilityReadiness(p,'tasks').ready)throw failure('CLASSROOM_TASK_POLICY_MISSING',503);if(value(p,'lateSubmissionPolicy')!=='reject')throw failure('CLASSROOM_TASK_LATE_REVIEW_ROUTE_HELD',503);return p;}
function check(candidate,{chapter,targetRef,validation,policy:rules,sessionId,classEnd,taskId,windowId,criterionId}={}){
 c.validateCoordinator(candidate,{mode:'design_check',chapter});
 if(candidate.status!=='complete'||candidate.review_required||candidate.artifacts.checks?.length!==1)throw failure('CLASSROOM_TASK_DESIGN_HELD');
 const proposal=candidate.artifacts.checks[0];
 if(!validation||validation.contentHash!==hash(proposal)||!validation.accepted||!validation.ownerRef||!validation.sourceVersion||validation.sourceVersion!==chapter.version)throw failure('CLASSROOM_TASK_VALIDATION_REQUIRED');
 if(validation.externalRequired&&validation.independent!==true)throw failure('CLASSROOM_TASK_INDEPENDENT_VALIDATION_REQUIRED');
 if(proposal.validation_status==='requires validation')throw failure('CLASSROOM_TASK_UNVALIDATED');
 if(proposal.response_form!=='text')throw failure('CLASSROOM_TASK_MODALITY_UNSUPPORTED');
 c.versionRef(targetRef,{kind:'course_learning_unit'});
 if(proposal.target_objective!==targetRef.id||!chapter.units.some(u=>u.objective_refs.some(r=>r.id===targetRef.id&&r.version===targetRef.version)))throw failure('CLASSROOM_TASK_TARGET_MISMATCH');
 const ceiling=proposal.permitted_assistance?.ceiling;
 c.enumeration(ceiling,require('../d12/contracts').ASSISTANCE_LEVELS,'permitted_assistance.ceiling');
 policy(rules);const kind=proposal.response_window_requirements?.duration_kind;
 const duration=value(rules,'taskDurations')[kind];if(!Number.isSafeInteger(duration)||duration<=0)throw failure('CLASSROOM_TASK_DURATION_NOT_ADOPTED');
 const sources=proposal.lineage_exposure_reuse?.source_refs;
 if(!Array.isArray(sources)||!sources.length)throw failure('CLASSROOM_TASK_SOURCE_REQUIRED');sources.forEach(r=>c.resolveAnchor(r,chapter));
 const intent=validation.evidenceIntent;
 if(!['practice','independent_evidence','none'].includes(intent)||validation.intendedEvidenceClaim!==proposal.intended_evidence_claim)throw failure('CLASSROOM_TASK_EVIDENCE_INTENT_NOT_AUTHORIZED');
 const task={id:taskId,version:'1',session_id:sessionId,source_refs:sources,target_ref:targetRef,public_question:{text:proposal.student_facing.question,board_refs:[],response_form:'text'},private:{criterion_ref:{kind:'criterion',id:criterionId,version:'1',anchor:null},expected_solution:proposal.private.expected_solution_or_criteria,acceptable_alternatives:proposal.private.acceptable_alternatives},evidence_intent:intent,inference_ceiling:proposal.inference_ceiling,assistance_ceiling:ceiling,window:{id:windowId,version:1,state:'PENDING_DELIVERY',opened_at:null,deadline_at:null,duration_ms:duration,extension_count:0,class_end_at:classEnd,activation_receipt_id:null},policy_version:rules.version};
 d.validateTask(task);return {task,proposal,validation,demand:proposal.task_demand,sourceHash:hash(chapter)};
}
function submission(input){
 const allowed=['schemaVersion','sessionId','operationKey','taskId','taskVersion','windowId','windowVersion','text'];
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw failure('CLASSROOM_TASK_SUBMISSION_INVALID',422);
 for(const key of ['sessionId','operationKey','taskId','taskVersion','windowId','text'])if(typeof input[key]!=='string'||!input[key].trim())throw failure('CLASSROOM_TASK_SUBMISSION_INVALID',422);
 if(input.schemaVersion!==VERSION||!Number.isSafeInteger(input.windowVersion)||input.windowVersion<1)throw failure('CLASSROOM_TASK_SUBMISSION_INVALID',422);return input;
}
function extension(input){
 const allowed=['schemaVersion','sessionId','operationKey','taskId','windowId','windowVersion'];
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||input.schemaVersion!==VERSION||!Number.isSafeInteger(input.windowVersion)||input.windowVersion<1)throw failure('CLASSROOM_TASK_EXTENSION_INVALID',422);
 for(const key of ['sessionId','operationKey','taskId','windowId'])if(typeof input[key]!=='string'||!input[key].trim())throw failure('CLASSROOM_TASK_EXTENSION_INVALID',422);
 return input;
}
function support(input){
 const allowed=['schemaVersion','sessionId','operationKey','taskId','taskVersion','windowId','windowVersion','text','kind'];
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||!['help','clarification'].includes(input.kind))throw failure('CLASSROOM_TASK_SUPPORT_INVALID',422);
 const {kind,...body}=input;submission(body);return input;
}
function openWindow(task,{now,receiptId,classEnd}){
 if(task.window.state!=='PENDING_DELIVERY')throw failure('CLASSROOM_TASK_WINDOW_NOT_PENDING');
 const opened=Date.parse(now),end=Math.min(Date.parse(classEnd),Date.parse(task.window.class_end_at));
 if(!Number.isFinite(opened)||!Number.isFinite(end)||!receiptId)throw failure('CLASSROOM_TASK_RENDER_RECEIPT_REQUIRED');
 if(opened+task.window.duration_ms>end)return {...task.window,state:'CANCELLED_SYSTEM',version:task.window.version+1,reason:'INSUFFICIENT_FAIR_RESPONSE_TIME'};
 return {...task.window,state:'OPEN',version:task.window.version+1,opened_at:new Date(opened).toISOString(),deadline_at:new Date(opened+task.window.duration_ms).toISOString(),activation_receipt_id:receiptId};
}
function extendWindow(window,rules,{now,classEnd}){
 policy(rules);if(![now,window.deadline_at,classEnd,window.class_end_at].every(v=>Number.isFinite(Date.parse(v)))||window.state!=='OPEN'||Date.parse(now)>=Date.parse(window.deadline_at))throw failure('CLASSROOM_TASK_EXTENSION_INELIGIBLE');
 if(window.extension_count>=value(rules,'extensionCount'))throw failure('CLASSROOM_TASK_EXTENSION_EXHAUSTED');
 const end=Math.min(Date.parse(classEnd),Date.parse(window.class_end_at)),deadline=Math.min(Date.parse(window.deadline_at)+value(rules,'extensionLimitMs'),end);
 if(deadline<=Date.parse(window.deadline_at))throw failure('CLASSROOM_TASK_EXTENSION_NO_TIME');
 return {...window,deadline_at:new Date(deadline).toISOString(),version:window.version+1,extension_count:window.extension_count+1};
}
function interpretation(output,{task,exposure,responseId,demand,stateReference}={}){
 c.validateCoordinator(output,{mode:'interpret_response'});
 if(output.status!=='complete'||output.review_required||output.runtime_requests.length)throw failure('CLASSROOM_TASK_INTERPRETATION_HELD');
 const accepted=require('./task-evaluation-adapter').adapt(output.artifacts.response_interpretation,{task,exposure,responseId,demand,stateReference});
 return {...accepted,nextAction:output.next_action,taskRef:{kind:'task',id:task.id,version:task.version,anchor:null},officialOutcome:false};
}
module.exports={VERSION,policy,check,submission,extension,support,openWindow,extendWindow,interpretation};
