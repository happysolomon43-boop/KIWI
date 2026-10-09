'use strict';
// Candidate namespace deliberately cannot supply an active runtime binding.
// Existing catalog/body hashes and historical readers remain authoritative.
const {readCandidates,candidateBody,validateMigrationProposal}=require('./candidate-governance');
const proposal=require('./migration-proposal.v1.json');
const {AUTHOR_MODES,COORDINATOR_MODES,PRESENTER_MODES}=require('./contracts');
const {getModeSchema}=require('./mode-schemas');
const ROLES=Object.freeze({'TPF-05':{role:'author',modes:AUTHOR_MODES},'TPF-21':{role:'coordinator',modes:COORDINATOR_MODES},'TPF-08':{role:'presenter',modes:PRESENTER_MODES}});
function resolveCandidateFamily(id){
 const canonical=id==='TPF-5/8'?'TPF-21':id;
 const manifest=readCandidates();validateMigrationProposal(proposal);
 const family=manifest.families.find(f=>f.familyId===canonical);
 if(!family||!ROLES[canonical])throw Object.assign(new Error('Unknown candidate family'),{code:'CLASSROOM_CANDIDATE_FAMILY_UNKNOWN'});
 return {canonicalId:canonical,designAlias:canonical==='TPF-21'?'TPF-5/8':null,version:family.version,sha256:family.sha256,role:ROLES[canonical].role,modes:[...ROLES[canonical].modes],governanceState:proposal.state,registrationState:'CANDIDATE_REGISTERED',qualification:'NOT_QUALIFIED',runtimeAuthorized:false};
}
function resolveCandidateBinding({familyId,mode,capabilityId=null,context={}}){
 const family=resolveCandidateFamily(familyId);
 if(!family.modes.includes(mode))throw Object.assign(new Error('Unregistered task mode'),{code:'CLASSROOM_CANDIDATE_MODE_UNKNOWN'});
 if(capabilityId!==null){const binding=proposal.bindings.find(b=>b.capabilityId===capabilityId);if(family.canonicalId!=='TPF-21'||!binding?.modes.includes(mode))throw Object.assign(new Error('Capability mode mismatch'),{code:'CLASSROOM_CANDIDATE_CAPABILITY_MISMATCH'});}
 return {family,schema:getModeSchema(family.role,mode,context),prompt:candidateBody(family.canonicalId),capabilityId,runtimeAuthorized:false};
}
function assertRuntimeActivation(){throw Object.assign(new Error('Candidate registration does not authorize runtime activation'),{code:'CLASSROOM_CANDIDATE_ACTIVATION_PROHIBITED'});}
module.exports={resolveCandidateFamily,resolveCandidateBinding,assertRuntimeActivation};
