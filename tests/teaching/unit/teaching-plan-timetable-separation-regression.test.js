'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('shared Semester availability never marks an uncreated Course Plan complete', () => {
  const flow = fs.readFileSync(path.join(root, 'public/teaching-flow-integrity.js'), 'utf8');
  const schedule = fs.readFileSync(path.join(root, 'public/teaching-d09.js'), 'utf8');
  const repository = fs.readFileSync(path.join(root, 'teaching/repositories/d09-scheduling.js'), 'utf8');

  assert.match(flow, /hasPlan=Boolean\(planReview\?\.plan\)/);
  assert.doesNotMatch(flow, /journey\(1,\{plan:true,/);
  assert.match(flow, /Shared Semester availability does not create a Course Plan/);
  assert.match(schedule, /item\.reason==='COURSE_PLAN_NOT_READY'/);
  assert.match(repository, /reason:'COURSE_PLAN_NOT_READY'/);
});

test('starting Course Plan generation stays on the current page', () => {
  const flow = fs.readFileSync(path.join(root, 'public/teaching-flow-integrity.js'), 'utf8');

  assert.match(flow, /Course Plan running in background/);
  assert.match(flow, /load\(\{showSkeleton:false\}\)/);
  assert.doesNotMatch(flow, /course-plan'\),\{method:'POST',body:\{\}\}\);await load\(\)/);
});

test('Teaching Settings owns scrolling while the page overlay is locked', () => {
  const html = fs.readFileSync(path.join(root, 'public/teaching.html'), 'utf8');
  const panelRule = html.match(/\.teaching-settings-panel\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';

  assert.match(panelRule, /height:\s*100dvh/);
  assert.match(panelRule, /overflow-y:\s*auto/);
  assert.match(panelRule, /overscroll-behavior:\s*contain/);
});
