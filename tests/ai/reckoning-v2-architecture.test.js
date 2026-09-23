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

test('Phase 1 is fail-closed and cannot become production authority', () => {
  const config = reckoning.createReckoningConfig({
    enabled: true,
    behaviorAuthority: 'v2',
  });

  assert.equal(config.enabled, false);
  assert.equal(config.behaviorAuthority, 'legacy');
  assert.equal(Object.isFrozen(config), true);

  const engine = reckoning.createReckoningEngine({ config });

  for (const method of ['prepare', 'start', 'recordAnswer', 'getState', 'finalize']) {
    assert.throws(
      () => engine[method](),
      (error) => error && error.code === 'ERR_RECKONING_V2_NOT_IMPLEMENTED'
    );
  }
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

test('Phase 1 does not wire Reckoning V2 into production index.js', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.js'),
    'utf8'
  );

  assert.doesNotMatch(source, /require\(['"]\.\/services\/reckoning(?:\/index)?['"]\)/);
  assert.doesNotMatch(source, /createReckoningEngine\s*\(/);
});
