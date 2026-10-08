'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'public/teaching-d09.js'), 'utf8');

test('Teaching Calendar uses day-grouped schedule rows instead of repeated full cards', () => {
  assert.match(source, /function groupCalendarItems\(items,zone\)/);
  assert.match(source, /teaching-d09-calendar-day/);
  assert.match(source, /teaching-d09-calendar-row__time/);
  assert.match(source, /teaching-d09-calendar-row__body/);
  assert.match(source, /calendarGroupedList\(events,data,calendarEventCard\)/);
  assert.doesNotMatch(source, /teaching-d09-calendar-item/);
});

test('Calendar keeps timezone and event actions readable without repeating date-time prose', () => {
  assert.match(source, /Times shown in \$\{zone\}/);
  assert.match(source, /Request new time/);
  assert.match(source, /Emergency absence/);
  assert.match(source, /teaching-d09-calendar-actions/);
  assert.match(source, /displayCalendarDay/);
  assert.match(source, /displayCalendarTime/);
  assert.doesNotMatch(source, /displayCalendarTime\(item\.startsAt,data\.currentTimeZone\).*data\.currentTimeZone/);
});

test('Calendar presentation preserves event authority semantics', () => {
  assert.match(source, /Approved schedule/);
  assert.match(source, /Announced assessment/);
  assert.match(source, /Pre-activation proposal/);
  assert.match(source, /window\.KIWITeachingD10\.requestClassReschedule\(item\)/);
  assert.match(source, /window\.KIWITeachingD10\.emergencyAbsence\(item\)/);
});


test('Calendar cards identify their Course and never relabel active Courses as proposals', () => {
  assert.match(source, /courseName=item\.course_title\|\|item\.courseTitle/);
  assert.match(source, /title\.append\(el\('strong','',courseName\)/);
});

test('Calendar API projection preserves real Course names', () => {
  const service = fs.readFileSync(path.join(root, 'teaching/d23/service.js'), 'utf8');
  assert.match(service, /courseTitle:row\.courseTitle\|\|row\.course_title/);
  assert.match(service, /courseTitleById/);
  assert.match(service, /candidate\.courseTitle\|\|courseTitleById/);
});
