'use strict';

const { EVIDENCE_STATUSES } = require('./constants');
const { createReckoningConfig } = require('./config');
const { ReckoningContractError } = require('./errors');

const EFFECT_TYPES = Object.freeze({
  CLEAN_RECOVERED: 'CLEAN_RECOVERED',
  REMEDIATED_RECOVERED: 'REMEDIATED_RECOVERED',
  UNRESOLVED: 'UNRESOLVED',
  NO_FINAL_EFFECT: 'NO_FINAL_EFFECT',
  SOURCE_MISSING: 'SOURCE_MISSING',
});

const PRESERVED_RISK_STATES = new Set([
  'DANGEROUS',
  'GHOST',
  'STUCK',
  'AVOIDED',
]);

function field(row, camel, snake, fallback = null) {
  if (row?.[camel] !== undefined) return row[camel];
  if (row?.[snake] !== undefined) return row[snake];
  return fallback;
}

function earlierDate(existing, target) {
  const targetDate = new Date(target);
  const existingMs = existing ? new Date(existing).getTime() : NaN;
  if (Number.isFinite(existingMs) && existingMs <= targetDate.getTime()) {
    return new Date(existingMs);
  }
  return targetDate;
}

function wasRemediated(evidence = {}) {
  return (
    field(evidence, 'diagnosticOutcome', 'diagnostic_outcome') === 'INCORRECT' ||
    field(evidence, 'challengeOutcome', 'challenge_outcome') != null ||
    Boolean(field(evidence, 'discoveredByControl', 'discovered_by_control', false))
  );
}

function buildEffect(evidence, card, cardState, {
  config = createReckoningConfig(),
  now = new Date(),
} = {}) {
  const status = String(
    field(evidence, 'evidenceStatus', 'evidence_status', EVIDENCE_STATUSES.UNTESTED)
  );
  const sourceCardId = field(evidence, 'sourceCardId', 'source_card_id');

  if (!sourceCardId || !card) {
    return Object.freeze({
      type: EFFECT_TYPES.SOURCE_MISSING,
      sourceCardId: sourceCardId || null,
      cardPatch: Object.freeze({}),
      cardStatePatch: Object.freeze({}),
    });
  }

  if (status === EVIDENCE_STATUSES.RECOVERED && !wasRemediated(evidence)) {
    return Object.freeze({
      type: EFFECT_TYPES.CLEAN_RECOVERED,
      sourceCardId,
      stageBefore: Number(card.stage) || 1,
      stageAfter: Number(card.stage) || 1,
      cardPatch: Object.freeze({}),
      cardStatePatch: Object.freeze({}),
    });
  }

  if (status === EVIDENCE_STATUSES.RECOVERED) {
    const reviewAt = earlierDate(
      card.next_review_at,
      new Date(now.getTime() + config.learningEffects.remediatedReviewDays * 86400000)
    );
    const stateWasVerified =
      cardState?.verified === true || String(cardState?.state || '') === 'VERIFIED';
    const statePatch = stateWasVerified
      ? {
          verified: false,
          verifiedAt: null,
          state: Number(card.stage) >= 5 ? 'FRAGILE' : cardState?.state,
          lastEvaluatedAt: now,
        }
      : {};

    return Object.freeze({
      type: EFFECT_TYPES.REMEDIATED_RECOVERED,
      sourceCardId,
      stageBefore: Number(card.stage) || 1,
      stageAfter: Number(card.stage) || 1,
      reviewAt,
      verificationRevoked: stateWasVerified,
      cardPatch: Object.freeze({ nextReviewAt: reviewAt }),
      cardStatePatch: Object.freeze(statePatch),
    });
  }

  if (status === EVIDENCE_STATUSES.UNRESOLVED) {
    const stageBefore = Math.max(
      config.learningEffects.minimumStage,
      Number(card.stage) || config.learningEffects.minimumStage
    );
    const stageAfter = Math.max(
      config.learningEffects.minimumStage,
      stageBefore - 1
    );
    const reviewAt = earlierDate(
      card.next_review_at,
      new Date(now.getTime() + config.learningEffects.unresolvedReviewDays * 86400000)
    );
    const currentState = String(cardState?.state || '');
    const nextState = PRESERVED_RISK_STATES.has(currentState)
      ? currentState
      : 'STUCK';

    return Object.freeze({
      type: EFFECT_TYPES.UNRESOLVED,
      sourceCardId,
      stageBefore,
      stageAfter,
      reviewAt,
      verificationRevoked:
        cardState?.verified === true || currentState === 'VERIFIED',
      cardPatch: Object.freeze({
        stage: stageAfter,
        intervalDays: 1,
        repetitionCount: 0,
        nextReviewAt: reviewAt,
      }),
      cardStatePatch: Object.freeze({
        stage: stageAfter,
        state: nextState,
        verified: false,
        verifiedAt: null,
        lastEvaluatedAt: now,
      }),
    });
  }

  return Object.freeze({
    type: EFFECT_TYPES.NO_FINAL_EFFECT,
    sourceCardId,
    stageBefore: Number(card.stage) || 1,
    stageAfter: Number(card.stage) || 1,
    cardPatch: Object.freeze({}),
    cardStatePatch: Object.freeze({}),
  });
}

function createLearningEffectsEngine({
  config = createReckoningConfig(),
  clock = () => new Date(),
} = {}) {
  function buildEffects({
    evidence = [],
    cardsById = new Map(),
    statesByCardId = new Map(),
  } = {}) {
    const now = clock();
    return Object.freeze(
      evidence.map((row) => {
        const cardId = field(row, 'sourceCardId', 'source_card_id');
        return buildEffect(
          row,
          cardId ? cardsById.get(String(cardId)) || null : null,
          cardId ? statesByCardId.get(String(cardId)) || null : null,
          { config, now }
        );
      })
    );
  }

  async function applyOnce({
    reckoningId,
    userId,
    evidence = [],
    store,
  } = {}) {
    if (!reckoningId || !userId || !store) {
      throw new ReckoningContractError(
        'learningEffects.applyOnce requires reckoningId, userId and store.'
      );
    }

    const now = clock();
    const applied = [];
    const skipped = [];

    for (const row of evidence) {
      if (field(row, 'learningEffectAppliedAt', 'learning_effect_applied_at')) {
        skipped.push(Object.freeze({
          evidenceId: row.id,
          sourceCardId: field(row, 'sourceCardId', 'source_card_id'),
          reason: 'ALREADY_APPLIED',
        }));
        continue;
      }

      const status = String(
        field(row, 'evidenceStatus', 'evidence_status', EVIDENCE_STATUSES.UNTESTED)
      );
      if (![
        EVIDENCE_STATUSES.RECOVERED,
        EVIDENCE_STATUSES.UNRESOLVED,
        EVIDENCE_STATUSES.INVALIDATED,
      ].includes(status)) {
        skipped.push(Object.freeze({
          evidenceId: row.id,
          sourceCardId: field(row, 'sourceCardId', 'source_card_id'),
          reason: 'NON_TERMINAL_EVIDENCE',
        }));
        continue;
      }

      const cardId = field(row, 'sourceCardId', 'source_card_id');
      const card = cardId
        ? await store.getCardForLearningEffect(userId, cardId, { forUpdate: true })
        : null;
      const cardState = cardId
        ? await store.getCardStateForLearningEffect(userId, cardId, { forUpdate: true })
        : null;
      const effect = buildEffect(row, card, cardState, { config, now });

      if (card && Object.keys(effect.cardPatch).length) {
        await store.saveCardLearningEffect(userId, card.id, effect.cardPatch);
      }

      if (card && Object.keys(effect.cardStatePatch).length) {
        await store.saveCardStateLearningEffect({
          userId,
          card,
          evidence: row,
          patch: effect.cardStatePatch,
        });
      }

      // The timestamp is written in the same transaction as card changes. A
      // rollback therefore releases the claim; a retry after commit cannot
      // demote/reschedule the same card a second time.
      await store.saveEvidence(row.id, {
        learningEffectAppliedAt: now,
      });

      applied.push(Object.freeze({
        evidenceId: row.id,
        ...effect,
      }));
    }

    return Object.freeze({
      version: config.learningEffectsVersion,
      applied: Object.freeze(applied),
      skipped: Object.freeze(skipped),
    });
  }

  return Object.freeze({
    name: 'reckoning-learning-effects-engine',
    version: config.learningEffectsVersion,
    effectTypes: EFFECT_TYPES,
    buildEffects,
    applyOnce,
  });
}

module.exports = {
  EFFECT_TYPES,
  earlierDate,
  wasRemediated,
  buildEffect,
  createLearningEffectsEngine,
};