'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FROZEN_DIR = path.join(__dirname, 'frozen', 'v1.3');
const EXPECTED_MANIFEST_SHA256 = '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce';
const EXPECTED_PACK_SHA256 = '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae';
const EXPECTED_CATALOG_SHA256 = '87499e2dc8c00e4cf0d789b654171c84d929c9352189fe509ec173f3f5a2346b';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fail(message) {
  const error = new Error(message);
  error.code = 'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED';
  throw error;
}

// Read and verify at each lookup as well as startup: a modified asset cannot
// be served after readiness was asserted earlier in a long-running process.
function loadPromptBodyStore({ directory = FROZEN_DIR } = {}) {
  const catalogBytes = Buffer.concat([0, 1, 2, 3].map(index => fs.readFileSync(
    path.join(__dirname, 'frozen', `prompt-family-catalog.v1.3.part-${String(index).padStart(2, '0')}`)
  )));
  if (sha256(catalogBytes) !== EXPECTED_CATALOG_SHA256) fail('Frozen prompt catalog identity mismatch.');
  const manifest = JSON.parse(catalogBytes.toString('utf8'));
  if (manifest.manifest_version !== '1.3' || manifest.manifest_source_sha256 !== EXPECTED_MANIFEST_SHA256 ||
      manifest.combined_prompt_pack?.sha256 !== EXPECTED_PACK_SHA256 ||
      manifest.prompt_family_count !== 19 || manifest.families?.length !== 19) {
    fail('Frozen prompt manifest identity or census mismatch.');
  }
  const expected = new Set();
  const records = new Map();
  for (const family of manifest.families) {
    const { family_id: familyId, version, prompt_file: promptFile, prompt_sha256: promptSha256 } = family;
    if (!/^TPF-\d{2}$/.test(familyId) || !/^TPF-\d{2}_[\w.-]+\.md$/.test(promptFile) ||
        !/^[a-f0-9]{64}$/.test(promptSha256) || records.has(familyId) || expected.has(promptFile)) {
      fail('Frozen prompt manifest contains duplicate or invalid family metadata.');
    }
    expected.add(promptFile);
    const bytes = fs.readFileSync(path.join(directory, promptFile));
    if (sha256(bytes) !== promptSha256) fail(`${familyId} frozen prompt bytes differ from the manifest.`);
    const promptText = bytes.toString('utf8');
    if (!Buffer.from(promptText, 'utf8').equals(bytes)) fail(`${familyId} frozen prompt is not UTF-8.`);
    records.set(familyId, Object.freeze({ familyId, version: String(version), promptFile,
      promptSha256, promptText, byteLength: bytes.length }));
  }
  const actual = fs.readdirSync(directory).sort();
  if (actual.length !== 19 || actual.some(name => !expected.has(name))) fail('Frozen prompt directory census mismatch.');
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
  return Object.freeze({ manifestVersion: '1.3', manifestSha256: EXPECTED_MANIFEST_SHA256,
    combinedPackSha256: EXPECTED_PACK_SHA256, familyCount: records.size,
    promptBodiesRuntimeAvailable: true, promptBodiesVerified: true });
}
module.exports = { loadPromptBodyStore, getFrozenPromptBody, getFrozenPromptBodyRecord,
  assertPromptBodyStoreReady, promptBodyStoreStatus };
