'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createPreparationService,
  resolveFamilyConcurrency,
} = require('../../services/reckoning/preparation');
const { createReckoningEngine } = require('../../services/reckoning');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function sourceEvidence(id, riskLevel = 'HIGH', riskScore = 70) {
  return {
    id,
    sourceCardId: 'card-' + id,
    conceptKey: 'concept-' + id,
    sourceSnapshot: {
      front_content: 'Question ' + id,
      back_content: 'Answer ' + id,
    },
    sourceHash: 'hash-' + id,
    originalCardState: riskLevel === 'CRITICAL' ? 'STUCK' : 'SLIPPING',
    riskScore,
    riskLevel,
    riskReasons: [],
    isBubbleCritical: false,
    hasLearningDebt: false,
    requiredConfirmations: riskLevel === 'CRITICAL' ? 1 : 0,
  };
}

function generated(blueprint, label) {
  return {
    blueprint,
    question: {
      stem: 'Stem ' + label,
      options: ['One ' + label, 'Two ' + label, 'Three ' + label, 'Four ' + label],
      correctIndex: 0,
      explanation: 'Grounded ' + label,
    },
  };
}

test('Delivery D migration creates backend-only resumable preparation artifacts', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      'migrations',
      '20260924_reckoning_resumable_preparation_delivery_d.sql'
    ),
    'utf8'
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.reckoning_preparation_manifests/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.reckoning_preparation_items/i);
  assert.match(migration, /generated_question\s+jsonb/i);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS uq_reckoning_preparation_blueprint/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.reckoning_preparation_manifests FROM anon, authenticated/i);
  assert.match(migration, /ON DELETE CASCADE/i);
  assert.doesNotMatch(migration, /DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE/i);
});

test('saved READY questions are reused and only missing blueprints are regenerated', async () => {
  const evidence = sourceEvidence('e1', 'CRITICAL', 90);
  const blueprints = [
    {
      id: 'bp-diagnostic',
      evidenceId: 'e1',
      sourceCardId: evidence.sourceCardId,
      role: 'DIAGNOSTIC',
      variantIndex: 0,
      cognitiveLevel: 'APPLICATION',
      riskLevel: 'CRITICAL',
      sourceSnapshot: evidence.sourceSnapshot,
    },
    {
      id: 'bp-challenge',
      evidenceId: 'e1',
      sourceCardId: evidence.sourceCardId,
      role: 'CHALLENGE',
      variantIndex: 1,
      cognitiveLevel: 'APPLICATION',
      riskLevel: 'CRITICAL',
      sourceSnapshot: evidence.sourceSnapshot,
    },
  ];

  const calls = [];
  const service = createPreparationService({
    planner: {
      buildPlan() {
        return {
          plannerVersion: 1,
          critical: [evidence],
          high: [],
          supporting: [],
          controls: [],
          evidence: [evidence],
          softQuestionBudget: 5,
          hardQuestionCap: 30,
          counts: {},
        };
      },
    },
    questionBank: {
      buildBlueprints() { return blueprints; },
      async generate(blueprint, options) {
        calls.push({
          id: blueprint.id,
          previousStem: options.previousQuestion?.stem || null,
        });
        return generated(blueprint, blueprint.id);
      },
    },
    scheduler: {
      chooseNext({ questions }) {
        return {
          type: 'QUESTION',
          questionId: questions[0].id,
          evidenceId: 'e1',
        };
      },
    },
    randomUUID: (() => {
      let n = 0;
      return () => 'generated-' + (++n);
    })(),
  });

  const manifest = service.buildManifest({
    generationGroupId: 'reckoning-1',
    deckIds: ['deck-1'],
  });

  const savedDiagnostic = {
    id: 'saved-q-1',
    cardId: evidence.sourceCardId,
    questionNumber: 1,
    cognitiveLevel: 'APPLICATION',
    difficulty: 'Medium',
    questionType: 'Reckoning',
    stem: 'Saved diagnostic stem',
    options: ['Saved A', 'Saved B', 'Saved C', 'Saved D'],
    correctAnswer: 'A',
    explanation: 'Saved explanation',
    evidenceId: 'e1',
    role: 'DIAGNOSTIC',
    variantIndex: 0,
    blueprint: blueprints[0],
  };

  const result = await service.prepare({
    manifest,
    preparedItems: [{
      blueprint_id: 'bp-diagnostic',
      status: 'READY',
      generated_question: savedDiagnostic,
    }],
  });

  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].id, 'saved-q-1');
  assert.deepEqual(calls.map((call) => call.id), ['bp-challenge']);
  assert.equal(calls[0].previousStem, 'Saved diagnostic stem');
});

test('partial provider failure preserves validated questions and retry resumes the missing work', async () => {
  const e1 = sourceEvidence('e1', 'HIGH', 70);
  const e2 = sourceEvidence('e2', 'HIGH', 68);
  const blueprints = [
    {
      id: 'bp-e1',
      evidenceId: 'e1',
      sourceCardId: e1.sourceCardId,
      role: 'DIAGNOSTIC',
      variantIndex: 0,
      cognitiveLevel: 'APPLICATION',
      riskLevel: 'HIGH',
      sourceSnapshot: e1.sourceSnapshot,
    },
    {
      id: 'bp-e2',
      evidenceId: 'e2',
      sourceCardId: e2.sourceCardId,
      role: 'DIAGNOSTIC',
      variantIndex: 0,
      cognitiveLevel: 'APPLICATION',
      riskLevel: 'HIGH',
      sourceSnapshot: e2.sourceSnapshot,
    },
  ];

  let providerBusy = true;
  const calls = [];
  const service = createPreparationService({
    planner: {
      buildPlan() {
        return {
          plannerVersion: 1,
          critical: [],
          high: [e1, e2],
          supporting: [],
          controls: [],
          evidence: [e1, e2],
          softQuestionBudget: 5,
          hardQuestionCap: 30,
          counts: {},
        };
      },
    },
    questionBank: {
      buildBlueprints() { return blueprints; },
      async generate(blueprint) {
        calls.push(blueprint.id);
        if (blueprint.id === 'bp-e2' && providerBusy) {
          throw new AIError('Gemini provider overloaded', {
            code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
            status: 503,
            retryable: true,
            scope: 'PROVIDER_MODEL',
          });
        }
        return generated(blueprint, blueprint.id);
      },
    },
    scheduler: {
      chooseNext({ questions }) {
        return {
          type: 'QUESTION',
          questionId: questions[0].id,
          evidenceId: questions[0].evidenceId,
        };
      },
    },
    randomUUID: (() => {
      let n = 0;
      return () => 'question-' + (++n);
    })(),
  });

  const manifest = service.buildManifest({
    generationGroupId: 'reckoning-partial',
  });
  const persisted = [];

  await assert.rejects(
    service.prepare({
      manifest,
      onQuestionReady: async (item) => {
        persisted.push({
          blueprint_id: item.blueprint.id,
          status: 'READY',
          generated_question: item.question,
        });
      },
      onQuestionFailure: async () => {},
    }),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
      assert.equal(error.preparationProgress.totalCount, 2);
      assert.ok(error.preparationProgress.readyCount >= 1);
      assert.match(error.message, /saved and will be reused on retry/i);
      return true;
    }
  );

  const callsAfterFirstRun = [...calls];
  assert.ok(persisted.some((item) => item.blueprint_id === 'bp-e1'));

  providerBusy = false;
  calls.length = 0;
  const retried = await service.prepare({
    manifest,
    preparedItems: persisted,
    onQuestionReady: async (item) => {
      persisted.push({
        blueprint_id: item.blueprint.id,
        status: 'READY',
        generated_question: item.question,
      });
    },
  });

  assert.equal(retried.questions.length, 2);
  assert.equal(calls.includes('bp-e1'), false);
  assert.equal(calls.includes('bp-e2'), true);
  assert.ok(callsAfterFirstRun.filter((id) => id === 'bp-e2').length >= 1);
});

test('Reckoning family concurrency follows central orchestrator congestion', () => {
  const config = {
    preparation: {
      familyConcurrency: 4,
      elevatedFamilyConcurrency: 2,
      highFamilyConcurrency: 1,
      severeFamilyConcurrency: 1,
    },
  };

  assert.equal(resolveFamilyConcurrency(null, config), 4);
  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'NORMAL',
    effectiveConcurrency: 6,
    active: 0,
    queued: 0,
  }, config), 4);
  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'NORMAL',
    effectiveConcurrency: 6,
    active: 5,
    queued: 0,
  }, config), 1);
  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'NORMAL',
    effectiveConcurrency: 6,
    active: 0,
    queued: 2,
  }, config), 1);
  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'ELEVATED',
    effectiveConcurrency: 4,
    active: 0,
    queued: 0,
  }, config), 2);
  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'HIGH',
    effectiveConcurrency: 2,
    active: 0,
    queued: 0,
  }, config), 1);
  assert.equal(resolveFamilyConcurrency({
    congestionLevel: 'SEVERE',
    effectiveConcurrency: 1,
    active: 0,
    queued: 0,
  }, config), 1);
});

test('engine resumes a compatible manifest without rebuilding source inputs and clears artifacts only after activation', async () => {
  const evidence = sourceEvidence('persisted', 'HIGH', 70);
  const blueprint = {
    id: 'bp-persisted',
    evidenceId: evidence.id,
    sourceCardId: evidence.sourceCardId,
    role: 'DIAGNOSTIC',
    variantIndex: 0,
  };
  const question = {
    id: 'q-persisted',
    cardId: evidence.sourceCardId,
    questionNumber: 1,
    cognitiveLevel: 'APPLICATION',
    difficulty: 'Medium',
    questionType: 'Reckoning',
    stem: 'Persisted question?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    explanation: 'Because',
    evidenceId: evidence.id,
    role: 'DIAGNOSTIC',
    variantIndex: 0,
    blueprint,
  };
  const claimed = {
    id: 'reckoning-persisted',
    user_id: 'user-persisted',
    subject_id: 'subject-persisted',
    pressure_score: 25,
    status: 'triggered',
    engine_version: 2,
    engine_mode: 'LIVE',
    engine_phase: 'PREPARING',
    generation_status: 'error',
    state_version: 0,
  };
  let active = null;
  const order = [];
  const evidenceRows = [];
  const questionRows = [];

  const store = {
    async claimPreparation() { order.push('claim'); return claimed; },
    async touchPreparation() {},
    async getPreparationManifest() {
      order.push('load-manifest');
      return {
        reckoning_id: claimed.id,
        user_id: claimed.user_id,
        preparation_version: 2,
        config_version: 6,
        generation_group_id: claimed.id,
        plan: {
          plannerVersion: 1,
          softQuestionBudget: 5,
          hardQuestionCap: 30,
          evidence: [evidence],
        },
        blueprints: [blueprint],
        family_order: [evidence.id],
        deck_ids: ['deck-persisted'],
        total_count: 1,
      };
    },
    async createPreparationManifest() {
      throw new Error('manifest should be reused');
    },
    async getPreparationItems() {
      order.push('load-items');
      return [{
        blueprint_id: blueprint.id,
        status: 'READY',
        generated_question: question,
      }];
    },
    async savePreparationItemReady() {},
    async savePreparationItemFailure() {},
    async releasePreparationFailure() { order.push('release-failure'); },
    async getSession() { return active || claimed; },
    async withTransaction(work) {
      order.push('tx-begin');
      const result = await work(store);
      order.push('tx-commit');
      return result;
    },
    async clearPreparationEvidence() { order.push('clear-evidence'); },
    async createEvidence(record) {
      const row = {
        id: record.id,
        reckoning_id: claimed.id,
        source_card_id: record.sourceCardId,
        concept_key: record.conceptKey,
        source_snapshot: record.sourceSnapshot,
        risk_score: record.riskScore,
        risk_level: record.riskLevel,
        evidence_status: 'UNTESTED',
        required_confirmations: record.requiredConfirmations,
        attempt_count: 0,
        successful_demonstrations: 0,
        questions_seen: 0,
      };
      evidenceRows.push(row);
      return row;
    },
    async createExecutionExam(_userId, input) {
      order.push('create-exam:' + input.deckIds.join(','));
      return { id: 'exam-persisted' };
    },
    async createPreparedQuestion(_userId, examId, record) {
      const row = {
        id: record.id,
        exam_session_id: examId,
        question_number: record.questionNumber,
        reckoning_evidence_id: record.evidenceId,
        reckoning_role: record.role,
        variant_index: record.variantIndex,
        stem: record.stem,
        option_a: record.options[0],
        option_b: record.options[1],
        option_c: record.options[2],
        option_d: record.options[3],
        correct_answer: record.correctAnswer,
        explanation: record.explanation,
        selected_option: null,
        is_unlocked: false,
      };
      questionRows.push(row);
      return row;
    },
    async unlockQuestion(_userId, _examId, questionId) {
      const row = questionRows.find((item) => item.id === questionId);
      row.is_unlocked = true;
      row.unlocked_at = new Date();
      return row;
    },
    async activatePreparedSession(_reckoningId, _userId, input) {
      order.push('activate');
      active = {
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
      return active;
    },
    async clearPreparationArtifacts() {
      order.push('clear-artifacts');
      return true;
    },
    async getEvidence() { return evidenceRows; },
    async getExecutionQuestions() { return questionRows; },
  };

  const service = {
    buildManifest() {
      throw new Error('source plan must not be rebuilt');
    },
    async prepare({ manifest, preparedItems }) {
      order.push('resume-bank');
      assert.equal(manifest.generationGroupId, claimed.id);
      assert.equal(preparedItems.length, 1);
      return {
        manifest,
        plan: manifest.plan,
        questions: [question],
        firstQuestionId: question.id,
        firstQuestionNumber: 1,
      };
    },
  };

  const engine = createReckoningEngine({
    store,
    preparationInputProvider: async () => {
      throw new Error('source input provider must not run for compatible manifest');
    },
    preparationService: service,
  });

  const state = await engine.start({
    reckoningId: claimed.id,
    userId: claimed.user_id,
  });

  assert.equal(state.enginePhase, 'ACTIVE');
  assert.equal(state.currentQuestion.id, question.id);
  assert.ok(order.indexOf('resume-bank') < order.indexOf('activate'));
  assert.ok(order.indexOf('activate') < order.indexOf('clear-artifacts'));
  assert.ok(order.indexOf('clear-artifacts') < order.indexOf('tx-commit'));
  assert.ok(order.includes('create-exam:deck-persisted'));
});
