'use strict';

const D31_TASK_IDS = Object.freeze(['TCH-0680','TCH-0681','TCH-0682','TCH-0683']);

const CANONICAL_RELEASE_BASELINE = Object.freeze({
  deliveryTaskMapVersion: '1.7',
  deliveryTaskMapSha256: '83a4430b96dfd1c59d43e2c1495aa8686f77b50d0730f03fca7c3bf158bd2481',
  capabilityRegistryVersion: '1.3',
  capabilityRegistrySha256: 'db2c9c89764b4fbcaffa4fc1d263f99ff0ddb337becbdc56b7ff71d829f5bc16',
  capabilityTraceabilityMatrixVersion: '1.3',
  capabilityTraceabilityMatrixSha256: '2366325cad88bd160e5c545baacb4b4cf8482ede5eeae6c67a7890fe16b1ef7a',
  promptManifestVersion: '1.4',
  promptManifestSha256: '7757b50cbf4cfb501158beeaccfbfd5776bc8ca8f7257b4855f5ed5fcdf67e3d',
  phase22ManifestVersion: '1.5',
  phase22ManifestSha256: '89a80a79cf9021f1e8a277a531668c172e7353ddd12e4849fda351c00f557788',
  criticalInvariantTraceMapVersion: '1.3',
  criticalInvariantTraceMapSha256: '3ee880522f20e098001a8ee69885db7a1e2f02a6d907eaaa7155c59365bd8f80',
  taskCount: 920,
  deliveryCount: 32,
  capabilityCount: 170,
  modelEligibleCapabilityCount: 148,
  t0CapabilityCount: 22,
  promptFamilyCount: 20,
  criticalInvariantCount: 40,
});

const D31_TASK_CONTRACTS = Object.freeze({
  'TCH-0680': Object.freeze({
    label: 'CORE',
    requirement: 'Perform privacy/security review before production academic records are enabled.',
  }),
  'TCH-0681': Object.freeze({
    label: 'CORE',
    requirement: 'Perform final visual/accessibility review.',
  }),
  'TCH-0682': Object.freeze({
    label: 'CORE',
    requirement: 'Perform final blueprint traceability review: every settled blueprint requirement is implemented, explicitly deferred, or intentionally excluded with rationale.',
  }),
  'TCH-0683': Object.freeze({
    label: 'CORE',
    requirement: 'Document known limitations honestly in-product where they affect academic meaning, especially unobserved physical skills and imperfect control of external resources.',
  }),
});

function assertD31CanonicalContract() {
  const ids = Object.keys(D31_TASK_CONTRACTS).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...D31_TASK_IDS].sort())) {
    throw new Error('D31 canonical task contract drift.');
  }
  if (CANONICAL_RELEASE_BASELINE.taskCount !== 920 || CANONICAL_RELEASE_BASELINE.deliveryCount !== 32) {
    throw new Error('D31 canonical delivery census drift.');
  }
  if (CANONICAL_RELEASE_BASELINE.capabilityCount !== 170 || CANONICAL_RELEASE_BASELINE.modelEligibleCapabilityCount !== 148 || CANONICAL_RELEASE_BASELINE.t0CapabilityCount !== 22) {
    throw new Error('D31 canonical capability census drift.');
  }
  if (CANONICAL_RELEASE_BASELINE.promptFamilyCount !== 20 || CANONICAL_RELEASE_BASELINE.criticalInvariantCount !== 40) {
    throw new Error('D31 canonical prompt/invariant census drift.');
  }
  return true;
}

assertD31CanonicalContract();

module.exports = Object.freeze({
  D31_TASK_IDS,
  D31_TASK_CONTRACTS,
  CANONICAL_RELEASE_BASELINE,
  assertD31CanonicalContract,
});
