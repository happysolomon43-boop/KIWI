'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEvidenceEngine,
  createScheduler,
  createScoringEngine,
  createReckoningConfig,
  EVIDENCE_STATUSES,
  RISK_LEVELS,
} = require('../../services/reckoning');

test('Critical clean diagnostic becomes provisional and cannot recover without delayed confirmation', () => {
  const engine = createEvidenceEngine({
    clock: () => new Date('2026-09-23T08:00:00.000Z'),
  });

  const result = engine.record({
    id: 'e1',
    risk_level: 'CRITICAL',
    evidence_status: 'UNTESTED',
    required_confirmations: 1,
  }, {
    role: 'DIAGNOSTIC',
    isCorrect: true,
    questionOrdinal: 1,
  });

  assert.equal(result.patch.evidenceStatus, EVIDENCE_STATUSES.PROVISIONAL);
  assert.equal(result.patch.successfulDemonstrations, 1);
  assert.equal(result.patch.requiredConfirmations, 1);
  assert.equal(result.patch.nextEligibleQuestion, 4);
  assert.equal(result.patch.resolvedAt, undefined);
});

test('Critical diagnostic miss requires one delayed Challenge and failed Challenge is terminal unresolved', () => {
  const engine = createEvidenceEngine();

  const diagnostic = engine.record({
    id: 'e1',
    risk_level: 'CRITICAL',
    evidence_status: 'UNTESTED',
  }, {
    role: 'DIAGNOSTIC',
    isCorrect: false,
    questionOrdinal: 2,
  });

  assert.equal(diagnostic.patch.evidenceStatus, EVIDENCE_STATUSES.CHALLENGE_REQUIRED);
  assert.equal(diagnostic.patch.nextEligibleQuestion, 5);

  const challenge = engine.record({
    id: 'e1',
    risk_level: 'CRITICAL',
    evidence_status: 'CHALLENGE_REQUIRED',
    diagnostic_outcome: 'INCORRECT',
    attempt_count: 1,
    questions_seen: 1,
  }, {
    role: 'CHALLENGE',
    isCorrect: false,
    questionOrdinal: 5,
  });

  assert.equal(challenge.patch.evidenceStatus, EVIDENCE_STATUSES.UNRESOLVED);
  assert.equal(challenge.patch.challengeOutcome, 'INCORRECT');
  assert.ok(challenge.patch.resolvedAt);
});

test('High-risk clean Diagnostic recovers while Supporting/Control misses enter High challenge flow', () => {
  const engine = createEvidenceEngine();

  const high = engine.record({
    id: 'high',
    risk_level: 'HIGH',
    evidence_status: 'UNTESTED',
  }, {
    role: 'DIAGNOSTIC',
    isCorrect: true,
    questionOrdinal: 1,
  });
  assert.equal(high.patch.evidenceStatus, EVIDENCE_STATUSES.RECOVERED);

  const supporting = engine.record({
    id: 'support',
    risk_level: 'SUPPORTING',
    evidence_status: 'UNTESTED',
  }, {
    role: 'DIAGNOSTIC',
    isCorrect: false,
    questionOrdinal: 2,
  });
  assert.equal(supporting.patch.riskLevel, RISK_LEVELS.HIGH);
  assert.equal(supporting.patch.evidenceStatus, EVIDENCE_STATUSES.CHALLENGE_REQUIRED);

  const control = engine.record({
    id: 'control',
    risk_level: 'SUPPORTING',
    evidence_status: 'UNTESTED',
  }, {
    role: 'CONTROL',
    isCorrect: false,
    questionOrdinal: 3,
  });
  assert.equal(control.patch.discoveredByControl, true);
  assert.equal(control.patch.riskLevel, RISK_LEVELS.HIGH);
  assert.equal(control.patch.evidenceStatus, EVIDENCE_STATUSES.CHALLENGE_REQUIRED);
});

test('scheduler respects revisit spacing, prefers unrelated evidence, and enforces hard cap', () => {
  const scheduler = createScheduler();

  const evidence = [
    {
      id: 'critical',
      risk_score: 95,
      risk_level: 'CRITICAL',
      evidence_status: 'PROVISIONAL',
      next_eligible_question: 4,
    },
    {
      id: 'high',
      risk_score: 70,
      risk_level: 'HIGH',
      evidence_status: 'UNTESTED',
    },
    {
      id: 'control',
      risk_score: 20,
      risk_level: 'SUPPORTING',
      evidence_status: 'UNTESTED',
    },
  ];

  const questions = [
    { id: 'c-confirm', reckoning_evidence_id: 'critical', reckoning_role: 'CONFIRMATION', variant_index: 2, selected_option: null },
    { id: 'h-diag', reckoning_evidence_id: 'high', reckoning_role: 'DIAGNOSTIC', variant_index: 0, selected_option: null },
    { id: 'ctrl', reckoning_evidence_id: 'control', reckoning_role: 'CONTROL', variant_index: 0, selected_option: null },
  ];

  const afterOne = scheduler.chooseNext({
    evidence,
    questions,
    questionsUsed: 1,
    lastEvidenceId: 'critical',
  });
  assert.equal(afterOne.questionId, 'h-diag');
  assert.equal(afterOne.role, 'DIAGNOSTIC');
  assert.equal(afterOne.spacingRelaxed, false);

  const atFour = scheduler.chooseNext({
    evidence: [
      evidence[0],
      { ...evidence[1], evidence_status: 'RECOVERED' },
      { ...evidence[2], evidence_status: 'RECOVERED' },
    ],
    questions,
    questionsUsed: 3,
    lastEvidenceId: 'control',
  });
  assert.equal(atFour.questionId, 'c-confirm');
  assert.equal(atFour.role, 'CONFIRMATION');

  const hardCap = scheduler.chooseNext({
    evidence,
    questions,
    questionsUsed: 30,
  });
  assert.equal(hardCap.type, 'COMPLETE');
  assert.equal(hardCap.reason, 'HARD_CAP_REACHED');
});

test('evidence-based recovery cannot be hidden by a high raw percentage', () => {
  const scoring = createScoringEngine();

  const evidence = [
    {
      id: 'critical',
      risk_score: 90,
      risk_level: 'CRITICAL',
      evidence_status: 'UNRESOLVED',
      diagnostic_outcome: 'INCORRECT',
    },
    {
      id: 'high',
      risk_score: 60,
      risk_level: 'HIGH',
      evidence_status: 'RECOVERED',
      diagnostic_outcome: 'CORRECT',
    },
    {
      id: 'control',
      risk_score: 20,
      risk_level: 'SUPPORTING',
      evidence_status: 'RECOVERED',
    },
  ];
  const questions = Array.from({ length: 20 }, (_, index) => ({
    selected_option: 'A',
    is_correct: index < 17,
  }));

  const result = scoring.calculateRecovery({ evidence, questions, questionsUsed: 20 });

  assert.equal(result.rawAccuracy, 85);
  assert.equal(result.unresolvedCriticalCount, 1);
  assert.equal(result.allCriticalRecovered, false);
  assert.equal(result.survived, false);
});

test('clean and remediated recovery are weighted differently and can satisfy early completion thresholds', () => {
  const scoring = createScoringEngine();

  const evidence = [
    {
      id: 'critical',
      risk_score: 90,
      risk_level: 'CRITICAL',
      evidence_status: 'RECOVERED',
      diagnostic_outcome: 'CORRECT',
      confirmation_outcome: 'CORRECT',
    },
    {
      id: 'high',
      risk_score: 70,
      risk_level: 'HIGH',
      evidence_status: 'RECOVERED',
      diagnostic_outcome: 'INCORRECT',
      challenge_outcome: 'CORRECT',
    },
    {
      id: 'control',
      risk_score: 20,
      risk_level: 'SUPPORTING',
      evidence_status: 'RECOVERED',
      discovered_by_control: false,
    },
  ];
  const questions = [
    { selected_option: 'A', is_correct: true },
    { selected_option: 'B', is_correct: false },
    { selected_option: 'C', is_correct: true },
    { selected_option: 'D', is_correct: true },
    { selected_option: 'A', is_correct: true },
  ];

  const result = scoring.calculateRecovery({ evidence, questions, questionsUsed: 5 });

  assert.equal(result.rawAccuracy, 80);
  assert.equal(result.unresolvedCriticalCount, 0);
  assert.ok(result.recoveryScore >= 75);
  assert.equal(result.minimumEvidenceSatisfied, true);
  assert.equal(result.survived, true);
});

test('response time is not part of correctness or recovery threshold arithmetic', () => {
  const scoring = createScoringEngine({
    config: createReckoningConfig(),
  });

  const evidence = [{
    id: 'critical',
    risk_score: 90,
    risk_level: 'CRITICAL',
    evidence_status: 'RECOVERED',
    diagnostic_outcome: 'CORRECT',
  }];

  const fast = Array.from({ length: 5 }, () => ({
    selected_option: 'A',
    is_correct: true,
    response_time_ms: 5000,
  }));
  const slow = fast.map((question) => ({
    ...question,
    response_time_ms: 240000,
  }));

  assert.deepEqual(
    scoring.calculateRecovery({ evidence, questions: fast, questionsUsed: 5 }),
    scoring.calculateRecovery({ evidence, questions: slow, questionsUsed: 5 })
  );
});
