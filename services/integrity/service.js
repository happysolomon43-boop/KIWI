'use strict';

const {
  POLICY_VERSION,SUBMISSION_GATE_POLICY_VERSION,profile,timingClass,normalizeRawEvent,
  departureDecision,sessionConsequence,verificationRouteDecision,deriveAssignmentSessionProfile,
  studentSafeSessionProjection,fail,
}=require('./contracts');
const {classifyDeadline,lateWorkDisposition}=require('../../teaching/d16/contracts');

function createIntegrityService({repository,d16Repository=null,d16Intelligence=null,randomUUID,clock=()=>new Date()}={}){
  if(!repository||typeof repository.createSession!=='function')throw new TypeError('Integrity service requires repository.');
  if(typeof randomUUID!=='function')throw new TypeError('Integrity service requires randomUUID().');
  const now=()=>{const value=clock();return value instanceof Date?value:new Date(value);};
  const conditions=(assignment)=>Array.isArray(assignment?.orthogonal_conditions)?assignment.orthogonal_conditions:[];
  const key=(prefix)=>`${prefix}:${randomUUID()}`;
  const safeItem=(item)=>item?Object.freeze({verificationItemId:item.verification_item_id,sequenceNo:Number(item.sequence_no),timingClass:item.timing_class,durationSeconds:Number(item.duration_seconds),prompt:item.prompt_payload||{},targetCapability:item.target_capability||null,startedAt:item.started_at||null,expiresAt:item.expires_at||null,protectedValidationHidden:true}):null;

  async function resolveProfile(userId,ownerType,ownerRef){
    const owner=await repository.resolveOwner(userId,ownerType,ownerRef);
    if(ownerType==='TEACHING_ASSIGNMENT')return deriveAssignmentSessionProfile(owner.row);
    if(ownerType==='KIWI_EXAM')return owner.row.is_reckoning?'HIGH_STAKES_EXAM':'SCHEDULED_TEST';
    return 'HIGH_STAKES_EXAM';
  }

  async function startSession(user,{ownerType,ownerRef,deviceRef=null}={}){
    const type=String(ownerType||'').toUpperCase(),ref=String(ownerRef||'');
    if(!ref)throw fail('Integrity session owner is required.','KIWI_INTEGRITY_OWNER_REQUIRED',400);
    const selectedProfile=await resolveProfile(user.id,type,ref);
    const created=await repository.createSession({userId:user.id,ownerType:type,ownerRef:ref,profile:selectedProfile,policyVersion:POLICY_VERSION,currentDeviceRef:deviceRef?String(deviceRef):null});
    return Object.freeze({...studentSafeSessionProjection(created.session),idempotent:created.idempotent,controlled:profile(selectedProfile).controlled});
  }
  async function getSession(user,sessionId){return studentSafeSessionProjection(await repository.requireSession(user.id,sessionId));}
  async function closeSession(user,sessionId){const row=await repository.closeSession(user.id,sessionId);if(!row)throw fail('Integrity session not found.','KIWI_INTEGRITY_SESSION_NOT_FOUND',404);return studentSafeSessionProjection(row);}

  async function recordEvent(user,sessionId,input={}){
    let session=await repository.requireSession(user.id,sessionId);
    if(['LOCKED','CLOSED'].includes(session.status))return Object.freeze({...studentSafeSessionProjection(session),action:session.status==='LOCKED'?'LOCK':'CLOSED',alreadyTerminal:true});
    const raw=normalizeRawEvent({...input,clientEventId:input.clientEventId||key('client-event')});
    let duplicate=false;
    if(['DEPARTURE_SIGNAL','FULLSCREEN_SIGNAL'].includes(raw.category)){
      const recent=await repository.recentDeparture(user.id,sessionId);
      if(recent){const delta=Math.abs(new Date(raw.observedAt).getTime()-new Date(recent.observed_at||recent.accepted_at).getTime());duplicate=delta<=1500;}
    }
    const decision=departureDecision({sessionProfile:profile(session.profile),rawEvent:raw,permitted:false,kiwiCaused:false,duplicate});
    const recorded=await repository.recordEvent({userId:user.id,sessionId,raw,decision,permitted:false,kiwiCaused:false});
    session=recorded.session;
    const consequence=sessionConsequence({sessionProfile:profile(session.profile),confirmedDepartureCount:session.confirmed_departure_count});
    if(consequence.action!=='CONTINUE')session=await repository.applySessionConsequence({userId:user.id,sessionId,action:consequence.action,outcome:consequence.outcome});
    return Object.freeze({...studentSafeSessionProjection(session),action:consequence.action,outcome:consequence.outcome,event:Object.freeze({kind:decision.normalizedKind,countsAsDeparture:Boolean(decision.counts)}),idempotent:recorded.idempotent});
  }

  async function projectGate(userId,gate){
    let verification=null;
    if(gate?.verification_session_id){
      const session=await repository.getVerificationSession(userId,gate.verification_session_id);
      if(session){
        const item=await repository.latestVerificationItem(userId,session.verification_session_id);
        verification=Object.freeze({verificationSessionId:session.verification_session_id,status:session.status,route:session.route,maxQuestions:Number(session.max_questions),questionCount:Number(session.question_count),targetCapabilities:Object.freeze(session.target_capabilities||[]),currentItem:safeItem(item)});
      }
    }
    return Object.freeze({submissionGateId:gate.submission_gate_id,assignmentId:gate.assignment_id,state:gate.state,route:gate.verification_route,receivedAt:gate.accepted_event_at,finalizedAt:gate.finalized_at||null,systemDeferredReason:gate.system_deferred_reason||null,reasonCodes:Object.freeze(gate.reason_codes||[]),verification,submissionTimePreserved:true,studentMayLeave:['FINALIZED','UNRESOLVED','SYSTEM_DEFERRED'].includes(gate.state)});
  }
  async function getAssignmentGate(user,assignmentId){const gate=await repository.gateByAssignment(user.id,assignmentId);return gate?projectGate(user.id,gate):Object.freeze({state:'NONE',assignmentId,submissionTimePreserved:true,studentMayLeave:true});}
  async function assignmentContext(userId,assignmentId){if(!d16Repository)throw fail('D16 Work owner is unavailable.','KIWI_INTEGRITY_D16_UNAVAILABLE',503);return d16Repository.publicBundle(userId,assignmentId);}
  function assertSubmissionAllowed(assignment,correction){
    if(['CLOSED','MARKING','VERIFICATION','VERIFIED'].includes(assignment.lifecycle_state))throw fail('Assignment cannot accept a new submission in its current state.','TEACHING_D16_SUBMISSION_STATE_INVALID',409);
    if(conditions(assignment).includes('PAUSED'))throw fail('Course pause currently suspends ordinary Homework submission expectations.','TEACHING_D16_ASSIGNMENT_PAUSED',409);
    if(assignment.assistance_mode==='FORMAL_ASSESSMENT')throw fail('Formal Assessment submission belongs to the Assessment owner.','TEACHING_D16_FORMAL_ASSESSMENT_OWNER_REQUIRED',409);
    if(assignment.solution_exposed&&!correction&&!assignment.replacement_assignment_id)throw fail('The original task is no longer clean evidence after full solution exposure; an equivalent replacement is required.','TEACHING_D16_REPLACEMENT_REQUIRED',409);
  }

  async function finalizeGate(userId,gateId){
    const gate=await repository.getGate(userId,gateId);if(!gate)throw fail('Submission gate not found.','KIWI_SUBMISSION_GATE_NOT_FOUND',404);if(gate.state==='FINALIZED')return gate;
    const receipt=await d16Repository.latestSubmissionById(userId,gate.receipt_submission_id);if(!receipt)throw fail('Submission receipt not found.','KIWI_SUBMISSION_RECEIPT_NOT_FOUND',409);
    let assignment=await d16Repository.requireAssignment(userId,gate.assignment_id),correction=receipt.submission_kind==='PENDING_CORRECTION';
    const result=await d16Repository.appendSubmission({studentId:userId,assignmentId:gate.assignment_id,submissionKind:correction?'CORRECTION':'FINAL',responsePayload:receipt.response_payload||{},policyVersionAtEvent:receipt.policy_version_at_event,deadlinePolicyVersionAtEvent:receipt.deadline_policy_version_at_event,assistanceModeAtEvent:receipt.assistance_mode_at_event,submittedAt:gate.accepted_event_at,acceptedEventAt:gate.accepted_event_at,correctionOfSubmissionId:correction?gate.correction_of_submission_id:null,idempotencyKey:`integrity-gate-finalize:${gate.submission_gate_id}`});
    assignment=await d16Repository.requireAssignment(userId,gate.assignment_id);
    if(correction&&assignment.lifecycle_state==='CORRECTION_AVAILABLE')await d16Repository.transition({studentId:userId,assignmentId:assignment.assignment_id,toState:'RESUBMITTED',reason:'Correction passed the Submission Verification Gate and re-enters marking/verification.',idempotencyKey:`integrity-gate-transition:${gate.submission_gate_id}`});
    if(!correction){
      if(['ASSIGNED','UPCOMING'].includes(assignment.lifecycle_state)){await d16Repository.transition({studentId:userId,assignmentId:assignment.assignment_id,toState:'OPEN',reason:'Assignment opened by accepted submission receipt.',idempotencyKey:`integrity-gate-open:${gate.submission_gate_id}`});assignment=await d16Repository.requireAssignment(userId,assignment.assignment_id);}
      if(['OPEN','STARTED'].includes(assignment.lifecycle_state))await d16Repository.transition({studentId:userId,assignmentId:assignment.assignment_id,toState:'SUBMITTED',reason:'Submission Verification Gate finalized the server-received response.',idempotencyKey:`integrity-gate-transition:${gate.submission_gate_id}`});
    }
    return repository.updateGate({userId,gateId,state:'FINALIZED',route:gate.verification_route,reasonCodes:gate.reason_codes||[],verificationSessionId:gate.verification_session_id,finalSubmissionId:result.submission.assignment_submission_id,finalizedAt:now()});
  }

  async function optionalIntelligencePreflight({userId,assignment,receipt,gate}){
    if(!d16Intelligence||typeof d16Intelligence.interpretSimilarity!=='function')return {available:false,routeHeld:true};
    try{
      const result=await d16Intelligence.interpretSimilarity({studentId:userId,assignmentId:assignment.assignment_id,stateVersion:assignment.state_version,academicInput:{assignment:{purpose:assignment.purpose,work_stake:assignment.work_stake,assistance_mode:assignment.assistance_mode,response_kind:assignment.response_kind,learning_unit_refs:assignment.learning_unit_refs},submitted_response:receipt.response_payload,policy:{telemetry_is_context_only:true,misconduct_verdict_forbidden:true,verification_instead_of_mind_reading:true},provenance_refs:[`assignment:${assignment.assignment_id}`,`submission:${receipt.assignment_submission_id}`]},requestKey:`submission-preflight:${gate.submission_gate_id}`});
      const output=result?.validatedResult?.output;if(!result?.accepted||!output)return {available:false,routeHeld:true};
      return {available:true,routeHeld:false,verificationRecommended:Boolean(output.verification_recommended),ruleAlignment:output.rule_alignment||output.rule_alignment_evidence?.state||null};
    }catch(error){return {available:false,routeHeld:true,errorCode:error?.code||'INTELLIGENCE_UNAVAILABLE'};}
  }

  async function generateImmediateVerification({userId,assignment,receipt,gate,integritySession}){
    const target=(assignment.learning_unit_refs||[])[0]||assignment.title;
    const verification=await repository.createVerificationSession({userId,ownerType:'TEACHING_ASSIGNMENT',ownerRef:assignment.assignment_id,sourceRef:receipt.assignment_submission_id,route:'VERIFY_NOW',targetCapabilities:[String(target)],maxQuestions:3,policyVersion:gate.policy_version,integritySessionId:integritySession?.integrity_session_id||null});
    if(!d16Intelligence||typeof d16Intelligence.generateVerificationTask!=='function'){await repository.completeVerificationSession({userId,sessionId:verification.verification_session_id,status:'SYSTEM_DEFERRED'});return {verification,routeHeld:true,reason:'D16_VERIFICATION_ROUTE_UNQUALIFIED'};}
    let result;try{result=await d16Intelligence.generateVerificationTask({studentId:userId,assignmentId:assignment.assignment_id,stateVersion:assignment.state_version,academicInput:{assignment:{title:assignment.title,instructions:assignment.instructions,purpose:assignment.purpose,response_kind:assignment.response_kind,learning_unit_refs:assignment.learning_unit_refs},submitted_response:receipt.response_payload,target_capability:String(target),requirements:{fresh_equivalent:true,do_not_repeat_original:true,max_questions:3,proportionate:true,misconduct_verdict_forbidden:true},provenance_refs:[`assignment:${assignment.assignment_id}`,`submission:${receipt.assignment_submission_id}`]},requestKey:`submission-gate-verification:${gate.submission_gate_id}`});}catch(error){result=null;}
    const output=result?.validatedResult?.output;if(!result?.accepted||!output?.verification_task){await repository.completeVerificationSession({userId,sessionId:verification.verification_session_id,status:'SYSTEM_DEFERRED'});return {verification,routeHeld:true,reason:'D16_VERIFICATION_ROUTE_UNQUALIFIED'};}
    const task=output.verification_task||{},kind=String(task.timing_class||task.response_kind||'SHORT_EXPLANATION').toUpperCase();let timer='SHORT_EXPLANATION';if(/MICRO|CHOICE|RECOGN/.test(kind))timer='MICRO_RECOGNITION';else if(/CALC|NUMERIC/.test(kind))timer='ONE_STEP_CALCULATION';else if(kind.includes('CODE'))timer='CODE_WALKTHROUGH';else if(kind.includes('CONSTRUCT'))timer='TINY_CONSTRUCTED_RESPONSE';const timing=timingClass(timer);
    let item=await repository.createVerificationItem({userId,verificationSessionId:verification.verification_session_id,sequenceNo:1,timingClass:timing.timingClass,durationSeconds:timing.seconds,promptPayload:{prompt:task.prompt||task.question||task.instruction||'Briefly explain the key method you used in the submitted work.',responseKind:task.response_kind||'SHORT_TEXT',allowedResources:output.allowed_resources||[]},protectedValidationPayload:{expectedAnswer:task.expected_answer||null,rubric:task.rubric||null},targetCapability:output.target_capability||String(target)});item=await repository.startVerificationItem(userId,item.verification_item_id);return {verification,item,routeHeld:false};
  }

  async function requestAssignmentSubmission(user,assignmentId,input={}){
    const bundle=await assignmentContext(user.id,assignmentId),initial=bundle.assignment,correction=Boolean(input.correction)||initial.lifecycle_state==='CORRECTION_AVAILABLE';assertSubmissionAllowed(initial,correction);
    const accepted=now(),deadline=classifyDeadline({deadlineType:initial.deadline_type,dueAt:initial.due_at,acceptedEventAt:accepted,asOf:accepted,solutionExposedAt:initial.solution_released_at,excused:conditions(initial).includes('EXCUSED'),systemProtected:conditions(initial).includes('SYSTEM_PROTECTED')}),disposition=lateWorkDisposition({deadline,solutionReleased:Boolean(initial.solution_exposed),dependencyAdvanced:Boolean(input.dependencyAdvanced),workStake:initial.work_stake,graded:initial.graded,excused:conditions(initial).includes('EXCUSED'),systemProtected:conditions(initial).includes('SYSTEM_PROTECTED')});
    if(!disposition.acceptOriginal&&!correction)throw fail('This original Assignment is no longer academically valid; an equivalent replacement is required.','TEACHING_D16_REPLACEMENT_REQUIRED',409,{reason:disposition.reason});
    const idempotencyKey=String(input.idempotencyKey||key('submission-receipt')),originalFinal=correction?await d16Repository.latestFinalSubmission(user.id,assignmentId):null;
    const appended=await d16Repository.appendSubmission({studentId:user.id,assignmentId,submissionKind:correction?'PENDING_CORRECTION':'PENDING_FINAL',responsePayload:input.response||{},policyVersionAtEvent:initial.integrity_policy_version,deadlinePolicyVersionAtEvent:initial.deadline_policy_version,assistanceModeAtEvent:initial.assistance_mode,submittedAt:accepted,acceptedEventAt:accepted,correctionOfSubmissionId:correction?originalFinal?.assignment_submission_id||null:null,idempotencyKey});const receipt=appended.submission;
    const gateResult=await repository.createGate({userId:user.id,assignmentId,receiptSubmissionId:receipt.assignment_submission_id,correctionOfSubmissionId:correction?originalFinal?.assignment_submission_id||null:null,policyVersion:SUBMISSION_GATE_POLICY_VERSION,acceptedEventAt:accepted,blockingDeadlineAt:new Date(accepted.getTime()+20000),idempotencyKey:`gate:${idempotencyKey}`});let gate=gateResult.gate;if(gateResult.idempotent)return projectGate(user.id,gate);
    let current=initial;const next=new Set(conditions(initial));if(deadline.late)next.add('LATE');if(deadline.expired)next.add('EXPIRED');if([...next].sort().join('|')!==conditions(initial).slice().sort().join('|')){await d16Repository.setConditions({studentId:user.id,assignmentId,conditions:[...next],reason:'Submission receipt classified using authoritative acceptance time before verification processing.',idempotencyKey:`${idempotencyKey}:deadline`});current=await d16Repository.requireAssignment(user.id,assignmentId);}
    gate=await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'CHECKING',route:'NO_VERIFICATION',reasonCodes:[]});const integritySession=await repository.findOwnerSession(user.id,'TEACHING_ASSIGNMENT',assignmentId),departures=integritySession?Number(integritySession.confirmed_departure_count||0):0,review=bundle.integrity||null,reasons=[];
    if(departures)reasons.push('CONTROLLED_SESSION_DEPARTURE_RECORDED');if(['UNRESOLVED','COMPROMISED','INVALID'].includes(review?.capability_evidence))reasons.push('CAPABILITY_EVIDENCE_UNRESOLVED');if(['MISALIGNED','UNRESOLVED'].includes(review?.rule_alignment))reasons.push('RULE_ALIGNMENT_REQUIRES_REVIEW');
    const preflight=await optionalIntelligencePreflight({userId:user.id,assignment:current,receipt,gate});if(preflight.verificationRecommended)reasons.push('INTELLIGENCE_PREFLIGHT_RECOMMENDS_VERIFICATION');
    let route=verificationRouteDecision({workStake:current.work_stake,purpose:current.purpose,assistanceMode:current.assistance_mode,capabilityEvidence:review?.capability_evidence||'NOT_REVIEWED',ruleAlignment:review?.rule_alignment||preflight.ruleAlignment||'NOT_REVIEWED',confirmedDepartures:departures,recurringUncertainty:Boolean(input.recurringUncertainty),highConsequence:Boolean(input.highConsequence),activeFormalAssessment:false,systemHealthy:true});if(preflight.verificationRecommended&&route==='NO_VERIFICATION'&&current.work_stake==='GRADED')route='VERIFY_NOW';
    if(route==='NO_VERIFICATION'){gate=await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'CHECKING',route,reasonCodes:reasons});return projectGate(user.id,await finalizeGate(user.id,gate.submission_gate_id));}
    if(['VERIFY_NEXT_CLASS','VERIFY_WITH_FRESH_EQUIVALENT_WORK'].includes(route)){const verification=await repository.createVerificationSession({userId:user.id,ownerType:'TEACHING_ASSIGNMENT',ownerRef:assignmentId,sourceRef:receipt.assignment_submission_id,route,targetCapabilities:current.learning_unit_refs||[],maxQuestions:3,policyVersion:SUBMISSION_GATE_POLICY_VERSION,integritySessionId:integritySession?.integrity_session_id||null});gate=await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'CHECKING',route,reasonCodes:reasons,verificationSessionId:verification.verification_session_id});return projectGate(user.id,await finalizeGate(user.id,gate.submission_gate_id));}
    if(route==='VERIFY_NOW'){const generated=await generateImmediateVerification({userId:user.id,assignment:current,receipt,gate,integritySession});if(generated.routeHeld){gate=await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'SYSTEM_DEFERRED',route:'SYSTEM_DEFERRED',reasonCodes:[...reasons,'MODEL_ROUTE_UNQUALIFIED_OR_UNAVAILABLE'],systemDeferredReason:generated.reason,verificationSessionId:generated.verification.verification_session_id});return projectGate(user.id,gate);}gate=await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'VERIFICATION_ACTIVE',route,reasonCodes:reasons,verificationSessionId:generated.verification.verification_session_id});return projectGate(user.id,gate);}
    gate=await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'UNRESOLVED',route,reasonCodes:reasons});return projectGate(user.id,gate);
  }

  const criterionPass=(output)=>{const rows=Array.isArray(output?.criterion_results)?output.criterion_results:[];return rows.length>0&&rows.every((row)=>row?.satisfied===true||['PASS','PASSED','SUPPORTED','CORRECT'].includes(String(row?.status||row?.result||'').toUpperCase()));};
  async function submitVerificationResponse(user,verificationSessionId,itemId,input={}){
    const session=await repository.getVerificationSession(user.id,verificationSessionId);if(!session)throw fail('Verification session not found.','KIWI_VERIFICATION_SESSION_NOT_FOUND',404);const item=await repository.getVerificationItem(user.id,itemId);if(!item||item.verification_session_id!==verificationSessionId)throw fail('Verification item not found.','KIWI_VERIFICATION_ITEM_NOT_FOUND',404);const accepted=now(),responseKey=String(input.idempotencyKey||key('verification-response'));
    if(item.expires_at&&accepted.getTime()>new Date(item.expires_at).getTime()){await repository.appendVerificationResponse({userId:user.id,verificationSessionId,itemId,responsePayload:input.response||{},acceptedEventAt:accepted,evaluationState:'INVALID',evidencePayload:{reason:'SERVER_TIMER_EXPIRED'},idempotencyKey:responseKey});await repository.completeVerificationSession({userId:user.id,sessionId:verificationSessionId,status:'EXPIRED'});const gate=await repository.gateByAssignment(user.id,session.owner_ref);if(gate)await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'UNRESOLVED',route:gate.verification_route,reasonCodes:[...(gate.reason_codes||[]),'VERIFICATION_EXPIRED']});return Object.freeze({status:'EXPIRED',studentMayLeave:true,capabilityEvidence:'UNRESOLVED',priorMisconductProven:false});}
    let result=null;if(d16Intelligence&&typeof d16Intelligence.evaluateHomework==='function'){try{result=await d16Intelligence.evaluateHomework({studentId:user.id,assignmentId:session.owner_ref,stateVersion:'verification',responseKind:'GENERAL',academicInput:{verification_task:item.prompt_payload,verification_response:input.response||{},target_capability:item.target_capability,criteria:[{id:'independent_capability_confirmation',required:true}],official_gradebook_write_allowed:false,misconduct_verdict_forbidden:true,provenance_refs:[`verification-session:${verificationSessionId}`,`verification-item:${itemId}`]},requestKey:`verification-evaluate:${responseKey}`});}catch(error){result=null;}}
    const output=result?.validatedResult?.output;if(!result?.accepted||!output){await repository.appendVerificationResponse({userId:user.id,verificationSessionId,itemId,responsePayload:input.response||{},acceptedEventAt:accepted,evaluationState:'REVIEW_NEEDED',evidencePayload:{reason:'MODEL_ROUTE_UNAVAILABLE'},idempotencyKey:responseKey});await repository.completeVerificationSession({userId:user.id,sessionId:verificationSessionId,status:'SYSTEM_DEFERRED'});const gate=await repository.gateByAssignment(user.id,session.owner_ref);if(gate)await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'SYSTEM_DEFERRED',route:'SYSTEM_DEFERRED',reasonCodes:[...(gate.reason_codes||[]),'VERIFICATION_EVALUATION_DEFERRED'],systemDeferredReason:'D16_EVALUATION_ROUTE_UNQUALIFIED',verificationSessionId});return Object.freeze({status:'SYSTEM_DEFERRED',studentMayLeave:true,priorMisconductProven:false});}
    const passed=criterionPass(output);await repository.appendVerificationResponse({userId:user.id,verificationSessionId,itemId,responsePayload:input.response||{},acceptedEventAt:accepted,evaluationState:passed?'PASS':'FAIL',evidencePayload:{criterion_results:output.criterion_results||[],learning_evidence:output.learning_evidence||{},misconductVerdict:null},idempotencyKey:responseKey});await repository.completeVerificationSession({userId:user.id,sessionId:verificationSessionId,status:passed?'PASSED':'FAILED'});const gate=await repository.gateByAssignment(user.id,session.owner_ref);if(!gate)return Object.freeze({status:passed?'PASSED':'FAILED',priorMisconductProven:false});if(passed)return Object.freeze({status:'PASSED',gate:await projectGate(user.id,await finalizeGate(user.id,gate.submission_gate_id)),priorMisconductProven:false});await repository.updateGate({userId:user.id,gateId:gate.submission_gate_id,state:'UNRESOLVED',route:gate.verification_route,reasonCodes:[...(gate.reason_codes||[]),'VERIFICATION_DID_NOT_ESTABLISH_CAPABILITY'],verificationSessionId});return Object.freeze({status:'FAILED',studentMayLeave:true,capabilityEvidence:'UNRESOLVED',priorMisconductProven:false});
  }

  return Object.freeze({startSession,getSession,recordEvent,closeSession,requestAssignmentSubmission,submitVerificationResponse,getAssignmentGate,finalizeGate,resolveProfile});
}
module.exports={createIntegrityService};
