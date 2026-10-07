'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const HISTORICAL_DIR = path.join(__dirname, 'frozen', 'v1.3');
const FROZEN_DIR = path.join(__dirname, 'frozen');
const SUCCESSOR_MANIFEST_ASSET = path.join(FROZEN_DIR, 'prompt-manifest.v1.4.json.gz.b64');
const AMENDMENT_REGISTRY_ASSET = path.join(FROZEN_DIR, 'prompt-amendments.v1.json');
const TPF20_ASSET = path.join(FROZEN_DIR, 'TPF-20_Class_Grounded_Study_Note_v1.0_DESIGN_FROZEN.md.gz.b64');

const HISTORICAL_MANIFEST_SHA256 = '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce';
const HISTORICAL_PACK_SHA256 = '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae';
const EXPECTED_MANIFEST_SHA256 = '7757b50cbf4cfb501158beeaccfbfd5776bc8ca8f7257b4855f5ed5fcdf67e3d';
const EXPECTED_PACK_SHA256 = '6632f5c566fb81906c5ecf27e7d5412a330b93f63c429d46f3bee65aac91ab5d';
const EXPECTED_CATALOG_SHA256 = '87499e2dc8c00e4cf0d789b654171c84d929c9352189fe509ec173f3f5a2346b';
const EXPECTED_AMENDMENT_REGISTRY_SHA256 = '76157d36547788ae05907b034afe69a0b60a293a758dea8b8b16b2839af25054';
const TPF20_SHA256 = 'd8d13f679e6817c1c02935e6581f5fc6ad512812004b59eebcf9a7d85c962e67';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fail(message) {
  const error = new Error(message);
  error.code = 'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED';
  throw error;
}

function readGzipBase64(file) {
  const encoded = fs.readFileSync(file, 'utf8').trim();
  return zlib.gunzipSync(Buffer.from(encoded, 'base64'));
}

function loadHistoricalCatalog() {
  const bytes = Buffer.concat([0, 1, 2, 3].map(index => fs.readFileSync(
    path.join(__dirname, 'frozen', `prompt-family-catalog.v1.3.part-${String(index).padStart(2, '0')}`)
  )));
  if (sha256(bytes) !== EXPECTED_CATALOG_SHA256) fail('Frozen historical prompt catalog identity mismatch.');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.manifest_version !== '1.3' || manifest.manifest_source_sha256 !== HISTORICAL_MANIFEST_SHA256 ||
      manifest.combined_prompt_pack?.sha256 !== HISTORICAL_PACK_SHA256 ||
      manifest.prompt_family_count !== 19 || manifest.families?.length !== 19) {
    fail('Frozen historical prompt manifest identity or census mismatch.');
  }
  return manifest;
}

function loadSuccessorManifest() {
  const bytes = readGzipBase64(SUCCESSOR_MANIFEST_ASSET);
  if (sha256(bytes) !== EXPECTED_MANIFEST_SHA256) fail('Frozen successor prompt manifest identity mismatch.');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.manifest_version !== '1.4' ||
      manifest.combined_prompt_pack?.sha256 !== EXPECTED_PACK_SHA256 ||
      manifest.prompt_family_count !== 20 || manifest.families?.length !== 20 ||
      manifest.model_eligible_capability_count !== 148) {
    fail('Frozen successor prompt manifest identity or census mismatch.');
  }
  return manifest;
}

function loadAmendmentRegistry(asset = AMENDMENT_REGISTRY_ASSET) {
  const bytes = fs.readFileSync(asset);
  if (sha256(bytes) !== EXPECTED_AMENDMENT_REGISTRY_SHA256) fail('Teaching prompt amendment registry identity mismatch.');
  const registry = JSON.parse(bytes.toString('utf8'));
  if (registry.registry_version !== '1.0' || registry.base_manifest_version !== '1.4' ||
      registry.base_manifest_sha256 !== EXPECTED_MANIFEST_SHA256 || !Array.isArray(registry.amendments)) {
    fail('Teaching prompt amendment registry contract mismatch.');
  }
  const ids = new Set();
  for (const amendment of registry.amendments) {
    if (!/^TPF-\d{2}$/.test(String(amendment.family_id || '')) || ids.has(amendment.family_id) ||
        !/^\d+\.\d+$/.test(String(amendment.version || '')) ||
        !/^TPF-\d{2}_[\w.-]+\.md$/.test(String(amendment.prompt_file || '')) ||
        !/^[\w.-]+\.md(?:\.gz\.b64)?$/.test(String(amendment.prompt_asset || '')) ||
        !/^[a-f0-9]{64}$/.test(String(amendment.prompt_sha256 || ''))) {
      fail('Teaching prompt amendment registry contains invalid or duplicate metadata.');
    }
    ids.add(amendment.family_id);
  }
  return registry;
}

function effectiveFamilies(manifest, registry) {
  const amendments = new Map(registry.amendments.map((item) => [item.family_id, item]));
  return manifest.families.map((family) => {
    const amendment = amendments.get(family.family_id);
    if (!amendment) return { ...family, amended: false, prompt_asset: null };
    if (String(amendment.supersedes_version) !== String(family.version)) {
      fail(`${family.family_id} amendment does not supersede the current base-manifest version.`);
    }
    return {
      ...family,
      version: amendment.version,
      prompt_file: amendment.prompt_file,
      prompt_sha256: amendment.prompt_sha256,
      status: amendment.status,
      amended: true,
      prompt_asset: amendment.prompt_asset,
      amendment_change_class: amendment.change_class || null,
      amendment_reason: amendment.reason || null,
    };
  });
}

// Read and verify at each lookup as well as startup: a modified asset cannot
// be served after readiness was asserted earlier in a long-running process.
function loadPromptBodyStore({
  directory = HISTORICAL_DIR,
  tpf20Asset = TPF20_ASSET,
  amendmentRegistryAsset = AMENDMENT_REGISTRY_ASSET,
  amendedAssetDirectory = FROZEN_DIR,
} = {}) {
  const historical = loadHistoricalCatalog();
  const manifest = loadSuccessorManifest();
  const registry = loadAmendmentRegistry(amendmentRegistryAsset);

  // The immutable v1.3 -> v1.4 baseline must still match exactly. Amendments
  // are applied only after this historical identity check succeeds.
  for (const oldFamily of historical.families) {
    const current = manifest.families.find((family) => family.family_id === oldFamily.family_id);
    if (!current) fail(`Historical family missing from successor manifest: ${oldFamily.family_id}`);
    for (const key of ['family_id','version','prompt_file','prompt_sha256','capability_count']) {
      if (current[key] !== oldFamily[key]) fail(`Historical prompt binding changed: ${oldFamily.family_id}.${key}`);
    }
  }

  const historicalExpected = new Set(historical.families.map((family) => family.prompt_file));
  const actualHistorical = fs.readdirSync(directory).sort();
  if (actualHistorical.length !== 19 || actualHistorical.some((name) => !historicalExpected.has(name))) {
    fail('Frozen historical prompt directory census mismatch.');
  }

  const effective = effectiveFamilies(manifest, registry);
  const records = new Map();
  for (const family of effective) {
    const { family_id: familyId, version, prompt_file: promptFile, prompt_sha256: promptSha256 } = family;
    if (!/^TPF-\d{2}$/.test(familyId) || !/^TPF-\d{2}_[\w.-]+\.md$/.test(promptFile) ||
        !/^[a-f0-9]{64}$/.test(promptSha256) || records.has(familyId)) {
      fail('Effective prompt catalog contains duplicate or invalid family metadata.');
    }

    let bytes;
    let storage;
    if (family.amended) {
      const amendmentAsset = path.join(amendedAssetDirectory, family.prompt_asset);
      if (String(family.prompt_asset).endsWith('.gz.b64')) {
        bytes = readGzipBase64(amendmentAsset);
        storage = 'gzip_base64_amendment_asset';
      } else {
        bytes = fs.readFileSync(amendmentAsset);
        storage = 'individual_utf8_amendment_asset';
      }
    } else if (familyId === 'TPF-20') {
      bytes = readGzipBase64(tpf20Asset);
      storage = 'gzip_base64_repository_asset';
    } else {
      bytes = fs.readFileSync(path.join(directory, promptFile));
      storage = 'individual_utf8_file';
    }

    if (familyId === 'TPF-20' && promptSha256 !== TPF20_SHA256) {
      fail('TPF-20 manifest SHA does not match the approved Class C design freeze.');
    }
    if (sha256(bytes) !== promptSha256) fail(`${familyId} prompt bytes differ from the effective governed binding.`);

    const promptText = bytes.toString('utf8');
    if (!Buffer.from(promptText, 'utf8').equals(bytes)) fail(`${familyId} prompt is not UTF-8.`);
    records.set(familyId, Object.freeze({
      familyId,
      version: String(version),
      promptFile,
      promptSha256,
      promptText,
      byteLength: bytes.length,
      storage,
      amended: family.amended === true,
    }));
  }

  if (records.size !== 20) fail('Teaching prompt runtime must contain exactly 20 effective families.');
  return records;
}

function getFrozenPromptBodyRecord(familyId) {
  const record = loadPromptBodyStore().get(familyId);
  if (!record) {
    const error = new Error(`Unknown governed Teaching prompt family: ${familyId}`);
    error.code = 'TEACHING_PROMPT_FAMILY_UNKNOWN';
    throw error;
  }
  return record;
}
function getFrozenPromptBody(familyId) { return getFrozenPromptBodyRecord(familyId).promptText; }
function assertPromptBodyStoreReady() { loadPromptBodyStore(); return true; }
function promptBodyStoreStatus() {
  const records = loadPromptBodyStore();
  const amendedFamilies = [...records.values()].filter((record) => record.amended).map((record) => `${record.familyId}@${record.version}`);
  return Object.freeze({
    manifestVersion: '1.4',
    manifestSha256: EXPECTED_MANIFEST_SHA256,
    combinedPackSha256: EXPECTED_PACK_SHA256,
    amendmentRegistryVersion: '1.0',
    amendmentRegistrySha256: EXPECTED_AMENDMENT_REGISTRY_SHA256,
    amendedFamilies: Object.freeze(amendedFamilies),
    historicalManifestSha256: HISTORICAL_MANIFEST_SHA256,
    historicalCombinedPackSha256: HISTORICAL_PACK_SHA256,
    familyCount: records.size,
    promptBodiesRuntimeAvailable: true,
    promptBodiesVerified: true,
    tpf20Sha256: TPF20_SHA256,
  });
}
module.exports = {
  EXPECTED_AMENDMENT_REGISTRY_SHA256,
  loadPromptBodyStore,
  getFrozenPromptBody,
  getFrozenPromptBodyRecord,
  assertPromptBodyStoreReady,
  promptBodyStoreStatus,
};
