'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPreparationService,
  fitPlanToBank,
} = require('../../services/reckoning/preparation');
const { createReckoningEngine } = require('../../services/reckoning');

function evidence(sourceCardId, riskLevel, riskScore) {
  return {
    sourceCardId,
    conceptKey: 'card:' + sourceCardId,
    sourceSnapshot: { front_content: sourceCardId, back_content: 'answer' },
    sourceHash: 'hash-' + sourceCardId,
    originalCardState: riskLevel === 'CRITICAL' ? 'STUCK' : 'STABLE',
    riskScore,
    riskLevel,
    riskReasons: [],
    isBubbleCritical: false,
    hasLearningDebt: false,
    requiredConfirmations: riskLevel === 'CRITICAL' ? 1 : 0,
  };
}

test('fitPlanToBank persists controls as real evidence and stays under its bank cap', () => {
  let id = 0;
  const fitted = fitPlanToBank({
    critical: [evidence('critical-1', 'CRITICAL', 90)],
    high: [evidence('high-1', 'HIGH', 70)],
    supporting: [
      evidence('support-1', 'SUPPORTING', 30),
      evidence('support-2', 'SUPPORTING', 25),
    ],
    controls: [
      evidence('control-1', 'SUPPORTING', 10),
      evidence('control-2', 'SUPPORTING', 8),
    ],
    counts: {},
  }, {
    maxBankQuestions: 12,
    minEvidenceUnits: 4,
    randomUUID: () => 'evidence-' + (++id),
  });

  assert.equal(fitted.mode, 'LIVE');
  assert.ok(fitted.controls.length >= 1);
  assert.ok(fitted.evidence.length >= 4);
  assert.ok(
    fitted.controls.every((control) =>
      fitted.evidence.some((item) => item.id === control.id)
    )
  );

  const estimatedCost =
    fitted.critical.length * 3 +
    fitted.high.length * 2 +
    fitted.supporting.length * 2 +
    fitted.controls.length * 2;
  assert.ok(estimatedCost <= 12);
  assert.equal(new Set(fitted.evidence.map((item) => item.id)).size, fitted.evidence.length);
});

test('preparation retries only the failed generated item', async () => {
  const baseEvidence = evidence('card-1', 'CRITICAL', 90);
  baseEvidence.id = 'evidence-1';

  const planner = {
    buildPlan() {
      return {
        plannerVersion: 1,
        critical: [baseEvidence],
        high: [],
        supporting: [],
        controls: [],
        evidence: [baseEvidence],
        softQuestionBudget: 5,
        hardQuestionCap: 30,
        counts: {},
      };
    },
  };

  const blueprints = [
    { id: 'bp-diag', evidenceId: 'evidence-1', sourceCardId: 'card-1', role: 'DIAGNOSTIC', variantIndex: 0, cognitiveLevel: 'APPLICATION', riskLevel: 'CRITICAL', sourceSnapshot: baseEvidence.sourceSnapshot },
    { id: 'bp-challenge', evidenceId: 'evidence-1', sourceCardId: 'card-1', role: 'CHALLENGE', variantIndex: 1, cognitiveLevel: 'APPLICATION', riskLevel: 'CRITICAL', sourceSnapshot: baseEvidence.sourceSnapshot },
    { id: 'bp-confirm', evidenceId: 'evidence-1', sourceCardId: 'card-1', role: 'CONFIRMATION', variantIndex: 2, cognitiveLevel: 'RETRIEVAL', riskLevel: 'CRITICAL', sourceSnapshot: baseEvidence.sourceSnapshot },
  ];

  const attempts = new Map();
  const retryCalls = [];
  const questionBank = {
    buildBlueprints() {
      return blueprints;
    },
    async generate(blueprint, options = {}) {
      retryCalls.push({ blueprintId: blueprint.id, ...options });
      const count = (attempts.get(blueprint.id) || 0) + 1;
      attempts.set(blueprint.id, count);
      if (blueprint.id === 'bp-challenge' && count === 1) {
        const error = new Error('one bad generated variant');
        error.validationIssues = ['duplicate_option'];
        throw error;
      }
      return {
        blueprint,
        question: {
          stem: 'stem-' + blueprint.id,
          options: ['A1', 'B1', 'C1', 'D1'],
          correctIndex: 0,
          explanation: 'grounded',
        },
      };
    },
  };

  let questionId = 0;
  const service = createPreparationService({
    planner,
    questionBank,
    scheduler: {
      chooseNext({ questions }) {
        return {
          type: 'QUESTION',
          questionId: questions[0].id,
          evidenceId: 'evidence-1',
        };
      },
    },
    randomUUID: () => 'generated-' + (++questionId),
  });

  const result = await service.prepare({
    cards: [{ id: 'card-1' }],
    states: [],
  });

  assert.equal(result.questions.length, 3);
  assert.equal(attempts.get('bp-diag'), 1);
  assert.equal(attempts.get('bp-challenge'), 2);
  assert.equal(attempts.get('bp-confirm'), 1);
  const challengeRetry = retryCalls.find(
    (call) => call.blueprintId === 'bp-challenge' && call.attempt === 2
  );
  assert.equal(challengeRetry.retryFeedback, 'duplicate_option');
});

test('activation persists the validated bank before the Reckoning becomes in_progress', async () => {
  const order = [];
  const evidenceRows = [];
  const questionRows = [];
  const claimed = {
    id: 'reckoning-e',
    user_id: 'user-e',
    subject_id: 'subject-e',
    pressure_score: 23,
    status: 'triggered',
    engine_version: 2,
    engine_mode: 'LIVE',
    engine_phase: 'PREPARING',
    generation_status: 'not_started',
    state_version: 0,
  };
  let activeSession = null;

  const failedSession = {
    id: 'reckoning-fail',
    user_id: 'user-fail',
    subject_id: 'subject-fail',
    engine_version: 2,
    engine_mode: 'LIVE',
    status: 'triggered',
  };
  const store = {
    async getSession() {
      return failedSession;
    },
    async claimPreparation() {
      order.push('claim');
      return claimed;
    },
    async releasePreparationFailure() {
      order.push('release-failure');
    },
    async getSession() {
      order.push('lock-session');
      return activeSession || claimed;
    },
    async withTransaction(work) {
      order.push('tx-begin');
      const result = await work(store);
      order.push('tx-commit');
      return result;
    },
    async clearPreparationEvidence() {
      order.push('clear-evidence');
    },
    async createEvidence(record) {
      order.push('create-evidence');
      const row = {
        id: record.id,
        reckoning_id: record.reckoningId,
        source_card_id: record.sourceCardId,
        concept_key: record.conceptKey,
        source_snapshot: record.sourceSnapshot,
        risk_score: record.riskScore,
        risk_level: record.riskLevel,
        risk_reasons: record.riskReasons,
        evidence_status: record.evidenceStatus,
        required_confirmations: record.requiredConfirmations,
        attempt_count: 0,
        successful_demonstrations: 0,
        questions_seen: 0,
      };
      evidenceRows.push(row);
      return row;
    },
    async createExecutionExam() {
      order.push('create-exam');
      return { id: 'exam-e' };
    },
    async createPreparedQuestion(_userId, examId, question) {
      order.push('create-question:' + question.id);
      const row = {
        id: question.id,
        exam_session_id: examId,
        question_number: question.questionNumber,
        reckoning_evidence_id: question.evidenceId,
        reckoning_role: question.role,
        variant_index: question.variantIndex,
        stem: question.stem,
        option_a: question.options[0],
        option_b: question.options[1],
        option_c: question.options[2],
        option_d: question.options[3],
        correct_answer: question.correctAnswer,
        explanation: question.explanation,
        selected_option: null,
        is_unlocked: false,
      };
      questionRows.push(row);
      return row;
    },
    async unlockQuestion(_userId, _examId, questionId) {
      order.push('unlock:' + questionId);
      const row = questionRows.find((question) => question.id === questionId);
      row.is_unlocked = true;
      row.unlocked_at = new Date();
      return row;
    },
    async activatePreparedSession(_reckoningId, _userId, input) {
      order.push('activate');
      activeSession = {
        ...claimed,
        status: 'in_progress',
        exam_session_id: input.examSessionId,
        current_question_id: input.currentQuestionId,
        engine_phase: 'ACTIVE',
        generation_status: 'ready',
        soft_question_budget: input.softQuestionBudget,
        hard_question_cap: input.hardQuestionCap,
        current_block: 1,
        questions_used: 0,
        state_version: 1,
        review_started_at: new Date(),
        safety_expires_at: new Date(Date.now() + 45 * 60 * 1000),
      };
      return activeSession;
    },
    async getEvidence() {
      return evidenceRows;
    },
    async getExecutionQuestions() {
      return questionRows;
    },
  };

  const engine = createReckoningEngine({
    store,
    preparationInputProvider: async () => {
      order.push('load-input');
      return { cards: [], states: [], deckIds: ['deck-e'] };
    },
    preparationService: {
      async prepare() {
        order.push('generate-and-validate-bank');
        return {
          plan: {
            plannerVersion: 1,
            softQuestionBudget: 5,
            hardQuestionCap: 30,
            evidence: [{
              id: 'evidence-e',
              sourceCardId: 'card-e',
              conceptKey: 'card:card-e',
              sourceSnapshot: { front_content: 'Question', back_content: 'Answer' },
              sourceHash: 'hash-e',
              originalCardState: 'STUCK',
              riskScore: 90,
              riskLevel: 'CRITICAL',
              riskReasons: [],
              isBubbleCritical: false,
              hasLearningDebt: false,
              requiredConfirmations: 1,
            }],
          },
          questions: [
            { id: 'q-e-1', questionNumber: 1, evidenceId: 'evidence-e', role: 'DIAGNOSTIC', variantIndex: 0, stem: 'Diagnostic?', options: ['a','b','c','d'], correctAnswer: 'A', explanation: 'x' },
            { id: 'q-e-2', questionNumber: 2, evidenceId: 'evidence-e', role: 'CONFIRMATION', variantIndex: 2, stem: 'Confirmation?', options: ['a','b','c','d'], correctAnswer: 'B', explanation: 'y' },
          ],
          firstQuestionId: 'q-e-1',
          firstQuestionNumber: 1,
        };
      },
    },
  });

  const state = await engine.start({
    reckoningId: 'reckoning-e',
    userId: 'user-e',
  });

  assert.equal(state.engineMode, 'LIVE');
  assert.equal(state.enginePhase, 'ACTIVE');
  assert.equal(state.currentQuestion.id, 'q-e-1');
  assert.equal(questionRows.length, 2);

  const activationIndex = order.indexOf('activate');
  assert.ok(activationIndex > order.indexOf('generate-and-validate-bank'));
  assert.ok(activationIndex > order.indexOf('create-evidence'));
  assert.ok(activationIndex > order.indexOf('create-question:q-e-2'));
  assert.ok(activationIndex > order.indexOf('unlock:q-e-1'));
  assert.ok(order.indexOf('tx-commit') > activationIndex);
});

test('generation failure leaves preparation retryable and never opens a transaction', async () => {
  const order = [];
  const failedSession = {
    id: 'reckoning-fail',
    user_id: 'user-fail',
    subject_id: 'subject-fail',
    engine_version: 2,
    engine_mode: 'LIVE',
    status: 'triggered',
  };
  const store = {
    async getSession() {
      return failedSession;
    },
    async claimPreparation() {
      return failedSession;
    },
    async releasePreparationFailure() {
      order.push('released');
    },
    async withTransaction() {
      order.push('transaction');
      throw new Error('transaction should not run');
    },
  };

  const engine = createReckoningEngine({
    store,
    preparationInputProvider: async () => ({ cards: [], states: [] }),
    preparationService: {
      async prepare() {
        throw new Error('Gemini validation exhausted');
      },
    },
  });

  await assert.rejects(
    () => engine.start({
      reckoningId: 'reckoning-fail',
      userId: 'user-fail',
    }),
    /Gemini validation exhausted/
  );

  assert.deepEqual(order, ['released']);
});