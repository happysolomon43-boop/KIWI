'use strict';

const TEACHING_EVENTS = Object.freeze({
  COURSE_ACTIVATED: 'teaching.course.activated',
  CLASS_START_DUE: 'teaching.class.start_due',
  CLASS_JOINED: 'teaching.class.joined',
  STUDENT_RESPONSE_SUBMITTED: 'teaching.student.response_submitted',
  ACTIVITY_TIMER_EXPIRED: 'teaching.activity.timer_expired',
  BREAK_STARTED: 'teaching.break.started',
  BREAK_ENDED: 'teaching.break.ended',
  ASSESSMENT_STARTED: 'teaching.assessment.started',
  ASSESSMENT_SUBMITTED: 'teaching.assessment.submitted',
  CLASS_ENDED: 'teaching.class.ended',
  ASSIGNMENT_DUE: 'teaching.assignment.due',
  REQUEST_DECIDED: 'teaching.request.decided',
  COURSE_RISK_CHANGED: 'teaching.course.risk_changed',
});

const TEACHING_EVENT_NAMES = Object.freeze(Object.values(TEACHING_EVENTS));

module.exports = { TEACHING_EVENTS, TEACHING_EVENT_NAMES };
