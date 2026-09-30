'use strict';

const ASSIGNMENT_PURPOSES = Object.freeze(['PRACTICE','RETRIEVAL','REMEDIATION','PREPARATION','APPLICATION','PRODUCTION','REVISION','INDEPENDENT_EVIDENCE','READING']);
const LIFECYCLE_STATES = Object.freeze(['ASSIGNED','UPCOMING','OPEN','STARTED','SUBMITTED','MARKING','RETURNED','CORRECTION_AVAILABLE','RESUBMITTED','VERIFICATION','VERIFIED','CLOSED']);
const CONDITIONS = Object.freeze(['LATE','EXPIRED','EXCUSED','REPLACED','INVALIDATED','MISSED','SYSTEM_PROTECTED']);
const DEADLINE_TYPES = Object.freeze(['SOFT','HARD','PEDAGOGICALLY_EXPIRING']);
const ASSISTANCE_MODES = Object.freeze(['OPEN_LEARNING_ASSISTANCE','HINT_ONLY','REFERENCE_ONLY','CLOSED_BOOK_INDEPENDENT','FORMAL_ASSESSMENT']);
const RULE_ALIGNMENT_STATES = Object.freeze(['NOT_REVIEWED','ALIGNED','MISALIGNED','UNRESOLVED']);
const CAPABILITY_EVIDENCE_STATES = Object.freeze(['NOT_REVIEWED','SUPPORTED','UNRESOLVED','COMPROMISED','INVALID']);
const VERIFICATION_STATES = Object.freeze(['NOT_REQUIRED','REQUIRED','PENDING','PASSED','FAILED','REFUSED']);
const WORK_STAKES = Object.freeze(['OPTIONAL','PREPARATION','REMEDIATION','GRADED']);

function fail(message, code, status = 422, details = null) {
  const error = new Error(message); error.code = code; error.status = status; if (details) error.details = details; return error;
}
function oneOf(value, allowed, field) {
  const normalized = String(value || '').toUpperCase();
  if (!allowed.includes(normalized)) throw fail(`${field} is unsupported.`, 'TEACHING_D16_CONTRACT_INVALID', 400, { field, value });
  return normalized;
}
function normalizeEffort(minMinutes, maxMinutes) {
  const min = Number(minMinutes); const max = Number(maxMinutes);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) throw fail('Estimated effort must be a valid range.', 'TEACHING_D16_EFFORT_INVALID', 400);
  return Object.freeze({ minMinutes: Math.round(min), maxMinutes: Math.round(max) });
}
function classifyDeadline({ deadlineType, dueAt, submittedAt, solutionExposedAt = null, excused = false, systemProtected = false }) {
  const type = oneOf(deadlineType, DEADLINE_TYPES, 'deadlineType');
  if (excused) return Object.freeze({ type, late: false, expired: false, condition: 'EXCUSED' });
  if (systemProtected) return Object.freeze({ type, late: false, expired: false, condition: 'SYSTEM_PROTECTED' });
  const due = new Date(dueAt); const event = submittedAt ? new Date(submittedAt) : null;
  if (!Number.isFinite(due.getTime()) || (event && !Number.isFinite(event.getTime()))) throw fail('Deadline timestamps are invalid.', 'TEACHING_D16_TIME_INVALID', 400);
  const late = Boolean(event && event.getTime() > due.getTime());
  const expired = type !== 'SOFT' && ((!event && Date.now() > due.getTime()) || Boolean(solutionExposedAt && new Date(solutionExposedAt).getTime() >= due.getTime()));
  return Object.freeze({ type, late, expired, condition: expired ? 'EXPIRED' : late ? 'LATE' : null });
}
function assistanceDecision({ mode, requestKind, submitted = false, closed = false, solutionReleased = false }) {
  const assistanceMode = oneOf(mode, ASSISTANCE_MODES, 'assistanceMode');
  const kind = String(requestKind || '').toUpperCase();
  if (solutionReleased || closed) return Object.freeze({ allowed: true, maxDisclosure: 'FULL_SOLUTION', reason: 'RELEASED' });
  if (assistanceMode === 'OPEN_LEARNING_ASSISTANCE') return Object.freeze({ allowed: true, maxDisclosure: submitted ? 'FULL_SOLUTION' : 'EXPLANATION', reason: 'OPEN_LEARNING' });
  if (assistanceMode === 'HINT_ONLY') return Object.freeze({ allowed: kind === 'HINT', maxDisclosure: 'HINT', reason: 'HINT_ONLY' });
  if (assistanceMode === 'REFERENCE_ONLY') return Object.freeze({ allowed: kind === 'REFERENCE', maxDisclosure: 'REFERENCE', reason: 'REFERENCE_ONLY' });
  if (assistanceMode === 'CLOSED_BOOK_INDEPENDENT') return Object.freeze({ allowed: false, maxDisclosure: 'NONE', reason: 'INDEPENDENT_ATTEMPT' });
  return Object.freeze({ allowed: false, maxDisclosure: 'NONE', reason: 'FORMAL_ASSESSMENT_OWNER' });
}
function integrityReview({ policyVersion, signals = [], ruleAlignment = 'NOT_REVIEWED', capabilityEvidence = 'NOT_REVIEWED', activeFormalAssessment = false }) {
  if (!policyVersion) throw fail('Integrity review requires policy-at-event version.', 'TEACHING_D16_POLICY_AT_EVENT_REQUIRED', 409);
  const contextualSignals = (signals || []).map((signal) => ({ type: String(signal.type || signal.kind || 'UNKNOWN').toUpperCase(), source: signal.source || null, value: signal.value ?? null, authoritativeProof: false }));
  return Object.freeze({
    policyVersion: String(policyVersion),
    ruleAlignment: oneOf(ruleAlignment, RULE_ALIGNMENT_STATES, 'ruleAlignment'),
    capabilityEvidence: oneOf(capabilityEvidence, CAPABILITY_EVIDENCE_STATES, 'capabilityEvidence'),
    signals: Object.freeze(contextualSignals),
    misconductVerdict: null,
    guiltProbability: null,
    permanentLabel: null,
    midAttemptVerificationAllowed: !activeFormalAssessment,
  });
}
function verificationDirective({ capabilityEvidence, activeFormalAssessment = false, disputedCapability, method = 'EQUIVALENT_TASK' }) {
  const evidence = oneOf(capabilityEvidence, CAPABILITY_EVIDENCE_STATES, 'capabilityEvidence');
  if (activeFormalAssessment) return Object.freeze({ state: 'PENDING', deferredToPostAttempt: true, target: disputedCapability || null, method: null });
  if (evidence !== 'UNRESOLVED') return Object.freeze({ state: 'NOT_REQUIRED', deferredToPostAttempt: false, target: null, method: null });
  if (!disputedCapability) throw fail('Fresh verification must target the disputed capability.', 'TEACHING_D16_VERIFICATION_TARGET_REQUIRED', 409);
  return Object.freeze({ state: 'REQUIRED', deferredToPostAttempt: false, target: String(disputedCapability), method: String(method).toUpperCase(), wholesaleReproductionRequired: false });
}
function missedOutcome(stake) {
  switch (oneOf(stake, WORK_STAKES, 'workStake')) {
    case 'OPTIONAL': return Object.freeze({ gradebookEffect: false, consequence: 'LESS_PRACTICE_EVIDENCE' });
    case 'PREPARATION': return Object.freeze({ gradebookEffect: false, consequence: 'NEXT_CLASS_ADJUSTMENT' });
    case 'REMEDIATION': return Object.freeze({ gradebookEffect: false, consequence: 'WEAKNESS_UNRESOLVED' });
    case 'GRADED': return Object.freeze({ gradebookEffect: 'POLICY_OWNED', consequence: 'MISSING_POLICY_PATH' });
    default: throw fail('Unsupported work stake.', 'TEACHING_D16_STAKE_INVALID');
  }
}
function readingEvidence({ completed, optionalCheckEvidence = null }) {
  return Object.freeze({ activityCompleted: Boolean(completed), mastery: null, learningEvidence: optionalCheckEvidence || null, completionAloneIsEvidence: false });
}

module.exports = { ASSIGNMENT_PURPOSES, LIFECYCLE_STATES, CONDITIONS, DEADLINE_TYPES, ASSISTANCE_MODES, RULE_ALIGNMENT_STATES, CAPABILITY_EVIDENCE_STATES, VERIFICATION_STATES, WORK_STAKES, normalizeEffort, classifyDeadline, assistanceDecision, integrityReview, verificationDirective, missedOutcome, readingEvidence, fail };
