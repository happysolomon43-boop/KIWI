'use strict';

/**
 * D01 typed-ID boundary.
 *
 * JavaScript cannot enforce nominal types at compile time in this repository,
 * so each academic identifier has a dedicated constructor/assertion function.
 * The functions deliberately return primitive strings so database/API layers
 * remain interoperable while callers cannot silently pass empty/invalid IDs.
 */

const ID_KINDS = Object.freeze([
  'semester',
  'course',
  'course_attempt',
  'class',
  'lesson_blueprint',
  'topic',
  'learning_unit',
  'evidence_event',
  'assignment',
  'assessment',
  'attempt',
  'request',
  'attendance_record',
  'teacher_identity',
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

function assertDomainId(kind, value) {
  if (!ID_KINDS.includes(kind)) {
    throw new TypeError(`Unknown Teaching identifier kind: ${kind}`);
  }

  if (typeof value !== 'string') {
    throw new TypeError(`${kind} id must be a string.`);
  }

  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) {
    throw new TypeError(`${kind} id is empty or contains unsupported characters.`);
  }

  return normalized;
}

function idFactory(kind) {
  return (value) => assertDomainId(kind, value);
}

const asSemesterId = idFactory('semester');
const asCourseId = idFactory('course');
const asCourseAttemptId = idFactory('course_attempt');
const asClassId = idFactory('class');
const asLessonBlueprintId = idFactory('lesson_blueprint');
const asTopicId = idFactory('topic');
const asLearningUnitId = idFactory('learning_unit');
const asEvidenceEventId = idFactory('evidence_event');
const asAssignmentId = idFactory('assignment');
const asAssessmentId = idFactory('assessment');
const asAttemptId = idFactory('attempt');
const asRequestId = idFactory('request');
const asAttendanceRecordId = idFactory('attendance_record');
const asTeacherIdentityId = idFactory('teacher_identity');

module.exports = {
  ID_KINDS,
  assertDomainId,
  asSemesterId,
  asCourseId,
  asCourseAttemptId,
  asClassId,
  asLessonBlueprintId,
  asTopicId,
  asLearningUnitId,
  asEvidenceEventId,
  asAssignmentId,
  asAssessmentId,
  asAttemptId,
  asRequestId,
  asAttendanceRecordId,
  asTeacherIdentityId,
};
