'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Teaching production document keeps the established shell and does not load the retired D23 visible UI', () => {
  const html = read('public/teaching.html');
  assert.doesNotMatch(html, /teaching-d23-live\.(?:js|css)/);
  assert.doesNotMatch(html, /class="d23-shell"/);
  assert.match(html, /id="teachingApp"/);
  assert.match(html, /src="\/teaching\.js"/);
});

test('runtime detects stale first-integration documents before feature bootstrap', () => {
  const runtime = read('public/kiwi-runtime-config.js');
  assert.match(runtime, /dataset\?\.app !== 'kiwi-teaching'/);
  assert.match(runtime, /querySelector\('\.d23-shell'\)/);
  assert.match(runtime, /teaching-d23-live\.css/);
  assert.match(runtime, /teaching-d23-live\.js/);
  assert.match(runtime, /location\.replace\(clean\.href\)/);
  assert.match(runtime, /original-20261003/);

  const staleGuard = runtime.indexOf('legacyVisibleShell');
  const featureBootstrap = runtime.indexOf('bootstrapTeachingFeatures');
  assert.ok(staleGuard >= 0 && featureBootstrap > staleGuard, 'stale-shell guard must run before feature bootstrap');
});

test('Teaching features mount only after the established original shell is visibly ready', () => {
  const runtime = read('public/kiwi-runtime-config.js');
  assert.match(runtime, /waitForEstablishedTeachingShell/);
  assert.match(runtime, /#teachingApp \.teaching-view/);
  assert.match(runtime, /KIWITeachingNavigation\?\.register/);
  assert.match(runtime, /KIWITeachingCourses\?\.registerSection/);
  assert.match(runtime, /__KIWI_TEACHING_FEATURE_BOOTSTRAP__/);

  const d15 = runtime.indexOf("import('/teaching-d15.js')");
  const bridge = runtime.indexOf("import('/teaching-original-bridge.js')");
  assert.ok(d15 >= 0, 'Results must be part of the Teaching feature bootstrap');
  assert.ok(bridge > d15, 'the original-shell information bridge must load after Results');
});

test('retired D23 visible-shell assets cannot take ownership of Teaching again', () => {
  const js = read('public/teaching-d23-live.js');
  const css = read('public/teaching-d23-live.css');

  assert.match(js, /Retired visible-shell compatibility guard/);
  assert.match(js, /querySelector\('\.d23-shell'\)/);
  assert.match(js, /location\.replace\(clean\.href\)/);
  assert.doesNotMatch(js, /const PRIMARY|renderToday|renderCourses|renderRecord|d23-mobile-dock/);

  assert.match(css, /Retired D23 replacement-shell stylesheet/);
  assert.doesNotMatch(css, /\.d23-shell\s*\{|\.d23-nav\s*\{|\.d23-mobile-dock\s*\{/);
});
