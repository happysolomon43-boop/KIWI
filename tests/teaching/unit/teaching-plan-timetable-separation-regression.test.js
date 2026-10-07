'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('shared Semester availability never marks an uncreated Course Plan complete', () => {
  const flow = fs.readFileSync(path.join(root, 'public/teaching-flow-integrity.js'), 'utf8');
  const schedule = fs.readFileSync(path.join(root, 'public/teaching-d09.js'), 'utf8');
  const repository = fs.readFileSync(path.join(root, 'teaching/repositories/d09-scheduling.js'), 'utf8');

  assert.match(flow, /hasPlan=Boolean\(planReview\?\.plan\?\.currentForCourseScope\)/);
  assert.doesNotMatch(flow, /journey\(1,\{plan:true,/);
  assert.match(flow, /Shared Semester availability does not create a Course Plan/);
  assert.match(schedule, /item\.reason==='COURSE_PLAN_NOT_READY'/);
  assert.match(repository, /reason:'COURSE_PLAN_NOT_READY'/);
});

test('starting Course Plan generation stays on the current page', () => {
  const flow = fs.readFileSync(path.join(root, 'public/teaching-flow-integrity.js'), 'utf8');

  assert.match(flow, /Course Plan running in background/);
  assert.match(flow, /load\(\{showSkeleton:false\}\)/);
  assert.doesNotMatch(flow, /course-plan'\),\{method:'POST',body:\{\}\}\);await load\(\)/);
});

test('Teaching Settings owns scrolling while the page overlay is locked', () => {
  const html = fs.readFileSync(path.join(root, 'public/teaching.html'), 'utf8');
  const panelRule = html.match(/\.teaching-settings-panel\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';

  assert.match(panelRule, /height:\s*100dvh/);
  assert.match(panelRule, /overflow-y:\s*auto/);
  assert.match(panelRule, /overscroll-behavior:\s*contain/);
});


test('the active Teaching schedule surface never renders another Course timetable as the selected Course', () => {
  const experience = fs.readFileSync(path.join(root, 'public/teaching-schedule-experience.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'teaching/d09/service.js'), 'utf8');

  assert.match(experience, /data\.requestedCourse\?data\.requestedCourse\.planReady===false/);
  assert.match(experience, /Array\.isArray\(data\.courseSlots\)/);
  assert.match(experience, /Semester timetable items from other Courses are not shown here/);
  assert.match(experience, /missingPlan\?'Open Course Plan'/);
  assert.match(service, /courseSlots:Object\.freeze\(courseSlots\)/);
  assert.match(service, /courseSummary/);
});

test('Semester owns one shared timetable version while Course pages remain filtered views', () => {
  const service = fs.readFileSync(path.join(root, 'teaching/d09/service.js'), 'utf8');
  const repository = fs.readFileSync(path.join(root, 'teaching/repositories/d09-scheduling.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'migrations/20260929_teaching_d09_scheduling.sql'), 'utf8');
  const scheduleUi = fs.readFileSync(path.join(root, 'public/teaching-schedule-experience.js'), 'utf8');

  assert.match(service, /scope:'SEMESTER_SHARED'/);
  assert.match(service, /oneSharedTimetableVersionPerSemester:true/);
  assert.match(service, /availabilityChangeReflowsAllSchedulableCourses:true/);
  assert.match(service, /courseSlots:Object\.freeze\(courseSlots\)/);
  assert.match(repository, /const coursePlanRefs=context\.courses\.map/);
  assert.match(repository, /for\(const slot of result\.schedule\)/);
  assert.match(migration, /UNIQUE\(semester_id,version_no\)/);
  assert.match(scheduleUi, /one deterministic Semester timetable version/);
  assert.match(scheduleUi, /filtered to this Course/);
});

test('availability changes and Course Plan changes converge through the same shared timetable rebuild owner', () => {
  const service = fs.readFileSync(path.join(root, 'teaching/d09/service.js'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'teaching-backend.js'), 'utf8');

  assert.match(service, /function rebuildSharedSemesterTimetable/);
  assert.match(service, /source:'AVAILABILITY_AUTO_RECALC'/);
  assert.match(service, /return rebuildSharedSemesterTimetable\(user,courseId,context/);
  assert.match(backend, /recalculateAfterCoursePlanChange/);
  assert.match(backend, /timetable_recalculated/);
});

test('Course Plan regeneration is versioned and triggers safe timetable recalculation', () => {
  const flow = fs.readFileSync(path.join(root, 'public/teaching-flow-integrity.js'), 'utf8');
  const d08 = fs.readFileSync(path.join(root, 'teaching/d08/service.js'), 'utf8');
  const writer = fs.readFileSync(path.join(root, 'teaching/repositories/d08/plan-writer.js'), 'utf8');
  const d09 = fs.readFileSync(path.join(root, 'teaching/d09/service.js'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'teaching-backend.js'), 'utf8');

  assert.match(flow, /Regenerate Course Plan/);
  assert.match(flow, /course-plan\/regenerate/);
  assert.match(d08, /regenerateCoursePlan/);
  assert.match(d08, /regeneration_requested: regenerate/);
  assert.match(writer, /allowCurrentPlanReplacement/);
  assert.match(writer, /supersedes_course_plan_id/);
  assert.match(d09, /recalculateAfterCoursePlanChange/);
  assert.match(d09, /COURSE_PLAN_AUTO_RECALC/);
  assert.match(backend, /timetable_recalculated/);
});
