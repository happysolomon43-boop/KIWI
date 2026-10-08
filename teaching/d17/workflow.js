'use strict';

const {TEACHING_EVENTS}=require('../events/names');
const {RECONCILIATION_DISPOSITIONS:R}=require('../runtime/constants');

// Owner services retain every eligibility, independent-validation and moderation
// gate. This coordinator only connects their persisted, retry-safe stages.
function createAssessmentWorkflow({repository,service,markingService,markingRepository,onGradeChange=null,clock=()=>new Date()}={}){
  async function prepare(studentId,assessmentId,key){
    const user={id:studentId},assessment=await repository.requireAssessment(studentId,assessmentId);
    if(['CANCELLED','SUPERSEDED'].includes(assessment.definition_state))return {state:'WITHDRAWN'};
    const locked=await repository.latestPackage(studentId,assessmentId);
    if(locked?.package_state==='LOCKED')return {state:'READY',packageId:locked.assessment_package_id};
    const eligibility=await repository.currentEligibility(studentId,assessment.course_id);
    if(assessment.graded&&!eligibility.length){
      await repository.upsertPplWorkspace({studentId,assessmentId,lane:'ELIGIBLE_CANDIDATE',maturity:'STRUCTURED',openFindings:[{code:'NO_ELIGIBLE_TAUGHT_MATERIAL'}],finalizationReady:false,finalizationReasons:['NO_ELIGIBLE_TAUGHT_MATERIAL']});
      return {state:'WAITING_FOR_ELIGIBLE_MATERIAL'};
    }
    if(assessment.graded)await markingService.ensurePolicy(user,assessment.course_id);
    const audit=await repository.courseAuditView(studentId,assessment.course_id);
    let bp=await repository.latestBlueprint(studentId,assessmentId);
    if(!bp||bp.lane!=='ELIGIBLE_CANDIDATE'||bp.maturity!=='PRE_LOCK_READY'||(bp.source_state_versions?.course_plan_id&&bp.source_state_versions.course_plan_id!==audit.course_plan_id)){
      const planned=await service.prepareBlueprint(user,assessmentId,{maturity:'PRE_LOCK_READY',sourceStateVersions:{course_plan_id:audit.course_plan_id,course_plan_version:audit.course_plan_version},requestKey:`${key}:plan`,idempotencyKey:`${key}:blueprint`});
      bp=planned.blueprint;
    }
    const slots=bp.blueprint_payload?.slots||[];
    if(!slots.length)throw Object.assign(new Error('Assessment Blueprint has no measurement slots.'),{code:'TEACHING_ASSESSMENT_EMPTY_BLUEPRINT'});
    for(const slot of slots){
      const versions=await repository.candidateVersions(studentId,assessmentId,bp.assessment_blueprint_id);
      let version=versions.find(v=>String(v.slot_id)===String(slot.slot_id));
      if(!version){const generated=await service.generateCandidate(user,assessmentId,{blueprintId:bp.assessment_blueprint_id,slotId:slot.slot_id,requestKey:`${key}:generate:${slot.slot_id}`});version=generated.version;}
      const validations=await repository.validations(studentId,assessmentId);
      const latest=validations.filter(v=>v.validation_scope==='ITEM'&&v.candidate_version_id===version.candidate_version_id).at(-1);
      if(latest?.outcome!=='PASS')await service.validateItem(user,assessmentId,version.candidate_version_id,{requestKey:`${key}:validate:${version.candidate_version_id}`,idempotencyKey:`${key}:validation:${version.candidate_version_id}`});
    }
    await service.validateWholePackage(user,assessmentId,{blueprintId:bp.assessment_blueprint_id,requestKey:`${key}:whole`,idempotencyKey:`${key}:whole-validation`});
    const result=await service.reconcileAndLock(user,assessmentId,{blueprintId:bp.assessment_blueprint_id,idempotencyKey:`${key}:lock`});
    return {state:'READY',packageId:result.package?.assessment_package_id||result.assessment_package_id};
  }
  async function mark(studentId,attemptId,key){
    const user={id:studentId};
    let result=await markingService.markAttempt(user,attemptId,{idempotencyKey:`${key}:mark`});
    if(result.state==='NON_GRADED')return result;
    result=result.result||result;
    const resultId=result.assessmentResultId||result.result?.assessmentResultId;
    if(!resultId)throw new Error('Marking did not return its persisted Result identity.');
    if(result.moderationRequired&&result.markingState!=='MODERATED')await markingService.moderateResult(user,resultId,{idempotencyKey:`${key}:moderate`});
    result=await markingService.assessmentReview(user,resultId);
    if(result.reviewBlocked||!['PROVISIONAL','MODERATED'].includes(result.markingState))return {state:'REVIEW_NEEDED',resultId};
    // Publication never resolves a disagreement or prematurely finalizes appeals.
    const releaseAt=result.feedbackReleaseAt&&Date.parse(result.feedbackReleaseAt);
    if(releaseAt&&releaseAt>new Date(clock()).getTime()){await repository.scheduleMarking(studentId,attemptId,new Date(releaseAt).toISOString());return {state:'RELEASE_NOT_DUE',resultId};}
    if(result.releaseState==='HELD')await markingService.transitionResult(user,resultId,{to:'RELEASED',idempotencyKey:`${key}:release`});
    result=await markingService.assessmentReview(user,resultId);
    const stored=await markingRepository.resultById(studentId,resultId),policy=await markingRepository.lockedPolicy(studentId,stored.course_id);
    if(result.releaseState==='RELEASED'&&policy?.appeal_policy?.default_review_direction&&(policy.appeal_policy.authority_ref||policy.appeal_policy.policy_ref))result=await markingService.transitionResult(user,resultId,{to:'APPEALABLE',idempotencyKey:`${key}:appealable`});
    if(onGradeChange)await onGradeChange(studentId,stored.course_id);
    return {state:result.releaseState,resultId};
  }
  const ownerEvent=event=>({...event,actorId:event.actorId||event.actor_id||event.payload?.student_id,aggregateId:event.aggregateId||event.aggregate_id,eventId:event.eventId||event.event_id});
  function register(eventRuntime,publishedEvents=null){
    if(publishedEvents)publishedEvents.register(TEACHING_EVENTS.CLASS_ENDED,{subscriberId:'d17-assessment-eligibility-reconciliation',handle:raw=>{const event=ownerEvent(raw);return repository.wakeAfterClass(event.actorId,event.payload?.class_id||event.aggregateId,`d17-class-coverage:${event.eventId}`);}});
    eventRuntime.register(TEACHING_EVENTS.ASSESSMENT_PREPARATION_DUE,{
      reconcile:async raw=>{const event=ownerEvent(raw);const row=await repository.assessment(event.actorId,event.aggregateId);return {disposition:row&&!['CANCELLED','SUPERSEDED'].includes(row.definition_state)?R.ACTIONABLE:R.SUPERSEDED};},
      handle:async raw=>{const event=ownerEvent(raw);return {safeMetadata:await prepare(event.actorId,event.aggregateId,event.eventId)};},
    });
    eventRuntime.register(TEACHING_EVENTS.ASSESSMENT_SUBMITTED,{
      reconcile:async raw=>{const event=ownerEvent(raw);const row=await repository.attempt(event.actorId,event.aggregateId);return {disposition:row&&['SUBMITTED','EXPIRED'].includes(row.attempt_state)&&!row.invalidation_reason?R.ACTIONABLE:R.SUPERSEDED};},
      handle:async raw=>{const event=ownerEvent(raw);return {safeMetadata:await mark(event.actorId,event.aggregateId,event.eventId)};},
    });
  }
  return Object.freeze({prepare,mark,register});
}
module.exports={createAssessmentWorkflow};
