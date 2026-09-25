'use strict';

const {
  integrity: registryIntegrity,
  REGISTRY_VERSION,
  REGISTRY_SOURCE_SHA256,
  assertRegistryIntegrity,
  getCapability,
  listCapabilities,
} = require('../capability-registry');
const {
  TEACHING_CONSTITUTION,
} = require('./constitution');
const {
  promptCatalogStatus,
  listPromptFamilies,
  createFrozenPromptBinding,
} = require('./prompt-catalog');
const {
  ROUTE_MANIFEST_VERSION,
  ROUTE_MANIFEST,
  resolveRouteControl,
  assertRouteQualified,
  assertMaturityGateRoute,
  assertFallbackIndependentlyQualified,
  assertStrongReviewEvidence,
} = require('./route-control');
const {
  PREPARATION_PROFILE_VERSION,
  PREPARATION_PROFILE_TEMPLATES,
  validatePreparationMetadata,
} = require('./preparation');
const {
  STRUCTURAL_PROMPT_CONTRACT_VERSION,
  completeness,
  getCapabilityContract,
  createStructuralPromptInvocation,
} = require('./contracts');

function createTeachingPromptControlPlane() {
  function assertReady() {
    const registry = assertRegistryIntegrity();
    const prompts = promptCatalogStatus();
    if (prompts.familyCount !== 19 || prompts.modelEligibleCapabilityCount !== 147) {
      const error = new Error('Teaching D03 prompt catalog census is invalid.');
      error.code = 'TEACHING_D03_PROMPT_CATALOG_INVALID';
      throw error;
    }
    if (completeness.total !== 169) {
      const error = new Error('Teaching D03 capability-contract census is invalid.');
      error.code = 'TEACHING_D03_CONTRACT_CENSUS_INVALID';
      throw error;
    }
    return true;
  }

  function status() {
    const prompts = promptCatalogStatus();
    return Object.freeze({
      delivery: 'D03',
      ready: true,
      registryVersion: REGISTRY_VERSION,
      registrySourceSha256: REGISTRY_SOURCE_SHA256,
      capabilityCounts: registryIntegrity,
      constitutionVersion: TEACHING_CONSTITUTION.version,
      structuralPromptContractVersion: STRUCTURAL_PROMPT_CONTRACT_VERSION,
      promptManifestVersion: prompts.manifestVersion,
      promptManifestSha256: prompts.manifestSha256,
      promptPackSha256: prompts.combinedPackSha256,
      promptFamilyCount: prompts.familyCount,
      routeManifestVersion: ROUTE_MANIFEST_VERSION,
      routeQualification: 'UNQUALIFIED',
      productionModelExecutionAuthorized: false,
      preparationProfileVersion: PREPARATION_PROFILE_VERSION,
    });
  }

  return Object.freeze({
    assertReady,
    status,
    getCapability,
    listCapabilities,
    listPromptFamilies,
    getCapabilityContract,
    createFrozenPromptBinding,
    createInvocation: createStructuralPromptInvocation,
    resolveRouteControl,
    assertRouteQualified,
    validatePreparationMetadata,
    assertMaturityGateRoute,
    assertFallbackIndependentlyQualified,
    assertStrongReviewEvidence,
    routeManifest: ROUTE_MANIFEST,
    preparationProfiles: PREPARATION_PROFILE_TEMPLATES,
    constitution: TEACHING_CONSTITUTION,
  });
}

module.exports = {
  createTeachingPromptControlPlane,
};
