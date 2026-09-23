'use strict';

const { EVIDENCE_STATUSES, RISK_LEVELS } = require('./constants');
const { createReckoningConfig } = require('./config');

function field(row, camel, snake, fallback = null) {
  if (row?.[camel] !== undefined) return row[camel];
  if (row?.[snake] !== undefined) return row[snake];
  return fallback;
}

function evidenceValue(row, scoring) {
  const status = String(field(row, 'evidenceStatus', 'evidence_status', EVIDENCE_STATUSES.UNTESTED));
  if (status === EVIDENCE_STATUSES.INVALIDATED) return null;
  if (status === EVIDENCE_STATUSES.PROVISIONAL ||
      status === EVIDENCE_STATUSES.CONFIRMATION_REQUIRED) {
    return scoring.provisionalValue;
  }
  if (status !== EVIDENCE_STATUSES.RECOVERED) return 0;

  const diagnostic = field(row, 'diagnosticOutcome', 'diagnostic_outcome');
  return diagnostic === 'CORRECT'
    ? scoring.recoveredCleanValue
    : scoring.recoveredRemediatedValue;
}

function createScoringEngine({ config = createReckoningConfig() } = {}) {
  function calculateRecovery({ evidence = [], questions = [], questionsUsed = null } = {}) {
    let totalRiskWeight = 0;
    let recoveredRiskWeight = 0;
    let unresolvedCriticalCount = 0;

    for (const row of evidence) {
      const status = String(field(row, 'evidenceStatus', 'evidence_status', EVIDENCE_STATUSES.UNTESTED));
      if (status === EVIDENCE_STATUSES.INVALIDATED) continue;

      const weight = Math.max(1, Number(field(row, 'riskScore', 'risk_score', 1)) || 1);
      const value = evidenceValue(row, config.scoring);
      totalRiskWeight += weight;
      recoveredRiskWeight += weight * (value || 0);

      const level = String(field(row, 'riskLevel', 'risk_level', RISK_LEVELS.SUPPORTING));
      if (level === RISK_LEVELS.CRITICAL && status !== EVIDENCE_STATUSES.RECOVERED) {
        unresolvedCriticalCount += 1;
      }
    }

    const answered = (questions || []).filter((question) => {
      const selected = field(question, 'selectedOption', 'selected_option');
      return selected != null && selected !== '';
    });
    const correct = answered.filter((question) => {
      const raw = field(question, 'isCorrect', 'is_correct', false);
      const bonus = field(question, 'bonusAwarded', 'bonus_awarded', false);
      return raw === true || bonus === true;
    }).length;

    const answeredCount = questionsUsed == null
      ? answered.length
      : Math.max(answered.length, Number(questionsUsed) || 0);
    const rawAccuracy = answered.length
      ? Number(((correct / answered.length) * 100).toFixed(2))
      : 0;
    const recoveryScore = totalRiskWeight
      ? Number(((recoveredRiskWeight / totalRiskWeight) * 100).toFixed(2))
      : 0;

    const minimumEvidenceSatisfied =
      answeredCount >= config.scoring.minAnsweredQuestions;
    const allCriticalRecovered = unresolvedCriticalCount === 0;
    const survived =
      allCriticalRecovered &&
      recoveryScore >= config.scoring.recoveryThreshold &&
      rawAccuracy >= config.scoring.rawAccuracyThreshold &&
      minimumEvidenceSatisfied;

    return Object.freeze({
      scoringVersion: config.scoringVersion,
      rawAccuracy,
      recoveryScore,
      totalRiskWeight: Number(totalRiskWeight.toFixed(2)),
      recoveredRiskWeight: Number(recoveredRiskWeight.toFixed(2)),
      unresolvedCriticalCount,
      allCriticalRecovered,
      answeredCount,
      minimumEvidenceSatisfied,
      survived,
      thresholds: Object.freeze({
        recoveryScore: config.scoring.recoveryThreshold,
        rawAccuracy: config.scoring.rawAccuracyThreshold,
        minimumAnswered: config.scoring.minAnsweredQuestions,
      }),
    });
  }

  return Object.freeze({
    name: 'reckoning-scoring-engine',
    version: config.scoringVersion,
    calculateRecovery,
  });
}

module.exports = {
  evidenceValue,
  createScoringEngine,
};
