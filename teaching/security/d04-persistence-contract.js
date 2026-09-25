'use strict';

const BROWSER_READ_ONLY_TABLES = Object.freeze([
  'teaching_semesters',
  'teaching_courses',
  'teaching_course_plans',
  'teaching_topics',
  'teaching_subtopics',
  'teaching_learning_units',
  'teaching_learning_unit_dependencies',
  'teaching_learning_unit_lineage',
  'teaching_classes',
  'teaching_lesson_blueprints',
  'teaching_class_sessions',
  'teaching_board_scenes',
  'teaching_board_items',
  'teaching_student_responses',
  'teaching_evidence_events',
  'teaching_evidence_event_learning_units',
  'teaching_teacher_identities',
  'teaching_interaction_preferences',
  'teaching_student_course_intakes',
  'teaching_student_course_intake_extractions',
  'teaching_source_content_items',
  'teaching_course_coverage',
  'teaching_assessment_eligibility',
  'teaching_academic_audit_log',
]);

const SERVER_AUTHORITATIVE_MUTATIONS = Object.freeze([
  'course.scope.persist',
  'schedule.authority.persist',
  'class.session.persist',
  'evidence.persist',
  'coverage.persist',
  'assessment.eligibility.persist',
  'teacher.identity.persist',
  'audit.append',
  'preparation.workspace.persist',
  'preparation.artifact.persist',
  'preparation.finding.persist',
]);

const FUTURE_PRIVILEGED_ACADEMIC_OPERATIONS = Object.freeze([
  'grading.finalize',
  'assessment.package.lock',
  'attendance.authoritative.record',
  'request.formal.decide',
  'schedule.authority.update',
]);

const PRIVATE_PREPARATION_SCHEMA = 'teaching_preparation';
const PROTECTED_PREPARATION_SCHEMA = 'teaching_protected';

function assertServerAcademicMutation(operation, context = {}) {
  const name = String(operation || '');
  if (!SERVER_AUTHORITATIVE_MUTATIONS.includes(name) && !FUTURE_PRIVILEGED_ACADEMIC_OPERATIONS.includes(name)) {
    const error = new TypeError(`Unknown Teaching academic mutation: ${name}`);
    error.code = 'TEACHING_UNKNOWN_ACADEMIC_MUTATION';
    throw error;
  }
  if (context.trustBoundary !== 'server') {
    const error = new Error(`Teaching academic mutation ${name} requires the server trust boundary.`);
    error.code = 'TEACHING_SERVER_AUTHORITY_REQUIRED';
    throw error;
  }
  return true;
}

function assertProtectedPreparationAccess(context = {}) {
  if (context.trustBoundary !== 'server' || context.protectedPreparationAuthorized !== true) {
    const error = new Error('Protected Teaching preparation content requires explicit server-side protected-content authorization.');
    error.code = 'TEACHING_PROTECTED_PREPARATION_ACCESS_DENIED';
    throw error;
  }
  return true;
}

module.exports = {
  BROWSER_READ_ONLY_TABLES,
  SERVER_AUTHORITATIVE_MUTATIONS,
  FUTURE_PRIVILEGED_ACADEMIC_OPERATIONS,
  PRIVATE_PREPARATION_SCHEMA,
  PROTECTED_PREPARATION_SCHEMA,
  assertServerAcademicMutation,
  assertProtectedPreparationAccess,
};
