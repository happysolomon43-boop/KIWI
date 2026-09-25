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

  assert.match(html, />Settings</);
  assert.match(html, /Back to KIWI/);
});

test('Teaching bottom navigation is placeholder-only until its IA is implemented', () => {
  const html = read(teachingHtmlPath);
  const slots = html.match(/class="teaching-dock__slot"/g) || [];

  assert.equal(slots.length, 5);
  assert.match(html, /class="teaching-dock"/);
  assert.doesNotMatch(html, /teaching-dock[^]*?>\s*(Home|Library|Study|Exam|More)\s*</);
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
