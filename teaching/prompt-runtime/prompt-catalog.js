'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_MANIFEST_SHA256 = '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce';
const EXPECTED_PACK_SHA256 = '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae';
const FROZEN_PROMPT_BINDING = Symbol('KIWI_TEACHING_FROZEN_PROMPT_BINDING');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(message, code = 'TEACHING_PROMPT_BASELINE_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const catalogBytes = Buffer.concat([0,1,2,3].map((index) =>
  fs.readFileSync(path.join(__dirname, 'frozen', `prompt-family-catalog.v1.3.part-${String(index).padStart(2, '0')}`))
));
const EXPECTED_COMPILED_CATALOG_SHA256 = '87499e2dc8c00e4cf0d789b654171c84d929c9352189fe509ec173f3f5a2346b';
if (sha256(catalogBytes) !== EXPECTED_COMPILED_CATALOG_SHA256) fail('Teaching prompt-family catalog payload hash mismatch.');
const manifest = JSON.parse(catalogBytes.toString('utf8'));
if (manifest.manifest_source_sha256 !== EXPECTED_MANIFEST_SHA256) fail('Teaching prompt manifest v1.3 source identity mismatch.');
if (manifest.manifest_version !== '1.3') fail('Teaching prompt manifest must be v1.3.');
if (manifest.prompt_family_count !== 19) fail('Teaching prompt manifest must contain 19 families.');
if (manifest.model_eligible_capability_count !== 147) fail('Teaching prompt manifest must describe exactly 147 model-eligible capabilities.');
if (manifest.combined_prompt_pack?.sha256 !== EXPECTED_PACK_SHA256) {
  fail('Prompt manifest combined-pack hash does not match the user-authorized v1.3 pack.');
}

const familyById = new Map();
for (const family of manifest.families) {
  if (familyById.has(family.family_id)) fail(`Duplicate prompt family ${family.family_id}.`);
  familyById.set(family.family_id, Object.freeze({
    id: family.family_id,
    name: family.name,
    version: String(family.version),
    criticality: family.criticality,
    capabilityCount: family.capability_count,
    promptFile: family.prompt_file,
    promptSha256: family.prompt_sha256,
    status: family.status,
  }));
}
if (familyById.size !== 19) fail('Teaching prompt catalog must contain exactly 19 families.');
if ([...familyById.values()].reduce((sum, family) => sum + family.capabilityCount, 0) !== 147) {
  fail('Teaching prompt catalog capability coverage must total 147.');
}

const ASSESSMENT_FAMILY_BOUNDARIES = Object.freeze({
  planning: 'TPF-12',
  generation: 'TPF-13',
  validationRepair: 'TPF-14',
  formalMarking: 'TPF-15',
  moderationAppeal: 'TPF-16',
});

function getPromptFamily(familyId) {
  const family = familyById.get(String(familyId || '').trim());
  if (!family) {
    const error = new Error(`Unknown Teaching prompt family: ${familyId}`);
    error.code = 'TEACHING_PROMPT_FAMILY_UNKNOWN';
    throw error;
  }
  return family;
}

function assertPromptArtifactIdentity({ familyId, version, promptFile, promptSha256 } = {}) {
  const family = getPromptFamily(familyId);
  if (
    String(version || '') !== family.version ||
    String(promptFile || '') !== family.promptFile ||
    String(promptSha256 || '') !== family.promptSha256
  ) {
    const error = new Error(`${family.id} prompt artifact is not the exact v1.3-manifested file/version/hash.`);
    error.code = 'TEACHING_UNMANIFESTED_PROMPT_REJECTED';
    throw error;
  }
  return true;
}

function createFrozenPromptBinding(familyId, expectedVersion = null) {
  const family = getPromptFamily(familyId);
  if (expectedVersion != null && String(expectedVersion) !== family.version) {
    const error = new Error(`${family.id} is frozen at v${family.version}; requested v${expectedVersion} is not manifested.`);
    error.code = 'TEACHING_PROMPT_VERSION_UNMANIFESTED';
    throw error;
  }

  const binding = {
    familyId: family.id,
    familyName: family.name,
    familyVersion: family.version,
    criticality: family.criticality,
    promptSourceFile: family.promptFile,
    promptSourceSha256: family.promptSha256,
    combinedPackFile: manifest.combined_prompt_pack?.file || null,
    combinedPackSha256: EXPECTED_PACK_SHA256,
    manifestVersion: manifest.manifest_version,
    manifestSha256: EXPECTED_MANIFEST_SHA256,
    promptBodyEmbedded: false,
  };
  Object.defineProperty(binding, FROZEN_PROMPT_BINDING, { value: true, enumerable: false, writable: false });
  return Object.freeze(binding);
}

function assertFrozenPromptBinding(binding) {
  if (!binding || binding[FROZEN_PROMPT_BINDING] !== true) {
    const error = new Error('Teaching prompt execution requires a binding loaded from the hash-locked v1.3 prompt catalog.');
    error.code = 'TEACHING_UNMANIFESTED_PROMPT_REJECTED';
    throw error;
  }
  const family = getPromptFamily(binding.familyId);
  assertPromptArtifactIdentity({
    familyId: family.id,
    version: binding.familyVersion,
    promptFile: binding.promptSourceFile,
    promptSha256: binding.promptSourceSha256,
  });
  return true;
}

function listPromptFamilies() {
  return Object.freeze([...familyById.values()]);
}

function promptCatalogStatus() {
  return Object.freeze({
    manifestVersion: manifest.manifest_version,
    manifestSha256: EXPECTED_MANIFEST_SHA256,
    combinedPromptPack: manifest.combined_prompt_pack?.file || null,
    combinedPackSha256: EXPECTED_PACK_SHA256,
    familyCount: familyById.size,
    modelEligibleCapabilityCount: manifest.model_eligible_capability_count,
    closureStatus: manifest.closure_status,
    promptBodiesEmbedded: false,
    qualificationPending: true,
  });
}

module.exports = {
  EXPECTED_MANIFEST_SHA256,
  EXPECTED_PACK_SHA256,
  ASSESSMENT_FAMILY_BOUNDARIES,
  getPromptFamily,
  listPromptFamilies,
  createFrozenPromptBinding,
  assertFrozenPromptBinding,
  assertPromptArtifactIdentity,
  promptCatalogStatus,
};
