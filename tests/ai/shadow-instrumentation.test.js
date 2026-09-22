'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');

test('Phase 5 leaves only 4 VVIP legacy callsites and has 23 live orchestrator callsites', () => {
  const legacyCalls = source.match(/geminiModel\.generateContent\s*\(/g) || [];
  const taskIds = source.match(/taskId\s*:/g) || [];
  const liveCalls = source.match(/\bai\.run\s*\(/g) || [];

  assert.equal(legacyCalls.length, 4);
  assert.equal(taskIds.length, 4);
  assert.equal(liveCalls.length, 23);
  assert.match(source, /_aiRuntime\.observeLegacy\(taskId, _modelName\)/);
});

test('normal and Reckoning CBT remain distinguished while the shared VVIP generator is shadowed', () => {
  assert.match(
    source,
    /ai_task_id:\s*isReckoningExam\s*\?\s*['"]RECKONING_CBT['"]\s*:\s*['"]MAIN_CBT['"]/
  );
  assert.match(source, /const _taskId\s*=\s*_opts\.ai_task_id\s*\|\|\s*['"]MAIN_CBT['"]/);
});

test('the remaining direct legacy callsites are only VVIP generation paths', () => {
  assert.match(source, /taskId:\s*_taskId/);
  for (const taskId of [
    'CBT_COMPLETION',
    'FLASHCARD_GENERATION',
    'IMPORT_IMAGE_EXTRACTION',
  ]) {
    assert.match(source, new RegExp(`taskId\\s*:\\s*['"]${taskId}['"]`), taskId);
  }
});

test('all VIP task IDs now execute through ai.run', () => {
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
    assert.match(source, new RegExp(`ai\\.run\\(['"]${taskId}['"]`), taskId);
    assert.doesNotMatch(source, new RegExp(`taskId\\s*:\\s*['"]${taskId}['"]`), taskId);
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
    assert.match(source, new RegExp(`ai\\.run\\(['"]${taskId}['"]`), taskId);
  }
});

test('feature callsites no longer provide provider thinkingConfig outside VVIP legacy paths', () => {
  const liveSection = source.replace(
    /const geminiModel\s*=\s*\{[\s\S]*?\n\};/,
    ''
  );
  const thinkingOccurrences = liveSection.match(/thinkingConfig\s*:/g) || [];
  assert.equal(thinkingOccurrences.length, 3, 'only the three text VVIP legacy calls should still specify thinkingConfig');
});
