'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');

test('Phase 6 has zero legacy Gemini calls and 27 live orchestrator callsites', () => {
  assert.equal((source.match(/geminiModel\.generateContent\s*\(/g) || []).length, 0);
  assert.equal((source.match(/\bai\.run\s*\(/g) || []).length, 27);
});

test('normal and Reckoning CBT share the VVIP generator but retain distinct task identity', () => {
  assert.match(
    source,
    /ai_task_id:\s*isReckoningExam\s*\?\s*['"]RECKONING_CBT['"]\s*:\s*['"]MAIN_CBT['"]/
  );
  assert.match(source, /const _taskId\s*=\s*_opts\.ai_task_id\s*\|\|\s*['"]MAIN_CBT['"]/);
  assert.match(source, /ai\.run\(\s*_taskId/);
});

test('VVIP direct feature calls now execute through ai.run', () => {
  for (const taskId of [
    'CBT_COMPLETION',
    'FLASHCARD_GENERATION',
    'IMPORT_IMAGE_EXTRACTION',
  ]) {
    assert.match(source, new RegExp(`ai\\.run\\(\\s*['"]${taskId}['"]`), taskId);
  }
});

test('VIP and IP tasks remain live through the centralized orchestrator', () => {
  for (const taskId of [
    'QUICK_QUESTIONS',
    'STUDY_TASK_GENERATION',
    'CONCEPT_CLUSTERING',
    'WEEKLY_CHRONICLE',
    'WEEKLY_ANCHOR',
    'MORNING_BRIEF',
    'DAILY_INVITATIONS',
    'BUBBLE_ADVISORY',
    'PRESSURE_EXPLANATION',
    'DEEP_AUDIT',
    'EXAM_DEBRIEF',
    'RECKONING_DEBRIEF',
    'LIVING_PERSONA',
    'WEEKLY_PERSONA',
    'LIVING_ACHIEVEMENTS',
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

test('feature code no longer owns provider thinking levels or model IDs', () => {
  assert.doesNotMatch(source, /thinkingConfig\s*:/);
  assert.doesNotMatch(source, /modelOverride/);
  assert.doesNotMatch(source, /gemini-\d/);
});
