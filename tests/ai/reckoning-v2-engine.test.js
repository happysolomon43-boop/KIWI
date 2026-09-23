'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createReckoningEngine,
  adaptiveSessionAllowed,
} = require('../../services/reckoning');

function snakePatch(target, patch) {
  const map = {
    engineVersion: 'engine_version',
    engineMode: 'engine_mode',
    enginePhase: 'engine_phase',
    questionsUsed: 'questions_used',
    softQuestionBudget: 'soft_question_budget',
    hardQuestionCap: 'hard_question_cap',
    recoveryScore: 'recovery_score',
    rawAccuracy: 'raw_accuracy',
    unresolvedCriticalCount: 'unresolved_critical_count',
    currentBlock: 'current_block',
    currentQuestionId: 'current_question_id',
    stateVersion: 'state_version',
    preparedAt: 'prepared_at',
    reviewStartedAt: 'review_started_at',
    safetyExpiresAt: 'safety_expires_at',
    plannerVersion: 'planner_version',
    configVersion: 'config_version',
    riskLevel: 'risk_level',
    evidenceStatus: 'evidence_status',
    diagnosticOutcome: 'diagnostic_outcome',
    challengeOutcome: 'challenge_outcome',
    confirmationOutcome: 'confirmation_outcome',
    attemptCount: 'attempt_count',
    successfulDemonstrations: 'successful_demonstrations',
    requiredConfirmations: 'required_confirmations',
    questionsSeen: 'questions_seen',
    lastQuestionRole: 'last_question_role',
    discoveredByControl: 'discovered_by_control',
    resolvedAt: 'resolved_at',
    nextEligibleQuestion: 'next_eligible_question',
  };
  for (const [key, value] of Object.entries(patch)) {
    target[map[key] || key] = value;
  }
  return target;
}

function makeStore() {
  const session = {
    id: 'reckoning-1',
    user_id: 'user-1',
    exam_session_id: 'exam-1',
    engine_version: 2,
    engine_mode: 'PILOT',
    engine_phase: 'ACTIVE',
    questions_used: 0,
    soft_question_budget: 10,
    hard_question_cap: 30,
    current_block: 1,
    current_question_id: 'q1',
    state_version: 0,
  };

  const evidence = [
    {
      id: 'e1',
      reckoning_id: 'reckoning-1',
      source_card_id: 'card-1',
      concept_key: 'card:card-1',
      risk_score: 90,
      risk_level: 'CRITICAL',
      evidence_status: 'UNTESTED',
      required_confirmations: 1,
      attempt_count: 0,
      successful_demonstrations: 0,
      questions_seen: 0,
    },
    {
      id: 'e2',
      reckoning_id: 'reckoning-1',
      source_card_id: 'card-2',
      concept_key: 'card:card-2',
      risk_score: 70,
      risk_level: 'HIGH',
      evidence_status: 'UNTESTED',
      required_confirmations: 0,
      attempt_count: 0,
      successful_demonstrations: 0,
      questions_seen: 0,
    },
    {
      id: 'e3',
      reckoning_id: 'reckoning-1',
      source_card_id: 'card-3',
      concept_key: 'card:card-3',
      risk_score: 20,
      risk_level: 'SUPPORTING',
      evidence_status: 'UNTESTED',
      required_confirmations: 0,
      attempt_count: 0,
      successful_demonstrations: 0,
      questions_seen: 0,
      discovered_by_control: false,
    },
  ];

  const questions = [
    {
      id: 'q1',
      user_id: 'user-1',
      exam_session_id: 'exam-1',
      question_number: 1,
      reckoning_evidence_id: 'e1',
      reckoning_role: 'DIAGNOSTIC',
      variant_index: 0,
      stem: 'Critical diagnostic?',
      option_a: 'Correct',
      option_b: 'Wrong B',
      option_c: 'Wrong C',
      option_d: 'Wrong D',
      correct_answer: 'A',
      explanation: 'Critical explanation.',
      is_unlocked: true,
      unlocked_at: new Date('2026-09-23T08:00:00.000Z'),
      selected_option: null,
      is_correct: null,
    },
    {
      id: 'q1-confirm',
      user_id: 'user-1',
      exam_session_id: 'exam-1',
      question_number: 2,
      reckoning_evidence_id: 'e1',
      reckoning_role: 'CONFIRMATION',
      variant_index: 2,
      stem: 'Critical confirmation?',
      option_a: 'Correct',
      option_b: 'Wrong B',
      option_c: 'Wrong C',
      option_d: 'Wrong D',
      correct_answer: 'A',
      explanation: 'Confirmation explanation.',
      is_unlocked: false,
      selected_option: null,
      is_correct: null,
    },
    {
      id: 'q2',
      user_id: 'user-1',
      exam_session_id: 'exam-1',
      question_number: 3,
      reckoning_evidence_id: 'e2',
      reckoning_role: 'DIAGNOSTIC',
      variant_index: 0,
      stem: 'High diagnostic?',
      option_a: 'Wrong A',
      option_b: 'Correct',
      option_c: 'Wrong C',
      option_d: 'Wrong D',
      correct_answer: 'B',
      explanation: 'High explanation.',
      is_unlocked: false,
      selected_option: null,
      is_correct: null,
    },
    {
      id: 'q2-challenge',
      user_id: 'user-1',
      exam_session_id: 'exam-1',
      question_number: 4,
      reckoning_evidence_id: 'e2',
      reckoning_role: 'CHALLENGE',
      variant_index: 1,
      stem: 'High challenge?',
      option_a: 'Wrong A',
      option_b: 'Correct',
      option_c: 'Wrong C',
      option_d: 'Wrong D',
      correct_answer: 'B',
      explanation: 'High challenge explanation.',
      is_unlocked: false,
      selected_option: null,
      is_correct: null,
    },
    {
      id: 'q3',
      user_id: 'user-1',
      exam_session_id: 'exam-1',
      question_number: 5,
      reckoning_evidence_id: 'e3',
      reckoning_role: 'CONTROL',
      variant_index: 0,
      stem: 'Healthy control?',
      option_a: 'Wrong A',
      option_b: 'Wrong B',
      option_c: 'Correct',
      option_d: 'Wrong D',
      correct_answer: 'C',
      explanation: 'Control explanation.',
      is_unlocked: false,
      selected_option: null,
      is_correct: null,
    },
    {
      id: 'q3-challenge',
      user_id: 'user-1',
      exam_session_id: 'exam-1',
      question_number: 6,
      reckoning_evidence_id: 'e3',
      reckoning_role: 'CHALLENGE',
      variant_index: 1,
      stem: 'Control challenge?',
      option_a: 'Wrong A',
      option_b: 'Wrong B',
      option_c: 'Correct',
      option_d: 'Wrong D',
      correct_answer: 'C',
      explanation: 'Control challenge explanation.',
      is_unlocked: false,
      selected_option: null,
      is_correct: null,
    },
  ];

  const api = {
    session,
    evidence,
    questions,
    async withTransaction(work) {
      return work(api);
    },
    async getSessionByExam(examSessionId, userId) {
      if (examSessionId !== session.exam_session_id || userId !== session.user_id) return null;
      return session;
    },
    async getEvidence(reckoningId) {
      return evidence.filter((row) => row.reckoning_id === reckoningId);
    },
    async getEvidenceById(evidenceId, reckoningId) {
      return evidence.find((row) => row.id === evidenceId && row.reckoning_id === reckoningId) || null;
    },
    async getExecutionQuestions(examSessionId) {
      return questions.filter((row) => row.exam_session_id === examSessionId);
    },
    async getQuestionForExecution(userId, examSessionId, questionId) {
      return questions.find(
        (row) =>
          row.id === questionId &&
          row.user_id === userId &&
          row.exam_session_id === examSessionId
      ) || null;
    },
    async saveEvidence(evidenceId, patch) {
      const row = evidence.find((item) => item.id === evidenceId);
      snakePatch(row, patch);
      return row;
    },
    async saveQuestionAnswer(userId, examSessionId, questionId, patch) {
      const row = questions.find((item) => item.id === questionId);
      row.selected_option = patch.selectedOption;
      row.is_correct = patch.isCorrect;
      row.response_time_ms = patch.responseTimeMs;
      row.evidence_effect = patch.evidenceEffect;
      return row;
    },
    async unlockQuestion(userId, examSessionId, questionId) {
      const row = questions.find((item) => item.id === questionId);
      if (!row || row.selected_option != null) return null;
      row.is_unlocked = true;
      row.unlocked_at ||= new Date();
      return row;
    },
    async saveSession(reckoningId, patch) {
      assert.equal(reckoningId, session.id);
      snakePatch(session, patch);
      return session;
    },
  };

  return api;
}

test('adaptive execution rejects every legacy/shadow session by construction', () => {
  assert.equal(adaptiveSessionAllowed({ engine_version: 1, engine_mode: 'LEGACY' }), false);
  assert.equal(adaptiveSessionAllowed({ engine_version: 2, engine_mode: 'SHADOW' }), false);
  assert.equal(adaptiveSessionAllowed({ engine_version: 2, engine_mode: 'PILOT' }), true);
  assert.equal(adaptiveSessionAllowed({ engine_version: 2, engine_mode: 'LIVE' }), true);
});

test('answer submission is one-way, idempotent, spaced and fully resumable from persisted state', async () => {
  const store = makeStore();
  const engine = createReckoningEngine({ store });

  const first = await engine.recordAnswer({
    examSessionId: 'exam-1',
    userId: 'user-1',
    questionId: 'q1',
    selectedOption: 'A',
    responseTimeMs: 240000,
  });

  assert.equal(first.duplicate, false);
  assert.equal(first.feedback.recorded, true);
  assert.equal(first.feedback.isCorrect, undefined);
  assert.equal(first.feedback.correctAnswer, undefined);
  assert.equal(first.questionsUsed, 1);
  assert.equal(first.currentQuestion.id, 'q2');
  assert.equal(first.evidence.find((item) => item.id === 'e1').status, 'PROVISIONAL');
  assert.equal(first.evidence.find((item) => item.id === 'e1').nextEligibleQuestion, 4);

  const duplicate = await engine.recordAnswer({
    examSessionId: 'exam-1',
    userId: 'user-1',
    questionId: 'q1',
    selectedOption: 'B',
    responseTimeMs: 1,
  });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.questionsUsed, 1);
  assert.equal(store.questions.find((question) => question.id === 'q1').selected_option, 'A');
  assert.equal(store.evidence.find((item) => item.id === 'e1').attempt_count, 1);

  const resumed = await engine.getState({
    examSessionId: 'exam-1',
    userId: 'user-1',
  });
  assert.equal(resumed.currentQuestion.id, 'q2');
  assert.equal(resumed.currentQuestion.correctAnswer, undefined);
  assert.equal(resumed.currentQuestion.explanation, undefined);
  assert.equal(resumed.history.length, 1);
  assert.equal(resumed.history[0].correctAnswer, undefined);
  assert.equal(resumed.history[0].explanation, undefined);

  await engine.recordAnswer({
    examSessionId: 'exam-1',
    userId: 'user-1',
    questionId: 'q2',
    selectedOption: 'A',
  });
  assert.equal(store.session.current_question_id, 'q3');

  await engine.recordAnswer({
    examSessionId: 'exam-1',
    userId: 'user-1',
    questionId: 'q3',
    selectedOption: 'C',
  });
  assert.equal(store.session.current_question_id, 'q1-confirm');

  await engine.recordAnswer({
    examSessionId: 'exam-1',
    userId: 'user-1',
    questionId: 'q1-confirm',
    selectedOption: 'A',
  });
  assert.equal(store.session.current_question_id, 'q2-challenge');

  const final = await engine.recordAnswer({
    examSessionId: 'exam-1',
    userId: 'user-1',
    questionId: 'q2-challenge',
    selectedOption: 'B',
  });

  assert.equal(final.final, true);
  assert.equal(final.enginePhase, 'FINALIZING');
  assert.equal(final.stopReason, 'RECOVERY_SUFFICIENT');
  assert.equal(final.recovery.survived, true);
  assert.equal(final.recovery.rawAccuracy, 80);
  assert.equal(final.recovery.unresolvedCriticalCount, 0);
  assert.equal(final.questionsUsed, 5);
});

test('locked or non-current adaptive questions cannot be answered', async () => {
  const store = makeStore();
  const engine = createReckoningEngine({ store });

  await assert.rejects(
    () => engine.recordAnswer({
      examSessionId: 'exam-1',
      userId: 'user-1',
      questionId: 'q2',
      selectedOption: 'B',
    }),
    (error) =>
      error &&
      error.code === 'ERR_RECKONING_QUESTION_LOCKED' &&
      error.status === 409
  );
});

test('getState exposes only answered history plus the one persisted current question', async () => {
  const store = makeStore();
  const engine = createReckoningEngine({ store });

  const state = await engine.getState({
    examSessionId: 'exam-1',
    userId: 'user-1',
  });

  assert.equal(state.currentQuestion.id, 'q1');
  assert.equal(state.history.length, 0);
  assert.equal(state.currentQuestion.correctAnswer, undefined);
  assert.equal(state.currentQuestion.explanation, undefined);
  assert.equal(JSON.stringify(state).includes('q1-confirm'), false);
  assert.equal(JSON.stringify(state).includes('q2-challenge'), false);
});