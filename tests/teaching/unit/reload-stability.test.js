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
  assert.match(html, /src="\/teaching\.js"/);
});

test('rejected D23 visible-shell implementation files are removed from production source', () => {
  assert.equal(exists('public/teaching-d23-live.js'), false);
  assert.equal(exists('public/teaching-d23-live.css'), false);
});

test('shared runtime config is presentation-neutral and never owns Teaching UI startup', () => {
  const runtime = read('public/kiwi-runtime-config.js');
  assert.match(runtime, /KIWI_RUNTIME_CONFIG/);
  assert.doesNotMatch(runtime, /teaching-bootstrap|teaching-original-bridge|teaching-d23|d23-shell|location\.replace/);
  assert.doesNotMatch(runtime, /\bimport\s*\(/);
});

test('original Teaching module stack loads D23 as a first-class dependency', () => {
  const d16 = read('public/teaching-d16.js');
  const d23 = read('public/teaching-d23.js');
  assert.match(d16, /import\('\.\/teaching-d23\.js'\)/);
  assert.match(d23, /window\.KIWITeachingNavigation/);
  assert.match(d23, /window\.KIWITeachingCourses/);
  assert.equal(exists('public/teaching-bootstrap.js'), false);
  assert.equal(exists('public/teaching-original-bridge.js'), false);
});

test('native D23 information module extends the established shell and cannot create a second UI owner', () => {
  const d23 = read('public/teaching-d23.js');
  assert.match(d23, /registerSurfaces\(\)/);
  assert.match(d23, /buildPrimaryDock\(\)/);
  assert.doesNotMatch(d23, /d23-shell|renderToday\(|renderCourses\(|d23-mobile-dock/);
  assert.doesNotMatch(d23, /document\.body\.replaceChildren/);
});
