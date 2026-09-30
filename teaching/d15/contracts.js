'use strict';

const decisionRegistry = require('../policy/decisions-v1.json');

const ATTENDANCE_OUTCOMES = Object.freeze([
  'PENDING','ON_TIME','LATE','PARTIAL','UNEXCUSED_ABSENCE','EXCUSED_ABSENCE',
  'APPROVED_LEAVE','INTERRUPTED','SYSTEM_PROTECTED','NO_OBLIGATION','RESCHEDULED',
]);
const OBLIGATION_STATES = Object.freeze(['REQUIRED','NO_OBLIGATION']);
const PRESENCE_STATES = Object.freeze(['UNESTABLISHED','PRESENT','MEANINGFUL','INTERRUPTED']);
const RECOVERY_STATES = Object.freeze(['NONE','DIAGNOSIS_REQUIRED','SCHEDULER_REVIEW_REQUIRED']);

function fail(message, code, status = 422, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function asDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw fail(`${field} must be a valid timestamp.`, 'TEACHING_D15_TIME_INVALID', 400);
  return date;
}

function minutesBetween(a, b) {
  return Math.max(0, (asDate(b, 'end').getTime() - asDate(a, 'start').getTime()) / 60000);
}

function registryDecision(taskId) {
  const decision = decisionRegistry?.decisions?.[taskId];
  if (!decision?.policy_version || !decision?.decision) {
    throw fail(`D15 required policy ${taskId} is unavailable.`, 'TEACHING_D15_POLICY_MISSING', 503);
  }
  return decision;
}

function resolveAttendancePolicy(overrides = {}) {
  const lateness = registryDecision('TCH-0076');
  const concern = registryDecision('TCH-0077');
  const graceMinutes = overrides.graceMinutes == null ? null : Number(overrides.graceMinutes);
  if (graceMinutes != null && (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 60)) {
    throw fail('Configured attendance grace must be between 0 and 60 minutes.', 'TEACHING_D15_POLICY_INVALID', 500);
  }
  return Object.freeze({
    lateness: Object.freeze({
      policyVersion: String(overrides.latenessPolicyVersion || lateness.policy_version),
      authoritativeClock: 'SERVER',
      graceRule: String(overrides.graceRule || lateness.decision.grace_rule),
      fixedGraceMinutes: graceMinutes,
      materialLatenessRatio: Number(overrides.materialLatenessRatio ?? lateness.decision.material_lateness_ratio),
      absenceFromLatenessAlone: false,
      approvedOrSystemDelayPenalty: false,
    }),
    concern: Object.freeze({
      policyVersion: String(overrides.concernPolicyVersion || concern.policy_version),
      enabled: overrides.concernEnabled == null ? Boolean(concern.decision.attendance_concern_first_release) : Boolean(overrides.concernEnabled),
      behaviorRelevantIncidents: Number(overrides.behaviorRelevantIncidents ?? concern.decision.default_trigger.behavior_relevant_incidents),
      rollingObligations: Number(overrides.rollingObligations ?? concern.decision.default_trigger.rolling_obligations),
      countedIncidents: Object.freeze([...(overrides.countedIncidents || concern.decision.default_trigger.counted_incidents)]),
      consequences: Object.freeze([...(concern.decision.consequences || [])]),
      subjectMarkReduction: false,
      probationEnabled: false,
    }),
  });
}

function graceMinutesFor({ scheduledStartAt, scheduledEndAt, policy = resolveAttendancePolicy() }) {
  const duration = minutesBetween(scheduledStartAt, scheduledEndAt);
  if (duration <= 0) throw fail('Attendance obligation must have positive scheduled duration.', 'TEACHING_D15_CLASS_DURATION_INVALID', 409);
  if (policy.lateness.fixedGraceMinutes != null) return Math.ceil(policy.lateness.fixedGraceMinutes);
  if (policy.lateness.graceRule === 'MIN_5_MINUTES_OR_10_PERCENT_OF_SCHEDULED_DURATION') {
    return Math.min(5, Math.ceil(duration * 0.10));
  }
  throw fail('Unsupported configured attendance grace rule.', 'TEACHING_D15_GRACE_RULE_UNSUPPORTED', 503, { rule: policy.lateness.graceRule });
}

function classifyArrival({ scheduledStartAt, scheduledEndAt, arrivedAt, policy = resolveAttendancePolicy() }) {
  const graceMinutes = graceMinutesFor({ scheduledStartAt, scheduledEndAt, policy });
  if (!arrivedAt) return Object.freeze({ outcome: 'PENDING', graceMinutes, lateMinutes: null, materialLateness: false });
  const duration = minutesBetween(scheduledStartAt, scheduledEndAt);
  const lateMinutes = Math.max(0, Math.floor((asDate(arrivedAt, 'arrivedAt').getTime() - asDate(scheduledStartAt, 'scheduledStartAt').getTime()) / 60000));
  const outcome = lateMinutes <= graceMinutes ? 'ON_TIME' : 'LATE';
  return Object.freeze({
    outcome,
    graceMinutes,
    lateMinutes,
    materialLateness: outcome === 'LATE' && duration > 0 && (lateMinutes / duration) >= policy.lateness.materialLatenessRatio,
  });
}

function hasMeaningfulParticipation(evidence = []) {
  const meaningful = new Set(['STUDENT_RESPONSE','ACTIVITY_SUBMISSION','TEACHER_LED_TRANSITION','CLASS_CLOSURE','READY','FINISHED','ASK_TEACHER','NEED_HELP']);
  return (evidence || []).some((item) => meaningful.has(String(item?.kind || item).toUpperCase()));
}

function finalizeAttendance({
  obligationState = 'REQUIRED', obligationDisposition = null, scheduledStartAt, scheduledEndAt,
  arrivedAt = null, exitedAt = null, participationEvidence = [], approvedOutcome = null,
  interruption = null, policy = resolveAttendancePolicy(),
} = {}) {
  if (!OBLIGATION_STATES.includes(obligationState)) throw fail('Invalid attendance obligation state.', 'TEACHING_D15_OBLIGATION_STATE_INVALID');
  const graceMinutes = graceMinutesFor({ scheduledStartAt, scheduledEndAt, policy });
  const durationMinutes = Math.ceil(minutesBetween(scheduledStartAt, scheduledEndAt));

  if (obligationState === 'NO_OBLIGATION') {
    const disposition = ['RESCHEDULED','APPROVED_LEAVE','SYSTEM_PROTECTED'].includes(String(obligationDisposition))
      ? String(obligationDisposition) : 'NO_OBLIGATION';
    return Object.freeze({ outcome: disposition, presenceState: 'UNESTABLISHED', graceMinutes, lateMinutes: null,
      materialLateness: false, missedMinutes: 0, recoveryState: 'NONE', behaviorRelevant: false });
  }

  if (interruption?.systemProtected === true) {
    return Object.freeze({ outcome: 'SYSTEM_PROTECTED', presenceState: arrivedAt ? 'INTERRUPTED' : 'UNESTABLISHED', graceMinutes,
      lateMinutes: arrivedAt ? classifyArrival({scheduledStartAt,scheduledEndAt,arrivedAt,policy}).lateMinutes : null,
      materialLateness: false, missedMinutes: 0, recoveryState: 'NONE', behaviorRelevant: false });
  }

  if (approvedOutcome === 'APPROVED_LEAVE') {
    return Object.freeze({ outcome:'APPROVED_LEAVE', presenceState:'UNESTABLISHED', graceMinutes, lateMinutes:null,
      materialLateness:false, missedMinutes:durationMinutes, recoveryState:'DIAGNOSIS_REQUIRED', behaviorRelevant:false });
  }
  if (approvedOutcome === 'EXCUSED_ABSENCE') {
    return Object.freeze({ outcome:'EXCUSED_ABSENCE', presenceState:'UNESTABLISHED', graceMinutes, lateMinutes:null,
      materialLateness:false, missedMinutes:durationMinutes, recoveryState:'DIAGNOSIS_REQUIRED', behaviorRelevant:false });
  }

  if (!arrivedAt) {
    return Object.freeze({ outcome:'UNEXCUSED_ABSENCE', presenceState:'UNESTABLISHED', graceMinutes, lateMinutes:null,
      materialLateness:false, missedMinutes:durationMinutes, recoveryState:'DIAGNOSIS_REQUIRED', behaviorRelevant:true });
  }

  const arrival = classifyArrival({ scheduledStartAt, scheduledEndAt, arrivedAt, policy });
  const meaningful = hasMeaningfulParticipation(participationEvidence);
  const end = asDate(scheduledEndAt, 'scheduledEndAt').getTime();
  const exit = exitedAt ? Math.min(end, asDate(exitedAt, 'exitedAt').getTime()) : end;
  const start = Math.max(asDate(scheduledStartAt, 'scheduledStartAt').getTime(), asDate(arrivedAt, 'arrivedAt').getTime());
  const presentMinutes = Math.max(0, Math.floor((exit - start) / 60000));
  const missedMinutes = Math.max(0, durationMinutes - presentMinutes);
  const leftEarly = Boolean(exitedAt && asDate(exitedAt, 'exitedAt').getTime() < end);

  if (interruption?.studentOrNetwork === true && !interruption?.resolved) {
    return Object.freeze({ outcome:'INTERRUPTED', presenceState:'INTERRUPTED', graceMinutes, lateMinutes:arrival.lateMinutes,
      materialLateness:arrival.materialLateness, missedMinutes, recoveryState: missedMinutes ? 'DIAGNOSIS_REQUIRED' : 'NONE', behaviorRelevant:false });
  }
  if (leftEarly || !meaningful) {
    return Object.freeze({ outcome:'PARTIAL', presenceState: meaningful ? 'MEANINGFUL' : 'PRESENT', graceMinutes,
      lateMinutes:arrival.lateMinutes, materialLateness:arrival.materialLateness, missedMinutes,
      recoveryState: missedMinutes ? 'DIAGNOSIS_REQUIRED' : 'NONE', behaviorRelevant:true });
  }
  return Object.freeze({ outcome:arrival.outcome, presenceState:'MEANINGFUL', graceMinutes, lateMinutes:arrival.lateMinutes,
    materialLateness:arrival.materialLateness, missedMinutes:arrival.outcome==='LATE' ? Math.min(durationMinutes, arrival.lateMinutes) : 0,
    recoveryState:arrival.outcome==='LATE' ? 'DIAGNOSIS_REQUIRED' : 'NONE', behaviorRelevant:arrival.outcome==='LATE' });
}

function concernIncidentCode(record) {
  if (!record) return null;
  if (record.outcome === 'LATE' && record.material_lateness) return 'MATERIAL_LATENESS';
  if (record.outcome === 'LATE') return 'LATE';
  if (record.outcome === 'UNEXCUSED_ABSENCE') return 'UNEXCUSED_ABSENCE';
  if (record.outcome === 'PARTIAL' && record.behavior_relevant !== false) return 'STUDENT_CAUSED_PARTIAL_ATTENDANCE';
  return null;
}

function evaluateAttendanceConcern(records, policy = resolveAttendancePolicy().concern) {
  const windowSize = Math.max(1, Number(policy.rollingObligations));
  const relevant = (records || []).filter((r) => r.obligation_state === 'REQUIRED').slice(0, windowSize);
  const counted = relevant.map(concernIncidentCode).filter((code) => code && policy.countedIncidents.includes(code));
  const triggered = Boolean(policy.enabled && counted.length >= Number(policy.behaviorRelevantIncidents));
  return Object.freeze({
    triggered,
    policyVersion: policy.policyVersion,
    evaluatedObligations: relevant.length,
    incidentCount: counted.length,
    incidents: Object.freeze(counted),
    actions: Object.freeze(triggered ? [...policy.consequences] : []),
    subjectMarkReduction: false,
    probationEnabled: false,
  });
}

function assertOutcome(value) {
  const outcome = String(value || '').toUpperCase();
  if (!ATTENDANCE_OUTCOMES.includes(outcome)) throw fail('Unsupported attendance outcome.', 'TEACHING_D15_OUTCOME_INVALID', 400);
  return outcome;
}

module.exports = {
  ATTENDANCE_OUTCOMES, OBLIGATION_STATES, PRESENCE_STATES, RECOVERY_STATES,
  resolveAttendancePolicy, graceMinutesFor, classifyArrival, hasMeaningfulParticipation,
  finalizeAttendance, evaluateAttendanceConcern, concernIncidentCode, assertOutcome, fail,
};
