'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../../../teaching/capability-registry');
const catalog = require('../../../teaching/prompt-runtime/prompt-catalog');
const constitution = require('../../../teaching/prompt-runtime/constitution');
const contracts = require('../../../teaching/prompt-runtime/contracts');
const routes = require('../../../teaching/prompt-runtime/route-control');
const preparation = require('../../../teaching/prompt-runtime/preparation');
const { createTeachingPromptControlPlane } = require('../../../teaching/prompt-runtime');
const { buildPromptBindingVersion, buildOutputSchemaBindingVersion } =
  require('../../../teaching/observability/postgres-execution-telemetry');

function firstModelCapability() {
  return registry.listCapabilities().find((item) => item.authority_ceiling !== 'T0');
}

test('D03 registry census is exactly 169 = 147 model-eligible + 22 deterministic T0', () => {
  const integrity = registry.assertRegistryIntegrity();
  assert.deepEqual(
    {
      total: integrity.total,
      modelEligible: integrity.modelEligible,
      t0Promptless: integrity.t0Promptless,
      promptFamilies: integrity.promptFamilies,
      legacyAliases: integrity.legacyAliases,
    },
    { total: 169, modelEligible: 147, t0Promptless: 22, promptFamilies: 19, legacyAliases: 165 }
  );
});

test('four PPL deterministic capabilities are promptless and cannot be remapped', () => {
  const ids = [
    'teaching.preparation.workspace_state_transition',
    'teaching.preparation.materiality_staleness_reconciliation',
    'teaching.preparation.finalization_readiness_gate',
    'teaching.preparation.protected_content_isolation',
  ];
  for (const id of ids) {
    const capability = registry.getCapability(id);
    assert.equal(capability.authority_ceiling, 'T0');
    assert.equal(capability.prompt_family_id, null);
    assert.throws(
      () => registry.assertCapabilityBinding(id, { promptFamilyId: 'TPF-01' }),
      (error) => error.code === 'TEACHING_CAPABILITY_PROMPT_FAMILY_MISMATCH'
    );
    assert.throws(
      () => contracts.createStructuralPromptInvocation({ capabilityId: id }),
      (error) => error.code === 'TEACHING_T0_PROMPT_FORBIDDEN'
    );
  }
});

test('v1.3 prompt baseline is exact, frozen and covers all 147 model-eligible capabilities', () => {
  const status = catalog.promptCatalogStatus();
  assert.equal(status.manifestVersion, '1.3');
  assert.equal(status.manifestSha256, '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce');
  assert.equal(status.combinedPackSha256, '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae');
  assert.equal(status.familyCount, 19);
  assert.equal(status.modelEligibleCapabilityCount, 147);

  const capability = firstModelCapability();
  const family = catalog.getPromptFamily(capability.prompt_family_id);
  const binding = catalog.createFrozenPromptBinding(family.id, family.version);
  assert.equal(binding.familyId, family.id);
  assert.equal(binding.promptBodyEmbedded, false);
  assert.throws(
    () => catalog.createFrozenPromptBinding(family.id, '999'),
    (error) => error.code === 'TEACHING_PROMPT_VERSION_UNMANIFESTED'
  );
});

test('all 169 capabilities have immutable D03 contracts and model prompts cannot raise authority or owner', () => {
  assert.deepEqual(contracts.completeness, { modelBacked: 147, deterministic: 22, total: 169 });
  for (const capability of registry.listCapabilities()) {
    const contract = contracts.getCapabilityContract(capability.id);
    assert.equal(contract.capabilityId, capability.id);
    assert.equal(contract.constitutionVersion, constitution.TEACHING_CONSTITUTION.version);
    assert.equal(contract.authorityCeiling, capability.authority_ceiling);
    assert.equal(contract.authoritativeOwnerBoundary, capability.authoritative_owner_boundary);
  }

  const capability = firstModelCapability();
  assert.throws(
    () => registry.assertCapabilityBinding(capability.id, { authorityLevel: 'T4' }),
    (error) => capability.authority_ceiling === 'T4'
      ? false
      : error.code === 'TEACHING_CAPABILITY_AUTHORITY_ESCALATION'
  );
  assert.throws(
    () => registry.assertCapabilityBinding(capability.id, { authoritativeOwnerBoundary: 'forged_owner' }),
    (error) => error.code === 'TEACHING_CAPABILITY_OWNER_MISMATCH'
  );
});

test('all Teaching model routes remain unqualified, provider-neutral and production blocked', () => {
  assert.equal(Object.keys(routes.ROUTE_MANIFEST).length, 19);
  for (const route of Object.values(routes.ROUTE_MANIFEST)) {
    assert.equal(route.qualificationStatus, 'UNQUALIFIED');
    assert.equal(route.productionAuthorized, false);
    assert.equal(route.qualificationGate, 'D30');
    assert.equal(route.productionAuthorizationGate, 'D31');
    assert.deepEqual(route.allowedPrimaryRoutes, []);
    assert.deepEqual(route.allowedFallbackRoutes, []);
  }
  const capability = firstModelCapability();
  const resolved = routes.resolveRouteControl(capability.id);
  assert.throws(
    () => routes.assertRouteQualified(resolved),
    (error) => error.code === 'TEACHING_ROUTE_UNQUALIFIED'
  );
});

test('PPL profiles are provider-neutral and weak/fallback routes cannot cross stronger gates', () => {
  for (const profile of Object.values(preparation.PREPARATION_PROFILE_TEMPLATES)) {
    assert.equal(profile.provider_model_names_allowed, false);
    assert.equal(profile.review_budget.mode, 'CONFIGURED_EXTERNALLY');
    assert.equal(profile.candidate_budget.mode, 'CONFIGURED_EXTERNALLY');
  }

  assert.throws(
    () => routes.assertMaturityGateRoute({
      targetMaturity: 'Pre-Lock Ready',
      routePosture: 'economy_maintenance',
    }),
    (error) => error.code === 'TEACHING_PPL_ROUTE_TOO_WEAK_FOR_GATE'
  );
  assert.throws(
    () => routes.assertFallbackIndependentlyQualified({ qualificationStatus: 'UNQUALIFIED' }),
    (error) => error.code === 'TEACHING_FALLBACK_UNQUALIFIED'
  );
  assert.throws(
    () => routes.assertStrongReviewEvidence({
      routePosture: 'final_reconciliation',
      primaryAuthoritativeEvidenceRefs: [],
      priorSummaryOnly: true,
    }),
    (error) => error.code === 'TEACHING_PPL_PRIMARY_EVIDENCE_REQUIRED'
  );
});

test('D03 reuses D02 audit columns for version bindings and exposes a production-held control plane', () => {
  assert.equal(
    buildPromptBindingVersion({
      promptFamilyId: 'TPF-12',
      promptFamilyVersion: '1.3',
      constitutionVersion: constitution.TEACHING_CONSTITUTION.version,
    }),
    `family:TPF-12@1.3;constitution:${constitution.TEACHING_CONSTITUTION.version}`
  );
  assert.equal(
    buildOutputSchemaBindingVersion({ outputSchemaId: 'assessment.plan', outputSchemaVersion: '1' }),
    'assessment.plan@1'
  );

  const plane = createTeachingPromptControlPlane();
  assert.equal(plane.assertReady(), true);
  const status = plane.status();
  assert.equal(status.delivery, 'D03');
  assert.equal(status.capabilityCounts.total, 169);
  assert.equal(status.routeQualification, 'UNQUALIFIED');
  assert.equal(status.productionModelExecutionAuthorized, false);
});
