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
const {
  isAutoRecoverablePreparationError,
  preparationRecoveryDelayMs,
} = require('../../services/reckoning/engine');
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


test('transient provider outage auto-recovers inside the same durable Reckoning preparation claim', async () => {
  const evidence = sourceEvidence('auto-recover', 'HIGH', 70);
  const blueprints = [
    {
      id: 'bp-auto-1',
      evidenceId: evidence.id,
      sourceCardId: evidence.sourceCardId,
      role: 'DIAGNOSTIC',
      variantIndex: 0,
    },
    {
      id: 'bp-auto-2',
      evidenceId: evidence.id,
      sourceCardId: evidence.sourceCardId,
      role: 'CHALLENGE',
      variantIndex: 1,
    },
  ];
  const q1 = {
    id: 'q-auto-1',
    cardId: evidence.sourceCardId,
    questionNumber: 1,
    cognitiveLevel: 'APPLICATION',
    difficulty: 'Medium',
    questionType: 'Reckoning',
    stem: 'Saved first question?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    explanation: 'one',
    evidenceId: evidence.id,
    role: 'DIAGNOSTIC',
    variantIndex: 0,
    blueprint: blueprints[0],
  };
  const q2 = {
    ...q1,
    id: 'q-auto-2',
    questionNumber: 2,
    stem: 'Recovered second question?',
    role: 'CHALLENGE',
    variantIndex: 1,
    blueprint: blueprints[1],
  };
  const claimed = {
    id: 'reckoning-auto-recover',
    user_id: 'user-auto-recover',
    subject_id: 'subject-auto-recover',
    pressure_score: 33,
    status: 'triggered',
    engine_version: 2,
    engine_mode: 'LIVE',
    engine_phase: 'PREPARING',
    generation_status: 'pending',
    state_version: 0,
  };

  let active = null;
  let fakeNow = Date.parse('2026-09-26T08:21:40Z');
  let prepareCalls = 0;
  let providerBusy = true;
  let releaseFailures = 0;
  let touchCount = 0;
  const sleepCalls = [];
  const recoveryBudgetIds = [];
  const items = [];
  const evidenceRows = [];
  const questionRows = [];

  function upsertItem(item) {
    const blueprintId = String(item.blueprint.id);
    const existing = items.find((row) => row.blueprint_id === blueprintId);
    const row = existing || { blueprint_id: blueprintId };
    row.status = item.question ? 'READY' : 'ERROR';
    row.generated_question = item.question || null;
    if (!existing) items.push(row);
    return row;
  }

  const store = {
    async claimPreparation() { return claimed; },
    async touchPreparation() {
      touchCount += 1;
      return { id: claimed.id, preparation_claim_id: 'claim-auto' };
    },
    async getPreparationManifest() {
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
        blueprints,
        family_order: [evidence.id],
        deck_ids: ['deck-auto'],
        total_count: 2,
      };
    },
    async createPreparationManifest() {
      throw new Error('compatible manifest must be reused');
    },
    async getPreparationItems() {
      return items.map((row) => ({ ...row }));
    },
    async savePreparationItemReady(_reckoningId, _userId, item) {
      return upsertItem(item);
    },
    async savePreparationItemFailure(_reckoningId, _userId, item) {
      return upsertItem(item);
    },
    async releasePreparationFailure() {
      releaseFailures += 1;
    },
    async getSession() {
      return active || claimed;
    },
    async withTransaction(work) {
      return work(store);
    },
    async clearPreparationEvidence() {},
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
    async createExecutionExam() {
      return { id: 'exam-auto-recover' };
    },
    async createPreparedQuestion(_userId, examId, question) {
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
      const row = questionRows.find((question) => question.id === questionId);
      row.is_unlocked = true;
      row.unlocked_at = new Date(fakeNow);
      return row;
    },
    async activatePreparedSession(_reckoningId, _userId, input) {
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
        review_started_at: new Date(fakeNow),
        safety_expires_at: new Date(fakeNow + 45 * 60 * 1000),
      };
      return active;
    },
    async clearPreparationArtifacts() {},
    async getEvidence() { return evidenceRows; },
    async getExecutionQuestions() { return questionRows; },
  };

  const preparationService = {
    buildManifest() {
      throw new Error('manifest should not rebuild');
    },
    async prepare({
      manifest,
      preparedItems,
      operationBudgetId,
      onQuestionReady,
      onQuestionFailure,
    }) {
      prepareCalls += 1;
      recoveryBudgetIds.push(operationBudgetId);

      if (providerBusy) {
        assert.equal(
          preparedItems.some((item) => item.status === 'READY'),
          false
        );
        await onQuestionReady({
          blueprint: blueprints[0],
          question: q1,
          generationAttempts: 1,
          familyIndex: 0,
          itemIndex: 0,
        });
        const outage = new AIError('Gemini provider overloaded', {
          code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
          status: 503,
          retryable: true,
          scope: 'PROVIDER_MODEL',
          retryAfterMs: 2000,
        });
        await onQuestionFailure({
          blueprint: blueprints[1],
          error: outage,
          generationAttempts: 1,
          familyIndex: 0,
          itemIndex: 1,
        });
        throw outage;
      }

      assert.equal(
        preparedItems.some(
          (item) =>
            item.blueprint_id === blueprints[0].id &&
            item.status === 'READY' &&
            item.generated_question?.id === q1.id
        ),
        true
      );
      await onQuestionReady({
        blueprint: blueprints[1],
        question: q2,
        generationAttempts: 1,
        familyIndex: 0,
        itemIndex: 1,
      });
      return {
        manifest,
        plan: manifest.plan,
        questions: [q1, q2],
        firstQuestionId: q1.id,
        firstQuestionNumber: 1,
      };
    },
  };

  const engine = createReckoningEngine({
    store,
    preparationService,
    preparationInputProvider: async () => {
      throw new Error('source input must not reload');
    },
    config: {
      preparation: {
        availabilityRecoveryWindowSeconds: 30,
        availabilityRecoveryMaxRounds: 3,
        availabilityRecoveryMinDelayMs: 100,
        availabilityRecoveryMaxDelayMs: 5000,
        heartbeatSeconds: 9999,
      },
    },
    clock: () => new Date(fakeNow),
    sleepImpl: async (ms) => {
      sleepCalls.push(ms);
      fakeNow += ms;
      providerBusy = false;
    },
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
    randomUUID: () => 'claim-auto',
  });

  const state = await engine.start({
    reckoningId: claimed.id,
    userId: claimed.user_id,
  });

  assert.equal(prepareCalls, 2);
  assert.deepEqual(recoveryBudgetIds, [
    'reckoning:reckoning-auto-recover:claim:claim-auto',
    'reckoning:reckoning-auto-recover:claim:claim-auto',
  ]);
  assert.deepEqual(sleepCalls, [2250]);
  assert.ok(touchCount >= 1);
  assert.equal(releaseFailures, 0);
  assert.equal(items.filter((item) => item.status === 'READY').length, 2);
  assert.equal(state.enginePhase, 'ACTIVE');
  assert.equal(state.examSessionId, 'exam-auto-recover');
});

test('auto recovery is limited to transient availability and never waits on daily quota or exhausted operation budget', () => {
  const transient = new AIError('overloaded', {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    status: 503,
    retryable: true,
  });
  const daily = new AIError('daily quota', {
    code: AI_ERROR_CODES.RATE_LIMIT_RPD,
    status: 429,
    retryable: true,
  });
  const budget = new AIError('budget exhausted', {
    code: AI_ERROR_CODES.OPERATION_BUDGET_EXHAUSTED,
    retryable: false,
  });

  assert.equal(isAutoRecoverablePreparationError(transient), true);
  assert.equal(isAutoRecoverablePreparationError(daily), false);
  assert.equal(isAutoRecoverablePreparationError(budget), false);

  const nested = new Error('partial');
  nested.retryable = true;
  nested.code = AI_ERROR_CODES.PROVIDER_OVERLOADED;
  nested.cause = new AIError('provider', {
    code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
    retryable: true,
    retryAfterMs: 4000,
  });

  assert.equal(
    preparationRecoveryDelayMs(nested, 0, {
      preparation: {
        availabilityRecoveryMinDelayMs: 1000,
        availabilityRecoveryMaxDelayMs: 20000,
      },
    }),
    4250
  );
});


test('Reckoning preparation forwards claim budget identity without persisting it in the manifest', async () => {
  const evidence = sourceEvidence('budget-scope', 'HIGH', 70);
  const blueprint = {
    id: 'bp-budget-scope',
    evidenceId: evidence.id,
    sourceCardId: evidence.sourceCardId,
    role: 'DIAGNOSTIC',
    variantIndex: 0,
    cognitiveLevel: 'APPLICATION',
    riskLevel: 'HIGH',
    sourceSnapshot: evidence.sourceSnapshot,
  };
  const calls = [];

  const service = createPreparationService({
    planner: {
      buildPlan() {
        return {
          plannerVersion: 1,
          critical: [],
          high: [evidence],
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
      buildBlueprints() { return [blueprint]; },
      async generate(current, options) {
        calls.push({
          generationGroupId: options.generationGroupId,
          operationBudgetId: options.operationBudgetId,
        });
        return generated(current, 'budget-scope');
      },
    },
    scheduler: {
      chooseNext({ questions }) {
        return {
          type: 'QUESTION',
          questionId: questions[0].id,
          evidenceId: evidence.id,
        };
      },
    },
    randomUUID: () => 'budget-question',
  });

  const manifest = service.buildManifest({
    generationGroupId: 'reckoning-stable-id',
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest, 'operationBudgetId'),
    false
  );

  await service.prepare({
    manifest,
    operationBudgetId: 'reckoning:stable:claim:fresh-claim',
  });

  assert.deepEqual(calls, [{
    generationGroupId: 'reckoning-stable-id',
    operationBudgetId: 'reckoning:stable:claim:fresh-claim',
  }]);
});
