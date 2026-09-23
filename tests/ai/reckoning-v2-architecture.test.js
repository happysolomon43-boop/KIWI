'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reckoning = require('../../services/reckoning');

test('Reckoning V2 Phase 1 exposes a stable backend facade', () => {
  const engine = reckoning.createReckoningEngine();

  for (const method of reckoning.ENGINE_METHODS) {
    assert.equal(typeof engine[method], 'function', `missing engine method: ${method}`);
  }

  const description = engine.describe();
  assert.equal(description.name, 'reckoning-v2');
  assert.equal(description.engineVersion, 2);
  assert.equal(description.architectureVersion, 1);
  assert.equal(description.status, 'SCAFFOLD');
});

test('Delivery D remains fail-closed for authority while consequence finalization is explicit', async () => {
  const config = reckoning.createReckoningConfig({
    enabled: true,
    behaviorAuthority: 'v2',
  });

  assert.equal(config.enabled, false);
  assert.equal(config.behaviorAuthority, 'legacy');
  assert.equal(Object.isFrozen(config), true);

  const engine = reckoning.createReckoningEngine({ config });

  for (const method of ['prepare', 'start']) {
    assert.throws(
      () => engine[method](),
      (error) => error && error.code === 'ERR_RECKONING_V2_NOT_IMPLEMENTED'
    );
  }

  await assert.rejects(
    () => engine.getState({ examSessionId: 'exam-1', userId: 'user-1' }),
    /requires a query function/
  );
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

test('all Phase 1 component boundaries are importable without side effects', () => {
  for (const factoryName of reckoning.COMPONENT_FACTORIES) {
    assert.equal(typeof reckoning[factoryName], 'function', `missing factory: ${factoryName}`);
    const component = reckoning[factoryName]();
    assert.equal(typeof component, 'object');
    assert.equal(Object.isFrozen(component), true);
  }
});

test('Delivery D wires dormant finalization without activating current Reckoning authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.js'),
    'utf8'
  );

  assert.match(source, /createShadowIntelligence/);
  assert.match(source, /reckoningShadow\.analyzeSafely/);
  assert.match(
    source,
    /const adaptiveReckoningEngine = createReckoningEngine\s*\(/
  );
  assert.match(source, /examRouter\.get\('\/:id\/reckoning\/state'/);
  assert.match(source, /examRouter\.post\('\/:id\/reckoning\/answer'/);
  assert.match(source, /examRouter\.post\('\/:id\/reckoning\/finalize'/);
  assert.match(source, /outcomeHandler:\s*finalizeAdaptiveReckoningOutcome/);
  assert.match(source, /completion\.survived/);
  assert.match(source, /!q\.reckoning_evidence_id/);

  const triggerStart = source.indexOf('async function triggerReckoning');
  const triggerEnd = source.indexOf('async function deferReckoning', triggerStart);
  assert.ok(triggerStart >= 0 && triggerEnd > triggerStart);
  const trigger = source.slice(triggerStart, triggerEnd);

  assert.match(trigger, /question_count:\s*questionCount/);
  assert.match(trigger, /reckoningShadow\.analyzeSafely/);
  assert.doesNotMatch(trigger, /engine_version\s*:/);
  assert.doesNotMatch(trigger, /engine_mode\s*:\s*['"](?:PILOT|LIVE)['"]/);
  assert.doesNotMatch(trigger, /adaptiveReckoningEngine/);
});