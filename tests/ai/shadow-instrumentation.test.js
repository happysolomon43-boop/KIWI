'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');

test('Phase 6 routes all 27 canonical AI callsites live through ai.run', () => {
  const legacyCalls = source.match(/geminiModel\.generateContent\s*\(/g) || [];
  const liveCalls = source.match(/\bai\.run\s*\(/g) || [];

  assert.equal(legacyCalls.length, 0);
  assert.equal(liveCalls.length, 27);
  assert.doesNotMatch(source, /const geminiModel\s*=\s*\{/);
});

test('normal and Reckoning CBT remain distinct VVIP task identities', () => {
  assert.match(
    source,
    /ai_task_id:\s*isReckoningExam\s*\?\s*['"]RECKONING_CBT['"]\s*:\s*['"]MAIN_CBT['"]/
  );
  assert.match(source, /const _taskId\s*=\s*_opts\.ai_task_id\s*\|\|\s*['"]MAIN_CBT['"]/);
  assert.match(source, /ai\.run\(\s*_taskId/);
});

test('all VVIP generation paths execute through the orchestrator', () => {
  for (const taskId of [
    'CBT_COMPLETION',
    'FLASHCARD_GENERATION',
    'IMPORT_IMAGE_EXTRACTION',
  ]) {
    assert.match(source, new RegExp(`ai\\.run\\(\\s*['"]${taskId}['"]`), taskId);
  }
});

test('all VIP task IDs remain live through ai.run', () => {
  for (const taskId of [
    'STUDY_TASK_GENERATION',
    'CONCEPT_CLUSTERING',
    'WEEKLY_CHRONICLE',
    'WEEKLY_PERSONA',
    'WEEKLY_ANCHOR',
    'MORNING_BRIEF',
    'DAILY_INVITATIONS',
    'BUBBLE_ADVISORY',
    'PRESSURE_EXPLANATION',
    'DEEP_AUDIT',
    'QUICK_QUESTIONS',
    'EXAM_DEBRIEF',
    'LIVING_PERSONA',
    'RECKONING_DEBRIEF',
    'LIVING_ACHIEVEMENTS',
  ]) {
    assert.match(source, new RegExp(`ai\\.run\\(\\s*['"]${taskId}['"]`), taskId);
  }
});

test('all seven IP task IDs remain live through ai.run', () => {
  for (const taskId of [
    'CARD_EXPLANATION',
    'RECLASSIFICATION_ALERT',
    'MASTERY_MOMENT',
    'ZONE_DESCRIPTION',
    'HIDDEN_DISCOVERY',
    'RETURN_GREETING',
    'CHRONICLE_ARTIFACT',
  ]) {
    assert.match(source, new RegExp(`ai\\.run\\(\\s*['"]${taskId}['"]`), taskId);
  }
});

test('feature code no longer contains provider thinking or model overrides', () => {
  assert.doesNotMatch(source, /thinkingConfig\s*:/);
  assert.doesNotMatch(source, /modelOverride\s*:/);
  assert.doesNotMatch(source, /gemini-\d+(?:\.\d+)?-[a-z0-9-]+/i);
});
