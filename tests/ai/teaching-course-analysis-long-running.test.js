'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AI_TASKS, AI_EXECUTION_LANES } = require('../../services/ai/task-registry');
const {
  AI_EXECUTION_PROFILES,
  EXECUTION_PROFILE_CONFIG,
  resolveExecutionProfile,
} = require('../../services/ai/orchestrator');
const { TPF02_EXECUTION_PROFILE } = require('../../teaching/orchestrator/ai-adapter');

test('Teaching TPF-02 uses the centrally governed long-running analysis profile', () => {
  assert.equal(TPF02_EXECUTION_PROFILE, AI_EXECUTION_PROFILES.LONG_RUNNING_ANALYSIS);
  const profile = resolveExecutionProfile(AI_TASKS.MAIN_CBT, TPF02_EXECUTION_PROFILE);

  assert.equal(profile.name, 'LONG_RUNNING_ANALYSIS');
  assert.equal(profile.operationTimeoutMs, 10 * 60 * 1000);
  assert.equal(profile.attemptTimeoutMs, 5 * 60 * 1000);
  assert.equal(profile.executionLane, AI_EXECUTION_LANES.BACKGROUND);
  assert.equal(profile.retryPolicy.maxAttemptsPerRoute, 1);
  assert.equal(profile.retryPolicy.maxTransientAttemptsPerRoute, 1);
  assert.equal(EXECUTION_PROFILE_CONFIG.LONG_RUNNING_ANALYSIS.operationTimeoutMs, profile.operationTimeoutMs);
});

test('ordinary MAIN_CBT calls keep their existing task deadlines and critical admission lane', () => {
  const profile = resolveExecutionProfile(AI_TASKS.MAIN_CBT, null);

  assert.equal(profile.name, null);
  assert.equal(profile.operationTimeoutMs, 180000);
  assert.equal(profile.attemptTimeoutMs, null);
  assert.equal(profile.executionLane, AI_TASKS.MAIN_CBT.executionLane);
  assert.equal(profile.retryPolicy, null);
  assert.equal(AI_TASKS.MAIN_CBT.attemptTimeoutMs, 75000);
});

test('execution profile names are centrally allowlisted and fail closed', () => {
  assert.throws(
    () => resolveExecutionProfile(AI_TASKS.MAIN_CBT, 'feature_supplied_timeout'),
    (error) => error?.code === 'CONFIG' && /Unknown AI execution profile/.test(error.message)
  );
});

test('TPF-02 adapter applies long-running profile without changing the central task route', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../teaching/orchestrator/ai-adapter.js'),
    'utf8'
  );
  const routePolicy = fs.readFileSync(
    path.resolve(__dirname, '../../teaching/d30/route-policy.js'),
    'utf8'
  );

  assert.match(source, /executionProfile:directTpf02\?TPF02_EXECUTION_PROFILE:null/);
  assert.match(source, /TPF02_EXECUTION_PROFILE='LONG_RUNNING_ANALYSIS'/);
  assert.match(routePolicy, /TEACHING_AI_TASK\s*=\s*'MAIN_CBT'/);
  assert.match(routePolicy, /WEBSITE_DEFAULT_AI_TASK\s*=\s*TEACHING_AI_TASK/);
  assert.match(routePolicy, /COURSE_PLAN_AI_TASK\s*=\s*TEACHING_AI_TASK/);
});
