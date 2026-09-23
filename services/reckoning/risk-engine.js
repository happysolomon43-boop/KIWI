'use strict';

const { RISK_LEVELS } = require('./constants');
const { createReckoningConfig } = require('./config');

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function daysOverdue(nextReviewAt, nowMs) {
  if (!nextReviewAt) return null;
  const due = new Date(nextReviewAt).getTime();
  if (!Number.isFinite(due)) return null;
  return Math.max(0, Math.floor((nowMs - due) / 86400000));
}

function addReason(reasons, code, weight, detail = null) {
  if (!weight) return;
  reasons.push(Object.freeze({ code, weight, detail }));
}

function createRiskEngine({ config = createReckoningConfig(), clock = () => Date.now() } = {}) {
  const riskConfig = config.risk;

  function score(input = {}, { now = null } = {}) {
    const card = input.card || {};
    const stateDoc = input.stateDoc || input.cardState || {};
    const state = String(
      input.state ||
      stateDoc.state ||
      card.state ||
      'GROWING'
    ).toUpperCase();

    const reasons = [];
    const base = Number(riskConfig.baseByState[state] ?? 35);
    let total = base;
    addReason(reasons, `STATE_${state}`, base, 'base');

    const bubbleCritical = Boolean(
      input.isBubbleCritical ??
      input.bubbleCritical ??
      stateDoc.bubble_critical
    );
    if (bubbleCritical) {
      total += riskConfig.modifiers.bubbleCritical;
      addReason(reasons, 'BUBBLE_CRITICAL', riskConfig.modifiers.bubbleCritical);
    }

    const learningDebt = Boolean(
      input.hasLearningDebt ??
      input.learningDebt ??
      stateDoc.learning_debt
    );
    if (learningDebt) {
      total += riskConfig.modifiers.learningDebt;
      addReason(reasons, 'LEARNING_DEBT', riskConfig.modifiers.learningDebt);
    }

    const verified = input.verified ?? stateDoc.verified ?? card.verified;
    if (verified === false) {
      total += riskConfig.modifiers.unverified;
      addReason(reasons, 'UNVERIFIED', riskConfig.modifiers.unverified);
    }

    const retrievability = finiteOrNull(
      input.retrievability ??
      input.fsrsRetrievability ??
      stateDoc.retrievability
    );
    if (retrievability != null) {
      if (retrievability < 0.6) {
        total += riskConfig.modifiers.retrievabilityLow;
        addReason(reasons, 'LOW_RETRIEVABILITY', riskConfig.modifiers.retrievabilityLow, retrievability);
      } else if (retrievability < 0.75) {
        total += riskConfig.modifiers.retrievabilityMedium;
        addReason(reasons, 'MEDIUM_RETRIEVABILITY', riskConfig.modifiers.retrievabilityMedium, retrievability);
      }
    }

    const stability = finiteOrNull(
      input.stability ??
      input.fsrsStability ??
      card.fsrs_stability ??
      stateDoc.fsrs_stability
    );
    if (stability != null) {
      if (stability <= 1) {
        total += riskConfig.modifiers.stabilityVeryLow;
        addReason(reasons, 'VERY_LOW_STABILITY', riskConfig.modifiers.stabilityVeryLow, stability);
      } else if (stability <= 3) {
        total += riskConfig.modifiers.stabilityLow;
        addReason(reasons, 'LOW_STABILITY', riskConfig.modifiers.stabilityLow, stability);
      }
    }

    const nowMs = now == null
      ? Number(clock()) || Date.now()
      : new Date(now).getTime();
    const overdue = finiteOrNull(
      input.daysOverdue ??
      daysOverdue(card.next_review_at ?? stateDoc.next_review_at, nowMs)
    );
    if (overdue != null) {
      if (overdue >= 20) {
        total += riskConfig.modifiers.overdueSevere;
        addReason(reasons, 'SEVERELY_OVERDUE', riskConfig.modifiers.overdueSevere, overdue);
      } else if (overdue >= 7) {
        total += riskConfig.modifiers.overdueModerate;
        addReason(reasons, 'OVERDUE', riskConfig.modifiers.overdueModerate, overdue);
      }
    }

    const daysToExam = finiteOrNull(input.daysToExam);
    if (daysToExam != null && daysToExam >= 0) {
      if (daysToExam <= 7) {
        total += riskConfig.modifiers.examProximityImmediate;
        addReason(reasons, 'EXAM_WITHIN_7_DAYS', riskConfig.modifiers.examProximityImmediate, daysToExam);
      } else if (daysToExam <= 14) {
        total += riskConfig.modifiers.examProximityNear;
        addReason(reasons, 'EXAM_WITHIN_14_DAYS', riskConfig.modifiers.examProximityNear, daysToExam);
      }
    }

    const examMisses = Math.max(0, Number(input.recentExamMisses) || 0);
    const examMissWeight = Math.min(
      riskConfig.modifiers.recentExamMissCap,
      examMisses * riskConfig.modifiers.recentExamMissEach
    );
    if (examMissWeight) {
      total += examMissWeight;
      addReason(reasons, 'RECENT_EXAM_MISSES', examMissWeight, examMisses);
    }

    const hardAgain = Math.max(
      0,
      Number(input.recentAgainHard ?? input.recentHardAgainCount) || 0
    );
    const hardAgainWeight = Math.min(
      riskConfig.modifiers.recentAgainHardCap,
      hardAgain * riskConfig.modifiers.recentAgainHardEach
    );
    if (hardAgainWeight) {
      total += hardAgainWeight;
      addReason(reasons, 'RECENT_AGAIN_HARD', hardAgainWeight, hardAgain);
    }

    const riskScore = clamp(total);
    const riskLevel =
      riskScore >= riskConfig.criticalThreshold ? RISK_LEVELS.CRITICAL :
      riskScore >= riskConfig.highThreshold ? RISK_LEVELS.HIGH :
      RISK_LEVELS.SUPPORTING;

    return Object.freeze({
      modelVersion: config.riskModelVersion,
      state,
      score: riskScore,
      level: riskLevel,
      reasons: Object.freeze(reasons),
    });
  }

  return Object.freeze({
    name: 'reckoning-risk-engine',
    version: config.riskModelVersion,
    levels: RISK_LEVELS,
    score,
  });
}

module.exports = {
  clamp,
  createRiskEngine,
};
