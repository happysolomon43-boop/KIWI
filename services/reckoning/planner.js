'use strict';

const crypto = require('node:crypto');
const { RISK_LEVELS } = require('./constants');
const { createReckoningConfig } = require('./config');
const { createRiskEngine } = require('./risk-engine');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableRiskSort(a, b) {
  if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
  return String(a.sourceCardId).localeCompare(String(b.sourceCardId));
}

function snapshotCard(card = {}) {
  const snapshot = {};
  for (const key of [
    'id', 'front', 'back', 'front_content', 'back_content', 'question', 'answer', 'title', 'content',
    'deck_id', 'subject_id', 'stage', 'verified', 'fsrs_stability',
    'fsrs_difficulty', 'next_review_at', 'last_reviewed_at',
  ]) {
    if (card[key] !== undefined) snapshot[key] = card[key];
  }
  return snapshot;
}

function hashSnapshot(snapshot) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
}

function createPlanner({
  config = createReckoningConfig(),
  riskEngine = createRiskEngine({ config }),
} = {}) {
  const plannerConfig = config.planner;

  function buildPlan({
    cards = [],
    states = [],
    bubbleCardIds = [],
    metricsByCardId = {},
    context = {},
    now = null,
  } = {}) {
    const stateMap = new Map((states || []).map((row) => [String(row.card_id || row.id), row]));
    const bubbleSet = new Set((bubbleCardIds || []).map(String));

    const candidates = (cards || [])
      .filter((card) => card?.id)
      .map((card) => {
        const sourceCardId = String(card.id);
        const stateDoc = stateMap.get(sourceCardId) || {};
        const metrics = metricsByCardId[sourceCardId] || metricsByCardId[card.id] || {};
        const risk = riskEngine.score({
          card,
          stateDoc,
          isBubbleCritical: bubbleSet.has(sourceCardId),
          hasLearningDebt: Boolean(stateDoc.learning_debt),
          daysToExam: context.daysToExam,
          ...metrics,
        }, { now });

        const sourceSnapshot = snapshotCard(card);
        return Object.freeze({
          sourceCardId,
          conceptKey: `card:${sourceCardId}`,
          sourceSnapshot,
          sourceHash: hashSnapshot(sourceSnapshot),
          originalCardState: risk.state,
          riskScore: risk.score,
          riskLevel: risk.level,
          riskReasons: risk.reasons,
          isBubbleCritical: bubbleSet.has(sourceCardId),
          hasLearningDebt: Boolean(stateDoc.learning_debt),
          requiredConfirmations: risk.level === RISK_LEVELS.CRITICAL ? 1 : 0,
        });
      })
      .sort(stableRiskSort);

    const critical = candidates.filter((item) => item.riskLevel === RISK_LEVELS.CRITICAL);
    const high = candidates.filter((item) => item.riskLevel === RISK_LEVELS.HIGH);
    const healthy = candidates.filter((item) => item.riskLevel === RISK_LEVELS.SUPPORTING);

    const weak = [...critical, ...high];
    const selected = [...weak];
    const selectedIds = new Set(selected.map((item) => item.sourceCardId));

    const minimumNeeded = Math.max(
      0,
      plannerConfig.minEvidenceUnits - selected.length
    );
    const supporting = healthy
      .filter((item) => !selectedIds.has(item.sourceCardId))
      .slice(0, Math.min(plannerConfig.maxSupportingUnits, minimumNeeded));

    for (const item of supporting) selectedIds.add(item.sourceCardId);

    const desiredControls = healthy.length
      ? clamp(
          Math.round(Math.max(1, weak.length) * plannerConfig.controlSampleRatio),
          plannerConfig.minControls,
          plannerConfig.maxControls
        )
      : 0;

    const controls = healthy
      .filter((item) => !selectedIds.has(item.sourceCardId))
      .slice(-desiredControls)
      .reverse();

    const allEvidence = [...critical, ...high, ...supporting].sort(stableRiskSort);
    const criticalCount = critical.length;
    const highCount = high.length;
    const initialEvidenceQuestions =
      (criticalCount * 2) +
      highCount +
      supporting.length +
      controls.length;
    const challengeReserve = criticalCount + Math.ceil(highCount * 0.5);

    const softQuestionBudget = clamp(
      Math.max(plannerConfig.minQuestionBudget, initialEvidenceQuestions + challengeReserve),
      plannerConfig.minQuestionBudget,
      plannerConfig.softQuestionCap
    );

    return Object.freeze({
      plannerVersion: config.plannerVersion,
      riskModelVersion: riskEngine.version,
      mode: 'SHADOW',
      context: Object.freeze({
        subjectId: context.subjectId || null,
        pressureScore: Number(context.pressureScore) || 0,
        daysToExam: context.daysToExam ?? null,
      }),
      critical: Object.freeze(critical),
      high: Object.freeze(high),
      supporting: Object.freeze(supporting),
      controls: Object.freeze(controls),
      evidence: Object.freeze(allEvidence),
      softQuestionBudget,
      hardQuestionCap: plannerConfig.hardQuestionCap,
      counts: Object.freeze({
        totalCards: candidates.length,
        critical: critical.length,
        high: high.length,
        supporting: supporting.length,
        controls: controls.length,
        evidence: allEvidence.length,
      }),
    });
  }

  return Object.freeze({
    name: 'reckoning-planner',
    version: config.plannerVersion,
    buildPlan,
  });
}

module.exports = {
  snapshotCard,
  hashSnapshot,
  stableRiskSort,
  createPlanner,
};