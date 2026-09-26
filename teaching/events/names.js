'use strict';

const TEACHING_EVENTS = Object.freeze({
  COURSE_ACTIVATED: 'teaching.course.activated',
  CLASS_START_DUE: 'teaching.class.start_due',
  CLASS_JOINED: 'teaching.class.joined',
  STUDENT_RESPONSE_SUBMITTED: 'teaching.student.response_submitted',
  ACTIVITY_TIMER_EXPIRED: 'teaching.activity.timer_expired',
  BREAK_STARTED: 'teaching.break.started',
  BREAK_END_DUE: 'teaching.break.end_due',
  BREAK_ENDED: 'teaching.break.ended',
  ASSESSMENT_EXPIRY_DUE: 'teaching.assessment.expiry_due',
  ASSESSMENT_STARTED: 'teaching.assessment.started',
  ASSESSMENT_SUBMITTED: 'teaching.assessment.submitted',
  CLASS_END_DUE: 'teaching.class.end_due',
  CLASS_ENDED: 'teaching.class.ended',
  ASSIGNMENT_DUE: 'teaching.assignment.due',
  REQUEST_EFFECTIVE_DUE: 'teaching.request.effective_due',
  REQUEST_DECIDED: 'teaching.request.decided',
  COURSE_RISK_CHANGED: 'teaching.course.risk_changed',

  // D05 Progressive Preparation Lifecycle durable events. Scheduled review and
  // finalization events use D02 due_events; all other committed facts use the
  // D05 transactional outbox. These are events, never academic owners.
  PREPARATION_WORKSPACE_SEEDED: 'teaching.preparation.workspace_seeded',
  PREPARATION_INPUT_CHANGED: 'teaching.preparation.input_changed',
  PREPARATION_REVIEW_DUE: 'teaching.preparation.review_due',
  PREPARATION_FINALIZATION_DUE: 'teaching.preparation.finalization_due',
  PREPARATION_FINDING_RESOLVED: 'teaching.preparation.finding_resolved',
  PROTECTED_CANDIDATE_CONTAMINATED: 'teaching.preparation.protected_candidate_contaminated',
  PREPARATION_WORKSPACE_SUPERSEDED: 'teaching.preparation.workspace_superseded',
  PREPARATION_WORKSPACE_CANCELLED: 'teaching.preparation.workspace_cancelled',
  PREPARATION_HANDOFF_READY: 'teaching.preparation.handoff_ready',
});

const TEACHING_EVENT_NAMES = Object.freeze(Object.values(TEACHING_EVENTS));

module.exports = { TEACHING_EVENTS, TEACHING_EVENT_NAMES };
