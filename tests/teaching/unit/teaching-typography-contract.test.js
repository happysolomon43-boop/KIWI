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
test('original component metrics and mathematical typography are not globally overridden', () => {
  assert.ok(!css.includes('!important'));
  assert.ok(!css.includes('body *'));
  assert.ok(!css.includes('font-weight:'));
  assert.ok(!css.includes('letter-spacing:'));
  assert.ok(!css.includes('clamp('));
  assert.ok(!css.includes('.tc-math'));
  assert.ok(!css.includes('small,'));
  assert.equal((css.match(/font-size:/g) || []).length, 1, 'Only status surfaces need a missing default size');
});
test('native controls and uncovered error surfaces share original Teaching fonts', () => {
  assert.ok(css.includes('button, input, select, textarea, option'));
  for (const selector of ['[role="status"]', '[role="alert"]', '.tf-live', '.ti-error', '.tw-message', '.tc-message']) assert.ok(css.includes(selector));
  assert.ok(css.includes('overflow-wrap: anywhere'));
  assert.ok(css.includes('text-size-adjust: 100%'));
});
