'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTeachingPromptControlPlane } = require('../../teaching/prompt-runtime');

const {
  ADAPTER_KEYS,
  OWNER_OVERRIDE,
  OWNER_OVERRIDE_MODE,
  RELEASE_MODE_ENV,
  createD31ReleaseIntelligence,
  resolveOwnerReleaseAuthorization,
} = require('../../teaching/d31');

const METHOD_BY_ADAPTER = Object.freeze({
  d07Intelligence: 'extractIntake',
  d08Intelligence: 'generateCoursePlan',
  d09Intelligence: 'execute',
  d11Intelligence: 'planLesson',
  d12Intelligence: 'evaluateResponse',
  d13Intelligence: 'interpretEvidence',
  d14HelpIntelligence: 'decide',
  d16Intelligence: 'generateHomework',
  d17Intelligence: 'planBlueprint',
});

test('D31 owner release override fails closed unless the exact server mode is present', () => {
  for (const value of [undefined, '', 'true', 'enabled', 'OWNER_OVERRIDE', 'OWNER_OVERRIDE_V2']) {
    const env = value === undefined ? {} : { [RELEASE_MODE_ENV]: value };
    const authorization = resolveOwnerReleaseAuthorization(env);
    assert.equal(authorization.enabled, false);
    assert.equal(authorization.releaseAuthorization, 'HELD_FAIL_CLOSED');
    assert.equal(authorization.productionQualifiedByOverride, false);

    const release = createD31ReleaseIntelligence({ runtimePlatform: null, env });
    assert.deepEqual(release.enabledAdapterKeys, []);
    for (const key of ADAPTER_KEYS) assert.equal(release.intelligence[key], null, `${key} must remain held`);
  }
});

test('D31 exact owner release mode enables every existing production-mounted Teaching AI adapter through the central boundary', () => {
  const runtimePlatform = {
    aiBoundary: { execute: async (request) => request },
    promptControl: createTeachingPromptControlPlane(),
    orchestrationStore: { begin: async () => ({ inserted: true }), mark: async () => ({}) },
  };
  const release = createD31ReleaseIntelligence({
    runtimePlatform,
    query: async () => ({ rows: [] }),
    randomUUID: () => 'execution-test',
    env: { [RELEASE_MODE_ENV]: OWNER_OVERRIDE_MODE },
  });

  assert.equal(release.authorization.enabled, true);
  assert.equal(release.authorization.releaseAuthorization, 'OWNER_OVERRIDE_ENABLED');
  assert.equal(release.authorization.qualificationDisposition, 'PRESERVE_D30_EVIDENCE_STATE');
  assert.equal(release.authorization.productionQualifiedByOverride, false);
  assert.deepEqual(release.enabledAdapterKeys, ADAPTER_KEYS);

  for (const key of ADAPTER_KEYS) {
    assert.ok(release.intelligence[key], `${key} should be instantiated`);
    assert.equal(typeof release.intelligence[key][METHOD_BY_ADAPTER[key]], 'function', `${key} should expose its canonical adapter API`);
  }
});

test('D31 owner mode cannot activate without the Teaching central AI execution boundary', () => {
  assert.throws(
    () => createD31ReleaseIntelligence({
      runtimePlatform: {},
      env: { [RELEASE_MODE_ENV]: OWNER_OVERRIDE_MODE },
    }),
    (error) => error?.code === 'TEACHING_D31_CENTRAL_AI_BOUNDARY_REQUIRED'
  );
});

test('D31 owner amendment preserves empirical qualification truth and frozen authority boundaries', () => {
  assert.equal(OWNER_OVERRIDE.qualificationAtAuthorization, 'INSUFFICIENT_EVIDENCE');
  assert.equal(OWNER_OVERRIDE.productionQualifiedByOverride, false);
  assert.equal(OWNER_OVERRIDE.preservesD30EvidenceTruth, true);
  assert.equal(OWNER_OVERRIDE.preservesAcademicOwnerBoundaries, true);
  assert.equal(OWNER_OVERRIDE.preservesCentralOrchestratorBoundary, true);
  assert.equal(OWNER_OVERRIDE.preservesD28ExecutionControls, true);

  const amendmentPath = path.join(__dirname, '../../teaching/d31/KIWI_Teaching_D31_Owner_AI_Release_Authorization_Amendment_v1.0.md');
  const amendment = fs.readFileSync(amendmentPath, 'utf8');
  assert.match(amendment, /does \*\*not\*\* convert missing D30 evidence into qualification evidence/);
  assert.match(amendment, /TEACHING_D31_AI_RELEASE_MODE=OWNER_OVERRIDE_V1/);
  assert.match(amendment, /central KIWI AI Orchestrator/);
  assert.match(amendment, /D28 execution controls/);
  assert.match(amendment, /Rollback \/ disable path/);
});
