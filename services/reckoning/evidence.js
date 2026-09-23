'use strict';

const { EVIDENCE_STATUSES, QUESTION_ROLES, RISK_LEVELS } = require('./constants');
const { createReckoningConfig } = require('./config');
const { ReckoningContractError } = require('./errors');

function value(row, camel, snake, fallback = null) {
  if (row?.[camel] !== undefined) return row[camel];
  if (row?.[snake] !== undefined) return row[snake];
  return fallback;
}

function normalizeEvidence(row = {}) {
  return {
    id: row.id || null,
    riskLevel: String(value(row, 'riskLevel', 'risk_level', RISK_LEVELS.SUPPORTING)),
    evidenceStatus: String(value(row, 'evidenceStatus', 'evidence_status', EVIDENCE_STATUSES.UNTESTED)),
    diagnosticOutcome: value(row, 'diagnosticOutcome', 'diagnostic_outcome'),
    challengeOutcome: value(row, 'challengeOutcome', 'challenge_outcome'),
    confirmationOutcome: value(row, 'confirmationOutcome', 'confirmation_outcome'),
    attemptCount: Number(value(row, 'attemptCount', 'attempt_count', 0)) || 0,
    successfulDemonstrations: Number(
      value(row, 'successfulDemonstrations', 'successful_demonstrations', 0)
    ) || 0,
    requiredConfirmations: Number(
      value(row, 'requiredConfirmations', 'required_confirmations', 0)
    ) || 0,
    questionsSeen: Number(value(row, 'questionsSeen', 'questions_seen', 0)) || 0,
    discoveredByControl: Boolean(
      value(row, 'discoveredByControl', 'discovered_by_control', false)
    ),
  };
}

function revisitAt(questionOrdinal, spacingQuestions) {
  return Math.max(0, Number(questionOrdinal) || 0) + Math.max(0, Number(spacingQuestions) || 0) + 1;
}

function createEvidenceEngine({ config = createReckoningConfig(), clock = () => new Date() } = {}) {
  function record(row, {
    role,
    isCorrect,
    questionOrdinal,
  } = {}) {
    const evidence = normalizeEvidence(row);
    const normalizedRole = String(role || '').toUpperCase();
    if (!Object.values(QUESTION_ROLES).includes(normalizedRole)) {
      throw new ReckoningContractError(`Unsupported Reckoning question role: ${role}`);
    }

    if ([
      EVIDENCE_STATUSES.RECOVERED,
      EVIDENCE_STATUSES.UNRESOLVED,
      EVIDENCE_STATUSES.INVALIDATED,
    ].includes(evidence.evidenceStatus)) {
      throw new ReckoningContractError(
        `Evidence ${evidence.id || ''} is already terminal: ${evidence.evidenceStatus}`
      );
    }

    const outcome = isCorrect ? 'CORRECT' : 'INCORRECT';
    const patch = {
      attemptCount: evidence.attemptCount + 1,
      questionsSeen: evidence.questionsSeen + 1,
      successfulDemonstrations:
        evidence.successfulDemonstrations + (isCorrect ? 1 : 0),
      lastQuestionRole: normalizedRole,
    };
    const spacing = config.execution.unrelatedSpacingQuestions;

    if (normalizedRole === QUESTION_ROLES.DIAGNOSTIC) {
      patch.diagnosticOutcome = outcome;

      if (isCorrect) {
        if (evidence.riskLevel === RISK_LEVELS.CRITICAL) {
          patch.evidenceStatus = EVIDENCE_STATUSES.PROVISIONAL;
          patch.requiredConfirmations = Math.max(1, evidence.requiredConfirmations);
          patch.nextEligibleQuestion = revisitAt(questionOrdinal, spacing);
        } else {
          patch.evidenceStatus = EVIDENCE_STATUSES.RECOVERED;
          patch.resolvedAt = clock();
        }
      } else {
        patch.evidenceStatus = EVIDENCE_STATUSES.CHALLENGE_REQUIRED;
        if (evidence.riskLevel === RISK_LEVELS.SUPPORTING) {
          patch.riskLevel = RISK_LEVELS.HIGH;
        }
        patch.nextEligibleQuestion = revisitAt(questionOrdinal, spacing);
      }
    } else if (normalizedRole === QUESTION_ROLES.CONTROL) {
      if (isCorrect) {
        patch.evidenceStatus = EVIDENCE_STATUSES.RECOVERED;
        patch.resolvedAt = clock();
      } else {
        patch.discoveredByControl = true;
        patch.riskLevel = RISK_LEVELS.HIGH;
        patch.evidenceStatus = EVIDENCE_STATUSES.CHALLENGE_REQUIRED;
        patch.nextEligibleQuestion = revisitAt(questionOrdinal, spacing);
      }
    } else if (normalizedRole === QUESTION_ROLES.CHALLENGE) {
      patch.challengeOutcome = outcome;

      if (!isCorrect) {
        patch.evidenceStatus = EVIDENCE_STATUSES.UNRESOLVED;
        patch.resolvedAt = clock();
      } else if (evidence.riskLevel === RISK_LEVELS.CRITICAL) {
        patch.evidenceStatus = EVIDENCE_STATUSES.CONFIRMATION_REQUIRED;
        patch.requiredConfirmations = Math.max(1, evidence.requiredConfirmations);
        patch.nextEligibleQuestion = revisitAt(questionOrdinal, spacing);
      } else {
        patch.evidenceStatus = EVIDENCE_STATUSES.RECOVERED;
        patch.resolvedAt = clock();
      }
    } else if (normalizedRole === QUESTION_ROLES.CONFIRMATION) {
      patch.confirmationOutcome = outcome;
      patch.evidenceStatus = isCorrect
        ? EVIDENCE_STATUSES.RECOVERED
        : EVIDENCE_STATUSES.UNRESOLVED;
      patch.resolvedAt = clock();
    }

    return Object.freeze({
      outcome,
      role: normalizedRole,
      patch: Object.freeze(patch),
      evidenceModelVersion: config.evidenceModelVersion,
    });
  }

  function evaluate(rows = []) {
    const normalized = rows.map(normalizeEvidence);
    const count = (status) =>
      normalized.filter((item) => item.evidenceStatus === status).length;

    return Object.freeze({
      total: normalized.length,
      recovered: count(EVIDENCE_STATUSES.RECOVERED),
      unresolved: count(EVIDENCE_STATUSES.UNRESOLVED),
      provisional: count(EVIDENCE_STATUSES.PROVISIONAL),
      challengeRequired: count(EVIDENCE_STATUSES.CHALLENGE_REQUIRED),
      confirmationRequired: count(EVIDENCE_STATUSES.CONFIRMATION_REQUIRED),
      untested: count(EVIDENCE_STATUSES.UNTESTED),
      criticalUnresolved: normalized.filter(
        (item) =>
          item.riskLevel === RISK_LEVELS.CRITICAL &&
          item.evidenceStatus !== EVIDENCE_STATUSES.RECOVERED &&
          item.evidenceStatus !== EVIDENCE_STATUSES.INVALIDATED
      ).length,
    });
  }

  return Object.freeze({
    name: 'reckoning-evidence-engine',
    version: config.evidenceModelVersion,
    statuses: EVIDENCE_STATUSES,
    record,
    evaluate,
  });
}

module.exports = {
  normalizeEvidence,
  revisitAt,
  createEvidenceEngine,
};
