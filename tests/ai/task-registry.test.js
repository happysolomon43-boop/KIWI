'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_CAPABILITIES, AI_INPUT_MODALITIES } = require('../../services/ai/capabilities');
const {
  AI_CLASSES,
  AI_EXECUTION_LANES,
  REASONING_LEVELS,
  AI_TASKS,
  CANONICAL_AI_TASK_IDS,
  validateTaskRegistry,
} = require('../../services/ai/task-registry');

test('canonical task registry validates without provider/model knowledge', () => {
  assert.deepEqual(validateTaskRegistry(), []);
  assert.deepEqual(CANONICAL_AI_TASK_IDS, Object.keys(AI_TASKS));
});

test('high-stakes assessment and knowledge-creation tasks keep VVIP class and required capabilities', () => {
  for (const taskId of ['MAIN_CBT', 'RECKONING_CBT', 'CBT_COMPLETION', 'CBT_QUESTION_AUDIT', 'FLASHCARD_GENERATION', 'IMPORT_IMAGE_EXTRACTION']) {
    const task = AI_TASKS[taskId];
    assert.equal(task.class, AI_CLASSES.VVIP, taskId);
    assert.ok(task.capabilities.includes(AI_CAPABILITIES.INFERENCE), taskId);
    assert.ok(task.capabilities.includes(AI_CAPABILITIES.REASONING), taskId);
    assert.equal(task.degradationAllowed, false, taskId);
  }
});

test('assessment reasoning requirements remain explicit and provider-neutral', () => {
  for (const taskId of ['MAIN_CBT', 'RECKONING_CBT', 'CBT_COMPLETION', 'CBT_QUESTION_AUDIT', 'FLASHCARD_GENERATION']) {
    assert.equal(AI_TASKS[taskId].reasoning, REASONING_LEVELS.HIGH, taskId);
  }
  assert.equal(AI_TASKS.IMPORT_IMAGE_EXTRACTION.reasoning, REASONING_LEVELS.MEDIUM);
  assert.deepEqual(AI_TASKS.IMPORT_IMAGE_EXTRACTION.inputModalities, [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE]);
});

test('presentation tasks remain low-cost policy requests without selecting a model family', () => {
  for (const taskId of ['CARD_EXPLANATION', 'RECLASSIFICATION_ALERT', 'MASTERY_MOMENT', 'ZONE_DESCRIPTION', 'HIDDEN_DISCOVERY', 'RETURN_GREETING', 'CHRONICLE_ARTIFACT']) {
    assert.equal(AI_TASKS[taskId].class, AI_CLASSES.IP, taskId);
  }
});

test('scheduled synthesis stays background while assessment stays critical', () => {
  assert.equal(AI_TASKS.MAIN_CBT.executionLane, AI_EXECUTION_LANES.CRITICAL);
  assert.equal(AI_TASKS.RECKONING_CBT.executionLane, AI_EXECUTION_LANES.CRITICAL);
  assert.equal(AI_TASKS.MORNING_BRIEF.executionLane, AI_EXECUTION_LANES.BACKGROUND);
  assert.equal(AI_TASKS.STUDY_TASK_GENERATION.executionLane, AI_EXECUTION_LANES.BACKGROUND);
});
