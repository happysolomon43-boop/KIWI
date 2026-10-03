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

test('shared runtime only escapes stale replacement documents and delegates Teaching startup', () => {
  const runtime = read('public/kiwi-runtime-config.js');
  assert.match(runtime, /dataset\?\.app !== 'kiwi-teaching'/);
  assert.match(runtime, /querySelector\('\.d23-shell'\)/);
  assert.match(runtime, /location\.replace\(clean\.href\)/);
  assert.match(runtime, /original-20261003/);
  assert.match(runtime, /import\('\/teaching-bootstrap\.js'\)/);
  assert.doesNotMatch(runtime, /import\('\/teaching-d15\.js'\)/);
  assert.doesNotMatch(runtime, /import\('\/teaching-original-bridge\.js'\)/);
});

test('Teaching-only bootstrap waits for the original shell then mounts accepted feature surfaces', () => {
  const bootstrap = read('public/teaching-bootstrap.js');
  assert.match(bootstrap, /waitForEstablishedTeachingShell/);
  assert.match(bootstrap, /#teachingApp \.teaching-view/);
  assert.match(bootstrap, /KIWITeachingNavigation\?\.register/);
  assert.match(bootstrap, /KIWITeachingCourses\?\.registerSection/);
  assert.match(bootstrap, /__KIWI_TEACHING_FEATURE_BOOTSTRAP__/);

  const d15 = bootstrap.indexOf("import('/teaching-d15.js')");
  const bridge = bootstrap.indexOf("import('/teaching-original-bridge.js')");
  assert.ok(d15 >= 0, 'Results must be part of the Teaching feature bootstrap');
  assert.ok(bridge > d15, 'the original-shell information bridge must load after Results');
});

test('feature bootstrap is idempotent and cannot create a second UI owner', () => {
  const bootstrap = read('public/teaching-bootstrap.js');
  assert.match(bootstrap, /state === 'loading' \|\| state === 'ready'/);
  assert.doesNotMatch(bootstrap, /d23-shell|renderToday|renderCourses|renderRecord|d23-mobile-dock/);
});
