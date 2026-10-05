'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ACADEMIC_LIMITATIONS, assertAcademicLimitationsComplete } = require('../../teaching/d31');

const root = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('D31 academic limitation registry covers canonical meaning boundaries', () => {
  assert.equal(assertAcademicLimitationsComplete(), true);
  assert.equal(ACADEMIC_LIMITATIONS.length, 4);
  const ids = new Set(ACADEMIC_LIMITATIONS.map((item) => item.id));
  for (const id of [
    'UNOBSERVED_PHYSICAL_SKILLS',
    'EXTERNAL_RESOURCE_VISIBILITY',
    'AI_OWNER_OVERRIDE_NOT_EMPIRICAL_QUALIFICATION',
    'AUTHORITATIVE_RECORD_BOUNDARIES',
  ]) assert.ok(ids.has(id), id);
});

test('Teaching Settings exposes accessible Academic Transparency limitations', () => {
  const html = read('public/teaching.html');
  for (const marker of [
    'id="teachingTransparencyTitle"',
    'aria-labelledby="teachingTransparencyTitle"',
    'Physical and practical skills:',
    'External resources:',
    'route-level empirical qualification remains incomplete',
    'Missing evaluation evidence is not treated as a qualification pass',
    'Owner-authorized · evidence status preserved',
    'id="teachingAiTransparencyTitle"',
  ]) assert.ok(html.includes(marker), `missing Academic Transparency marker: ${marker}`);

  assert.ok(!html.includes('Teaching-specific settings will live here as the app is built.'), 'legacy empty Settings placeholder remains');
});

test('Academic Transparency UI is presentation-only and does not create client release controls', () => {
  const html = read('public/teaching.html');
  const js = read('public/teaching.js');
  assert.ok(!html.includes('TEACHING_D31_AI_RELEASE_MODE'));
  assert.ok(!js.includes('TEACHING_D31_AI_RELEASE_MODE'));
  assert.ok(!html.includes('OWNER_OVERRIDE_V1'));
  assert.ok(!js.includes('OWNER_OVERRIDE_V1'));
});
