'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const d30 = require('../../../teaching/d30');

function c4Record(overrides = {}) {
  return {
    runId:'00000000-0000-4000-8000-000000000101',
    sessionId:'00000000-0000-4000-8000-000000000001',
    caseId:'D30-TPF-14-001',
    familyId:'TPF-14',
    capabilityId:'teaching.assessment.assessment_item_independent_validation',
    routeKey:'groq::candidate',
    routeRole:'PRIMARY',
    promptFamilyVersion:'1.4',
    promptSha256:d30.getFamilyDefinition('TPF-14').promptSha256,
    criticality:'C4',
    attemptNo:1,
    modelId:'candidate',
    provider:'groq',
    outputArtifact:{caseId:'D30-TPF-14-001',familyId:'TPF-14',output:{status:'REVIEW_NEEDED',finding:'bounded'}},
    defects:[],
    ...overrides,
  };
}

test('every one of the 46 D30 tasks has an explicit implementation anchor and no extra task is smuggled in', () => {
  assert.equal(d30.assertTaskAccountingComplete(), true);
  assert.deepEqual(Object.keys(d30.TASK_ACCOUNTING).sort(), [...d30.D30_TASK_IDS].sort());
  for (const [taskId, entry] of Object.entries(d30.TASK_ACCOUNTING)) {
    assert.ok(entry.area, taskId);
    assert.ok(entry.anchors.length > 0, taskId);
  }
});

test('C4 and consequential evidence is selected for independent human academic review', () => {
  const queue = d30.buildHumanReviewQueue([c4Record()]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].criticality, 'C4');
  assert.equal(queue[0].routeKey, 'groq::candidate');
  assert.equal(queue[0].runId, '00000000-0000-4000-8000-000000000101');
  assert.equal(queue[0].attemptNo, 1);
  assert.equal(queue[0].artifact.output.status, 'REVIEW_NEEDED');
  assert.match(queue[0].rubric.independence, /automated semantic reviewer cannot satisfy/i);
  assert.equal(d30.requiresHumanAcademicReview({criticality:'C3',consequential:true}), true);
  assert.equal(d30.requiresHumanAcademicReview({criticality:'C3',consequential:false}), false);
});

test('human review submissions are exact-run bound, independent, and cannot contain hidden reasoning', () => {
  const item = d30.buildHumanReviewQueue([c4Record()])[0];
  const valid = {
    sessionId:item.sessionId,
    runId:item.runId,
    attemptNo:item.attemptNo,
    caseId:item.caseId,
    familyId:item.familyId,
    capabilityId:item.capabilityId,
    routeKey:item.routeKey,
    reviewerRef:'academic-reviewer-001',
    reviewerKind:'HUMAN_ACADEMIC',
    independent:true,
    decision:'PASS',
    rubric:{academicCorrectness:'PASS',authorityDiscipline:'PASS',uncertaintyCalibration:'PASS',provenance:'PASS'},
  };
  assert.equal(d30.validateHumanReviewSubmission(valid,item).valid,true);
  const normalized=d30.normalizeHumanReviewSubmission(valid,item);
  assert.equal(normalized.decision,'PASS');
  assert.equal(normalized.runId,item.runId);
  assert.equal(normalized.attemptNo,item.attemptNo);
  assert.equal(d30.validateHumanReviewSubmission({...valid,runId:'00000000-0000-4000-8000-000000000999'},item).valid,false);
  assert.equal(d30.validateHumanReviewSubmission({...valid,attemptNo:2},item).valid,false);
  assert.equal(d30.validateHumanReviewSubmission({...valid,independent:false},item).valid,false);
  assert.equal(d30.validateHumanReviewSubmission({...valid,reviewerKind:'AUTOMATED_SEMANTIC_RUBRIC'},item).valid,false);
  assert.throws(()=>d30.validateHumanReviewSubmission({...valid,rubric:{chain_of_thought:'secret'}},item),/hidden|chain-of-thought/i);
});

test('automated semantic review is explicitly incapable of satisfying C4 human-review authority', () => {
  const payload = d30.validateReviewPayload({
    accepted:true,
    academicCorrectness:1,
    scopeDiscipline:1,
    uncertaintyCalibration:1,
    provenanceQuality:1,
    coverage:1,
    coherence:1,
    anchoringResistance:1,
    defects:[],
    criterionFindings:['bounded'],
  });
  assert.equal(payload.accepted,true);
  const human = d30.requireIndependentHumanReview({criticality:'C4',humanReviews:[{reviewerKind:'AUTOMATED_SEMANTIC_RUBRIC',independent:true,decision:'PASS'}]});
  assert.equal(human.required,true);
  assert.equal(human.satisfied,false);
});