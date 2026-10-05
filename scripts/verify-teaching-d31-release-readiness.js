'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const d30 = require('../teaching/d30');
const d31 = require('../teaching/d31');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

function verifyCanonicalCensus() {
  assert.equal(d31.assertD31CanonicalContract(), true);
  assert.equal(d31.assertD31TaskAccountingComplete(), true);
  assert.equal(d31.D31_TASK_IDS.length, 4);
  assert.deepEqual(d31.D31_TASK_IDS, ['TCH-0680','TCH-0681','TCH-0682','TCH-0683']);
  assert.equal(Object.keys(d31.DELIVERY_TASK_COUNTS).length, 32);
  assert.equal(Object.values(d31.DELIVERY_TASK_COUNTS).reduce((sum, count) => sum + count, 0), 920);
  assert.equal(d31.CANONICAL_RELEASE_BASELINE.capabilityCount, 170);
  assert.equal(d31.CANONICAL_RELEASE_BASELINE.modelEligibleCapabilityCount, 148);
  assert.equal(d31.CANONICAL_RELEASE_BASELINE.t0CapabilityCount, 22);
  assert.equal(d31.CANONICAL_RELEASE_BASELINE.promptFamilyCount, 20);
  assert.equal(d31.CANONICAL_RELEASE_BASELINE.criticalInvariantCount, 40);
}

function verifyTaskAnchors() {
  for (const [taskId, accounting] of Object.entries(d31.TASK_ACCOUNTING)) {
    assert.ok(accounting.area, `${taskId} area missing`);
    for (const anchor of accounting.anchors) assert.ok(exists(anchor), `${taskId} anchor missing: ${anchor}`);
  }
}

function verifyPriorDeliveryVerifierChain() {
  for (let delivery = 1; delivery <= 30; delivery += 1) {
    const id = String(delivery).padStart(2, '0');
    const expectedPrefix = `verify-teaching-d${id}`;
    const matches = fs.readdirSync(path.join(root, 'scripts')).filter((name) => name.startsWith(expectedPrefix) && name.endsWith('.js'));
    assert.ok(matches.length >= 1, `accepted delivery D${id} verifier missing`);
  }
}

function verifyD30TruthPreserved() {
  d30.assertD30TaskCensus();
  d30.assertTaskAccountingComplete();
  assert.equal(d30.D30_OWNER_ACCEPTANCE.productionAuthorized, false, 'D31 must not rewrite D30 production authorization evidence');
  const noEvidence = d30.summarizeRouteQualification({
    routeKey:'d31-truth-preservation-no-evidence',
    routeRole:'PRIMARY',
    familyId:'TPF-01',
    capabilityId:'teaching.d31.truth.preservation',
    requiredCaseIds:['D31-NO-EVIDENCE'],
    records:[],
    humanReviews:[],
  });
  assert.equal(noEvidence.decision, 'INSUFFICIENT_EVIDENCE');
  assert.equal(noEvidence.productionQualified, false);
  assert.equal(d31.OWNER_OVERRIDE.productionQualifiedByOverride, false);
  assert.equal(d31.OWNER_OVERRIDE.qualificationAtAuthorization, 'INSUFFICIENT_EVIDENCE');
}

function verifyOwnerReleaseBoundary() {
  const held = d31.resolveOwnerReleaseAuthorization({});
  assert.equal(held.enabled, false);
  assert.equal(held.releaseAuthorization, 'HELD_FAIL_CLOSED');
  const enabled = d31.resolveOwnerReleaseAuthorization({ TEACHING_D31_AI_RELEASE_MODE:'OWNER_OVERRIDE_V1' });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.releaseAuthorization, 'OWNER_OVERRIDE_ENABLED');
  assert.equal(enabled.productionQualifiedByOverride, false);

  const serverSources = [
    read('teaching/d31/owner-release-override.js'),
    read('teaching/d31/release-intelligence.js'),
    read('index.js'),
  ].join('\n');
  assert.match(serverSources, /TEACHING_D31_AI_RELEASE_MODE/);
  assert.match(serverSources, /teachingRuntimePlatform\.aiBoundary|runtimePlatform\.aiBoundary/);

  for (const client of ['public/teaching.html','public/teaching.js']) {
    const source = read(client);
    assert.ok(!source.includes('TEACHING_D31_AI_RELEASE_MODE'), `${client} exposes D31 server release control`);
    assert.ok(!source.includes('OWNER_OVERRIDE_V1'), `${client} exposes D31 release secret/control value`);
  }

  const d31Sources = fs.readdirSync(path.join(root, 'teaching', 'd31'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => read(path.join('teaching', 'd31', name)))
    .join('\n');
  assert.ok(!/require\(['"](?:openai|@google|groq|anthropic)/.test(d31Sources), 'D31 bypasses central orchestration with a provider SDK');
  assert.ok(!/https:\/\/(?:generativelanguage|api\.groq|api\.cloudflare)/i.test(d31Sources), 'D31 contains a direct provider endpoint');
}

function verifyLimitationsAndReviewEvidence() {
  assert.equal(d31.assertAcademicLimitationsComplete(), true);
  const html = read('public/teaching.html');
  for (const marker of [
    'id="teachingTransparencyTitle"',
    'Physical and practical skills:',
    'External resources:',
    'route-level empirical qualification remains incomplete',
    'Owner-authorized · evidence status preserved',
  ]) assert.ok(html.includes(marker), `Teaching Academic Transparency missing: ${marker}`);

  const security = read('teaching/d31/security-privacy-review.md');
  assert.match(security, /SECURITY \/ PRIVACY CANDIDATE PASS/);
  assert.match(security, /no Teaching table grants/i);
  assert.match(security, /Rollback/);

  const accessibility = read('teaching/d31/visual-accessibility-review.md');
  assert.match(accessibility, /Automated D24 regression verification/);
  assert.match(accessibility, /Independent human visual attestation/);
  assert.match(accessibility, /not fabricated/i);

  const trace = read('teaching/d31/traceability-reconciliation.md');
  assert.match(trace, /920 unique tasks/);
  assert.match(trace, /170 capabilities/);
  assert.match(trace, /20 prompt families/);
  assert.match(trace, /40 critical invariants/);
}

function main() {
  verifyCanonicalCensus();
  verifyTaskAnchors();
  verifyPriorDeliveryVerifierChain();
  verifyD30TruthPreserved();
  verifyOwnerReleaseBoundary();
  verifyLimitationsAndReviewEvidence();
  process.stdout.write(`${JSON.stringify({
    delivery:'D31',
    status:'RELEASE_CANDIDATE_VERIFIED',
    tasks:d31.D31_TASK_IDS,
    canonicalTasks:920,
    deliveries:32,
    capabilities:170,
    modelEligibleCapabilities:148,
    t0Capabilities:22,
    promptFamilies:20,
    criticalInvariants:40,
    d30NoEvidenceDecision:'INSUFFICIENT_EVIDENCE',
    ownerReleaseAuthorization:'EXPLICIT_SERVER_SIDE_EXCEPTION',
    productionQualifiedByOverride:false,
    inProductAcademicLimitations:'PRESENT',
  }, null, 2)}\n`);
}

main();
