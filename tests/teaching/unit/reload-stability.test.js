'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

test('Teaching production document keeps the established shell and does not load the rejected D23 visible UI', () => {
  const html = read('public/teaching.html');
  assert.doesNotMatch(html, /teaching-d23-live\.(?:js|css)/);
  assert.doesNotMatch(html, /class="d23-shell"/);
  assert.match(html, /id="teachingApp"/);
  assert.match(html, /src="\/teaching\.js\?v=20261003-location-restore-1"/);
});

test('Teaching refresh restores the last valid destination and Course section', () => {
  const shell = read('public/teaching.js');
  assert.match(shell, /TEACHING_LOCATION_STORAGE_KEY = 'kiwi\.teaching\.location\.v1'/);
  assert.match(shell, /window\.sessionStorage\.setItem\(TEACHING_LOCATION_STORAGE_KEY/);
  assert.match(shell, /saved\.view === 'navigation'/);
  assert.match(shell, /teachingNavigationItems\.get\(saved\.navigationId\)/);
  assert.match(shell, /saved\.view === 'course'/);
  assert.match(shell, /getTeachingCourse\(saved\.courseId\)/);
  assert.match(shell, /teachingCourseSections\.has\(saved\.sectionId\)/);
  assert.match(shell, /if \(restoreTeachingLocation\(\)\) return true/);
});

test('rejected D23 visible-shell implementation files are removed from production source', () => {
  assert.equal(exists('public/teaching-d23-live.js'), false);
  assert.equal(exists('public/teaching-d23-live.css'), false);
});

test('shared runtime config is presentation-neutral and never owns Teaching UI startup', () => {
  const runtime = read('public/kiwi-runtime-config.js');
  assert.match(runtime, /KIWI_RUNTIME_CONFIG/);
  assert.doesNotMatch(runtime, /teaching-bootstrap|teaching-original-bridge|teaching-d15|teaching-d23|d23-shell|location\.replace/);
  assert.doesNotMatch(runtime, /\bimport\s*\(/);
});

test('original Teaching document loads independent native modules in dependency order', () => {
  const html = read('public/teaching.html');
  const entry = read('public/teaching-d16.js');
  const d23 = read('public/teaching-d23.js');
  const d16Import = html.indexOf('/teaching-d16.js?v=20261003-runtime-fix-2');
  const d15Import = html.indexOf('/teaching-d15.js?v=20261003-runtime-fix-1');
  const d23Import = html.indexOf('/teaching-d23.js?v=20261003-runtime-fix-1');
  assert.ok(d16Import >= 0);
  assert.ok(d15Import > d16Import);
  assert.ok(d23Import > d15Import);
  assert.doesNotMatch(entry, /\bimport\s*\(/);
  assert.match(entry, /Teaching Work requires KIWI Teaching navigation and API client/);
  assert.match(d23, /window\.KIWITeachingNavigation/);
  assert.match(d23, /window\.KIWITeachingCourses/);
  assert.equal(exists('public/teaching-bootstrap.js'), false);
  assert.equal(exists('public/teaching-original-bridge.js'), false);
  assert.equal(exists('public/teaching-d16-core.js'), false);
});

test('native D23 information module extends the established shell and cannot create a second UI owner', () => {
  const d23 = read('public/teaching-d23.js');
  assert.match(d23, /registerSurfaces\(\)/);
  assert.match(d23, /buildPrimaryDock\(\)/);
  assert.doesNotMatch(d23, /d23-shell|renderToday\(|renderCourses\(|d23-mobile-dock/);
  assert.doesNotMatch(d23, /document\.body\.replaceChildren/);
});
