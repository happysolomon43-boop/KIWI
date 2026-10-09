'use strict';

// A candidate binding is an internal evaluation capability, not a JSON flag
// granting runtime authority. Existing frozen/historical readers stay intact.
const {getCapability}=require('../capability-registry');
const {resolveCandidateFamily}=require('./candidate-registry');
const {candidateBody}=require('./candidate-governance');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const proposal=require('./migration-proposal.v1.json');
const {fail}=require('./contracts');
const bindings=new WeakSet();
function createCandidateInvocationBinding({capabilityId,familyId,mode}={}) {
 const capability=getCapability(capabilityId),family=resolveCandidateFamily(familyId);
 if(!family.modes.includes(mode))fail('CLASSROOM_CANDIDATE_MODE_UNKNOWN');
 if(family.canonicalId==='TPF-21') {
  if(!proposal.bindings.some(b=>b.capabilityId===capabilityId&&b.modes.includes(mode)))fail('CLASSROOM_CANDIDATE_CAPABILITY_MISMATCH');
 } else if(capability.prompt_family_id!==family.canonicalId)fail('CLASSROOM_CANDIDATE_CAPABILITY_MISMATCH');
 const manifest=fs.readFileSync(path.join(__dirname,'prompts/candidate-manifest.v1.json'));
 const manifestSha256=crypto.createHash('sha256').update(manifest).digest('hex');
 const binding=Object.freeze({manifestVersion:'classroom-prompt-candidates.v1',manifestSha256,capabilityId,familyId:family.canonicalId,familyVersion:family.version,promptSha256:family.sha256,mode,purpose:'QUALIFICATION_ONLY',runtimeAuthorized:false});
 bindings.add(binding);return binding;
}
function assertCandidateInvocationBinding(binding,{capabilityId,mode}={}) {
 if(!binding||!bindings.has(binding)||binding.capabilityId!==capabilityId||binding.mode!==mode)fail('CLASSROOM_CANDIDATE_BINDING_UNTRUSTED');
 const manifestHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'prompts/candidate-manifest.v1.json'))).digest('hex');
 if(manifestHash!==binding.manifestSha256)fail('CLASSROOM_CANDIDATE_BINDING_STALE');
 const body=candidateBody(binding.familyId);
 if(body.metadata.sha256!==binding.promptSha256||body.metadata.version!==binding.familyVersion)fail('CLASSROOM_CANDIDATE_BINDING_STALE');
 return body;
}
module.exports={createCandidateInvocationBinding,assertCandidateInvocationBinding};
