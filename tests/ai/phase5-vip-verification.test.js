'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
const {
  AI_TASKS,
  AI_CLASSES,
  REASONING_LEVELS,
  QUALITY_FLOORS,
} = require('../../services/ai/task-registry');
const { createModelRouter } = require('../../services/ai/model-router');

const VIP_EXPECTED = Object.freeze({
  STUDY_TASK_GENERATION: { reasoning: 'MEDIUM', floor: 'FLASH_LITE', degradable: true, calls: 1 },
  CONCEPT_CLUSTERING: { reasoning: 'MEDIUM', floor: 'FLASH', degradable: false, calls: 1 },
  WEEKLY_CHRONICLE: { reasoning: 'MEDIUM', floor: 'FLASH', degradable: false, calls: 1 },
  WEEKLY_PERSONA: { reasoning: 'LOW', floor: 'FLASH_LITE', degradable: true, calls: 1 },
  WEEKLY_ANCHOR: { reasoning: 'MEDIUM', floor: 'FLASH_LITE', degradable: true, calls: 1 },
  MORNING_BRIEF: { reasoning: 'LOW', floor: 'FLASH_LITE', degradable: true, calls: 1 },
  DAILY_INVITATIONS: { reasoning: 'MEDIUM', floor: 'FLASH_LITE', degradable: true, calls: 1 },
  BUBBLE_ADVISORY: { reasoning: 'MEDIUM', floor: 'FLASH', degradable: false, calls: 1 },
  PRESSURE_EXPLANATION: { reasoning: 'MEDIUM', floor: 'FLASH_LITE', degradable: true, calls: 1 },
  DEEP_AUDIT: { reasoning: 'HIGH', floor: 'FLASH', degradable: false, calls: 1 },
  QUICK_QUESTIONS: { reasoning: 'MEDIUM', floor: 'FLASH', degradable: false, calls: 1 },
  EXAM_DEBRIEF: { reasoning: 'MEDIUM', floor: 'FLASH_LITE', degradable: true, calls: 2 },
  LIVING_PERSONA: { reasoning: 'MEDIUM', floor: 'FLASH', degradable: false, calls: 1 },
  RECKONING_DEBRIEF: { reasoning: 'MEDIUM', floor: 'FLASH_LITE', degradable: true, calls: 1 },
  LIVING_ACHIEVEMENTS: { reasoning: 'MEDIUM', floor: 'FLASH', degradable: false, calls: 1 },
});

function countLiteralCalls(taskId) {
  const re = new RegExp(`\\bai\\.run\\s*\\(\\s*['"]${taskId}['"]`, 'g');
  return (source.match(re) || []).length;
}

test('Phase 5 has exactly fifteen canonical VIP tasks', () => {
  const actual = Object.entries(AI_TASKS)
    .filter(([, config]) => config.class === AI_CLASSES.VIP)
    .map(([id]) => id)
    .sort();

  assert.deepEqual(actual, Object.keys(VIP_EXPECTED).sort());
});

test('every VIP feature remains live through ai.run with the expected callsite count', () => {
  for (const [taskId, expected] of Object.entries(VIP_EXPECTED)) {
    assert.equal(countLiteralCalls(taskId), expected.calls, taskId);
  }

  const totalVipCallsites = Object.values(VIP_EXPECTED)
    .reduce((sum, config) => sum + config.calls, 0);
  assert.equal(totalVipCallsites, 16);
});

test('VIP reasoning, quality floors, and degradation permissions still match the accepted policy', () => {
  for (const [taskId, expected] of Object.entries(VIP_EXPECTED)) {
    const config = AI_TASKS[taskId];
    assert.equal(config.reasoning, REASONING_LEVELS[expected.reasoning], `${taskId} reasoning`);
    assert.equal(config.qualityFloor, QUALITY_FLOORS[expected.floor], `${taskId} floor`);
    assert.equal(config.degradationAllowed, expected.degradable, `${taskId} degradation`);
  }
});

test('non-degradable VIP tasks stay on Flash while degradable VIP tasks append Lite only after Flash', () => {
  const router = createModelRouter();

  for (const [taskId, expected] of Object.entries(VIP_EXPECTED)) {
    const models = router.resolveCandidates(taskId).map((entry) => entry.modelId);

    assert.deepEqual(models.slice(0, 3), [
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
    ], `${taskId} Flash chain`);

    if (expected.degradable) {
      assert.deepEqual(models.slice(3), [
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
      ], `${taskId} Lite fallback`);
    } else {
      assert.equal(models.some((model) => model.includes('lite')), false, taskId);
    }
  }
});

test('Phase 5 preserved feature-owned output budgets where they existed', () => {
  assert.match(
    source,
    /ai\.run\(['"]QUICK_QUESTIONS['"][\s\S]{0,500}maxOutputTokens:\s*Math\.max\(4000,\s*count\s*\*\s*900\)/
  );
  assert.match(
    source,
    /ai\.run\(['"]EXAM_DEBRIEF['"][\s\S]{0,500}maxOutputTokens:\s*512/
  );
});

test('VIP migration did not reintroduce provider-specific model or thinking decisions in feature code', () => {
  assert.doesNotMatch(source, /thinkingConfig\s*:/);
  assert.doesNotMatch(source, /modelOverride\s*:/);
  assert.doesNotMatch(source, /gemini-\d+(?:\.\d+)?-[a-z0-9-]+/i);
});
