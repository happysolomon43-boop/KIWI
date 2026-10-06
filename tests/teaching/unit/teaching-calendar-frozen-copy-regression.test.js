'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../../public/teaching-d09.js'), 'utf8');

test('Teaching Calendar preserves the frozen single-timetable contract wording', () => {
  assert.match(source, /Classes and announced assessments share one timetable/);
});
