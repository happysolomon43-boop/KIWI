'use strict';

const { createTeachingPromptControlPlane } = require('../prompt-runtime');
const { listCapabilities } = require('../capability-registry');
const { FAMILY_DEFINITIONS, EVALUATION_SUITE_VERSION, CONSTITUTION_VERSION, PROMPT_MANIFEST_VERSION, PROMPT_MANIFEST_SHA256 } = require('./contracts');
const { FAMILY_EVALUATION_FOCUS } = require('./family-matrix');

const CANONICAL_MAINTENANCE_SOURCES = Object.freeze([
  Object.freeze({ name:'KIWI_Teaching_System_Blueprint-11.7.md', role:'architecture_and_academic_authority' }),
  Object.freeze({ name:'KIWI_Teaching_Capability_Registry_v1.3.md', role:'capability_authority_and_owner_contracts' }),
  Object.freeze({ name:'KIWI_Teaching_Phase15_Final_Prompt_Manifest_v1.4.json', role:'frozen_prompt_identity' }),
  Object.freeze({ name:'KIWI_Teaching_Implementation_Change_Control_Protocol_v1.0.md', role:'prompt_change_governance' }),
  Object.freeze({ name:'KIWI_Teaching_Phase16_Evaluation_Adversarial_Spec_v1.4_FINAL.md', role:'evaluation_contract' }),
]);

const AUTHORING_DEPENDENCIES = Object.freeze({
  'TPF-01': Object.freeze([]),
  'TPF-02': Object.freeze(['TPF-01']),
  'TPF-04': Object.freeze(['TPF-02']),
  'TPF-03': Object.freeze(['TPF-02','TPF-04']),
  'TPF-05': Object.freeze(['TPF-03','TPF-04']),
  'TPF-06': Object.freeze(['TPF-04','TPF-05']),
  'TPF-07': Object.freeze(['TPF-06']),
  'TPF-08': Object.freeze(['TPF-07','TPF-18']),
  'TPF-09': Object.freeze(['TPF-06','TPF-08']),
  'TPF-10': Object.freeze(['TPF-03']),
  'TPF-11': Object.freeze(['TPF-09']),
  'TPF-12': Object.freeze(['TPF-03','TPF-04','TPF-11']),
  'TPF-13': Object.freeze(['TPF-12']),
  'TPF-14': Object.freeze(['TPF-13']),
  'TPF-15': Object.freeze(['TPF-14']),
  'TPF-16': Object.freeze(['TPF-15']),
  'TPF-17': Object.freeze(['TPF-09','TPF-16']),
  'TPF-18': Object.freeze(['TPF-01']),
  'TPF-19': Object.freeze(['TPF-09']),
  'TPF-20': Object.freeze(['TPF-05','TPF-09','TPF-19']),
});

function assertDependencyOrder(order = []) {
  const positions = new Map(order.map((familyId,index) => [familyId,index]));
  const missing = FAMILY_DEFINITIONS.map((family) => family.familyId).filter((familyId) => !positions.has(familyId));
  if (missing.length) throw new Error(`Prompt dependency order is incomplete: ${missing.join(', ')}`);
  for (const [familyId, dependencies] of Object.entries(AUTHORING_DEPENDENCIES)) {
    for (const dependency of dependencies) {
      if (positions.get(dependency) >= positions.get(familyId)) throw new Error(`${dependency} must precede ${familyId} by dependency, not numeric family ID.`);
    }
  }
  return true;
}

function buildPromptMaintenanceContext(familyId, { promptControl = createTeachingPromptControlPlane() } = {}) {
  promptControl.assertReady();
  const family = FAMILY_DEFINITIONS.find((entry) => entry.familyId === familyId);
  if (!family) throw new Error(`Unknown family: ${familyId}`);
  const capabilities = listCapabilities().filter((capability) => capability.prompt_family_id === familyId);
  if (capabilities.length !== family.capabilityCount) throw new Error(`${familyId} capability mapping count mismatch.`);
  const body = promptControl.getPromptBody(familyId,family.version);
  if (body.promptSha256 !== family.promptSha256) throw new Error(`${familyId} runtime prompt hash does not match D30 canonical binding.`);
  return Object.freeze({
    family:Object.freeze({ familyId, name:family.name, version:family.version, criticality:family.criticality, promptSha256:family.promptSha256 }),
    canonicalSources:CANONICAL_MAINTENANCE_SOURCES,
    constitutionVersion:CONSTITUTION_VERSION,
    promptManifest:Object.freeze({ version:PROMPT_MANIFEST_VERSION, sha256:PROMPT_MANIFEST_SHA256 }),
    capabilityContracts:Object.freeze(capabilities.map((capability) => Object.freeze({
      capabilityId:capability.id,
      authorityCeiling:capability.authority_ceiling,
      authoritativeOwnerBoundary:capability.authoritative_owner_boundary,
      executionClass:capability.execution_class,
      purpose:capability.purpose,
    }))),
    evaluation:Object.freeze({ suiteVersion:EVALUATION_SUITE_VERSION, focus:Object.freeze([...(FAMILY_EVALUATION_FOCUS[familyId] || [])]) }),
    dependencies:AUTHORING_DEPENDENCIES[familyId],
    currentPromptBodyHashVerified:true,
    promptTextReturned:false,
  });
}

module.exports = { CANONICAL_MAINTENANCE_SOURCES, AUTHORING_DEPENDENCIES, assertDependencyOrder, buildPromptMaintenanceContext };