'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const teachingHtmlPath = path.join(root, 'public', 'teaching.html');
const teachingJsPath = path.join(root, 'public', 'teaching.js');
const indexHtmlPath = path.join(root, 'index.html');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('Teaching uses a standalone document instead of rendering inside the KIWI shell', () => {
  const html = read(teachingHtmlPath);
  const js = read(teachingJsPath);
  const index = read(indexHtmlPath);

  assert.match(html, /data-app="kiwi-teaching"/);
  assert.match(html, /id="teachingApp"/);
  assert.match(html, /src="\/teaching\.js"/);
  assert.match(js, /window\.location\.assign\(TEACHING_PATH\)/);
  assert.doesNotMatch(js, /renderTeachingPage/);
  assert.doesNotMatch(js, /main\.innerHTML/);

  assert.match(index, /src="\/teaching\.js"/);
  assert.doesNotMatch(index, /teaching-frontend\.js/);
});

test('Teaching shell excludes the normal KIWI navigation inventory', () => {
  const html = read(teachingHtmlPath);
  const forbidden = [
    'Dashboard',
    'Library',
    'Study Session',
    'CBT Exam',
    'Exam Goals',
    'The Biome',
    'The Brain',
    'Living Profile',
  ];

  for (const label of forbidden) {
    assert.equal(
      html.includes(label),
      false,
      `Teaching standalone shell must not inherit normal KIWI menu label: ${label}`
    );
  }
});

test('Teaching has a dedicated broad menu with Settings and Switch to KIWI at the bottom', () => {
  const html = read(teachingHtmlPath);

  assert.match(html, /id="teachingMenuButton"/);
  assert.match(html, /id="teachingMenuPanel"/);
  assert.match(html, /class="teaching-menu-panel__footer"/);
  assert.match(html, /id="teachingSettingsButton"/);
  assert.match(html, />Settings</);
  assert.match(html, /id="teachingSwitchToKiwiButton"/);
  assert.match(html, />Switch to KIWI</);
});

test('Switching from Teaching back to KIWI requires an explicit confirmation', () => {
  const html = read(teachingHtmlPath);
  const js = read(teachingJsPath);

  assert.match(html, /id="teachingConfirmDialog"/);
  assert.match(html, /Stay in Teaching/);
  assert.match(html, /Switch to KIWI/);
  assert.match(js, /function requestSwitchToKiwi\(\)/);
  assert.match(js, /dialog\.showModal\(\)/);
  assert.match(js, /window\.location\.assign\(KIWI_PATH\)/);
});

test('Teaching bottom navigation is hidden and template-driven with no fixed item count', () => {
  const html = read(teachingHtmlPath);
  const js = read(teachingJsPath);

  assert.match(html, /id="teachingDockShell"[^>]*hidden/);
  assert.match(html, /id="teachingDockItemTemplate"/);
  assert.doesNotMatch(html, /teaching-dock__slot/);
  assert.doesNotMatch(html, /teaching-dock__placeholder/);

  assert.match(js, /const teachingNavigationItems = new Map\(\)/);
  assert.match(js, /function registerTeachingNavigationItem/);
  assert.match(js, /function unregisterTeachingNavigationItem/);
  assert.match(js, /shell\.hidden = teachingNavigationItems\.size === 0/);
  assert.match(js, /window\.KIWITeachingNavigation/);
  assert.doesNotMatch(js, /slice\(0,\s*5\)/);
  assert.doesNotMatch(js, /length\s*[<>]=?\s*5/);
});

test('Teaching suppresses Vercel live-feedback toolbar injection', () => {
  const html = read(teachingHtmlPath);
  const js = read(teachingJsPath);

  assert.match(html, /vercel-live-feedback/);
  assert.match(js, /function suppressVercelToolbar\(\)/);
  assert.match(js, /querySelectorAll\('vercel-live-feedback, \[data-vercel-feedback\]'\)/);
  assert.match(js, /new MutationObserver\(removeToolbar\)/);
});

test('Teaching switch is appended as a dashboard mode switch and redirects to teaching.html', () => {
  const js = read(teachingJsPath);

  assert.match(js, /pageWrap\.appendChild\(createTeachingSwitch\(\)\)/);
  assert.match(js, /Switch to KIWI Teaching\?/);
  assert.match(js, /const TEACHING_PATH = '\/teaching\.html'/);
});

test('Teaching frontend entry has valid JavaScript syntax', () => {
  execFileSync(process.execPath, ['--check', teachingJsPath], { stdio: 'pipe' });
});
