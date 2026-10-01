'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  normalizeAssignmentSpec,classifyDeadline,assistanceDecision,solutionReleaseDecision,
  integrityReview,verificationDirective,verificationResult,repeatIntegrityPolicy,retryPolicy,
  lateWorkDisposition,extensionFeasibility,subjectEvaluationProfile,homeworkNeedDecision,
  missedOutcome,readingEvidence,studentIntegrityProjection,
}=require('../../../teaching/d16/contracts');

const DUE='2026-10-02T12:00:00.000Z';
const before='2026-10-02T11:59:59.000Z';
const after='2026-10-02T12:00:01.000Z';

function spec(overrides={}){
  return normalizeAssignmentSpec({
    courseId:'course-1',title:'Explain conservation of momentum',instructions:'Show your reasoning.',
    learningUnitIds:['lu-1'],sourceLineage:{classClosureRef:'class-closure:c1'},purpose:'PRACTICE',
    workStake:'OPTIONAL',estimatedEffortMinMinutes:20,estimatedEffortMaxMinutes:35,
    deadlineType:'SOFT',dueAt:DUE,assistanceMode:'OPEN_LEARNING_ASSISTANCE',responseKind:'QUANTITATIVE',
    solutionReleasePolicy:{trigger:'AFTER_DEADLINE',releaseAt:'2026-10-03T12:00:00.000Z'},graded:false,
    ...overrides,
  });
}

test('D16 models primary lifecycle separately from orthogonal deadline conditions',()=>{
  const value=spec({conditions:['LATE','EXCUSED']});
  assert.equal(value.lifecycleState,'ASSIGNED');
  assert.deepEqual(value.conditions,['LATE','EXCUSED']);
});

test('event-time submission remains on time even when processing happens later',()=>{
  const result=classifyDeadline({deadlineType:'HARD',dueAt:DUE,acceptedEventAt:before,asOf:'2026-10-05T12:00:00.000Z'});
  assert.equal(result.late,false);assert.equal(result.expired,false);assert.equal(result.eventTimeUsed,before);
});

test('soft and pedagogically expiring deadlines remain distinct',()=>{
  const soft=classifyDeadline({deadlineType:'SOFT',dueAt:DUE,acceptedEventAt:after,asOf:after});
  const expiring=classifyDeadline({deadlineType:'PEDAGOGICALLY_EXPIRING',dueAt:DUE,acceptedEventAt:after,asOf:after});
  assert.equal(soft.late,true);assert.equal(soft.expired,false);
  assert.equal(expiring.late,true);assert.equal(expiring.expired,true);
});

test('answer requests are controller-enforced in every assistance mode',()=>{
  assert.equal(assistanceDecision({mode:'OPEN_LEARNING_ASSISTANCE',requestKind:'EXPLANATION'}).allowed,true);
  assert.equal(assistanceDecision({mode:'HINT_ONLY',requestKind:'ANSWER'}).allowed,false);
  assert.equal(assistanceDecision({mode:'HINT_ONLY',requestKind:'HINT'}).maxDisclosure,'HINT');
  assert.equal(assistanceDecision({mode:'REFERENCE_ONLY',requestKind:'ANSWER'}).allowed,false);
  assert.equal(assistanceDecision({mode:'REFERENCE_ONLY',requestKind:'REFERENCE'}).maxDisclosure,'REFERENCE');
  assert.equal(assistanceDecision({mode:'CLOSED_BOOK_INDEPENDENT',requestKind:'HINT'}).allowed,false);
  assert.equal(assistanceDecision({mode:'FORMAL_ASSESSMENT',requestKind:'HINT'}).reason,'FORMAL_ASSESSMENT_OWNER');
});

test('solution release is policy-timed and does not leak before its trigger',()=>{
  const early=solutionReleaseDecision({policy:{trigger:'AFTER_DEADLINE',releaseAt:'2026-10-03T12:00:00.000Z'},now:DUE});
  const released=solutionReleaseDecision({policy:{trigger:'AFTER_DEADLINE',releaseAt:'2026-10-03T12:00:00.000Z'},now:'2026-10-03T12:00:00.000Z'});
  assert.equal(early.released,false);assert.equal(released.released,true);
});

test('telemetry and detector signals remain contextual evidence rather than misconduct proof',()=>{
  const review=integrityReview({policyVersion:'integrity-verification.v1',signals:[{type:'AI_DETECTOR_SCORE',value:0.99},{type:'PASTE_EVENT',value:true}],ruleAlignment:'UNRESOLVED',capabilityEvidence:'UNRESOLVED'});
  assert.equal(review.signals.length,2);assert.equal(review.signals.every((signal)=>signal.authoritativeProof===false),true);
  assert.equal(review.misconductVerdict,null);assert.equal(review.guiltProbability,null);assert.equal(review.permanentLabel,null);
});

test('student integrity projection suppresses contextual signals and pseudo-precision',()=>{
  const projection=studentIntegrityProjection({rule_alignment:'UNRESOLVED',capability_evidence:'UNRESOLVED',verification_state:'REQUIRED',signals:[{type:'PASTE'}]});
  assert.equal(projection.verificationRequired,true);assert.equal(projection.contextualSignals,null);assert.equal(projection.guiltProbability,null);assert.equal(projection.permanentLabel,null);
});

test('unresolved capability evidence produces proportional targeted verification',()=>{
  const directive=verificationDirective({capabilityEvidence:'UNRESOLVED',disputedCapability:'solve a conservation-of-momentum problem'});
  assert.equal(directive.state,'REQUIRED');assert.equal(directive.wholesaleReproductionRequired,false);assert.equal(directive.priorMisconductProven,false);
});

test('active formal assessment defers D16 verification until post-attempt',()=>{
  const directive=verificationDirective({capabilityEvidence:'UNRESOLVED',activeFormalAssessment:true,disputedCapability:'derive the result'});
  assert.equal(directive.deferredToPostAttempt,true);assert.equal(directive.method,null);assert.equal(directive.priorMisconductProven,false);
});

test('failed or refused verification remains unresolved and never proves prior misconduct',()=>{
  for(const result of ['FAILED','REFUSED','REVIEW_NEEDED']){
    const value=verificationResult({result});
    assert.equal(value.capabilityEvidence,'UNRESOLVED');assert.equal(value.priorMisconductProven,false);
  }
});

test('repeat-integrity escalation is disabled because D06 defines no repeat incident policy',()=>{
  const policy=repeatIntegrityPolicy();
  assert.equal(policy.enabled,false);assert.equal(policy.automaticEscalation,false);assert.equal(policy.permanentLabel,false);
});

test('solution exposure makes the exact original task invalid as clean independent evidence',()=>{
  const disposition=lateWorkDisposition({deadline:{late:true,expired:false},solutionReleased:true,dependencyAdvanced:false,workStake:'OPTIONAL'});
  assert.equal(disposition.acceptOriginal,false);assert.equal(disposition.replacementRequired,true);assert.equal(disposition.markPenalty,null);
});

test('extension feasibility respects solution exposure and dependency boundaries',()=>{
  const solution=extensionFeasibility({requestedDeadlineAt:'2026-10-04T12:00:00.000Z',currentDueAt:DUE,solutionReleaseAt:'2026-10-03T12:00:00.000Z'});
  assert.equal(solution.outcome,'ALTERNATIVE_REQUIRED');assert.equal(solution.reason,'SOLUTION_RELEASE');
  const dependency=extensionFeasibility({requestedDeadlineAt:'2026-10-04T12:00:00.000Z',currentDueAt:DUE,dependencyDueAts:['2026-10-03T18:00:00.000Z']});
  assert.equal(dependency.outcome,'ALTERNATIVE_REQUIRED');assert.equal(dependency.reason,'DEPENDENCY');
});

test('course pause protects work rather than creating an overdue wall',()=>{
  const result=extensionFeasibility({requestedDeadlineAt:'2026-10-04T12:00:00.000Z',currentDueAt:DUE,coursePaused:true});
  assert.equal(result.outcome,'APPROVED_WITH_ADJUSTMENT');assert.equal(result.effectiveAfterResume,true);
});

test('correction/retry rules preserve the original attempt',()=>{
  const practice=retryPolicy({purpose:'PRACTICE',workStake:'OPTIONAL',graded:false});
  const graded=retryPolicy({purpose:'APPLICATION',workStake:'GRADED',graded:true});
  assert.equal(practice.preserveOriginal,true);assert.equal(practice.correctionAllowed,true);
  assert.equal(graded.preserveOriginal,true);assert.equal(graded.maxOrdinaryRetries,0);assert.equal(graded.markRecovery,'POLICY_OWNED');
});

test('subject-sensitive evaluation semantics distinguish major response forms',()=>{
  assert.ok(subjectEvaluationProfile('QUANTITATIVE').dimensions.includes('units'));
  assert.ok(subjectEvaluationProfile('CODE').dimensions.includes('tests'));
  assert.ok(subjectEvaluationProfile('HUMANITIES').dimensions.includes('source_use'));
  assert.equal(subjectEvaluationProfile('LONG_FORM').rubricRequiredBeforeResponse,true);
});

test('Homework is generated only when learning evidence or declared need justifies it',()=>{
  assert.equal(homeworkNeedDecision({lessonFacts:[],knowledgeSignals:[],upcomingPrerequisites:[],retentionDue:[]}).assign,false);
  const justified=homeworkNeedDecision({lessonFacts:[{misconception:true}],knowledgeSignals:[],courseWorkloadAtRisk:true});
  assert.equal(justified.assign,true);assert.equal(justified.reasons.includes('LESSON_EVIDENCE'),true);assert.equal(justified.workloadReviewRequired,true);
});

test('reading completion is activity evidence, never automatic mastery',()=>{
  const reading=readingEvidence({completed:true});
  assert.equal(reading.activityCompleted,true);assert.equal(reading.mastery,null);assert.equal(reading.completionAloneIsEvidence,false);assert.equal(reading.officialMarkFromCompletion,false);
});

test('missed optional, preparation, remediation and graded Work keep distinct outcomes',()=>{
  assert.equal(missedOutcome('OPTIONAL').consequence,'LESS_PRACTICE_EVIDENCE');
  assert.equal(missedOutcome('PREPARATION').consequence,'NEXT_CLASS_ADJUSTMENT');
  assert.equal(missedOutcome('REMEDIATION').consequence,'WEAKNESS_UNRESOLVED');
  assert.equal(missedOutcome('GRADED').gradebookEffect,'POLICY_OWNED');
});

test('D16 refuses to author locked formal Assessment truth',()=>{
  assert.throws(()=>spec({assistanceMode:'FORMAL_ASSESSMENT'}),(error)=>error.code==='TEACHING_D16_FORMAL_ASSESSMENT_OWNER_REQUIRED');
});
