'use strict';

const { EVIDENCE_STATUSES, QUESTION_ROLES } = require('./constants');
const { createReckoningConfig } = require('./config');

function field(row, camel, snake, fallback = null) {
  if (row?.[camel] !== undefined) return row[camel];
  if (row?.[snake] !== undefined) return row[snake];
  return fallback;
}

function roleForEvidence(evidence, questions) {
  const status = String(field(evidence, 'evidenceStatus', 'evidence_status', EVIDENCE_STATUSES.UNTESTED));
  if (status === EVIDENCE_STATUSES.CHALLENGE_REQUIRED) return QUESTION_ROLES.CHALLENGE;
  if (
    status === EVIDENCE_STATUSES.PROVISIONAL ||
    status === EVIDENCE_STATUSES.CONFIRMATION_REQUIRED
  ) {
    return QUESTION_ROLES.CONFIRMATION;
  }
  if (status !== EVIDENCE_STATUSES.UNTESTED) return null;

  const evidenceId = String(evidence.id || '');
  const availableRoles = new Set(
    questions
      .filter((question) => String(field(question, 'evidenceId', 'reckoning_evidence_id', '')) === evidenceId)
      .map((question) => String(field(question, 'role', 'reckoning_role', '')))
  );
  return availableRoles.has(QUESTION_ROLES.DIAGNOSTIC)
    ? QUESTION_ROLES.DIAGNOSTIC
    : availableRoles.has(QUESTION_ROLES.CONTROL)
      ? QUESTION_ROLES.CONTROL
      : null;
}

function candidateScore({ evidence, role, lastEvidenceId, controlDue }) {
  const risk = Number(field(evidence, 'riskScore', 'risk_score', 0)) || 0;
  const status = String(field(evidence, 'evidenceStatus', 'evidence_status', EVIDENCE_STATUSES.UNTESTED));
  let score = risk;

  if (status === EVIDENCE_STATUSES.CHALLENGE_REQUIRED) score += 24;
  if (
    status === EVIDENCE_STATUSES.PROVISIONAL ||
    status === EVIDENCE_STATUSES.CONFIRMATION_REQUIRED
  ) score += 18;
  if (role === QUESTION_ROLES.CONTROL) score += controlDue ? 50 : -20;
  if (String(evidence.id) === String(lastEvidenceId || '')) score -= 40;

  return score;
}

function createScheduler({ config = createReckoningConfig() } = {}) {
  function chooseNext({
    evidence = [],
    questions = [],
    questionsUsed = 0,
    lastEvidenceId = null,
  } = {}) {
    const used = Math.max(0, Number(questionsUsed) || 0);
    const nextOrdinal = used + 1;

    if (used >= config.planner.hardQuestionCap) {
      return Object.freeze({
        type: 'COMPLETE',
        reason: 'HARD_CAP_REACHED',
        schedulerVersion: config.schedulerVersion,
      });
    }

    const unanswered = (questions || []).filter(
      (question) => field(question, 'selectedOption', 'selected_option') == null
    );
    const byEvidence = new Map((evidence || []).map((row) => [String(row.id), row]));
    const rawCandidates = [];

    for (const row of evidence || []) {
      const role = roleForEvidence(row, unanswered);
      if (!role) continue;

      const evidenceId = String(row.id);
      const question = unanswered.find((item) =>
        String(field(item, 'evidenceId', 'reckoning_evidence_id', '')) === evidenceId &&
        String(field(item, 'role', 'reckoning_role', '')) === role
      );
      if (!question) continue;

      const nextEligible = Number(
        field(row, 'nextEligibleQuestion', 'next_eligible_question', 0)
      ) || 0;
      rawCandidates.push({
        evidence: row,
        question,
        role,
        nextEligible,
      });
    }

    if (!rawCandidates.length) {
      return Object.freeze({
        type: 'COMPLETE',
        reason: 'NO_PENDING_QUESTIONS',
        schedulerVersion: config.schedulerVersion,
      });
    }

    const controlDue =
      config.execution.controlCadence > 0 &&
      nextOrdinal <= config.execution.controlCadence * 3 &&
      nextOrdinal % config.execution.controlCadence === 0;

    function sortCandidates(items) {
      return [...items].sort((a, b) => {
        const aScore = candidateScore({
          ...a,
          lastEvidenceId,
          controlDue,
        });
        const bScore = candidateScore({
          ...b,
          lastEvidenceId,
          controlDue,
        });
        if (bScore !== aScore) return bScore - aScore;

        const aRisk = Number(field(a.evidence, 'riskScore', 'risk_score', 0)) || 0;
        const bRisk = Number(field(b.evidence, 'riskScore', 'risk_score', 0)) || 0;
        if (bRisk !== aRisk) return bRisk - aRisk;

        const evidenceCompare = String(a.evidence.id).localeCompare(String(b.evidence.id));
        if (evidenceCompare !== 0) return evidenceCompare;

        return Number(field(a.question, 'variantIndex', 'variant_index', 0)) -
          Number(field(b.question, 'variantIndex', 'variant_index', 0));
      });
    }

    let eligible = rawCandidates.filter((candidate) => candidate.nextEligible <= nextOrdinal);

    if (controlDue) {
      const controls = eligible.filter((candidate) => candidate.role === QUESTION_ROLES.CONTROL);
      if (controls.length) eligible = controls;
    }

    const notSameEvidence = eligible.filter(
      (candidate) => String(candidate.evidence.id) !== String(lastEvidenceId || '')
    );
    if (notSameEvidence.length) eligible = notSameEvidence;

    let spacingRelaxed = false;
    if (!eligible.length) {
      // Prefer an unrelated untested Diagnostic/Control as a spacing filler.
      const filler = rawCandidates.filter((candidate) =>
        candidate.nextEligible <= nextOrdinal &&
        [QUESTION_ROLES.DIAGNOSTIC, QUESTION_ROLES.CONTROL].includes(candidate.role) &&
        String(candidate.evidence.id) !== String(lastEvidenceId || '')
      );
      if (filler.length) {
        eligible = filler;
      } else {
        // The design says two unrelated questions should "normally" separate a
        // revisit. If the bank has nothing else valid, relax spacing rather than
        // trapping the learner behind an impossible state.
        eligible = rawCandidates.filter(
          (candidate) => String(candidate.evidence.id) !== String(lastEvidenceId || '')
        );
        if (!eligible.length) eligible = rawCandidates;
        spacingRelaxed = true;
      }
    }

    const chosen = sortCandidates(eligible)[0];
    return Object.freeze({
      type: 'QUESTION',
      schedulerVersion: config.schedulerVersion,
      questionId: chosen.question.id,
      evidenceId: chosen.evidence.id,
      role: chosen.role,
      nextOrdinal,
      spacingRelaxed,
      controlDue,
    });
  }

  return Object.freeze({
    name: 'reckoning-scheduler',
    version: config.schedulerVersion,
    chooseNext,
  });
}

module.exports = {
  roleForEvidence,
  candidateScore,
  createScheduler,
};
