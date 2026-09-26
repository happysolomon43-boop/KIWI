'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PROMPT_BODY_BUNDLE_VERSION = '1.0';
const PROMPT_MANIFEST_VERSION = '1.3';
const EXPECTED_MANIFEST_SHA256 = '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce';
const EXPECTED_PACK_SHA256 = '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae';
const EXPECTED_COMPRESSED_SHA256 = 'cda3c9959aade4ee187827708096cb89942d10b209bcefdfeae36b37115ba4ff';
const EXPECTED_DECOMPRESSED_SHA256 = 'ee68f82a48efb038134371cb33aa34e60986a177661be401d2386c54596d2fd1';
const BUNDLE_PART_COUNT = 12;

let cached = null;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(message, code = 'TEACHING_PROMPT_BODY_BUNDLE_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function partPath(index) {
  return path.join(
    __dirname,
    'frozen',
    'prompt-bodies.v1.3',
    `promptbundle-${String(index).padStart(2, '0')}.b64`
  );
}

function loadBundleBytes() {
  const encoded = [];
  for (let index = 0; index < BUNDLE_PART_COUNT; index += 1) {
    const filename = partPath(index);
    if (!fs.existsSync(filename)) {
      fail(
        `Frozen Teaching prompt-body bundle part is missing: ${path.basename(filename)}`,
        'TEACHING_PROMPT_BODY_BUNDLE_PART_MISSING'
      );
    }
    const part = fs.readFileSync(filename, 'utf8').trim();
    if (!part) {
      fail(
        `Frozen Teaching prompt-body bundle part is empty: ${path.basename(filename)}`,
        'TEACHING_PROMPT_BODY_BUNDLE_PART_EMPTY'
      );
    }
    encoded.push(part);
  }

  let compressed;
  try {
    compressed = Buffer.from(encoded.join(''), 'base64');
  } catch (error) {
    fail('Frozen Teaching prompt-body bundle is not valid base64.');
  }

  if (sha256(compressed) !== EXPECTED_COMPRESSED_SHA256) {
    fail(
      'Frozen Teaching prompt-body compressed bundle hash mismatch.',
      'TEACHING_PROMPT_BODY_BUNDLE_HASH_MISMATCH'
    );
  }
  return compressed;
}

function parseBundle() {
  const compressed = loadBundleBytes();
  let raw;
  try {
    raw = zlib.brotliDecompressSync(compressed);
  } catch (error) {
    fail(
      'Frozen Teaching prompt-body bundle could not be decompressed.',
      'TEACHING_PROMPT_BODY_BUNDLE_DECOMPRESSION_FAILED'
    );
  }

  if (sha256(raw) !== EXPECTED_DECOMPRESSED_SHA256) {
    fail(
      'Frozen Teaching prompt-body decompressed payload hash mismatch.',
      'TEACHING_PROMPT_BODY_PAYLOAD_HASH_MISMATCH'
    );
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail(
      'Frozen Teaching prompt-body payload is not valid JSON.',
      'TEACHING_PROMPT_BODY_PAYLOAD_INVALID'
    );
  }

  if (String(payload.bundle_version || '') !== PROMPT_BODY_BUNDLE_VERSION) {
    fail('Teaching prompt-body bundle version mismatch.');
  }
  if (String(payload.prompt_manifest_version || '') !== PROMPT_MANIFEST_VERSION) {
    fail('Teaching prompt-body bundle manifest version mismatch.');
  }
  if (String(payload.prompt_manifest_sha256 || '') !== EXPECTED_MANIFEST_SHA256) {
    fail('Teaching prompt-body bundle manifest SHA-256 mismatch.');
  }
  if (String(payload.combined_prompt_pack_sha256 || '') !== EXPECTED_PACK_SHA256) {
    fail('Teaching prompt-body bundle combined-pack SHA-256 mismatch.');
  }
  if (Number(payload.family_count) !== 19 || !Array.isArray(payload.families) || payload.families.length !== 19) {
    fail('Teaching prompt-body bundle must contain exactly 19 prompt families.');
  }

  const families = new Map();
  for (const entry of payload.families) {
    const familyId = String(entry?.family_id || '').trim();
    const version = String(entry?.version || '').trim();
    const promptFile = String(entry?.prompt_file || '').trim();
    const promptSha256 = String(entry?.prompt_sha256 || '').trim();
    const promptText = entry?.prompt_text;

    if (!familyId || !version || !promptFile || !promptSha256 || typeof promptText !== 'string' || !promptText.length) {
      fail('Teaching prompt-body bundle contains a malformed family entry.');
    }
    if (families.has(familyId)) {
      fail(`Teaching prompt-body bundle contains duplicate family ${familyId}.`);
    }
    const actualSha256 = sha256(Buffer.from(promptText, 'utf8'));
    if (actualSha256 !== promptSha256) {
      fail(
        `${familyId} prompt body does not match its embedded SHA-256.`,
        'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED'
      );
    }
    families.set(familyId, Object.freeze({
      familyId,
      version,
      promptFile,
      promptSha256,
      promptText,
      byteLength: Buffer.byteLength(promptText, 'utf8'),
    }));
  }

  return Object.freeze({
    bundleVersion: PROMPT_BODY_BUNDLE_VERSION,
    manifestVersion: PROMPT_MANIFEST_VERSION,
    manifestSha256: EXPECTED_MANIFEST_SHA256,
    combinedPackSha256: EXPECTED_PACK_SHA256,
    compressedSha256: EXPECTED_COMPRESSED_SHA256,
    payloadSha256: EXPECTED_DECOMPRESSED_SHA256,
    familyCount: families.size,
    families,
  });
}

function bundle() {
  if (!cached) cached = parseBundle();
  return cached;
}

function getFrozenPromptBodyRecord(familyId) {
  const id = String(familyId || '').trim();
  const record = bundle().families.get(id);
  if (!record) {
    const error = new Error(`Frozen Teaching prompt body is unavailable for ${familyId}.`);
    error.code = 'TEACHING_PROMPT_BODY_UNKNOWN';
    throw error;
  }
  return record;
}

function assertPromptBodyBundleReady() {
  const resolved = bundle();
  if (resolved.familyCount !== 19) {
    fail('Teaching prompt-body bundle census mismatch.');
  }
  return true;
}

function promptBodyBundleStatus() {
  const resolved = bundle();
  return Object.freeze({
    bundleVersion: resolved.bundleVersion,
    manifestVersion: resolved.manifestVersion,
    manifestSha256: resolved.manifestSha256,
    combinedPackSha256: resolved.combinedPackSha256,
    compressedSha256: resolved.compressedSha256,
    payloadSha256: resolved.payloadSha256,
    familyCount: resolved.familyCount,
    promptBodiesRuntimeAvailable: true,
  });
}

module.exports = {
  PROMPT_BODY_BUNDLE_VERSION,
  EXPECTED_COMPRESSED_SHA256,
  EXPECTED_DECOMPRESSED_SHA256,
  BUNDLE_PART_COUNT,
  getFrozenPromptBodyRecord,
  assertPromptBodyBundleReady,
  promptBodyBundleStatus,
};
