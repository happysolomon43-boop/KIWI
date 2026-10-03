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

test('shared runtime escapes stale replacement documents and version-loads the Teaching bootstrap', () => {
  const runtime = read('public/kiwi-runtime-config.js');
  assert.match(runtime, /dataset\?\.app !== 'kiwi-teaching'/);
  assert.match(runtime, /querySelector\('\.d23-shell'\)/);
  assert.match(runtime, /location\.replace\(clean\.href\)/);
  assert.match(runtime, /original-20261003/);
  assert.match(runtime, /import\('\/teaching-bootstrap\.js\?v=20261003-visible-features-1'\)/);
  assert.doesNotMatch(runtime, /import\('\/teaching-d15\.js/);
  assert.doesNotMatch(runtime, /import\('\/teaching-original-bridge\.js/);
});

test('Teaching bootstrap waits for established registries rather than backend-rendered view state', () => {
  const bootstrap = read('public/teaching-bootstrap.js');
  assert.match(bootstrap, /waitForEstablishedTeachingRegistries/);
  assert.match(bootstrap, /KIWI_API_CLIENT\?\.kiwiApiRequest/);
  assert.match(bootstrap, /KIWITeachingNavigation\?\.register/);
  assert.match(bootstrap, /KIWITeachingCourses\?\.registerSection/);
  assert.doesNotMatch(bootstrap, /#teachingApp \.teaching-view/);
  assert.doesNotMatch(bootstrap, /teachingSessionBack/);
  assert.match(bootstrap, /__KIWI_TEACHING_FEATURE_BOOTSTRAP__/);
});

test('Results failure cannot prevent the accepted original-shell information bridge from loading', () => {
  const bootstrap = read('public/teaching-bootstrap.js');
  const d15 = bootstrap.indexOf('`/teaching-d15.js?v=${BOOTSTRAP_VERSION}`');
  const bridge = bootstrap.indexOf('`/teaching-original-bridge.js?v=${BOOTSTRAP_VERSION}`');
  assert.ok(d15 >= 0, 'Results must remain part of the Teaching feature bootstrap');
  assert.ok(bridge > d15, 'the information bridge should load after the Results attempt');
  assert.match(bootstrap, /resultsReady = false/);
  assert.match(bootstrap, /continuing with the remaining Teaching surfaces/);
});

test('feature bootstrap is idempotent and cannot create a second UI owner', () => {
  const bootstrap = read('public/teaching-bootstrap.js');
  assert.match(bootstrap, /state === 'loading' \|\| state === 'ready' \|\| state === 'degraded'/);
  assert.match(bootstrap, /dataset\.teachingFeatures/);
  assert.doesNotMatch(bootstrap, /d23-shell|renderToday|renderCourses|renderRecord|d23-mobile-dock/);
});
