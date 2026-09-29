'use strict';

const part00 = require('./prompt-catalog-data.v1.3.part-00');
const part01 = require('./prompt-catalog-data.v1.3.part-01');

const HISTORICAL_MANIFEST_VERSION = '1.3';
const HISTORICAL_MANIFEST_SHA256 = '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce';
const HISTORICAL_COMBINED_PACK_SHA256 = '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae';

const MANIFEST_VERSION = '1.4';
const MANIFEST_SHA256 = '7757b50cbf4cfb501158beeaccfbfd5776bc8ca8f7257b4855f5ed5fcdf67e3d';
const COMBINED_PACK_SHA256 = '6632f5c566fb81906c5ecf27e7d5412a330b93f63c429d46f3bee65aac91ab5d';

const TPF20 = Object.freeze({
  id:'TPF-20',
  version:'1.0',
  name:'Class-Grounded Study Note',
  criticality:'C3',
  capabilityCount:1,
  promptFile:'TPF-20_Class_Grounded_Study_Note_v1.0_DESIGN_FROZEN.md',
  promptSha256:'d8d13f679e6817c1c02935e6581f5fc6ad512812004b59eebcf9a7d85c962e67',
  sourceManifestVersion:MANIFEST_VERSION,
  sourceManifestSha256:MANIFEST_SHA256,
  routeQualification:'UNQUALIFIED',
});

const historicalFamilies = Object.freeze([...part00, ...part01].map((item) => Object.freeze({ ...item })));
if (historicalFamilies.length !== 19) throw new Error('Historical D03 prompt catalog must remain exactly 19 families.');
const families = Object.freeze([...historicalFamilies, TPF20]);
const byId = new Map(families.map((family) => [family.id, family]));

function fail(message, code='TEACHING_PROMPT_CATALOG_INVALID') {
  const error = new Error(message); error.code=code; throw error;
}

function getPromptFamily(id) {
  const family=byId.get(String(id||'').trim().toUpperCase());
  if(!family) fail(`Unknown frozen Teaching prompt family: ${id}`,'TEACHING_PROMPT_FAMILY_UNKNOWN');
  return family;
}

function listPromptFamilies() { return families; }

function manifestIdentityFor(family) {
  if (family.id === 'TPF-20') {
    return Object.freeze({
      manifestVersion:MANIFEST_VERSION,
      manifestSha256:MANIFEST_SHA256,
      combinedPackSha256:COMBINED_PACK_SHA256,
    });
  }
  return Object.freeze({
    manifestVersion:HISTORICAL_MANIFEST_VERSION,
    manifestSha256:HISTORICAL_MANIFEST_SHA256,
    combinedPackSha256:HISTORICAL_COMBINED_PACK_SHA256,
  });
}

function createFrozenPromptBinding(familyId, version) {
  const family=getPromptFamily(familyId);
  if(String(version)!==family.version) fail(
    `${family.id} is frozen at version ${family.version}, not ${version}.`,
    'TEACHING_PROMPT_VERSION_MISMATCH'
  );
  const identity=manifestIdentityFor(family);
  const binding={
    familyId:family.id,
    familyVersion:family.version,
    familyName:family.name,
    defaultCriticality:family.criticality,
    promptFile:family.promptFile,
    promptSha256:family.promptSha256,
    capabilityCount:family.capabilityCount,
    ...identity,
  };
  Object.defineProperty(binding,'__frozenCatalogBinding',{value:true,enumerable:false,writable:false});
  return Object.freeze(binding);
}

function assertFrozenPromptBinding(binding) {
  if (!binding?.__frozenCatalogBinding) fail('Prompt binding did not originate from frozen D03 catalog.','TEACHING_PROMPT_BINDING_UNTRUSTED');
  const expected=createFrozenPromptBinding(binding.familyId,binding.familyVersion);
  for(const field of ['familyId','familyVersion','promptFile','promptSha256','manifestVersion','manifestSha256','combinedPackSha256']){
    if(binding[field]!==expected[field]) fail(`Frozen prompt binding drift: ${field}`,'TEACHING_PROMPT_BINDING_DRIFT');
  }
  return true;
}

function assertPromptArtifactIdentity({ manifestSha256, combinedPackSha256 }={}) {
  if (manifestSha256 !== MANIFEST_SHA256 || combinedPackSha256 !== COMBINED_PACK_SHA256) {
    fail('Teaching prompt artifact identity does not match successor manifest v1.4.','TEACHING_PROMPT_ARTIFACT_MISMATCH');
  }
  return true;
}

function getPromptBody(familyId, version) {
  const { getFrozenPromptBodyRecord } = require('./prompt-body-store');
  return getFrozenPromptBodyRecord(familyId,version);
}

function promptCatalogStatus() {
  const capabilityCount=families.reduce((sum,f)=>sum+Number(f.capabilityCount||0),0);
  return Object.freeze({
    manifestVersion:MANIFEST_VERSION,
    manifestSha256:MANIFEST_SHA256,
    combinedPackSha256:COMBINED_PACK_SHA256,
    historicalManifestVersion:HISTORICAL_MANIFEST_VERSION,
    historicalManifestSha256:HISTORICAL_MANIFEST_SHA256,
    historicalCombinedPackSha256:HISTORICAL_COMBINED_PACK_SHA256,
    historicalFamilyCount:19,
    familyCount:families.length,
    modelEligibleCapabilityCount:capabilityCount,
    promptBodiesRuntimeAvailable:true,
    promptBodiesVerified:true,
    tpf20Qualification:'UNQUALIFIED',
  });
}

module.exports={
  MANIFEST_VERSION,MANIFEST_SHA256,COMBINED_PACK_SHA256,
  HISTORICAL_MANIFEST_VERSION,HISTORICAL_MANIFEST_SHA256,HISTORICAL_COMBINED_PACK_SHA256,
  TPF20,getPromptFamily,listPromptFamilies,createFrozenPromptBinding,assertFrozenPromptBinding,
  assertPromptArtifactIdentity,getPromptBody,promptCatalogStatus,
};
