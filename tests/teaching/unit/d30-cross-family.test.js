'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const d30 = require('../../../teaching/d30');

test('all 72 cross-family cases execute against registered contracts without provider calls', async () => {
  const execute = d30.createCrossFamilyWorkflowExecutor();
  assert.equal(d30.CROSS_FAMILY_CORPUS.length, 72);
  const workflowIds = new Set();
  for (const caseSpec of d30.CROSS_FAMILY_CORPUS) {
    const result = await execute(caseSpec);
    workflowIds.add(result.workflowId);
    assert.equal(result.authorityPreserved, true, caseSpec.id);
    assert.equal(result.provenancePreserved, true, caseSpec.id);
    assert.equal(result.handoffCompatible, true, caseSpec.id);
    assert.equal(result.terminalOwner, caseSpec.workflow.terminalOwner, caseSpec.id);
    assert.ok(result.checks.familyNodes.length > 0, caseSpec.id);
  }
  assert.deepEqual([...workflowIds].sort(), [
    'ASSESSMENT_CONSTRUCTION_CHAIN',
    'INTEGRITY_HANDOFF',
    'MARKING_REVIEW_CHAIN',
    'TEACHER_STYLE_CHAIN',
    'TEACHING_EVIDENCE_CHAIN',
  ]);
});

test('assessment construction terminates at deterministic T0 package locking', async () => {
  const execute = d30.createCrossFamilyWorkflowExecutor();
  const caseSpec = d30.CROSS_FAMILY_CORPUS.find((item) => item.workflow.id === 'ASSESSMENT_CONSTRUCTION_CHAIN');
  const result = await execute(caseSpec);
  assert.equal(result.checks.deterministicBoundary.capabilityId, 'teaching.assessment.assessment_package_locking');
  assert.equal(result.checks.deterministicBoundary.authorityCeiling, 'T0');
  assert.equal(result.checks.deterministicBoundary.promptFamily, null);
});

test('marking review preserves deterministic aggregation, blind-first moderation and Gradebook ownership', async () => {
  const execute = d30.createCrossFamilyWorkflowExecutor();
  const caseSpec = d30.CROSS_FAMILY_CORPUS.find((item) => item.workflow.id === 'MARKING_REVIEW_CHAIN');
  const result = await execute(caseSpec);
  assert.equal(result.checks.markingReview.deterministicAggregation, true);
  assert.equal(result.checks.markingReview.blindPassA, true);
  assert.equal(result.checks.markingReview.comparisonPassB, true);
  assert.equal(result.checks.deterministicBoundary.capabilityId, 'teaching.progression.gradebook_calculation');
  assert.equal(result.checks.deterministicBoundary.authorityCeiling, 'T0');
});

test('integrity handoff never fabricates guilt and stays isolated during an active formal assessment', async () => {
  const execute = d30.createCrossFamilyWorkflowExecutor();
  const caseSpec = d30.CROSS_FAMILY_CORPUS.find((item) => item.workflow.id === 'INTEGRITY_HANDOFF');
  const result = await execute(caseSpec);
  assert.equal(result.checks.integrityHandoff.misconductVerdictOwned, false);
  assert.equal(result.checks.integrityHandoff.guiltProbabilityOwned, false);
  assert.equal(result.checks.integrityHandoff.midAttemptVerificationAllowed, false);
});

test('TPF-18 teacher style envelope remains exactly compatible with TPF-08', async () => {
  const execute = d30.createCrossFamilyWorkflowExecutor();
  const caseSpec = d30.CROSS_FAMILY_CORPUS.find((item) => item.workflow.id === 'TEACHER_STYLE_CHAIN');
  const result = await execute(caseSpec);
  assert.equal(result.checks.teacherStyleEnvelope.version, 'tpf08.teacher-style-envelope.v1');
  assert.deepEqual(result.checks.teacherStyleEnvelope.fields, [
    'teacher_identity_ref','warmth','directness','formality','expressiveness','humor_frequency',
    'encouragement_intensity','challenge_style','accountability_style','conversationality','familiarity_level',
  ]);
});

test('cross-family executor fails closed when workflow identity or terminal owner is altered', async () => {
  const execute = d30.createCrossFamilyWorkflowExecutor();
  const source = d30.CROSS_FAMILY_CORPUS[0];
  await assert.rejects(
    () => execute({...source,workflow:{...source.workflow,terminalOwner:'wrong-owner'}}),
    /terminal owner drift/i
  );
  await assert.rejects(
    () => execute({...source,workflow:{...source.workflow,id:'invented-workflow'}}),
    /Unknown cross-family workflow/i
  );
});