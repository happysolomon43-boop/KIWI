'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const d30 = require('../../../teaching/d30');

test('owner acceptance closes D30 on implementation gates without provider or human evidence', () => {
  assert.equal(d30.D30_OWNER_ACCEPTANCE.ownerAuthorized, true);
  assert.equal(d30.D30_OWNER_ACCEPTANCE.changeClass, 'CLASS_E_SCOPE_ACCEPTANCE');
  assert.equal(d30.D30_OWNER_ACCEPTANCE.exhaustiveLiveEmpiricalExecutionRequiredForDelivery, false);
  assert.equal(d30.D30_OWNER_ACCEPTANCE.externalProviderCredentialsRequiredForDelivery, false);
  assert.equal(d30.D30_OWNER_ACCEPTANCE.independentHumanAcademicReviewRequiredForDelivery, false);
  assert.equal(d30.D30_OWNER_ACCEPTANCE.fabricatedEvidenceAllowed, false);
  assert.equal(d30.D30_OWNER_ACCEPTANCE.productionAuthorized, false);
  assert.equal(d30.D30_OWNER_ACCEPTANCE.authorizationGate, 'D31');

  const completion = d30.assessD30DeliveryCompletion({
    taskAccountingComplete: true,
    canonicalVerifierPass: true,
    unitTestsPass: true,
    webBuildPass: true,
  });
  assert.equal(completion.complete, true);
  assert.equal(completion.status, 'COMPLETE_OWNER_ACCEPTED');
  assert.deepEqual(completion.missingImplementationRequirements, []);
  assert.equal(completion.liveEmpiricalEvidenceRequiredForDelivery, false);
  assert.equal(completion.humanAcademicReviewRequiredForDelivery, false);
});

test('owner acceptance does not fabricate route qualification when empirical evidence is absent', () => {
  const summary = d30.summarizeRouteQualification({
    routeKey: 'owner-accepted-not-empirically-qualified',
    routeRole: 'PRIMARY',
    familyId: 'TPF-01',
    capabilityId: 'teaching.owner.acceptance.regression',
    requiredCaseIds: ['D30-OWNER-ACCEPTANCE-NO-EVIDENCE'],
    records: [],
    humanReviews: [],
  });

  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
  assert.equal(summary.productionQualified, false);
  assert.equal(summary.productionAuthorized, false);
  assert.equal(summary.authorizationGate, 'D31');
});

test('implementation failures still block D30 delivery completion', () => {
  const completion = d30.assessD30DeliveryCompletion({
    taskAccountingComplete: true,
    canonicalVerifierPass: true,
    unitTestsPass: false,
    webBuildPass: true,
  });
  assert.equal(completion.complete, false);
  assert.deepEqual(completion.missingImplementationRequirements, ['unitTestsPass']);
});
