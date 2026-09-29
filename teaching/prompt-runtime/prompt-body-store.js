'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const HISTORICAL_DIR = path.join(__dirname, 'frozen', 'v1.3');
const SUCCESSOR_MANIFEST_ASSET = path.join(__dirname, 'frozen', 'prompt-manifest.v1.4.json.gz.b64');
const TPF20_ASSET = path.join(__dirname, 'frozen', 'TPF-20_Class_Grounded_Study_Note_v1.0_DESIGN_FROZEN.md.gz.b64');

const HISTORICAL_MANIFEST_SHA256 = '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce';
const HISTORICAL_PACK_SHA256 = '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae';
const EXPECTED_MANIFEST_SHA256 = '7757b50cbf4cfb501158beeaccfbfd5776bc8ca8f7257b4855f5ed5fcdf67e3d';
const EXPECTED_PACK_SHA256 = '6632f5c566fb81906c5ecf27e7d5412a330b93f63c429d46f3bee65aac91ab5d';
const EXPECTED_CATALOG_SHA256 = '87499e2dc8c00e4cf0d789b654171c84d929c9352189fe509ec173f3f5a2346b';
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

// Read and verify at each lookup as well as startup: a modified asset cannot
// be served after readiness was asserted earlier in a long-running process.
function loadPromptBodyStore({
  directory = HISTORICAL_DIR,
  tpf20Asset = TPF20_ASSET,
} = {}) {
  const historical = loadHistoricalCatalog();
  const manifest = loadSuccessorManifest();

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

  const records = new Map();
  for (const family of manifest.families) {
    const { family_id: familyId, version, prompt_file: promptFile, prompt_sha256: promptSha256 } = family;
    if (!/^TPF-\d{2}$/.test(familyId) || !/^TPF-\d{2}_[\w.-]+\.md$/.test(promptFile) ||
        !/^[a-f0-9]{64}$/.test(promptSha256) || records.has(familyId)) {
      fail('Frozen prompt manifest contains duplicate or invalid family metadata.');
    }

    const bytes = familyId === 'TPF-20'
      ? readGzipBase64(tpf20Asset)
      : fs.readFileSync(path.join(directory, promptFile));

    if (familyId === 'TPF-20' && promptSha256 !== TPF20_SHA256) {
      fail('TPF-20 manifest SHA does not match the approved Class C design freeze.');
    }
    if (sha256(bytes) !== promptSha256) fail(`${familyId} frozen prompt bytes differ from the manifest.`);

    const promptText = bytes.toString('utf8');
    if (!Buffer.from(promptText, 'utf8').equals(bytes)) fail(`${familyId} frozen prompt is not UTF-8.`);
    records.set(familyId, Object.freeze({
      familyId,
      version: String(version),
      promptFile,
      promptSha256,
      promptText,
      byteLength: bytes.length,
      storage: familyId === 'TPF-20' ? 'gzip_base64_repository_asset' : 'individual_utf8_file',
    }));
  }

  if (records.size !== 20) fail('Frozen prompt runtime must contain exactly 20 families.');
  return records;
}

function getFrozenPromptBodyRecord(familyId) {
  const record = loadPromptBodyStore().get(familyId);
  if (!record) {
    const error = new Error(`Unknown frozen Teaching prompt family: ${familyId}`);
    error.code = 'TEACHING_PROMPT_FAMILY_UNKNOWN';
    throw error;
  }
  return record;
}
function getFrozenPromptBody(familyId) { return getFrozenPromptBodyRecord(familyId).promptText; }
function assertPromptBodyStoreReady() { loadPromptBodyStore(); return true; }
function promptBodyStoreStatus() {
  const records = loadPromptBodyStore();
  return Object.freeze({
    manifestVersion: '1.4',
    manifestSha256: EXPECTED_MANIFEST_SHA256,
    combinedPackSha256: EXPECTED_PACK_SHA256,
    historicalManifestSha256: HISTORICAL_MANIFEST_SHA256,
    historicalCombinedPackSha256: HISTORICAL_PACK_SHA256,
    familyCount: records.size,
    promptBodiesRuntimeAvailable: true,
    promptBodiesVerified: true,
    tpf20Sha256: TPF20_SHA256,
  });
}
module.exports = {
  loadPromptBodyStore,
  getFrozenPromptBody,
  getFrozenPromptBodyRecord,
  assertPromptBodyStoreReady,
  promptBodyStoreStatus,
};
