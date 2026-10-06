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
  assert.match(html, /src="\/teaching\.js(?:\?[^\"]+)?"/);
  assert.match(js, /window\.location\.assign\(KIWI_PATH\)/);
  assert.doesNotMatch(js, /renderTeachingPage/);
  assert.doesNotMatch(js, /main\.innerHTML/);

  assert.doesNotMatch(index, /src="\/teaching\.js"/);
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

test('Teaching uses the main KIWI type system and exposes Create Course navigation', () => {
  const html = read(teachingHtmlPath);
  const js = read(teachingJsPath);

  assert.match(html, /family=Syne/);
  assert.match(html, /family=DM\+Sans/);
  assert.match(html, /family=JetBrains\+Mono/);
  assert.match(html, /--font-display: "DM Sans"/);
  assert.match(html, /--font-body: "DM Sans"/);
  assert.match(html, /--font-mono: "JetBrains Mono"/);
  assert.match(js, /title: 'Overview'/);
  assert.match(js, /title: 'Create Course'/);
  assert.match(js, /Create course/);
  assert.doesNotMatch(js, /Stage 1 · Course Intake/);
  assert.match(js, /function renderCourseIntake\(\)/);
  assert.match(js, /function navigateTeaching\(view\)/);
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

test('Teaching bottom navigation stays hidden until four destinations are ready and Menu owns slot five', () => {
  const html = read(teachingHtmlPath);
  const js = read(teachingJsPath);

  assert.match(html, /id="teachingDockShell"[^>]*hidden/);
  assert.match(html, /id="teachingDockItemTemplate"/);
  assert.doesNotMatch(html, /teaching-dock__slot/);
  assert.doesNotMatch(html, /teaching-dock__placeholder/);

  assert.match(js, /const TEACHING_DOCK_LIMIT = 5/);
  assert.match(js, /const TEACHING_DOCK_DESTINATION_SLOTS = TEACHING_DOCK_LIMIT - 1/);
  assert.match(js, /const teachingNavigationItems = new Map\(\)/);
  assert.match(js, /function registerTeachingNavigationItem/);
  assert.match(js, /function unregisterTeachingNavigationItem/);
  assert.match(js, /dockReady = destinations\.length === TEACHING_DOCK_DESTINATION_SLOTS/);
  assert.match(js, /shell\.hidden = !dockReady/);
  assert.match(js, /if \(!dockReady\) return/);
  assert.match(js, /id: 'menu'/);
  assert.match(js, /label: 'Menu'/);
  assert.match(js, /onSelect: \(\) => setMenuOpen\(true/);
  assert.match(js, /window\.KIWITeachingNavigation/);

  assert.match(html, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(html, /body\[data-teaching-dock-visible="true"\] \.teaching-stage/);
});

test('Teaching suppresses Vercel live-feedback toolbar injection', () => {
  const html = read(teachingHtmlPath);
  const js = read(teachingJsPath);

  assert.match(html, /vercel-live-feedback/);
  assert.match(js, /function suppressVercelToolbar\(\)/);
  assert.match(js, /querySelectorAll\('vercel-live-feedback, \[data-vercel-feedback\]'\)/);
  assert.match(js, /new MutationObserver\(removeToolbar\)/);
});

test('Teaching switch is dashboard-owned, bottom-positioned, and requires confirmation', () => {
  const index = read(indexHtmlPath);
  const paintStart = index.indexOf('function _paintDashboard');
  const dashboardGrid = index.indexOf('<div class="dashboard-grid">', paintStart);
  const brainPreview = index.indexOf('id="brain-preview-card"', dashboardGrid);
  const switchPosition = index.indexOf('id="kiwiTeachingSwitch"', dashboardGrid);
  const rendererMarker = index.indexOf('// Canonical living-vine renderer.', dashboardGrid);

  assert.ok(paintStart >= 0);
  assert.ok(dashboardGrid > paintStart);
  assert.ok(brainPreview > dashboardGrid);
  assert.ok(switchPosition > brainPreview);
  assert.ok(rendererMarker > switchPosition);
  assert.match(index, /data-dashboard-owned="true"/);
  assert.match(index, /onclick="requestKiwiTeachingSwitch\(\)"/);
  assert.match(index, /function requestKiwiTeachingSwitch\(\)/);
  assert.match(index, /Switch to KIWI Teaching\?/);
  assert.match(index, /You are leaving the KIWI study app and opening KIWI Teaching\. Continue\?/);
  assert.match(index, /window\.location\.replace\("\/teaching\.html"\)/);
});

test('Teaching dashboard switch is not hidden behind runtime feature availability gates', () => {
  const js = read(teachingJsPath);

  assert.doesNotMatch(js, /TEACHING_ENABLED/);
  assert.doesNotMatch(js, /TEACHING_DEV_USER_IDS/);
  assert.doesNotMatch(js, /TEACHING_NOT_ENABLED/);
  assert.doesNotMatch(js, /status\?\.available/);
  assert.doesNotMatch(js, /getTeachingStatus/);
  assert.match(js, /function isTeachingDocument\(\)/);
  assert.match(js, /document\.getElementById\('teachingApp'\)/);
  assert.doesNotMatch(js, /function ensureDashboardTeachingSwitch\(\)/);
  assert.doesNotMatch(js, /function initKiwiDashboardBridge\(\)/);
});

test('Teaching shared API client and frontend entry have valid JavaScript syntax', () => {
  const sharedApiClientPath = path.join(root, 'public', 'kiwi-api-client.js');
  const sharedApiClient = read(sharedApiClientPath);

  assert.doesNotMatch(sharedApiClient, /\\n/);
  execFileSync(process.execPath, ['--check', sharedApiClientPath], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', teachingJsPath], { stdio: 'pipe' });
});

test('Teaching owns browser Back and dashboard entry does not leave a dashboard history entry', () => {
  const js = read(teachingJsPath);
  const index = read(indexHtmlPath);

  assert.match(index, /window\.location\.replace\("\/teaching\.html"\)/);
  assert.match(js, /function installTeachingHistoryGuard\(\)/);
  assert.match(js, /window\.history\.replaceState\(marker/);
  assert.match(js, /window\.history\.pushState\(marker/);
  assert.match(js, /window\.addEventListener\('popstate'/);
  assert.match(js, /installTeachingHistoryGuard\(\)/);
  assert.match(js, /window\.location\.assign\(KIWI_PATH\)/);
});
