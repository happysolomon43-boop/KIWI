'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORK_STATES,
  createDurablePreparationWorker,
} = require('../../services/reckoning/durable-preparation-worker');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');

function blueprint() {
  return Object.freeze({
    id: 'bp-1',
    evidenceId: 'ev-1',
    sourceCardId: 'card-1',
    role: 'DIAGNOSTIC',
    variantIndex: 0,
    cognitiveLevel: 'APPLICATION',
    riskLevel: 'HIGH',
    sourceSnapshot: {
      front_content: 'What is horizontal communication?',
      back_content: 'Communication between people of the same rank.',
    },
  });
}

function manifest(bp = blueprint()) {
  return Object.freeze({
    preparationVersion: 2,
    configVersion: 6,
    generationGroupId: 'reckoning-1',
    plan: {
      plannerVersion: 1,
      softQuestionBudget: 5,
      hardQuestionCap: 30,
      evidence: [{ id: 'ev-1' }],
    },
    blueprints: Object.freeze([bp]),
    familyOrder: Object.freeze(['ev-1']),
    deckIds: Object.freeze(['deck-1']),
    totalCount: 1,
  });
}

function candidate() {
  return Object.freeze({
    stem: 'Which scenario demonstrates horizontal communication?',
    options: Object.freeze([
      'Two department heads of equal rank coordinating work.',
      'An intern reporting to a director.',
      'A manager instructing a trainee.',
      'A chief executive addressing junior staff.',
    ]),
    correctIndex: 0,
    explanation: 'Horizontal communication occurs between people at the same level.',
  });
}

function fakeStore(initial = {}) {
  const state = {
    item: {
      id: 'item-1',
      reckoning_id: 'reckoning-1',
      user_id: 'user-1',
      blueprint_id: 'bp-1',
      evidence_id: 'ev-1',
      family_index: 0,
      item_index: 0,
      status: 'PENDING',
      generated_question: null,
      attempt_count: 0,
      validation_issues: [],
      last_error: null,
      ready_at: null,
      work_state: 'NEEDS_GENERATION',
      candidate_question: null,
      retry_phase: 'GENERATE',
      retry_epoch: 0,
      content_revision_count: 0,
      next_attempt_at: new Date(0),
      lease_token: null,
      lease_expires_at: null,
      last_error_code: null,
      ...initial,
    },
  };

  return {
    state,
    async ensurePreparationWorkItems() { return 1; },
    async ownsPreparationClaim() { return true; },
    async getPreparationItems() { return [{ ...state.item }]; },
    async leasePreparationWorkItem(_rid, _uid, _bid, { leaseToken }) {
      const now = Date.now();
      const next = state.item.next_attempt_at
        ? new Date(state.item.next_attempt_at).getTime()
        : 0;
      if (next > now || state.item.status === 'READY') return null;
      state.item.lease_token = leaseToken;
      state.item.lease_expires_at = new Date(now + 240000);
      state.item.work_state =
        state.item.candidate_question && state.item.retry_phase === 'AUDIT'
          ? 'AUDITING'
          : 'GENERATING';
      return { ...state.item };
    },
    async savePreparationItemCandidate(_rid, _uid, input) {
      if (state.item.lease_token !== input.leaseToken) return null;
      state.item.status = 'PENDING';
      state.item.work_state = 'NEEDS_AUDIT';
      state.item.candidate_question = input.candidate;
      state.item.retry_phase = 'AUDIT';
      state.item.next_attempt_at = new Date(0);
      state.item.attempt_count += input.generationAttempts || 1;
      state.item.lease_token = null;
      state.item.lease_expires_at = null;
      return { ...state.item };
    },
    async savePreparationWorkItemReady(_rid, _uid, input) {
      if (state.item.lease_token !== input.leaseToken) return null;
      state.item.status = 'READY';
      state.item.work_state = 'READY';
      state.item.generated_question = input.question;
      state.item.candidate_question = null;
      state.item.retry_phase = null;
      state.item.next_attempt_at = null;
      state.item.lease_token = null;
      state.item.lease_expires_at = null;
      return { ...state.item };
    },
    async schedulePreparationItemRetry(_rid, _uid, input) {
      if (state.item.lease_token !== input.leaseToken) return null;
      state.item.status = 'PENDING';
      state.item.work_state = 'RETRY_WAIT';
      state.item.retry_phase = input.phase;
      state.item.retry_epoch += 1;
      state.item.next_attempt_at = input.nextAttemptAt;
      if (input.phase === 'GENERATE') state.item.candidate_question = null;
      state.item.last_error = input.error?.message || '';
      state.item.last_error_code = input.error?.code || null;
      state.item.lease_token = null;
      state.item.lease_expires_at = null;
      return { ...state.item };
    },
    async savePreparationItemAuditRejection() {
      throw new Error('not expected');
    },
    async savePreparationItemTerminal() {
      throw new Error('not expected');
    },
  };
}

function config() {
  return {
    preparationVersion: 2,
    preparation: {
      durableWorkerConcurrency: 1,
      durableWorkerPollMaxMs: 1000,
      durableItemLeaseSeconds: 240,
      durableRetryBaseMs: 1000,
      durableRetryMaxMs: 5000,
      semanticRegenerationAttempts: 3,
    },
  };
}

test('generation provider outage becomes durable retry work and completes without learner retry', async () => {
  let now = 1000;
  const sleeps = [];
  const generationBudgetIds = [];
  let generationCalls = 0;
  const store = fakeStore();

  const preparationService = {
    resolveFamilyConcurrency() { return 1; },
    async generateCandidateWithRetry(_bp, options) {
      generationCalls += 1;
      generationBudgetIds.push(options.operationBudgetId);
      if (generationCalls === 1) {
        throw new AIError('provider overloaded', {
          code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
          status: 503,
          retryable: true,
        });
      }
      return { question: candidate(), generationAttempts: 1 };
    },
    async auditCandidate() {
      return { valid: true };
    },
  };

  const worker = createDurablePreparationWorker({
    config: config(),
    preparationService,
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
      return () => 'uuid-' + (++n);
    })(),
    clock: () => new Date(now),
    sleepImpl: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0,
  });

  const result = await worker.run({
    store,
    reckoningId: 'reckoning-1',
    userId: 'user-1',
    claimId: 'claim-1',
    manifest: manifest(),
  });

  assert.equal(result.readyCount, 1);
  assert.equal(store.state.item.status, 'READY');
  assert.equal(generationCalls, 2);
  assert.ok(sleeps.length >= 1);
  assert.match(generationBudgetIds[0], /generate:epoch:0$/);
  assert.match(generationBudgetIds[1], /generate:epoch:1$/);
});

test('audit outage preserves generated candidate and retries audit without regenerating', async () => {
  let now = 1000;
  let generateCalls = 0;
  let auditCalls = 0;
  const auditBudgetIds = [];
  const store = fakeStore({
    work_state: 'NEEDS_AUDIT',
    retry_phase: 'AUDIT',
    candidate_question: candidate(),
  });

  const preparationService = {
    resolveFamilyConcurrency() { return 1; },
    async generateCandidateWithRetry() {
      generateCalls += 1;
      throw new Error('generation must not run while candidate awaits audit');
    },
    async auditCandidate(_bp, _candidate, options) {
      auditCalls += 1;
      auditBudgetIds.push(options.operationBudgetId);
      if (auditCalls === 1) {
        throw new AIError('auditor overloaded', {
          code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
          status: 503,
          retryable: true,
        });
      }
      return { valid: true };
    },
  };

  const worker = createDurablePreparationWorker({
    config: config(),
    preparationService,
    scheduler: {
      chooseNext({ questions }) {
        return {
          type: 'QUESTION',
          questionId: questions[0].id,
          evidenceId: questions[0].evidenceId,
        };
      },
    },
    randomUUID: () => 'question-audited',
    clock: () => new Date(now),
    sleepImpl: async (ms) => { now += ms; },
    random: () => 0,
  });

  const result = await worker.run({
    store,
    reckoningId: 'reckoning-1',
    userId: 'user-1',
    claimId: 'claim-1',
    manifest: manifest(),
  });

  assert.equal(result.readyCount, 1);
  assert.equal(generateCalls, 0);
  assert.equal(auditCalls, 2);
  assert.match(auditBudgetIds[0], /audit:epoch:0$/);
  assert.match(auditBudgetIds[1], /audit:epoch:1$/);
  assert.equal(store.state.item.status, 'READY');
});

test('operation budget exhaustion is a retry epoch, not a terminal Reckoning failure', async () => {
  let now = 1000;
  let calls = 0;
  const store = fakeStore();
  const budgetIds = [];

  const preparationService = {
    resolveFamilyConcurrency() { return 1; },
    async generateCandidateWithRetry(_bp, options) {
      calls += 1;
      budgetIds.push(options.operationBudgetId);
      if (calls === 1) {
        throw new AIError('epoch budget exhausted', {
          code: AI_ERROR_CODES.OPERATION_BUDGET_EXHAUSTED,
          retryable: false,
        });
      }
      return { question: candidate(), generationAttempts: 1 };
    },
    async auditCandidate() { return { valid: true }; },
  };

  const worker = createDurablePreparationWorker({
    config: config(),
    preparationService,
    scheduler: {
      chooseNext({ questions }) {
        return {
          type: 'QUESTION',
          questionId: questions[0].id,
          evidenceId: questions[0].evidenceId,
        };
      },
    },
    randomUUID: () => 'question-budget',
    clock: () => new Date(now),
    sleepImpl: async (ms) => { now += ms; },
    random: () => 0,
  });

  const result = await worker.run({
    store,
    reckoningId: 'reckoning-1',
    userId: 'user-1',
    claimId: 'claim-1',
    manifest: manifest(),
  });

  assert.equal(result.readyCount, 1);
  assert.equal(calls, 2);
  assert.notEqual(budgetIds[0], budgetIds[1]);
  assert.equal(store.state.item.work_state, WORK_STATES.READY);
});
