'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_CLASSES,
  AI_EXECUTION_LANES,
  AI_TASKS,
  CANONICAL_AI_TASK_IDS,
  QUALITY_FLOORS,
  REASONING_LEVELS,
  validateTaskRegistry,
} = require('../../services/ai/task-registry');

test('AI task registry is structurally valid', () => {
  assert.deepEqual(validateTaskRegistry(), []);
  assert.equal(CANONICAL_AI_TASK_IDS.length, 28);
});

test('AI task classes match the accepted Phase 1 inventory', () => {
  const counts = Object.values(AI_TASKS).reduce((acc, task) => {
    acc[task.class] = (acc[task.class] || 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(counts, {
    [AI_CLASSES.VVIP]: 6,
    [AI_CLASSES.VIP]: 15,
    [AI_CLASSES.IP]: 7,
  });
});

test('core assessment and knowledge creation tasks are VVIP with a Flash quality floor', () => {
  for (const taskId of [
    'MAIN_CBT',
    'RECKONING_CBT',
    'CBT_COMPLETION',
    'CBT_QUESTION_AUDIT',
    'FLASHCARD_GENERATION',
    'IMPORT_IMAGE_EXTRACTION',
  ]) {
    const task = AI_TASKS[taskId];
    assert.equal(task.class, AI_CLASSES.VVIP, taskId);
    assert.equal(task.qualityFloor, QUALITY_FLOORS.FLASH, taskId);
    assert.equal(task.degradationAllowed, false, taskId);
  }
});

test('main CBT, Reckoning CBT, completion, and flashcard generation retain high reasoning', () => {
  for (const taskId of [
    'MAIN_CBT',
    'RECKONING_CBT',
    'CBT_COMPLETION',
    'CBT_QUESTION_AUDIT',
    'FLASHCARD_GENERATION',
  ]) {
    assert.equal(AI_TASKS[taskId].reasoning, REASONING_LEVELS.HIGH, taskId);
  }
});

test('Reckoning declares a non-AI emergency fallback rather than silent model degradation', () => {
  assert.equal(
    AI_TASKS.RECKONING_CBT.emergencyFallback,
    'DETERMINISTIC_RECKONING_EXAM'
  );
  assert.equal(AI_TASKS.RECKONING_CBT.degradationAllowed, false);
});

test('IP presentation tasks use the Flash-Lite quality floor', () => {
  const ipTasks = Object.entries(AI_TASKS)
    .filter(([, task]) => task.class === AI_CLASSES.IP);

  assert.ok(ipTasks.length > 0);
  for (const [taskId, task] of ipTasks) {
    assert.equal(task.qualityFloor, QUALITY_FLOORS.FLASH_LITE, taskId);
  }
});


test('critical assessment stays critical while confirmed scheduled generation is background', () => {
  for (const taskId of ['MAIN_CBT', 'RECKONING_CBT', 'CBT_COMPLETION']) {
    assert.equal(
      AI_TASKS[taskId].executionLane,
      AI_EXECUTION_LANES.CRITICAL,
      taskId
    );
  }

  assert.equal(
    AI_TASKS.MORNING_BRIEF.executionLane,
    AI_EXECUTION_LANES.BACKGROUND
  );
  assert.equal(
    AI_TASKS.STUDY_TASK_GENERATION.executionLane,
    AI_EXECUTION_LANES.BACKGROUND
  );
  assert.equal(
    AI_TASKS.DAILY_INVITATIONS.executionLane,
    AI_EXECUTION_LANES.INTERACTIVE
  );
});
