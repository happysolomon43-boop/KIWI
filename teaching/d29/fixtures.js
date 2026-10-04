'use strict';

const FIXTURE_VERSION = 'teaching.d29.fixtures.v1';
const PEDAGOGY_COURSES = Object.freeze([
  { id: 'd29-course-conceptual', pedagogy: 'CONCEPTUAL', subject: 'Chemistry', knowledgeType: 'CONCEPTUAL' },
  { id: 'd29-course-procedural', pedagogy: 'PROCEDURAL', subject: 'Mathematics', knowledgeType: 'PROCEDURAL' },
  { id: 'd29-course-analytical', pedagogy: 'ANALYTICAL', subject: 'Physics', knowledgeType: 'ANALYTICAL' },
  { id: 'd29-course-interpretive', pedagogy: 'INTERPRETIVE', subject: 'Literature', knowledgeType: 'INTERPRETIVE' },
  { id: 'd29-course-production', pedagogy: 'PRODUCTION', subject: 'Computer Science', knowledgeType: 'PRODUCTION' },
]);
const STUDENT_PROFILES = Object.freeze([
  { id: 'd29-normal', profile: 'NORMAL', expectedCourseState: 'ACTIVE' },
  { id: 'd29-struggling', profile: 'STRUGGLING', expectedCourseState: 'ACTIVE', expectedOverlay: 'BLOCKED' },
  { id: 'd29-transfer', profile: 'TRANSFER', expectedCourseState: 'READY' },
  { id: 'd29-resit', profile: 'RESIT', expectedCourseState: 'ACTIVE', expectedOverlay: 'RESIT' },
  { id: 'd29-incomplete', profile: 'INCOMPLETE_SEMESTER', expectedCourseState: 'INCOMPLETE' },
]);
const COURSE_STATES = Object.freeze(['ACTIVE', 'PAUSED', 'COMPLETED', 'INCOMPLETE', 'RESIT', 'RECOVERY', 'REPEAT']);
function buildFixtureNamespace(runId) {
  if (!runId || !/^[a-zA-Z0-9._:-]+$/.test(String(runId))) throw new TypeError('A safe D29 run id is required.');
  return `d29:${runId}`;
}
module.exports = { FIXTURE_VERSION, PEDAGOGY_COURSES, STUDENT_PROFILES, COURSE_STATES, buildFixtureNamespace };
