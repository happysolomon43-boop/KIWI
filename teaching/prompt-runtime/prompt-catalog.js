'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { getFrozenPromptBodyRecord, promptBodyStoreStatus } = require('./prompt-body-store');

const HISTORICAL_MANIFEST_SHA256 = '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce';
const HISTORICAL_PACK_SHA256 = '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae';
const EXPECTED_MANIFEST_SHA256 = '7757b50cbf4cfb501158beeaccfbfd5776bc8ca8f7257b4855f5ed5fcdf67e3d';
const EXPECTED_PACK_SHA256 = '6632f5c566fb81906c5ecf27e7d5412a330b93f63c429d46f3bee65aac91ab5d';
const EXPECTED_COMPILED_CATALOG_SHA256 = '87499e2dc8c00e4cf0d789b654171c84d929c9352189fe509ec173f3f5a2346b';
const SUCCESSOR_MANIFEST_ASSET = path.join(__dirname, 'frozen', 'prompt-manifest.v1.4.json.gz.b64');
const FROZEN_PROMPT_BINDING = Symbol('KIWI_TEACHING_FROZEN_PROMPT_BINDING');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(message, code = 'TEACHING_PROMPT_BASELINE_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function loadHistoricalManifest() {
  const bytes = Buffer.concat([0,1,2,3].map((index) =>
    fs.readFileSync(path.join(__dirname, 'frozen', `prompt-family-catalog.v1.3.part-${String(index).padStart(2, '0')}`))
  ));
  if (sha256(bytes) !== EXPECTED_COMPILED_CATALOG_SHA256) fail('Historical Teaching prompt-family catalog payload hash mismatch.');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.manifest_source_sha256 !== HISTORICAL_MANIFEST_SHA256) fail('Historical Prompt Manifest v1.3 source identity mismatch.');
  if (manifest.manifest_version !== '1.3' || manifest.prompt_family_count !== 19 ||
      manifest.model_eligible_capability_count !== 147 ||
      manifest.combined_prompt_pack?.sha256 !== HISTORICAL_PACK_SHA256) {
    fail('Historical Prompt Manifest v1.3 census or pack identity mismatch.');
  }
  return manifest;
}

function loadSuccessorManifest() {
  const encoded = fs.readFileSync(SUCCESSOR_MANIFEST_ASSET, 'utf8').trim();
  const bytes = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
  if (sha256(bytes) !== EXPECTED_MANIFEST_SHA256) fail('Teaching Prompt Manifest v1.4 source identity mismatch.');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.manifest_version !== '1.4') fail('Teaching prompt manifest must be v1.4.');
  if (manifest.prompt_family_count !== 20 || manifest.families?.length !== 20) fail('Teaching prompt manifest must contain 20 families.');
  if (manifest.model_eligible_capability_count !== 148) fail('Teaching prompt manifest must describe exactly 148 model-eligible capabilities.');
  if (manifest.combined_prompt_pack?.sha256 !== EXPECTED_PACK_SHA256) fail('Prompt manifest combined-pack hash does not match the v1.4 frozen pack.');
  return manifest;
}

const historicalManifest = loadHistoricalManifest();
const manifest = loadSuccessorManifest();

// The v1.4 manifest is an immutable baseline. Versioned amendments are applied
// by the hash-locked body store only after this baseline check succeeds.
for (const historical of historicalManifest.families) {
  const successor = manifest.families.find((family) => family.family_id === historical.family_id);
  if (!successor) fail(`Historical family missing from successor manifest: ${historical.family_id}`);
  for (const key of ['family_id','name','version','criticality','capability_count','prompt_file','prompt_sha256']) {
    if (successor[key] !== historical[key]) {
      fail(`Historical prompt binding changed in v1.4: ${historical.family_id}.${key}`);
    }
  }
}

const bodyStoreStatus = promptBodyStoreStatus();
const familyById = new Map();
for (const family of manifest.families) {
  if (familyById.has(family.family_id)) fail(`Duplicate prompt family ${family.family_id}.`);
  const effectiveBody = getFrozenPromptBodyRecord(family.family_id);
  familyById.set(family.family_id, Object.freeze({
    id: family.family_id,
    name: family.name,
    version: String(effectiveBody.version),
    criticality: family.criticality,
    capabilityCount: family.capability_count,
    promptFile: effectiveBody.promptFile,
    promptSha256: effectiveBody.promptSha256,
    status: effectiveBody.amended ? 'qualification_pending' : family.status,
    amended: effectiveBody.amended === true,
  }));
}
if (familyById.size !== 20) fail('Teaching prompt catalog must contain exactly 20 effective families.');
if ([...familyById.values()].reduce((sum, family) => sum + family.capabilityCount, 0) !== 148) {
  fail('Teaching prompt catalog capability coverage must total 148.');
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
    const error = new Error(`${family.id} prompt artifact is not the exact governed effective file/version/hash.`);
    error.code = 'TEACHING_UNMANIFESTED_PROMPT_REJECTED';
    throw error;
  }
  return true;
}

function assertManifestedPromptText({ familyId, version, promptText } = {}) {
  const family = getPromptFamily(familyId);
  if (String(version || '') !== family.version) {
    const error = new Error(`${family.id} prompt text version must be exactly v${family.version}.`);
    error.code = 'TEACHING_PROMPT_VERSION_UNMANIFESTED';
    throw error;
  }
  if (typeof promptText !== 'string' || !promptText.length) {
    const error = new Error(`${family.id} prompt text is required for runtime/build-time identity validation.`);
    error.code = 'TEACHING_PROMPT_TEXT_REQUIRED';
    throw error;
  }
  const actualSha256 = sha256(Buffer.from(promptText, 'utf8'));
  if (actualSha256 !== family.promptSha256) {
    const error = new Error(`${family.id} prompt text does not match the governed SHA-256.`);
    error.code = 'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED';
    throw error;
  }
  return true;
}

function createFrozenPromptBinding(familyId, expectedVersion = null) {
  const family = getPromptFamily(familyId);
  if (expectedVersion != null && String(expectedVersion) !== family.version) {
    const error = new Error(`${family.id} is governed at v${family.version}; requested v${expectedVersion} is not active.`);
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
    amendmentRegistryVersion: bodyStoreStatus.amendmentRegistryVersion || null,
    amendmentRegistrySha256: bodyStoreStatus.amendmentRegistrySha256 || null,
    promptAmended: family.amended,
    promptBodyEmbedded: false,
    promptBodyRuntimeAvailable: true,
  };
  Object.defineProperty(binding, FROZEN_PROMPT_BINDING, { value: true, enumerable: false, writable: false });
  return Object.freeze(binding);
}

function assertFrozenPromptBinding(binding) {
  if (!binding || binding[FROZEN_PROMPT_BINDING] !== true) {
    const error = new Error('Teaching prompt execution requires a binding loaded from the governed prompt catalog.');
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

function getPromptBody(familyId, version) {
  const family = getPromptFamily(familyId);
  if (String(version) !== family.version) fail('Unmanifested Teaching prompt version.', 'TEACHING_PROMPT_VERSION_UNMANIFESTED');
  const body = getFrozenPromptBodyRecord(family.id);
  assertPromptArtifactIdentity({ familyId, version: body.version, promptFile: body.promptFile, promptSha256: body.promptSha256 });
  return body;
}

function promptCatalogStatus() {
  return Object.freeze({
    manifestVersion: manifest.manifest_version,
    manifestSha256: EXPECTED_MANIFEST_SHA256,
    combinedPromptPack: manifest.combined_prompt_pack?.file || null,
    combinedPackSha256: EXPECTED_PACK_SHA256,
    historicalManifestSha256: HISTORICAL_MANIFEST_SHA256,
    historicalCombinedPackSha256: HISTORICAL_PACK_SHA256,
    familyCount: familyById.size,
    modelEligibleCapabilityCount: manifest.model_eligible_capability_count,
    closureStatus: manifest.closure_status,
    ...promptBodyStoreStatus(),
    qualificationPending: true,
  });
}

module.exports = {
  // Explicit candidate lookup cannot satisfy createFrozenPromptBinding.
  // Preserve the immutable active/historical catalog census and identity checks.
  getClassroomCandidateFamily: (id) => require('../classroom-remodel/candidate-registry').resolveCandidateFamily(id),
  getClassroomCandidateBinding: (request) => require('../classroom-remodel/candidate-registry').resolveCandidateBinding(request),
  HISTORICAL_MANIFEST_SHA256,
  HISTORICAL_PACK_SHA256,
  EXPECTED_MANIFEST_SHA256,
  EXPECTED_PACK_SHA256,
  ASSESSMENT_FAMILY_BOUNDARIES,
  getPromptFamily,
  getPromptBody,
  listPromptFamilies,
  createFrozenPromptBinding,
  assertFrozenPromptBinding,
  assertPromptArtifactIdentity,
  assertManifestedPromptText,
  promptCatalogStatus,
};
