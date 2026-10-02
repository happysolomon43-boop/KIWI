'use strict';

const ASSIGNMENT_PURPOSES = Object.freeze([
  'PRACTICE','RETRIEVAL','REMEDIATION','PREPARATION','APPLICATION','PRODUCTION','REVISION','INDEPENDENT_EVIDENCE','READING',
]);
const LIFECYCLE_STATES = Object.freeze([
  'ASSIGNED','UPCOMING','OPEN','STARTED','SUBMITTED','MARKING','RETURNED','CORRECTION_AVAILABLE','RESUBMITTED','VERIFICATION','VERIFIED','CLOSED',
]);
const LIFECYCLE_TRANSITIONS = Object.freeze({
  ASSIGNED:Object.freeze(['UPCOMING','OPEN','CLOSED']),
  UPCOMING:Object.freeze(['OPEN','CLOSED']),
  OPEN:Object.freeze(['STARTED','SUBMITTED','CLOSED']),
  STARTED:Object.freeze(['SUBMITTED','CLOSED']),
  SUBMITTED:Object.freeze(['MARKING','VERIFICATION']),
  MARKING:Object.freeze(['RETURNED','VERIFICATION']),
  RETURNED:Object.freeze(['CORRECTION_AVAILABLE','CLOSED']),
  CORRECTION_AVAILABLE:Object.freeze(['RESUBMITTED','CLOSED']),
  RESUBMITTED:Object.freeze(['MARKING','VERIFICATION']),
  VERIFICATION:Object.freeze(['RETURNED','VERIFIED']),
  VERIFIED:Object.freeze(['CLOSED']),
  CLOSED:Object.freeze([]),
});
const CONDITIONS = Object.freeze(['LATE','EXPIRED','EXCUSED','REPLACED','INVALIDATED','MISSED','SYSTEM_PROTECTED','PAUSED']);
const DEADLINE_TYPES = Object.freeze(['SOFT','HARD','PEDAGOGICALLY_EXPIRING']);
const ASSISTANCE_MODES = Object.freeze(['OPEN_LEARNING_ASSISTANCE','HINT_ONLY','REFERENCE_ONLY','CLOSED_BOOK_INDEPENDENT','FORMAL_ASSESSMENT']);
const RULE_ALIGNMENT_STATES = Object.freeze(['NOT_REVIEWED','ALIGNED','MISALIGNED','UNRESOLVED']);
const CAPABILITY_EVIDENCE_STATES = Object.freeze(['NOT_REVIEWED','SUPPORTED','UNRESOLVED','COMPROMISED','INVALID']);
const VERIFICATION_STATES = Object.freeze(['NOT_REQUIRED','REQUIRED','PENDING','PASSED','FAILED','REFUSED','REVIEW_NEEDED']);
const WORK_STAKES = Object.freeze(['OPTIONAL','PREPARATION','REMEDIATION','GRADED']);
const SUBMISSION_KINDS = Object.freeze(['DRAFT','PENDING_FINAL','FINAL','PENDING_CORRECTION','CORRECTION','VERIFICATION']);
const SOLUTION_RELEASE_TRIGGERS = Object.freeze(['AFTER_SUBMISSION','AFTER_DEADLINE','AFTER_CLASS','AFTER_EQUIVALENT_ATTEMPTS','MANUAL_AUTHORIZED']);
const RESPONSE_KINDS = Object.freeze(['GENERAL','LONG_FORM','CODE','QUANTITATIVE','HUMANITIES','READING_CHECK']);
const INTEGRITY_POLICY_VERSION = 'integrity-verification.v1';
const CORRECTION_POLICY_VERSION = 'coursework-correction.v1';
const DEADLINE_POLICY_VERSION = 'homework-deadline-semantics.v1';

function fail(message, code, status = 422, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}
function upper(value){ return String(value ?? '').trim().toUpperCase(); }
function oneOf(value, allowed, field) {
  const normalized = upper(value);
  if (!allowed.includes(normalized)) throw fail(`${field} is unsupported.`, 'TEACHING_D16_CONTRACT_INVALID', 400, { field, value });
  return normalized;
}
function asDate(value, field, {nullable=false}={}){
  if(value==null && nullable)return null;
  const d=value instanceof Date?new Date(value.getTime()):new Date(value);
  if(!Number.isFinite(d.getTime()))throw fail(`${field} must be a valid timestamp.`,'TEACHING_D16_TIME_INVALID',400,{field});
  return d;
}
function object(value, field){
  if(value==null)return {};
  if(typeof value!=='object'||Array.isArray(value))throw fail(`${field} must be an object.`,'TEACHING_D16_CONTRACT_INVALID',400,{field});
  return {...value};
}
function array(value, field){
  if(value==null)return [];
  if(!Array.isArray(value))throw fail(`${field} must be an array.`,'TEACHING_D16_CONTRACT_INVALID',400,{field});
  return [...value];
}
function string(value, field, {required=true,max=1000}={}){
  const out=String(value??'').trim();
  if(required&&!out)throw fail(`${field} is required.`,'TEACHING_D16_CONTRACT_INVALID',400,{field});
  if(out.length>max)throw fail(`${field} is too long.`,'TEACHING_D16_CONTRACT_INVALID',400,{field});
  return out||null;
}
function normalizeEffort(minMinutes, maxMinutes) {
  const min = Number(minMinutes); const max = Number(maxMinutes);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    throw fail('Estimated effort must be a valid range.', 'TEACHING_D16_EFFORT_INVALID', 400);
  }
  return Object.freeze({ minMinutes: Math.round(min), maxMinutes: Math.round(max) });
}
function normalizeConditions(values=[]){
  const normalized=[...new Set(array(values,'conditions').map((v)=>oneOf(v,CONDITIONS,'condition')))];
  return Object.freeze(normalized);
}
function assertLifecycleTransition(from,to){
  const current=oneOf(from,LIFECYCLE_STATES,'lifecycleState');
  const next=oneOf(to,LIFECYCLE_STATES,'lifecycleState');
  if(!LIFECYCLE_TRANSITIONS[current].includes(next))throw fail(`Assignment lifecycle cannot transition from ${current} to ${next}.`,'TEACHING_D16_LIFECYCLE_TRANSITION_INVALID',409,{from:current,to:next});
  return Object.freeze({from:current,to:next});
}
function normalizeSolutionReleasePolicy(value={}){
  const raw=object(value,'solutionReleasePolicy');
  const trigger=oneOf(raw.trigger||'AFTER_DEADLINE',SOLUTION_RELEASE_TRIGGERS,'solutionReleasePolicy.trigger');
  const releaseAt=raw.releaseAt==null?null:asDate(raw.releaseAt,'solutionReleasePolicy.releaseAt').toISOString();
  const dependentClassRef=raw.dependentClassRef==null?null:string(raw.dependentClassRef,'solutionReleasePolicy.dependentClassRef',{max:200});
  return Object.freeze({trigger,releaseAt,dependentClassRef,equivalentAttemptsRequired:Math.max(0,Number(raw.equivalentAttemptsRequired)||0)});
}
function normalizeAssignmentSpec(input={}){
  const effort=normalizeEffort(input.estimatedEffortMinMinutes,input.estimatedEffortMaxMinutes);
  const due=asDate(input.dueAt,'dueAt');
  const purpose=oneOf(input.purpose,ASSIGNMENT_PURPOSES,'purpose');
  const stake=oneOf(input.workStake,WORK_STAKES,'workStake');
  const assistance=oneOf(input.assistanceMode,ASSISTANCE_MODES,'assistanceMode');
  const graded=Boolean(input.graded);
  if(graded && stake!=='GRADED')throw fail('A graded Assignment must use GRADED work stake.','TEACHING_D16_GRADED_STAKE_MISMATCH',400);
  if(assistance==='FORMAL_ASSESSMENT')throw fail('D16 cannot create a formal Assessment Assignment; D17+ owns locked formal Assessment truth.','TEACHING_D16_FORMAL_ASSESSMENT_OWNER_REQUIRED',409);
  return Object.freeze({
    courseId:string(input.courseId,'courseId',{max:200}),
    title:string(input.title,'title',{max:240}),
    instructions:string(input.instructions,'instructions',{required:false,max:12000}),
    learningUnitIds:Object.freeze([...new Set(array(input.learningUnitIds,'learningUnitIds').map(String).filter(Boolean))]),
    sourceLineage:Object.freeze(object(input.sourceLineage,'sourceLineage')),
    purpose,workStake:stake,lifecycleState:oneOf(input.lifecycleState||'ASSIGNED',LIFECYCLE_STATES,'lifecycleState'),
    conditions:normalizeConditions(input.conditions||[]),
    estimatedEffortMinMinutes:effort.minMinutes,estimatedEffortMaxMinutes:effort.maxMinutes,
    deadlineType:oneOf(input.deadlineType,DEADLINE_TYPES,'deadlineType'),dueAt:due.toISOString(),
    deadlinePolicyVersion:string(input.deadlinePolicyVersion||DEADLINE_POLICY_VERSION,'deadlinePolicyVersion',{max:120}),
    integrityPolicyVersion:string(input.integrityPolicyVersion||INTEGRITY_POLICY_VERSION,'integrityPolicyVersion',{max:120}),
    correctionPolicyVersion:string(input.correctionPolicyVersion||CORRECTION_POLICY_VERSION,'correctionPolicyVersion',{max:120}),
    assistanceMode:assistance,solutionReleasePolicy:normalizeSolutionReleasePolicy(input.solutionReleasePolicy||{}),
    graded,responseKind:oneOf(input.responseKind||'GENERAL',RESPONSE_KINDS,'responseKind'),
    dependencyRefs:Object.freeze([...new Set(array(input.dependencyRefs,'dependencyRefs').map(String).filter(Boolean))]),
    feedbackReleasePolicy:Object.freeze(object(input.feedbackReleasePolicy,'feedbackReleasePolicy')),
  });
}
function classifyDeadline({ deadlineType, dueAt, acceptedEventAt = null, submittedAt = null, asOf = new Date(), solutionExposedAt = null, excused = false, systemProtected = false, paused = false }) {
  const type = oneOf(deadlineType, DEADLINE_TYPES, 'deadlineType');
  if (excused) return Object.freeze({ type, late: false, expired: false, condition: 'EXCUSED' });
  if (systemProtected) return Object.freeze({ type, late: false, expired: false, condition: 'SYSTEM_PROTECTED' });
  if (paused) return Object.freeze({ type, late: false, expired: false, condition: 'PAUSED' });
  const due = asDate(dueAt,'dueAt');
  const eventValue=acceptedEventAt??submittedAt;
  const event = eventValue==null?null:asDate(eventValue,'acceptedEventAt');
  const now = asDate(asOf,'asOf');
  const exposed = solutionExposedAt==null?null:asDate(solutionExposedAt,'solutionExposedAt');
  const overdueWithoutSubmission = !event && now.getTime() > due.getTime();
  const late = Boolean(event ? event.getTime() > due.getTime() : (type === 'SOFT' && overdueWithoutSubmission));
  const timeExpired = overdueWithoutSubmission;
  const evidenceExpired = Boolean(exposed && exposed.getTime() >= due.getTime());
  const expired = type !== 'SOFT' && (timeExpired || late || evidenceExpired);
  return Object.freeze({ type, late, expired, condition: expired ? 'EXPIRED' : late ? 'LATE' : null, eventTimeUsed:event?.toISOString()||null });
}
function assistanceDecision({ mode, requestKind, submitted = false, closed = false, solutionReleased = false }) {
  const assistanceMode = oneOf(mode, ASSISTANCE_MODES, 'assistanceMode');
  const kind = upper(requestKind);
  if (assistanceMode === 'FORMAL_ASSESSMENT') return Object.freeze({ allowed:false,maxDisclosure:'NONE',reason:'FORMAL_ASSESSMENT_OWNER',owner:'ASSESSMENT' });
  if (solutionReleased || closed) return Object.freeze({ allowed:true,maxDisclosure:'FULL_SOLUTION',reason:'RELEASED',owner:'WORK' });
  if (assistanceMode === 'OPEN_LEARNING_ASSISTANCE') return Object.freeze({ allowed:true,maxDisclosure:submitted?'FULL_SOLUTION':'EXPLANATION',reason:'OPEN_LEARNING',owner:'WORK' });
  if (assistanceMode === 'HINT_ONLY') return Object.freeze({ allowed:kind==='HINT',maxDisclosure:'HINT',reason:'HINT_ONLY',owner:'WORK' });
  if (assistanceMode === 'REFERENCE_ONLY') return Object.freeze({ allowed:kind==='REFERENCE',maxDisclosure:'REFERENCE',reason:'REFERENCE_ONLY',owner:'WORK' });
  return Object.freeze({ allowed:false,maxDisclosure:'NONE',reason:'INDEPENDENT_ATTEMPT',owner:'WORK' });
}
function solutionReleaseDecision({policy,now=new Date(),finalSubmissionAt=null,dependentClassEndedAt=null,equivalentAttemptsCompleted=0,manualAuthorized=false}){
  const p=normalizeSolutionReleasePolicy(policy||{});
  const at=asDate(now,'now');
  let released=false,reason='NOT_DUE';
  if(p.trigger==='AFTER_SUBMISSION'&&finalSubmissionAt){released=true;reason='FINAL_SUBMISSION_ACCEPTED';}
  else if(p.trigger==='AFTER_DEADLINE'&&p.releaseAt&&at.getTime()>=Date.parse(p.releaseAt)){released=true;reason='DEADLINE_RELEASE_AT_REACHED';}
  else if(p.trigger==='AFTER_DEADLINE'&&!p.releaseAt){released=false;reason='OWNER_DUE_AT_REQUIRED';}
  else if(p.trigger==='AFTER_CLASS'&&dependentClassEndedAt&&at.getTime()>=Date.parse(dependentClassEndedAt)){released=true;reason='DEPENDENT_CLASS_ENDED';}
  else if(p.trigger==='AFTER_EQUIVALENT_ATTEMPTS'&&Number(equivalentAttemptsCompleted)>=p.equivalentAttemptsRequired){released=true;reason='EQUIVALENT_ATTEMPTS_COMPLETE';}
  else if(p.trigger==='MANUAL_AUTHORIZED'&&manualAuthorized===true){released=true;reason='MANUAL_OWNER_AUTHORIZED';}
  return Object.freeze({released,reason,policy:p});
}
function integrityReview({ policyVersion, signals = [], ruleAlignment = 'NOT_REVIEWED', capabilityEvidence = 'NOT_REVIEWED', activeFormalAssessment = false }) {
  if (!policyVersion) throw fail('Integrity review requires policy-at-event version.', 'TEACHING_D16_POLICY_AT_EVENT_REQUIRED', 409);
  const contextualSignals = array(signals,'signals').map((signal) => Object.freeze({
    type: upper(signal?.type || signal?.kind || 'UNKNOWN'),
    source: signal?.source == null ? null : String(signal.source),
    value: signal?.value ?? null,
    authoritativeProof: false,
  }));
  return Object.freeze({
    policyVersion:String(policyVersion),
    ruleAlignment:oneOf(ruleAlignment,RULE_ALIGNMENT_STATES,'ruleAlignment'),
    capabilityEvidence:oneOf(capabilityEvidence,CAPABILITY_EVIDENCE_STATES,'capabilityEvidence'),
    signals:Object.freeze(contextualSignals),
    misconductVerdict:null,guiltProbability:null,permanentLabel:null,
    midAttemptVerificationAllowed:!activeFormalAssessment,
    activeFormalAssessment:Boolean(activeFormalAssessment),
  });
}
function verificationDirective({ capabilityEvidence, activeFormalAssessment = false, disputedCapability, method = 'TARGETED_CONTROLLED_REDEMONSTRATION' }) {
  const evidence = oneOf(capabilityEvidence, CAPABILITY_EVIDENCE_STATES, 'capabilityEvidence');
  if (activeFormalAssessment) return Object.freeze({ state:'PENDING',deferredToPostAttempt:true,target:disputedCapability||null,method:null,priorMisconductProven:false });
  if (evidence !== 'UNRESOLVED') return Object.freeze({ state:'NOT_REQUIRED',deferredToPostAttempt:false,target:null,method:null,priorMisconductProven:false });
  const target=string(disputedCapability,'disputedCapability',{max:500});
  const allowed=['TARGETED_CONTROLLED_REDEMONSTRATION','PROVENANCE_AND_ATTEMPT_REVIEW','RULE_COMPLIANCE_REVIEW'];
  const selected=oneOf(method,allowed,'verificationMethod');
  return Object.freeze({ state:'REQUIRED',deferredToPostAttempt:false,target,method:selected,wholesaleReproductionRequired:false,priorMisconductProven:false });
}
function verificationResult({result}){
  const state=oneOf(result,['PASSED','FAILED','REFUSED','REVIEW_NEEDED'],'verificationResult');
  return Object.freeze({verificationState:state,priorMisconductProven:false,capabilityEvidence:state==='PASSED'?'SUPPORTED':'UNRESOLVED'});
}
function repeatIntegrityPolicy(){
  return Object.freeze({enabled:false,reason:'NO_REPEAT_INTEGRITY_INCIDENT_POLICY_DEFINED_IN_D06_GATE',automaticEscalation:false,permanentLabel:false});
}
function retryPolicy({purpose,workStake,graded=false}){
  const p=oneOf(purpose,ASSIGNMENT_PURPOSES,'purpose');
  const stake=oneOf(workStake,WORK_STAKES,'workStake');
  if(p==='PRACTICE'&&!graded)return Object.freeze({mode:'GENEROUS_RETRY',maxOrdinaryRetries:null,correctionAllowed:true,preserveOriginal:true});
  if(stake==='GRADED'||graded)return Object.freeze({mode:'STRUCTURED_CORRECTION',maxOrdinaryRetries:0,correctionAllowed:true,preserveOriginal:true,markRecovery:'POLICY_OWNED'});
  return Object.freeze({mode:'LEARNING_RETRY',maxOrdinaryRetries:3,correctionAllowed:true,preserveOriginal:true});
}
function lateWorkDisposition({deadline,solutionReleased=false,dependencyAdvanced=false,workStake,graded=false,excused=false,systemProtected=false,coursePaused=false}){
  if(excused||systemProtected||coursePaused)return Object.freeze({acceptOriginal:true,replacementRequired:false,markPenalty:null,reason:coursePaused?'COURSE_PAUSED':excused?'EXCUSED':'SYSTEM_PROTECTED'});
  if(solutionReleased)return Object.freeze({acceptOriginal:false,replacementRequired:true,markPenalty:null,reason:'SOLUTION_EXPOSED_ORIGINAL_NOT_CLEAN'});
  if(deadline?.expired && (dependencyAdvanced||graded))return Object.freeze({acceptOriginal:false,replacementRequired:true,markPenalty:null,reason:'PEDAGOGICAL_VALIDITY_EXPIRED'});
  return Object.freeze({acceptOriginal:true,replacementRequired:false,markPenalty:null,reason:deadline?.late?'LATE_BUT_ACADEMICALLY_VALID':'VALID'});
}
function extensionFeasibility({requestedDeadlineAt,currentDueAt,solutionReleaseAt=null,dependencyDueAts=[],coursePaused=false,approvedBreakEndAt=null}){
  const requested=asDate(requestedDeadlineAt,'requestedDeadlineAt');
  const current=asDate(currentDueAt,'currentDueAt');
  if(requested.getTime()<=current.getTime())return Object.freeze({outcome:'REJECTED',reason:'EXTENSION_MUST_MOVE_DEADLINE_FORWARD'});
  const hardStops=[];
  if(solutionReleaseAt)hardStops.push({kind:'SOLUTION_RELEASE',at:asDate(solutionReleaseAt,'solutionReleaseAt')});
  for(const at of array(dependencyDueAts,'dependencyDueAts'))hardStops.push({kind:'DEPENDENCY',at:asDate(at,'dependencyDueAt')});
  const first=hardStops.sort((a,b)=>a.at-b.at)[0]||null;
  if(first&&requested.getTime()>=first.at.getTime())return Object.freeze({outcome:'ALTERNATIVE_REQUIRED',reason:first.kind,latestCleanDeadlineAt:new Date(first.at.getTime()-1000).toISOString()});
  if(coursePaused)return Object.freeze({outcome:'APPROVED_WITH_ADJUSTMENT',reason:'COURSE_PAUSED',requestedDeadlineAt:requested.toISOString(),effectiveAfterResume:true});
  if(approvedBreakEndAt&&requested.getTime()<Date.parse(approvedBreakEndAt))return Object.freeze({outcome:'APPROVED_WITH_ADJUSTMENT',reason:'APPROVED_BREAK',earliestDeadlineAt:asDate(approvedBreakEndAt,'approvedBreakEndAt').toISOString()});
  return Object.freeze({outcome:'APPROVED',reason:'FEASIBLE',requestedDeadlineAt:requested.toISOString()});
}
function subjectEvaluationProfile(responseKind){
  const kind=oneOf(responseKind,RESPONSE_KINDS,'responseKind');
  const dimensions={
    GENERAL:['correctness','reasoning','task_requirements'],
    LONG_FORM:['rubric_criteria','argument','evidence','organization','precision'],
    CODE:['reasoning','correctness','debugging','tests','explanation'],
    QUANTITATIVE:['method','substitution','reasoning','arithmetic','units','final_answer'],
    HUMANITIES:['claim','evidence','interpretation','counterargument','source_use'],
    READING_CHECK:['understanding','retrieval','source_grounding'],
  }[kind];
  return Object.freeze({kind,dimensions:Object.freeze(dimensions),rubricRequiredBeforeResponse:Boolean(kind==='LONG_FORM' || kind==='HUMANITIES'),officialGradeOwner:'GRADEBOOK_D20'});
}
function homeworkNeedDecision({lessonFacts=[],knowledgeSignals=[],upcomingPrerequisites=[],retentionDue=[],declaredProductionNeed=false,courseWorkloadAtRisk=false}){
  const reasons=[];
  if(array(lessonFacts,'lessonFacts').some((x)=>x?.unfinished||x?.needs_practice||x?.misconception))reasons.push('LESSON_EVIDENCE');
  if(array(knowledgeSignals,'knowledgeSignals').some((x)=>['ASSISTED','EMERGING'].includes(upper(x?.base_state)) || (x?.overlays||[]).includes('FRAGILE')))reasons.push('KNOWLEDGE_EVIDENCE');
  if(array(upcomingPrerequisites,'upcomingPrerequisites').length)reasons.push('UPCOMING_PREREQUISITE');
  if(array(retentionDue,'retentionDue').length)reasons.push('RETENTION_DUE');
  if(declaredProductionNeed)reasons.push('DECLARED_PRODUCTION');
  if(!reasons.length)return Object.freeze({assign:false,reasons:Object.freeze([]),workloadReviewRequired:false});
  return Object.freeze({assign:true,reasons:Object.freeze(reasons),workloadReviewRequired:Boolean(courseWorkloadAtRisk)});
}
function missedOutcome(stake) {
  switch (oneOf(stake, WORK_STAKES, 'workStake')) {
    case 'OPTIONAL': return Object.freeze({ gradebookEffect:false,consequence:'LESS_PRACTICE_EVIDENCE' });
    case 'PREPARATION': return Object.freeze({ gradebookEffect:false,consequence:'NEXT_CLASS_ADJUSTMENT' });
    case 'REMEDIATION': return Object.freeze({ gradebookEffect:false,consequence:'WEAKNESS_UNRESOLVED' });
    case 'GRADED': return Object.freeze({ gradebookEffect:'POLICY_OWNED',consequence:'MISSING_POLICY_PATH' });
    default: throw fail('Unsupported work stake.', 'TEACHING_D16_STAKE_INVALID');
  }
}
function readingEvidence({ completed, optionalCheckEvidence = null }) {
  return Object.freeze({ activityCompleted:Boolean(completed),mastery:null,learningEvidence:optionalCheckEvidence||null,completionAloneIsEvidence:false,officialMarkFromCompletion:false });
}
function studentIntegrityProjection(review){
  if(!review)return null;
  return Object.freeze({
    ruleAlignment:review.rule_alignment||review.ruleAlignment||'NOT_REVIEWED',
    capabilityEvidence:review.capability_evidence||review.capabilityEvidence||'NOT_REVIEWED',
    verificationState:review.verification_state||review.verificationState||'NOT_REQUIRED',
    verificationRequired:['REQUIRED','PENDING','REVIEW_NEEDED'].includes(upper(review.verification_state||review.verificationState)),
    misconductVerdict:null,guiltProbability:null,contextualSignals:null,permanentLabel:null,
  });
}

module.exports={
  ASSIGNMENT_PURPOSES,LIFECYCLE_STATES,LIFECYCLE_TRANSITIONS,CONDITIONS,DEADLINE_TYPES,ASSISTANCE_MODES,
  RULE_ALIGNMENT_STATES,CAPABILITY_EVIDENCE_STATES,VERIFICATION_STATES,WORK_STAKES,SUBMISSION_KINDS,
  SOLUTION_RELEASE_TRIGGERS,RESPONSE_KINDS,INTEGRITY_POLICY_VERSION,CORRECTION_POLICY_VERSION,DEADLINE_POLICY_VERSION,
  fail,oneOf,normalizeEffort,normalizeConditions,assertLifecycleTransition,normalizeSolutionReleasePolicy,normalizeAssignmentSpec,
  classifyDeadline,assistanceDecision,solutionReleaseDecision,integrityReview,verificationDirective,verificationResult,
  repeatIntegrityPolicy,retryPolicy,lateWorkDisposition,extensionFeasibility,subjectEvaluationProfile,homeworkNeedDecision,
  missedOutcome,readingEvidence,studentIntegrityProjection,
};