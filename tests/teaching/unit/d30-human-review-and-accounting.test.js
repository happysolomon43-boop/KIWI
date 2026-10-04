'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const d30 = require('../../../teaching/d30');

const root = path.join(__dirname, '..', '..', '..');

function anchorExists(anchor) {
  const relative = String(anchor || '').trim();
  if (!relative) return false;
  const candidates = relative.includes('/')
    ? [relative]
    : [path.join('teaching', 'd30', relative), relative];
  return candidates.some((candidate) => fs.existsSync(path.join(root, candidate)));
}

function reviewRecord(overrides = {}) {
  const family = d30.getFamilyDefinition(overrides.familyId || 'TPF-02');
  return {
    sessionId:'00000000-0000-4000-8000-000000000101',
    runId:'00000000-0000-4000-8000-000000000102',
    caseId:'D30-HUMAN-REVIEW-001',
    familyId:family.familyId,
    familyVersion:family.version,
    promptFamilyVersion:family.version,
    promptSha256:family.promptSha256,
    capabilityId:'teaching.course.curriculum_structure_analysis',
    criticality:'C4',
    routeKey:'provider::model',
    routeRole:'PRIMARY',
    modelId:'model',
    provider:'provider',
    attemptNo:1,
    outputArtifact:{
      conclusion:'bounded academic artifact',
      evidence_refs:['fixture:1'],
      review_required:false,
    },
    defects:[],
    ...overrides,
  };
}

test('all 46 canonical D30 tasks have concrete implementation anchors', () => {
  assert.equal(d30.assertD30TaskCensus(), true);
  assert.equal(d30.assertTaskAccountingComplete(), true);
  assert.equal(d30.D30_TASK_IDS.length, 46);
  assert.equal(Object.keys(d30.TASK_ACCOUNTING).length, 46);

  for (const taskId of d30.D30_TASK_IDS) {
    const entry = d30.TASK_ACCOUNTING[taskId];
    assert.ok(entry, taskId);
    assert.ok(entry.area, `${taskId} area`);
    assert.ok(entry.anchors.length > 0, `${taskId} anchors`);
    for (const anchor of entry.anchors) {
      assert.equal(anchorExists(anchor), true, `${taskId} missing anchor ${anchor}`);
    }
  }
});

test('C4 and explicitly consequential runs enter the independent human academic review queue', () => {
  const c4 = reviewRecord();
  const ordinary = reviewRecord({
    runId:'00000000-0000-4000-8000-000000000103',
    caseId:'D30-HUMAN-REVIEW-002',
    criticality:'C3',
  });

  const c4Queue = d30.buildHumanReviewQueue([c4, ordinary]);
  assert.equal(c4Queue.length, 1);
  assert.equal(c4Queue[0].caseId, c4.caseId);
  assert.equal(c4Queue[0].runId,c4.runId);
  assert.equal(c4Queue[0].attemptNo,c4.attemptNo);
  assert.equal(c4Queue[0].artifact.conclusion, 'bounded academic artifact');
  assert.match(c4Queue[0].rubric.independence, /automated semantic reviewer cannot satisfy/i);

  const consequentialQueue = d30.buildHumanReviewQueue([ordinary], {
    consequentialCaseIds:[ordinary.caseId],
  });
  assert.equal(consequentialQueue.length, 1);
  assert.equal(consequentialQueue[0].caseId, ordinary.caseId);
});

test('human review queue fails closed when a required run has no bounded review artifact', () => {
  const record = reviewRecord({ outputArtifact:null });
  assert.throws(
    () => d30.buildHumanReviewQueue([record]),
    /no bounded review artifact/i
  );
});

test('automated or non-independent review cannot satisfy the C4 gate', () => {
  const record = reviewRecord();
  const [queueItem] = d30.buildHumanReviewQueue([record]);
  const common = {
    sessionId:record.sessionId,
    runId:record.runId,
    attemptNo:record.attemptNo,
    caseId:record.caseId,
    familyId:record.familyId,
    capabilityId:record.capabilityId,
    routeKey:record.routeKey,
    reviewerRef:'reviewer-1',
    decision:'PASS',
    rubric:{ academicCorrectness:'PASS' },
  };

  const automated = d30.validateHumanReviewSubmission({
    ...common,
    reviewerKind:'AUTOMATED',
    independent:true,
  }, queueItem);
  assert.equal(automated.valid, false);
  assert.ok(automated.errors.includes('HUMAN_ACADEMIC_REVIEWER_REQUIRED'));

  const dependent = d30.validateHumanReviewSubmission({
    ...common,
    reviewerKind:'HUMAN_ACADEMIC',
    independent:false,
  }, queueItem);
  assert.equal(dependent.valid, false);
  assert.ok(dependent.errors.includes('INDEPENDENT_REVIEW_REQUIRED'));

  const accepted = d30.validateHumanReviewSubmission({
    ...common,
    reviewerKind:'HUMAN_ACADEMIC',
    independent:true,
  }, queueItem);
  assert.equal(accepted.valid, true);
});

test('human review submissions are bound to the exact run, attempt, case, capability and route under review', () => {
  const record = reviewRecord();
  const [queueItem] = d30.buildHumanReviewQueue([record]);
  const common={
    sessionId:record.sessionId,
    runId:record.runId,
    attemptNo:record.attemptNo,
    caseId:record.caseId,
    familyId:record.familyId,
    capabilityId:record.capabilityId,
    routeKey:record.routeKey,
    reviewerRef:'reviewer-2',
    reviewerKind:'HUMAN_ACADEMIC',
    independent:true,
    decision:'PASS',
    rubric:{ academicCorrectness:'PASS' },
  };
  const wrongCapability = d30.validateHumanReviewSubmission({...common,capabilityId:'teaching.some.other.capability'}, queueItem);
  assert.equal(wrongCapability.valid, false);
  assert.ok(wrongCapability.errors.includes('CAPABILITY_ID_MISMATCH'));
  const wrongRun=d30.validateHumanReviewSubmission({...common,runId:'00000000-0000-4000-8000-000000000999'},queueItem);
  assert.equal(wrongRun.valid,false);
  assert.ok(wrongRun.errors.includes('RUNID_MISMATCH'));
  const wrongAttempt=d30.validateHumanReviewSubmission({...common,attemptNo:2},queueItem);
  assert.equal(wrongAttempt.valid,false);
  assert.ok(wrongAttempt.errors.includes('ATTEMPT_NO_MISMATCH'));
});

test('review artifacts reject private reasoning fields before queueing or persistence', () => {
  assert.throws(
    () => d30.createHumanReviewArtifact({
      caseSpec:{ id:'case', familyId:'TPF-02', capabilityId:'cap', criticality:'C4' },
      parsedOutput:{ chain_of_thought:'private reasoning' },
      routeKey:'provider::model',
      modelId:'model',
      provider:'provider',
    }),
    /private-reasoning field|hidden chain-of-thought/i
  );

  assert.throws(
    () => d30.normalizeHumanReviewSubmission({
      sessionId:'00000000-0000-4000-8000-000000000101',
      runId:'00000000-0000-4000-8000-000000000102',
      attemptNo:1,
      caseId:'D30-HUMAN-REVIEW-001',
      familyId:'TPF-02',
      capabilityId:'teaching.course.curriculum_structure_analysis',
      routeKey:'provider::model',
      reviewerRef:'reviewer-3',
      reviewerKind:'HUMAN_ACADEMIC',
      independent:true,
      decision:'PASS',
      rubric:{ private_scratchpad:'do not persist' },
    }),
    /private-reasoning field|hidden chain-of-thought/i
  );
});
