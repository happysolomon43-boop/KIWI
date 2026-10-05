'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Teaching renders one enriched active Course list without a late replacement renderer', () => {
  const shell = read('public/teaching.js');
  const bridge = read('public/teaching-d23.js');
  assert.match(shell, /kiwiApiRequest\('\/teaching\/information\/courses'\)/);
  assert.match(shell, /teacher: detail\.teacher/);
  assert.match(shell, /restoredCourse\.information_overview/);
  assert.doesNotMatch(bridge, /grid\.replaceChildren\(\);\s*if \(!rows\.length\)/);
  assert.match(shell, /function canonicalCourseRows/);
  assert.match(shell, /course\.source_version_ref/);
});

test('Teaching normalizes display names and assigns stable Course accents', () => {
  const display = read('public/teaching-display.js');
  const shell = read('public/teaching.js');
  assert.match(display, /function displayName/);
  assert.match(display, /function courseTone/);
  assert.match(display, /course\?\.subject_id/);
  assert.match(shell, /displayCourseName\(course\.title\)/);
  assert.match(shell, /decorateCourse\?\.\(card, course\)/);
});

test('Course materials overlay separates originals, flashcards and additional sources', () => {
  const bridge = read('public/teaching-d23.js');
  assert.match(bridge, /title:'Original notes'/);
  assert.match(bridge, /title:'KIWI flashcards'/);
  assert.match(bridge, /title:'Additional materials'/);
  assert.match(bridge, /supplemental when an original note exists/);
  assert.match(bridge, /Search materials by name, type or description/);
  assert.match(bridge, /\$\('details', 'ti-material-group'\)/);
});

test('preloaded Course overview still renders Materials and the other contextual actions', () => {
  const bridge = read('public/teaching-d23.js');
  assert.match(bridge, /const cachedOverview = courses\.getCourse/);
  assert.match(bridge, /const data = cachedOverview \|\| await kiwiApiRequest/);
  assert.doesNotMatch(bridge, /information_overview\) return;/);
  for (const action of ['Course Materials', 'Study Packs', 'Teacher', 'Requests']) assert.match(bridge, new RegExp(`action\\('${action}'`));
});

test('Create Course places the original-note upload beside the Subject selector', () => {
  const upload = read('public/teaching-unified-upload.js');
  assert.match(upload, /subjectField\.insertAdjacentElement\('afterend',original\)/);
  assert.match(upload, /Upload original note/);
  assert.match(upload, /flashcards remain available as supplemental retrieval practice/);
});
