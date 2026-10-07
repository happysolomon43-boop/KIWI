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
  assert.match(source, /Repair Semester timetable/);
});

test('Course Plan background actions expose authoritative running, success and failure states', () => {
  const source = read('public/teaching-flow-integrity.js');
  assert.match(source, /job\.completionConfirmed/);
  assert.match(source, /title:'Action completed'/);
  assert.match(source, /Course Plan regenerated successfully\. Version/);
  assert.match(source, /Course Plan regeneration failed/);
  assert.match(source, /has not been changed/);
  assert.match(source, /ACTIVE_PLAN_JOB_STATUSES/);
  assert.doesNotMatch(source, /Regeneration running in background';window\.setTimeout/);
});

test('Final Review uses the same structured status card as Course Plan for loading and completion', () => {
  const source = read('public/teaching-flow-integrity.js');
  assert.match(source, /title:'Preparing academic rules'/);
  assert.match(source, /title:'Academic rules prepared'/);
  assert.match(source, /setActionStatus\(live,notice\)/);
  assert.doesNotMatch(source, /live\.textContent='Academic rules prepared\.'/);
  assert.doesNotMatch(source, /live\.textContent='Preparing the Teacher and grading policy/);
});

test('Timetable actions explicitly rebuild the shared Semester timetable', () => {
  const source = read('public/teaching-flow-integrity.js');
  assert.match(source, /Shared Semester timetable/);
  assert.match(source, /Build Semester timetable/);
  assert.match(source, /Rebuild Semester timetable/);
  assert.match(source, /every schedulable Course/);
});

test('Schedule surfaces use the Course Plan skeleton instead of a plain loading message', () => {
  const legacy = read('public/teaching-d09.js');
  const experience = read('public/teaching-schedule-experience.js');
  for (const source of [legacy, experience]) {
    assert.match(source, /teaching-shell-skeleton/);
    assert.match(source, /teaching-skeleton-card/);
    assert.match(source, /teaching-skeleton-line/);
    assert.match(source, /teaching-skeleton-block/);
  }
  assert.doesNotMatch(legacy, /page\.replaceChildren\(el\('div','teaching-message','Loading semester and timetable…'\)\)/);
});

test('Teaching flow bootstrap waits for D08 D09 and D10 before replacing registered sections', () => {
  const bootstrap = read('public/teaching-unified-upload.js');
  assert.match(bootstrap, /KIWITeachingD08/);
  assert.match(bootstrap, /KIWITeachingD09/);
  assert.match(bootstrap, /KIWITeachingD10/);
  assert.match(bootstrap, /teaching-flow-integrity\.js/);
  assert.match(bootstrap, /teaching-flow-integrity\.css/);
});

test('Teaching flow stylesheet contains responsive timetable and journey safeguards', () => {
  const css = read('public/teaching-flow-integrity.css');
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /@media\(max-width:560px\)/);
  assert.match(css, /\.tf-journey/);
  assert.match(css, /\.tf-slot/);
  assert.match(css, /\.tf-actions\{display:grid;grid-template-columns:1fr\}/);
  assert.match(css, /\.tf-action-status\[data-kind="success"\]/);
  assert.match(css, /\.tf-action-status\[data-kind="error"\]/);
});
