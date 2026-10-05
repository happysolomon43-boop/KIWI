'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(relative) {
  return fs.readFileSync(path.resolve(__dirname, '../../../', relative), 'utf8');
}

test('Teaching guided review flow JavaScript parses as a standalone browser asset', () => {
  const source = read('public/teaching-flow-integrity.js');
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'teaching-flow-integrity.js' }));
});

test('Teaching guided review flow keeps Course Plan, Timetable and Final Review as distinct sections', () => {
  const source = read('public/teaching-flow-integrity.js');
  assert.match(source, /id:'course-plan',label:'Course Plan'/);
  assert.match(source, /id:'timetable-review',label:'Timetable'/);
  assert.match(source, /id:'activation',label:'Final Review'/);
  assert.match(source, /Accept final review/);
  assert.match(source, /Start Course/);
  assert.match(source, /Repair timetable/);
});

test('Teaching flow bootstrap waits for D08 D09 and D10 before replacing registered sections', () => {
  const bootstrap = read('public/teaching-unified-upload.js');
  assert.match(bootstrap, /KIWITeachingD08/);
  assert.match(bootstrap, /KIWITeachingD09/);
  assert.match(bootstrap, /KIWITeachingD10/);
  assert.match(bootstrap, /teaching-flow-integrity\.js/);
  assert.match(bootstrap, /teaching-flow-integrity\.css/);
});

test('Teaching flow stylesheet contains mobile and reduced-motion safeguards', () => {
  const css = read('public/teaching-flow-integrity.css');
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.tf-journey/);
  assert.match(css, /\.tf-slot/);
});
