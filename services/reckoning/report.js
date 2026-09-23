'use strict';

const { EVIDENCE_STATUSES, RISK_LEVELS } = require('./constants');

function sourceLabel(row = {}) {
  const snapshot = row.source_snapshot || row.sourceSnapshot || {};
  return String(
    snapshot.front_content ||
    snapshot.front ||
    snapshot.question ||
    snapshot.title ||
    row.concept_key ||
    row.conceptKey ||
    'Concept'
  ).trim();
}

function buildDiagnosticReport({
  evidence = [],
  recovery = {},
  learningEffects = {},
  subjectName = 'Subject',
} = {}) {
  const recovered = [];
  const unresolved = [];
  const controlDiscoveries = [];
  const originallyDistrusted = [];

  for (const row of evidence) {
    const label = sourceLabel(row);
    const riskLevel = row.risk_level || row.riskLevel || RISK_LEVELS.SUPPORTING;
    const status = row.evidence_status || row.evidenceStatus || EVIDENCE_STATUSES.UNTESTED;
    const originalState = row.original_card_state || row.originalCardState || null;

    if (riskLevel === RISK_LEVELS.CRITICAL || riskLevel === RISK_LEVELS.HIGH) {
      originallyDistrusted.push(Object.freeze({
        label,
        riskLevel,
        originalState,
        riskScore: Number(row.risk_score ?? row.riskScore) || 0,
      }));
    }

    if (status === EVIDENCE_STATUSES.RECOVERED) {
      recovered.push(Object.freeze({
        label,
        riskLevel,
        recoveredAfterRemediation:
          (row.diagnostic_outcome || row.diagnosticOutcome) === 'INCORRECT' ||
          (row.challenge_outcome || row.challengeOutcome) != null,
      }));
    } else if (status === EVIDENCE_STATUSES.UNRESOLVED) {
      unresolved.push(Object.freeze({ label, riskLevel }));
    }

    if (row.discovered_by_control === true || row.discoveredByControl === true) {
      controlDiscoveries.push(Object.freeze({
        label,
        status,
      }));
    }
  }

  const effects = Array.isArray(learningEffects?.applied) ? learningEffects.applied : [];
  const changes = effects.map((effect) => Object.freeze({
    sourceCardId: effect.sourceCardId || null,
    type: effect.type,
    stageBefore: effect.stageBefore ?? null,
    stageAfter: effect.stageAfter ?? null,
    nextReviewAt: effect.reviewAt || effect.cardPatch?.nextReviewAt || null,
    verificationRevoked: effect.verificationRevoked === true,
  }));

  return Object.freeze({
    subjectName,
    survived: recovery.survived === true,
    rawAccuracy: Number(recovery.rawAccuracy) || 0,
    recoveryScore: Number(recovery.recoveryScore) || 0,
    criticalRemaining: Number(recovery.unresolvedCriticalCount) || 0,
    originallyDistrusted: Object.freeze(originallyDistrusted),
    recovered: Object.freeze(recovered),
    unresolved: Object.freeze(unresolved),
    controlDiscoveries: Object.freeze(controlDiscoveries),
    learningChanges: Object.freeze(changes),
    nextStep: unresolved.length
      ? 'Unresolved concepts have been returned to urgent review. Recover those before relying on this subject under exam pressure.'
      : 'Recovered material stays in normal spaced review. Reckoning survival does not grant automatic mastery or verification.',
  });
}

module.exports = {
  sourceLabel,
  buildDiagnosticReport,
};
