'use strict';

const AUTHORITATIVE_OWNERS = Object.freeze({
  COURSE_SCOPE: 'course_scope',
  STUDENT_KNOWLEDGE_MODEL: 'student_knowledge_model',
  SCHEDULER: 'scheduler',
  ASSESSMENT: 'assessment',
  GRADEBOOK: 'gradebook',
  PROGRESSION: 'progression',
  ATTENDANCE: 'attendance',
  REQUEST: 'request',
  TEACHER_IDENTITY: 'teacher_identity',
  TEACHING_CONTROLLER: 'teaching_controller',
});

const AUTHORITATIVE_OWNER_VALUES = Object.freeze(Object.values(AUTHORITATIVE_OWNERS));

function assertAuthoritativeOwner(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!AUTHORITATIVE_OWNER_VALUES.includes(normalized)) {
    throw new TypeError(`Unknown Teaching authoritative owner: ${value}`);
  }
  return normalized;
}

module.exports = {
  AUTHORITATIVE_OWNERS,
  AUTHORITATIVE_OWNER_VALUES,
  assertAuthoritativeOwner,
};
