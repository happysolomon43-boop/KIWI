'use strict';

const { createReckoningConfig } = require('./config');
const { createRiskEngine } = require('./risk-engine');
const { createPlanner } = require('./planner');
const { createReckoningStore } = require('./store');

function daysBetween(from, to) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86400000);
}

function fsrsRetrievability(card, nowMs) {
  const stability = Number(card?.fsrs_stability);
  if (!Number.isFinite(stability) || stability <= 0 || !card?.last_reviewed_at) return null;
  const elapsed = Math.max(
    0,
    (nowMs - new Date(card.last_reviewed_at).getTime()) / 86400000
  );
  if (!Number.isFinite(elapsed)) return null;
  return Math.pow(0.9, elapsed / stability);
}

function createShadowIntelligence({
  query,
  randomUUID,
  logger = console,
  config = createReckoningConfig(),
  clock = () => Date.now(),
} = {}) {
  const riskEngine = createRiskEngine({ config, clock });
  const planner = createPlanner({ config, riskEngine });
  const store = createReckoningStore({ query, randomUUID });

  async function loadMetrics(userId, cards, nowMs) {
    const cardIds = (cards || []).map((card) => card?.id).filter(Boolean);
    const metrics = Object.fromEntries(cardIds.map((id) => [
      String(id),
      {
        retrievability: fsrsRetrievability(
          cards.find((card) => String(card.id) === String(id)),
          nowMs
        ),
        recentAgainHard: 0,
        recentExamMisses: 0,
      },
    ]));

    if (!cardIds.length || typeof query !== 'function') return metrics;

    const reviewSince = new Date(nowMs - 30 * 86400000);
    const examSince = new Date(nowMs - 90 * 86400000);

    const [reviewResult, examResult] = await Promise.all([
      query(
        `SELECT card_id,
                COUNT(*) FILTER (
                  WHERE LOWER(COALESCE(response, '')) IN ('again','hard')
                )::int AS recent_again_hard
         FROM review_logs
         WHERE user_id = $1
           AND card_id = ANY($2::text[])
           AND reviewed_at >= $3
         GROUP BY card_id`,
        [userId, cardIds, reviewSince]
      ),
      query(
        `SELECT card_id,
                COUNT(*) FILTER (WHERE is_correct = false)::int AS recent_exam_misses
         FROM exam_questions
         WHERE user_id = $1
           AND card_id = ANY($2::text[])
           AND created_at >= $3
           AND is_correct IS NOT NULL
         GROUP BY card_id`,
        [userId, cardIds, examSince]
      ),
    ]);

    for (const row of reviewResult?.rows || []) {
      if (!metrics[String(row.card_id)]) continue;
      metrics[String(row.card_id)].recentAgainHard =
        Number(row.recent_again_hard) || 0;
    }
    for (const row of examResult?.rows || []) {
      if (!metrics[String(row.card_id)]) continue;
      metrics[String(row.card_id)].recentExamMisses =
        Number(row.recent_exam_misses) || 0;
    }

    return metrics;
  }

  async function analyzeAndPersist({
    reckoning,
    userId,
    subjectId,
    cards = [],
    states = [],
    bubbleCardIds = [],
    pressureScore = 0,
    subjectExamDate = null,
    now = null,
  } = {}) {
    if (!reckoning?.id) throw new Error('Shadow analysis requires a Reckoning session.');
    if (!userId) throw new Error('Shadow analysis requires userId.');

    const nowMs = now == null ? Number(clock()) || Date.now() : new Date(now).getTime();
    const metricsByCardId = await loadMetrics(userId, cards, nowMs);
    const daysToExam = subjectExamDate
      ? daysBetween(new Date(nowMs), subjectExamDate)
      : null;

    const plan = planner.buildPlan({
      cards,
      states,
      bubbleCardIds,
      metricsByCardId,
      context: {
        subjectId,
        pressureScore,
        daysToExam,
      },
      now: new Date(nowMs),
    });

    await Promise.all(
      plan.evidence.map((evidence) => store.upsertEvidence({
        reckoningId: reckoning.id,
        userId,
        subjectId,
        sourceCardId: evidence.sourceCardId,
        conceptKey: evidence.conceptKey,
        sourceSnapshot: evidence.sourceSnapshot,
        sourceHash: evidence.sourceHash,
        originalCardState: evidence.originalCardState,
        riskScore: evidence.riskScore,
        riskLevel: evidence.riskLevel,
        riskReasons: evidence.riskReasons,
        isBubbleCritical: evidence.isBubbleCritical,
        hasLearningDebt: evidence.hasLearningDebt,
        discoveredByControl: false,
        evidenceStatus: 'UNTESTED',
        requiredConfirmations: evidence.requiredConfirmations,
      }))
    );

    await store.saveSession(reckoning.id, {
      engineMode: 'SHADOW',
      softQuestionBudget: plan.softQuestionBudget,
      hardQuestionCap: plan.hardQuestionCap,
      stateVersion: (Number(reckoning.state_version) || 0) + 1,
      plannerVersion: config.plannerVersion,
      configVersion: config.configVersion,
    });

    return plan;
  }

  async function analyzeSafely(input) {
    try {
      return await analyzeAndPersist(input);
    } catch (error) {
      logger?.warn?.('[KIWI Reckoning V2] shadow analysis failed; legacy Reckoning continues', {
        reckoningId: input?.reckoning?.id || null,
        error: error?.message || String(error),
      });
      return null;
    }
  }

  return Object.freeze({
    name: 'reckoning-shadow-intelligence',
    mode: 'SHADOW',
    config,
    riskEngine,
    planner,
    store,
    loadMetrics,
    analyzeAndPersist,
    analyzeSafely,
  });
}

module.exports = {
  daysBetween,
  fsrsRetrievability,
  createShadowIntelligence,
};
