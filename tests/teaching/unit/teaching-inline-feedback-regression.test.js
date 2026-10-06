'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('Teaching interaction wrapper no longer turns API failures into floating overlay toasts', () => {
  const source = fs.readFileSync(path.join(root, 'public/teaching-interaction-system.js'), 'utf8');
  assert.doesNotMatch(source, /kiwi-teaching-action-result/);
  assert.doesNotMatch(source, /toast\(/);
  assert.match(source, /finally\{endForButton\(triggerButton\);\}/);
});

test('Teaching API error messages are presented as an in-flow website-native status surface', () => {
  const source = fs.readFileSync(path.join(root, 'public/teaching-interaction-system.js'), 'utf8');
  assert.match(source, /\.teaching-message\[data-kind="error"\]/);
  assert.match(source, /position:relative;display:block/);
  assert.match(source, /border-radius:16px/);
  assert.match(source, /overflow-wrap:anywhere/);
});
