'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createReckoningEngine } = require('../../services/reckoning');

function patchSnake(target, patch) {
  const map = {
    enginePhase: 'engine_phase',
    currentQuestionId: 'current_question_id',
    rawAccuracy: 'raw_accuracy',
    recoveryScore: 'recovery_score',
    unresolvedCriticalCount: 'unresolved_critical_count',
    stateVersion: 'state_version',
    learningEffectAppliedAt: 'learning_effect_applied_at',
  };
  for (const [key, value] of Object.entries(patch || {})) {
    target[map[key] || key] = value;
  }
  return target;
}

function makeFinalizationStore() {
  const session = {
    id: 'reckoning-d',
    user_id: 'user-d',
    subject_id: 'subject-d',
    exam_session_id: 'exam-d',
    engine_version: 2,
    engine_mode: 'PILOT',
    engine_phase: 'FINALIZING',
    questions_used: 5,
    hard_question_cap: 30,
    state_version: 9,
  };

  const evidence = [
    {
      id: 'e-critical',
      reckoning_id: session.id,
      user_id: session.user_id,
      subject_id: session.subject_id,
      source_card_id: 'card-critical',
      risk_score: 90,
      risk_level: 'CRITICAL',
      evidence_status: 'RECOVERED',
      diagnostic_outcome: 'CORRECT',
      confirmation_outcome: 'CORRECT',
      questions_seen: 2,
      learning_effect_applied_at: null,
    },
    {
      id: 'e-remediated',
      reckoning_id: session.id,
      user_id: session.user_id,
      subject_id: session.subject_id,
      source_card_id: 'card-remediated',
      risk_score: 70,
      risk_level: 'HIGH',
      evidence_status: 'RECOVERED',
      diagnostic_outcome: 'INCORRECT',
      challenge_outcome: 'CORRECT',
      questions_seen: 2,
      learning_effect_applied_at: null,
    },
    {
      id: 'e-control',
      reckoning_id: session.id,
      user_id: session.user_id,
      subject_id: session.subject_id,
      source_card_id: 'card-control',
      risk_score: 20,
      risk_level: 'SUPPORTING',
      evidence_status: 'RECOVERED',
      questions_seen: 1,
      learning_effect_applied_at: null,
    },
  ];

  const questions = [
    { id: 'q1', exam_session_id: 'exam-d', selected_option: 'A', is_correct: true },
    { id: 'q2', exam_session_id: 'exam-d', selected_option: 'B', is_correct: false },
    { id: 'q3', exam_session_id: 'exam-d', selected_option: 'C', is_correct: true },
    { id: 'q4', exam_session_id: 'exam-d', selected_option: 'D', is_correct: true },
    { id: 'q5', exam_session_id: 'exam-d', selected_option: 'A', is_correct: true },
  ];

  const cards = new Map([
    ['card-critical', { id: 'card-critical', stage: 4, next_review_at: null }],
    ['card-remediated', {
      id: 'card-remediated',
      stage: 5,
      next_review_at: new Date('2026-10-20T00:00:00.000Z'),
    }],
    ['card-control', { id: 'card-control', stage: 3, next_review_at: null }],
  ]);
  const states = new Map([
    ['card-critical', { state: 'STABLE', stage: 4, verified: false }],
    ['card-remediated', { state: 'VERIFIED', stage: 5, verified: true }],
    ['card-control', { state: 'GROWING', stage: 3, verified: false }],
  ]);

  const metrics = {
    cardWrites: 0,
    stateWrites: 0,
    examCompletions: 0,
    outcomeLocks: 0,
  };
  let transactionQueue = Promise.resolve();
  let outcomeQueue = Promise.resolve();

  const api = {
    session,
    evidence,
    questions,
    cards,
    states,
    metrics,
    async withTransaction(work) {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        return await work(api);
      } finally {
        release();
      }
    },
    async withOutcomeLock(_reckoningId, work) {
      metrics.outcomeLocks += 1;
      const previous = outcomeQueue;
      let release;
      outcomeQueue = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        return await work();
      } finally {
        release();
      }
    },
    async getSessionByExam(examSessionId, userId) {
      if (
        userId === session.user_id &&
        (
          examSessionId === session.exam_session_id ||
          examSessionId === session.last_failure_exam_id
        )
      ) {
        return session;
      }
      return null;
    },
    async getSession(reckoningId, userId) {
      return reckoningId === session.id && userId === session.user_id
        ? session
        : null;
    },
    async getEvidence(reckoningId) {
      return evidence.filter((row) => row.reckoning_id === reckoningId);
    },
    async getExecutionQuestions(examSessionId) {
      return questions.filter((row) => row.exam_session_id === examSessionId);
    },
    async getCardForLearningEffect(_userId, cardId) {
      return cards.get(cardId) || null;
    },
    async getCardStateForLearningEffect(_userId, cardId) {
      return states.get(cardId) || null;
    },
    async saveCardLearningEffect(_userId, cardId, patch) {
      metrics.cardWrites += 1;
      const card = cards.get(cardId);
      if (patch.stage !== undefined) card.stage = patch.stage;
      if (patch.intervalDays !== undefined) card.interval_days = patch.intervalDays;
      if (patch.repetitionCount !== undefined) card.repetition_count = patch.repetitionCount;
      if (patch.nextReviewAt !== undefined) card.next_review_at = patch.nextReviewAt;
      return card;
    },
    async saveCardStateLearningEffect({ card, patch }) {
      metrics.stateWrites += 1;
      const state = states.get(card.id) || {};
      if (patch.stage !== undefined) state.stage = patch.stage;
      if (patch.state !== undefined) state.state = patch.state;
      if (patch.verified !== undefined) state.verified = patch.verified;
      if (patch.verifiedAt !== undefined) state.verified_at = patch.verifiedAt;
      states.set(card.id, state);
      return state;
    },
    async saveEvidence(evidenceId, patch) {
      const row = evidence.find((item) => item.id === evidenceId);
      patchSnake(row, patch);
      return row;
    },
    async completeExecutionExam(_userId, _examSessionId, payload) {
      metrics.examCompletions += 1;
      api.completedExam = { ...payload };
      return { id: 'exam-d', status: 'completed', ...payload };
    },
    async saveSession(reckoningId, patch) {
      assert.equal(reckoningId, session.id);
      patchSnake(session, patch);
      return session;
    },
  };

  return api;
}

test('Delivery D finalization is crash-retry safe and never reapplies card consequences', async () => {
  const store = makeFinalizationStore();
  let outcomeCalls = 0;
  const outcomeEvidenceStates = [];

  const engine = createReckoningEngine({
    store,
    outcomeHandler: async ({ evidenceState }) => {
      outcomeCalls += 1;
      outcomeEvidenceStates.push(evidenceState);
      if (outcomeCalls === 1) {
        throw new Error('simulated process boundary failure');
      }
      return { ok: true };
    },
  });

  await assert.rejects(
    () => engine.finalize({
      examSessionId: 'exam-d',
      userId: 'user-d',
    }),
    /simulated process boundary failure/
  );

  assert.equal(store.session.engine_phase, 'FINALIZING');
  assert.equal(store.metrics.cardWrites, 1);
  assert.equal(store.metrics.stateWrites, 1);
  assert.equal(store.states.get('card-remediated').verified, false);
  assert.ok(store.evidence.every((row) => row.learning_effect_applied_at));

  const writesAfterCrash = {
    cardWrites: store.metrics.cardWrites,
    stateWrites: store.metrics.stateWrites,
  };

  const recovered = await engine.finalize({
    examSessionId: 'exam-d',
    userId: 'user-d',
  });

  assert.equal(recovered.final, true);
  assert.equal(recovered.recovery.survived, true);
  assert.equal(store.session.engine_phase, 'COMPLETE');
  assert.equal(outcomeCalls, 2);
  assert.deepEqual(
    outcomeEvidenceStates.map((state) => ({
      recovered: state.recovered,
      unresolved: state.unresolved,
    })),
    [
      { recovered: 3, unresolved: 0 },
      { recovered: 3, unresolved: 0 },
    ]
  );
  assert.deepEqual(
    {
      cardWrites: store.metrics.cardWrites,
      stateWrites: store.metrics.stateWrites,
    },
    writesAfterCrash
  );

  const again = await engine.finalize({
    examSessionId: 'exam-d',
    userId: 'user-d',
  });

  assert.equal(again.alreadyFinalized, true);
  assert.equal(outcomeCalls, 2);
  assert.deepEqual(
    {
      cardWrites: store.metrics.cardWrites,
      stateWrites: store.metrics.stateWrites,
    },
    writesAfterCrash
  );
});

test('Delivery D closes the adaptive exam from persisted answered questions', async () => {
  const store = makeFinalizationStore();
  const engine = createReckoningEngine({
    store,
    outcomeHandler: async () => ({ ok: true }),
  });

  const result = await engine.finalize({
    examSessionId: 'exam-d',
    userId: 'user-d',
  });

  assert.equal(result.final, true);
  assert.equal(store.metrics.examCompletions, 1);
  assert.deepEqual(store.completedExam, {
    rawAccuracy: 80,
    answeredCount: 5,
    correctCount: 4,
  });
});

test('concurrent Delivery D finalizers execute external outcome effects exactly once', async () => {
  const store = makeFinalizationStore();
  let outcomeCalls = 0;

  const engine = createReckoningEngine({
    store,
    outcomeHandler: async () => {
      outcomeCalls += 1;
      await Promise.resolve();
      return { sequence: outcomeCalls };
    },
  });

  const [first, second] = await Promise.all([
    engine.finalize({
      examSessionId: 'exam-d',
      userId: 'user-d',
    }),
    engine.finalize({
      examSessionId: 'exam-d',
      userId: 'user-d',
    }),
  ]);

  assert.equal(outcomeCalls, 1);
  assert.equal(store.session.engine_phase, 'COMPLETE');
  assert.equal(store.metrics.cardWrites, 1);
  assert.equal(store.metrics.stateWrites, 1);
  assert.ok(store.metrics.outcomeLocks >= 2);
  assert.equal(
    [first, second].filter((result) => result.alreadyFinalized === true).length,
    1
  );
  assert.ok(first.final);
  assert.ok(second.final);
});