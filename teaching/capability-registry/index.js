'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

function loadCompiledRegistry() {
  const encoded = ['registry-data.v1.1.part-00.b64', 'registry-data.v1.1.part-01.b64']
    .map((name) => fs.readFileSync(path.join(__dirname, name), 'utf8').trim())
    .join('');
  const bytes = zlib.brotliDecompressSync(Buffer.from(encoded, 'base64'));
  return Object.freeze({ bytes, data: JSON.parse(bytes.toString('utf8')) });
}

const compiled = loadCompiledRegistry();
const data = compiled.data;
const {
  AUTHORITY_ORDER,
  assertAuthorityLevel,
  assertIntelligenceClass,
} = require('../ai/contracts');

const REGISTRY_VERSION = '1.1';
const REGISTRY_SOURCE_SHA256 = 'a68e19eff631d43d4ab31ddd15b46298dc4ffb48dc2006758e85f712200c4ef4';
const REGISTRY_COMPILED_SHA256 = '73a6517a71f49b8f72323369b19c3f9cf50dec4032fae24f695f72c0766e2b9d';

const EXPECTED_COUNTS = Object.freeze({
  total: 169,
  modelEligible: 147,
  t0Promptless: 22,
  promptFamilies: 19,
  legacyAliases: 165,
});

function invariant(condition, message) {
  if (!condition) {
    const error = new Error(`Teaching Capability Registry invariant failed: ${message}`);
    error.code = 'TEACHING_CAPABILITY_REGISTRY_INVALID';
    throw error;
  }
}

invariant(crypto.createHash('sha256').update(compiled.bytes).digest('hex') === REGISTRY_COMPILED_SHA256, 'compiled registry payload hash drift');
invariant(data.registry_version === REGISTRY_VERSION, 'compiled registry version drift');
invariant(data.source_sha256 === REGISTRY_SOURCE_SHA256, 'compiled registry source hash drift');

const capabilities = Object.freeze(data.capabilities.map((capability) => Object.freeze({
  id: capability.id,
  legacy_aliases: Object.freeze([...(capability.aliases || [])]),
  execution_class: capability.execution_class,
  authority_ceiling: capability.authority_ceiling,
  authoritative_owner_boundary: capability.authoritative_owner_boundary,
  model_posture: capability.model_posture,
  prompt_family_id: capability.prompt_family_id,
  commit_posture: capability.commit_posture,
  blueprint_anchors: capability.blueprint_anchors,
  purpose: capability.purpose,
  contract_refs: Object.freeze({
    constitution: 'Blueprint-11.5/Teaching-Constitution',
    structural_prompt_contract: 'Teaching-Structural-Prompt-Contract/D03-v1',
  }),
  output_schema_binding: 'RUNTIME_REQUIRED',
})));

const capabilityById = new Map();
const canonicalByAlias = new Map();

function assertRegistryIntegrity() {
  invariant(capabilities.length === EXPECTED_COUNTS.total, 'expected exactly 169 capabilities');
  capabilityById.clear();
  canonicalByAlias.clear();

  const familyIds = new Set();
  let t0Promptless = 0;
  let modelEligible = 0;
  let aliasCount = 0;

  for (const capability of capabilities) {
    invariant(/^teaching\./.test(capability.id), `invalid canonical id: ${capability.id}`);
    invariant(!capabilityById.has(capability.id), `duplicate canonical id: ${capability.id}`);
    assertIntelligenceClass(capability.execution_class);
    assertAuthorityLevel(capability.authority_ceiling);
    invariant(
      typeof capability.authoritative_owner_boundary === 'string' && capability.authoritative_owner_boundary.trim(),
      `${capability.id} missing authoritative owner/boundary`
    );
    invariant(
      typeof capability.commit_posture === 'string' && capability.commit_posture.trim(),
      `${capability.id} missing commit posture`
    );
    invariant(
      capability.contract_refs.constitution === 'Blueprint-11.5/Teaching-Constitution',
      `${capability.id} missing Constitution binding`
    );

    capabilityById.set(capability.id, capability);
    for (const alias of capability.legacy_aliases) {
      invariant(!canonicalByAlias.has(alias), `duplicate legacy alias: ${alias}`);
      canonicalByAlias.set(alias, capability.id);
      aliasCount += 1;
    }

    if (capability.authority_ceiling === 'T0') {
      t0Promptless += 1;
      invariant(capability.prompt_family_id == null, `${capability.id} is T0 but has a prompt family`);
      invariant(
        capability.model_posture === 'NONE' || capability.model_posture === 'DELEGATES_ONLY',
        `${capability.id} T0 model posture must not be model-primary`
      );
    } else {
      modelEligible += 1;
      invariant(/^TPF-\d{2}$/.test(capability.prompt_family_id || ''), `${capability.id} must have exactly one prompt family`);
      familyIds.add(capability.prompt_family_id);
    }
  }

  invariant(t0Promptless === EXPECTED_COUNTS.t0Promptless, 'expected exactly 22 T0/no-prompt capabilities');
  invariant(modelEligible === EXPECTED_COUNTS.modelEligible, 'expected exactly 147 model-eligible capabilities');
  invariant(aliasCount === EXPECTED_COUNTS.legacyAliases, 'expected exactly 165 legacy INV aliases');
  invariant(familyIds.size === EXPECTED_COUNTS.promptFamilies, 'expected exactly 19 prompt families');

  return Object.freeze({
    registryVersion: REGISTRY_VERSION,
    sourceSha256: REGISTRY_SOURCE_SHA256,
    compiledSha256: REGISTRY_COMPILED_SHA256,
    total: capabilities.length,
    modelEligible,
    t0Promptless,
    promptFamilies: familyIds.size,
    legacyAliases: aliasCount,
  });
}

const integrity = assertRegistryIntegrity();

function getCapability(idOrAlias) {
  const key = String(idOrAlias || '').trim();
  const canonicalId = capabilityById.has(key) ? key : canonicalByAlias.get(key);
  if (!canonicalId) {
    const error = new Error(`Unknown Teaching capability identity: ${idOrAlias}`);
    error.code = 'TEACHING_CAPABILITY_UNKNOWN';
    throw error;
  }
  return capabilityById.get(canonicalId);
}

function compareAuthority(left, right) {
  return AUTHORITY_ORDER.indexOf(assertAuthorityLevel(left)) - AUTHORITY_ORDER.indexOf(assertAuthorityLevel(right));
}

function assertCapabilityBinding(capabilityId, {
  authorityLevel = null,
  promptFamilyId = undefined,
  authoritativeOwnerBoundary = null,
} = {}) {
  const capability = getCapability(capabilityId);
  if (authorityLevel != null && compareAuthority(authorityLevel, capability.authority_ceiling) > 0) {
    const error = new Error(`${capability.id} cannot be invoked above authority ceiling ${capability.authority_ceiling}.`);
    error.code = 'TEACHING_CAPABILITY_AUTHORITY_ESCALATION';
    throw error;
  }
  if (promptFamilyId !== undefined) {
    const normalized = promptFamilyId == null ? null : String(promptFamilyId).trim();
    if (normalized !== capability.prompt_family_id) {
      const error = new Error(`${capability.id} prompt family is fixed at ${capability.prompt_family_id || 'none'}.`);
      error.code = 'TEACHING_CAPABILITY_PROMPT_FAMILY_MISMATCH';
      throw error;
    }
  }
  if (authoritativeOwnerBoundary != null && String(authoritativeOwnerBoundary).trim() !== capability.authoritative_owner_boundary) {
    const error = new Error(`${capability.id} authoritative owner/boundary cannot be changed by invocation.`);
    error.code = 'TEACHING_CAPABILITY_OWNER_MISMATCH';
    throw error;
  }
  return capability;
}

function listCapabilities() {
  return Object.freeze([...capabilityById.values()]);
}

module.exports = {
  EXPECTED_COUNTS,
  REGISTRY_VERSION,
  REGISTRY_SOURCE_SHA256,
  REGISTRY_COMPILED_SHA256,
  integrity,
  assertRegistryIntegrity,
  getCapability,
  listCapabilities,
  assertCapabilityBinding,
};
