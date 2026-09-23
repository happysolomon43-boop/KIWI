'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EFFECT_TYPES,
  buildEffect,
  createLearningEffectsEngine,
} = require('../../services/reckoning/learning-effects');

const NOW = new Date('2026-09-23T09:00:00.000Z');

test('clean recovered evidence does not promote, verify, or extend review timing', () => {
  const card = {
    id: 'card-clean',
    stage: 4,
    next_review_at: new Date('2026-09-30T09:00:00.000Z'),
    repetition_count: 7,
  };
  const state = {
    state: 'STABLE',
    stage: 4,
    verified: false,
  };

  const effect = buildEffect({
    id: 'e-clean',
    source_card_id: card.id,
    evidence_status: 'RECOVERED',
    diagnostic_outcome: 'CORRECT',
  }, card, state, { now: NOW });

  assert.equal(effect.type, EFFECT_TYPES.CLEAN_RECOVERED);
  assert.equal(effect.stageBefore, 4);
  assert.equal(effect.stageAfter, 4);
  assert.deepEqual(effect.cardPatch, {});
  assert.deepEqual(effect.cardStatePatch, {});
});

test('remediated recovery keeps stage, schedules follow-up within three days, and revokes optimistic verification', () => {
  const card = {
    id: 'card-remediated',
    stage: 5,
    next_review_at: new Date('2026-10-20T09:00:00.000Z'),
    repetition_count: 12,
  };
  const state = {
    state: 'VERIFIED',
    stage: 5,
    verified: true,
    verified_at: new Date('2026-09-01T09:00:00.000Z'),
  };

  const effect = buildEffect({
    id: 'e-remediated',
    source_card_id: card.id,
    evidence_status: 'RECOVERED',
    diagnostic_outcome: 'INCORRECT',
    challenge_outcome: 'CORRECT',
  }, card, state, { now: NOW });

  assert.equal(effect.type, EFFECT_TYPES.REMEDIATED_RECOVERED);
  assert.equal(effect.stageBefore, 5);
  assert.equal(effect.stageAfter, 5);
  assert.equal(
    effect.cardPatch.nextReviewAt.toISOString(),
    '2026-09-26T09:00:00.000Z'
  );
  assert.equal(effect.cardStatePatch.verified, false);
  assert.equal(effect.cardStatePatch.verifiedAt, null);
  assert.equal(effect.cardStatePatch.state, 'FRAGILE');
});

test('remediated recovery never postpones a review that is already sooner', () => {
  const existing = new Date('2026-09-24T09:00:00.000Z');
  const effect = buildEffect({
    source_card_id: 'card-soon',
    evidence_status: 'RECOVERED',
    diagnostic_outcome: 'INCORRECT',
    challenge_outcome: 'CORRECT',
  }, {
    id: 'card-soon',
    stage: 3,
    next_review_at: existing,
  }, {
    state: 'GROWING',
    stage: 3,
    verified: false,
  }, { now: NOW });

  assert.equal(effect.cardPatch.nextReviewAt.toISOString(), existing.toISOString());
});

test('unresolved evidence demotes at most one stage, clears verification, resets repetition, and schedules urgent review', () => {
  const effect = buildEffect({
    id: 'e-unresolved',
    source_card_id: 'card-unresolved',
    evidence_status: 'UNRESOLVED',
    diagnostic_outcome: 'INCORRECT',
    challenge_outcome: 'INCORRECT',
  }, {
    id: 'card-unresolved',
    stage: 5,
    repetition_count: 8,
    interval_days: 21,
    next_review_at: new Date('2026-10-20T09:00:00.000Z'),
  }, {
    state: 'VERIFIED',
    stage: 5,
    verified: true,
  }, { now: NOW });

  assert.equal(effect.type, EFFECT_TYPES.UNRESOLVED);
  assert.equal(effect.stageBefore, 5);
  assert.equal(effect.stageAfter, 4);
  assert.equal(effect.cardPatch.stage, 4);
  assert.equal(effect.cardPatch.intervalDays, 1);
  assert.equal(effect.cardPatch.repetitionCount, 0);
  assert.equal(
    effect.cardPatch.nextReviewAt.toISOString(),
    '2026-09-24T09:00:00.000Z'
  );
  assert.equal(effect.cardStatePatch.verified, false);
  assert.equal(effect.cardStatePatch.verifiedAt, null);
  assert.equal(effect.cardStatePatch.state, 'STUCK');
});

test('unresolved evidence never demotes below stage one and preserves a more severe existing risk state', () => {
  const effect = buildEffect({
    source_card_id: 'card-dangerous',
    evidence_status: 'UNRESOLVED',
  }, {
    id: 'card-dangerous',
    stage: 1,
    next_review_at: new Date('2026-09-30T09:00:00.000Z'),
  }, {
    state: 'DANGEROUS',
    stage: 1,
    verified: false,
  }, { now: NOW });

  assert.equal(effect.stageAfter, 1);
  assert.equal(effect.cardStatePatch.state, 'DANGEROUS');
});

test('applyOnce is idempotent and leaves nonterminal evidence eligible for a later attempt', async () => {
  const evidence = [
    {
      id: 'e-clean',
      source_card_id: 'card-clean',
      evidence_status: 'RECOVERED',
      diagnostic_outcome: 'CORRECT',
      learning_effect_applied_at: null,
    },
    {
      id: 'e-unresolved',
      source_card_id: 'card-unresolved',
      evidence_status: 'UNRESOLVED',
      diagnostic_outcome: 'INCORRECT',
      learning_effect_applied_at: null,
    },
    {
      id: 'e-pending',
      source_card_id: 'card-pending',
      evidence_status: 'PROVISIONAL',
      diagnostic_outcome: 'CORRECT',
      learning_effect_applied_at: null,
    },
  ];
  const cards = new Map([
    ['card-clean', { id: 'card-clean', stage: 4, next_review_at: null }],
    ['card-unresolved', { id: 'card-unresolved', stage: 4, next_review_at: null }],
    ['card-pending', { id: 'card-pending', stage: 3, next_review_at: null }],
  ]);
  const states = new Map([
    ['card-clean', { state: 'STABLE', stage: 4, verified: false }],
    ['card-unresolved', { state: 'STABLE', stage: 4, verified: false }],
    ['card-pending', { state: 'GROWING', stage: 3, verified: false }],
  ]);

  let cardWrites = 0;
  let stateWrites = 0;
  const store = {
    async getCardForLearningEffect(_userId, cardId) {
      return cards.get(cardId) || null;
    },
    async getCardStateForLearningEffect(_userId, cardId) {
      return states.get(cardId) || null;
    },
    async saveCardLearningEffect(_userId, cardId, patch) {
      cardWrites += 1;
      const card = cards.get(cardId);
      if (patch.stage !== undefined) card.stage = patch.stage;
      if (patch.intervalDays !== undefined) card.interval_days = patch.intervalDays;
      if (patch.repetitionCount !== undefined) card.repetition_count = patch.repetitionCount;
      if (patch.nextReviewAt !== undefined) card.next_review_at = patch.nextReviewAt;
      return card;
    },
    async saveCardStateLearningEffect({ card, patch }) {
      stateWrites += 1;
      const state = states.get(card.id) || {};
      Object.assign(state, {
        ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.verified !== undefined ? { verified: patch.verified } : {}),
        ...(patch.verifiedAt !== undefined ? { verified_at: patch.verifiedAt } : {}),
      });
      states.set(card.id, state);
      return state;
    },
    async saveEvidence(evidenceId, patch) {
      const row = evidence.find((item) => item.id === evidenceId);
      if (patch.learningEffectAppliedAt !== undefined) {
        row.learning_effect_applied_at = patch.learningEffectAppliedAt;
      }
      return row;
    },
  };

  const engine = createLearningEffectsEngine({ clock: () => NOW });
  const first = await engine.applyOnce({
    reckoningId: 'reckoning-1',
    userId: 'user-1',
    evidence,
    store,
  });

  assert.equal(first.applied.length, 2);
  assert.equal(first.skipped.length, 1);
  assert.equal(first.skipped[0].reason, 'NON_TERMINAL_EVIDENCE');
  assert.ok(evidence[0].learning_effect_applied_at);
  assert.ok(evidence[1].learning_effect_applied_at);
  assert.equal(evidence[2].learning_effect_applied_at, null);
  assert.equal(cards.get('card-unresolved').stage, 3);

  const writesAfterFirst = { cardWrites, stateWrites };
  const second = await engine.applyOnce({
    reckoningId: 'reckoning-1',
    userId: 'user-1',
    evidence,
    store,
  });

  assert.equal(second.applied.length, 0);
  assert.equal(second.skipped.length, 3);
  assert.deepEqual({ cardWrites, stateWrites }, writesAfterFirst);
  assert.equal(cards.get('card-unresolved').stage, 3);
});
