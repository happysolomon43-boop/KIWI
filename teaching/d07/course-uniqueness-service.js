'use strict';

const TERMINAL_STATES = new Set(['COMPLETED','ARCHIVED']);
const STATE_PRIORITY = Object.freeze({
  ACTIVE: 100,
  PAUSED: 90,
  READY: 80,
  TEACHING_ENDED: 70,
  FINALIZING: 65,
  INCOMPLETE: 60,
  DRAFT: 50,
  COMPLETED: 20,
  ARCHIVED: 10,
});

function courseKey(course = {}) {
  const subjectId = String(course.subject_id || course.subjectId || '').trim();
  if (subjectId) return `subject:${subjectId}`;
  return `title:${String(course.title || '').trim().toLowerCase()}`;
}

function canonicalCourse(left, right) {
  const lp = STATE_PRIORITY[String(left?.lifecycle_state || '').toUpperCase()] || 0;
  const rp = STATE_PRIORITY[String(right?.lifecycle_state || '').toUpperCase()] || 0;
  if (lp !== rp) return lp > rp ? left : right;
  const lv = Number(left?.state_version) || 0;
  const rv = Number(right?.state_version) || 0;
  if (lv !== rv) return lv > rv ? left : right;
  const lt = Date.parse(left?.updated_at || left?.created_at || 0) || 0;
  const rt = Date.parse(right?.updated_at || right?.created_at || 0) || 0;
  return lt >= rt ? left : right;
}

function dedupeCourses(courses = []) {
  const byKey = new Map();
  for (const course of courses || []) {
    const key = courseKey(course);
    if (!byKey.has(key)) byKey.set(key, course);
    else byKey.set(key, canonicalCourse(byKey.get(key), course));
  }
  return Object.freeze([...byKey.values()].sort((a, b) => {
    const at = Date.parse(a?.updated_at || a?.created_at || 0) || 0;
    const bt = Date.parse(b?.updated_at || b?.created_at || 0) || 0;
    return bt - at;
  }));
}

function decorateCourseUniqueness(service) {
  if (!service || typeof service.listCourses !== 'function' || typeof service.createCourse !== 'function') return service;

  async function listCourses(user) {
    return dedupeCourses(await service.listCourses(user));
  }

  async function createCourse(user, input = {}) {
    const subjectId = String(input.subjectId || '').trim();
    if (subjectId) {
      const existing = (await service.listCourses(user)).filter((course) =>
        String(course.subject_id || course.subjectId || '') === subjectId &&
        !TERMINAL_STATES.has(String(course.lifecycle_state || '').toUpperCase())
      );
      if (existing.length) {
        const selected = existing.reduce((best, row) => best ? canonicalCourse(best, row) : row, null);
        const error = new Error('This KIWI Subject already has a Teaching Course. Open the existing Course instead of creating a duplicate.');
        error.status = 409;
        error.code = 'TEACHING_D07_DUPLICATE_COURSE';
        error.courseId = selected?.course_id || null;
        throw error;
      }
    }
    return service.createCourse(user, input);
  }

  return Object.freeze({ ...service, listCourses, createCourse });
}

module.exports = { TERMINAL_STATES, STATE_PRIORITY, courseKey, canonicalCourse, dedupeCourses, decorateCourseUniqueness };
