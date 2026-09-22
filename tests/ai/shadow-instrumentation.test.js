'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');

test('Phase 3 keeps all 27 legacy Gemini calls while attaching shadow task identities', () => {
  const calls = source.match(/geminiModel\.generateContent\s*\(/g) || [];
  const taskIds = source.match(/taskId\s*:/g) || [];

  assert.equal(calls.length, 27);
  assert.equal(taskIds.length, 27);
  assert.match(source, /_aiRuntime\.observeLegacy\(taskId, _modelName\)/);
});

test('normal and Reckoning CBT are distinguished before shadow routing', () => {
  assert.match(
    source,
    /ai_task_id:\s*isReckoningExam\s*\?\s*['"]RECKONING_CBT['"]\s*:\s*['"]MAIN_CBT['"]/
  );
  assert.match(source, /const _taskId\s*=\s*_opts\.ai_task_id\s*\|\|\s*['"]MAIN_CBT['"]/);
});

test('all canonical legacy callsite task IDs are represented', () => {
  for (const taskId of [
    'CBT_COMPLETION',
    'FLASHCARD_GENERATION',
    'CARD_EXPLANATION',
    'IMPORT_IMAGE_EXTRACTION',
    'STUDY_TASK_GENERATION',
    'CONCEPT_CLUSTERING',
    'RECLASSIFICATION_ALERT',
    'MASTERY_MOMENT',
    'ZONE_DESCRIPTION',
    'WEEKLY_CHRONICLE',
    'HIDDEN_DISCOVERY',
    'WEEKLY_PERSONA',
    'WEEKLY_ANCHOR',
    'MORNING_BRIEF',
    'DAILY_INVITATIONS',
    'RETURN_GREETING',
    'BUBBLE_ADVISORY',
    'PRESSURE_EXPLANATION',
    'DEEP_AUDIT',
    'CHRONICLE_ARTIFACT',
    'QUICK_QUESTIONS',
    'EXAM_DEBRIEF',
    'LIVING_PERSONA',
    'RECKONING_DEBRIEF',
    'LIVING_ACHIEVEMENTS',
  ]) {
    assert.match(source, new RegExp(`taskId\\s*:\\s*['"]${taskId}['"]`), taskId);
  }
});

test('Phase 3 does not migrate production features to ai.run yet', () => {
  assert.doesNotMatch(source, /_aiRuntime\.orchestrator\.run\s*\(/);
});
