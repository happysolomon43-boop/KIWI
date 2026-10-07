'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('public/teaching-typography-system.css');
const html = read('public/teaching.html');

test('original Teaching typography loads before JavaScript and has one family owner', () => {
  assert.ok(html.indexOf('data-teaching-typography="canonical"') < html.indexOf('</head>'));
  assert.equal((html.match(/teaching-typography-system.css/g) || []).length, 1);
  for (const [role, family] of [['body','DM Sans'], ['display','Syne'], ['mono','JetBrains Mono']]) {
    assert.ok(css.includes('--teaching-font-' + role + ': "' + family + '"'));
    assert.ok(css.includes('--font-' + role + ': var(--teaching-font-' + role + ')'));
  }
  assert.ok(!read('public/teaching-display.js').includes('ensureTeachingTypographyStyles'));
  assert.ok(!read('public/teaching-interaction-system.js').includes('fonts.googleapis.com'));
});

test('typography stays centralized without universal metric overrides', () => {
  assert.ok(!css.includes('!important'));
  assert.ok(!css.includes('body *'));
  assert.ok(!css.includes('clamp('));
  assert.ok(!css.includes('.tc-math'));
  assert.ok(!css.includes('small,'));
  assert.match(css, /body \.tf-hero h2[\s\S]*font-weight: 600/);
  assert.match(css, /\.tf-card h3, \.tf-summary-card h3[\s\S]*font-family: var\(--font-body\)/);
  assert.match(css, /\.tf-card h3, \.tf-summary-card h3[\s\S]*font-weight: 700/);
  assert.doesNotMatch(css, /:is\(h1, h2, h3, h4, h5, h6[^}]+font-weight:/);
});

test('Schedule keeps display typography at the hero and uses body typography for dense operational text', () => {
  assert.match(css, /body :is\([\s\S]*\.teaching-schedule-x__card h3[\s\S]*\.teaching-schedule-x__metric strong[\s\S]*\) \{[\s\S]*font-family: var\(--font-body\)/);
  assert.match(css, /\.teaching-schedule-x__hero h2[\s\S]*font-family: var\(--font-display\)/);
  assert.match(css, /\.teaching-schedule-x__metric strong[\s\S]*font-weight: 600/);
});

test('native controls and uncovered error surfaces share original Teaching fonts', () => {
  assert.ok(css.includes('button, input, select, textarea, option'));
  for (const selector of ['[role="status"]', '[role="alert"]', '.tf-live', '.ti-error', '.tw-message', '.tc-message']) assert.ok(css.includes(selector));
  assert.ok(css.includes('overflow-wrap: anywhere'));
  assert.ok(css.includes('text-size-adjust: 100%'));
  assert.ok(css.includes('font-synthesis: none'));
  assert.ok(css.includes('font-stretch: normal'));
});
