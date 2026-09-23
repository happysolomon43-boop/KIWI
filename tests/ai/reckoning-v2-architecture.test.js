'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reckoning = require('../../services/reckoning');

test('Reckoning V2 final delivery exposes a LIVE backend facade', () => {
  const engine = reckoning.createReckoningEngine();
  for (const method of reckoning.ENGINE_METHODS) {
    assert.equal(typeof engine[method], 'function', `missing engine method: ${method}`);
  }

  const description = engine.describe();
  assert.equal(description.name, 'reckoning-v2');
  assert.equal(description.engineVersion, 2);
  assert.equal(description.architectureVersion, 1);
  assert.equal(description.status, 'LIVE');
  assert.equal(description.enabled, true);
  assert.equal(description.behaviorAuthority, 'v2');
  assert.equal(description.executionCore, true);
  assert.equal(description.consequenceFinalization, true);
});

test('Delivery E activation is explicit and immutable in configuration', () => {
  const config = reckoning.createReckoningConfig({
    enabled: false,
    behaviorAuthority: 'legacy',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.behaviorAuthority, 'v2');
  assert.equal(config.engineVersion, 2);
  assert.equal(config.execution.hardQuestionCap ?? config.planner.hardQuestionCap, 30);
  assert.equal(config.execution.safetyWindowMinutes, 45);
  assert.equal(Object.isFrozen(config), true);
});

test('accepted Reckoning concepts are centralized and immutable', () => {
  assert.deepEqual(Object.values(reckoning.QUESTION_ROLES), [
    'DIAGNOSTIC',
    'CONTROL',
    'CHALLENGE',
    'CONFIRMATION',
  ]);
  assert.deepEqual(Object.values(reckoning.RISK_LEVELS), [
    'CRITICAL',
    'HIGH',
    'SUPPORTING',
  ]);
  assert.equal(Object.isFrozen(reckoning.QUESTION_ROLES), true);
  assert.equal(Object.isFrozen(reckoning.EVIDENCE_STATUSES), true);
  assert.equal(Object.isFrozen(reckoning.RISK_LEVELS), true);
});

test('all Reckoning component boundaries remain importable', () => {
  for (const factoryName of reckoning.COMPONENT_FACTORIES) {
    assert.equal(typeof reckoning[factoryName], 'function', `missing factory: ${factoryName}`);
    const component = reckoning[factoryName]();
    assert.equal(typeof component, 'object');
    assert.equal(Object.isFrozen(component), true);
  }
});

test('Delivery E production wiring activates only newly-triggered V2 rows', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.js'),
    'utf8'
  );

  assert.match(source, /const adaptiveReckoningEngine = createReckoningEngine\s*\(/);
  assert.match(source, /preparationService:\s*adaptivePreparationService/);
  assert.match(source, /preparationInputProvider:\s*buildAdaptivePreparationInput/);
  assert.match(source, /outcomeHandler:\s*finalizeAdaptiveReckoningOutcome/);

  for (const route of [
    /brainRouter\.post\('\/reckoning\/start'/,
    /examRouter\.get\('\/:id\/reckoning\/state'/,
    /examRouter\.post\('\/:id\/reckoning\/answer'/,
    /examRouter\.post\('\/:id\/reckoning\/continue'/,
    /examRouter\.post\('\/:id\/reckoning\/finalize'/,
  ]) {
    assert.match(source, route);
  }

  const triggerStart = source.indexOf('async function triggerReckoning');
  const triggerEnd = source.indexOf('async function deferReckoning', triggerStart);
  assert.ok(triggerStart >= 0 && triggerEnd > triggerStart);
  const trigger = source.slice(triggerStart, triggerEnd);

  assert.match(trigger, /engine_version:\s*2/);
  assert.match(trigger, /engine_mode:\s*['"]LIVE['"]/);
  assert.match(trigger, /engine_phase:\s*['"]PREPARING['"]/);
  assert.match(trigger, /generation_status:\s*['"]not_started['"]/);
  assert.doesNotMatch(trigger, /adaptiveReckoningEngine\.start/);
  assert.doesNotMatch(trigger, /reckoningShadow\.analyzeSafely/);
  assert.doesNotMatch(trigger, /status:\s*['"]in_progress['"]/);
});

test('legacy Reckoning rows retain an explicit resume path', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.js'),
    'utf8'
  );
  const marker = "brainRouter.post('/reckoning/start'";
  const start = source.indexOf(marker);
  const end = source.indexOf('async function submitReckoningHandler', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);

  assert.match(route, /Number\(active\.engine_version \|\| 1\) !== 2/);
  assert.match(route, /RECKONING_LEGACY_RESUME/);
  assert.match(route, /reckoning_v2_start/);
  assert.match(route, /adaptiveReckoningEngine\.start/);
});
