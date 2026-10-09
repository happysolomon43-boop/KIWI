'use strict';
// Sessions are pinned. No browser flag can select a runtime or advertise routes.
const {fail}=require('./contracts');
const {validatePolicy,capabilityReadiness}=require('./state-policy');
const LEGACY='LEGACY';const REMODELED='CLASSROOM_V1';
function selectSessionContract({existingBinding=null,release=null,policy=null,qualifiedRoutes=[],cohortAuthorized=false}={}){
 if(existingBinding){if(![LEGACY,REMODELED].includes(existingBinding.engine))fail('CLASSROOM_SESSION_ENGINE_UNKNOWN');if(existingBinding.engine===REMODELED&&(!existingBinding.promptManifestHash||!existingBinding.schemaVersion||!existingBinding.policyVersion))fail('CLASSROOM_SESSION_BINDING_INCOMPLETE');return {...existingBinding,upgrade:false};}
 if(!release||release.status!=='QUALIFIED'||!cohortAuthorized)return {engine:LEGACY,upgrade:false,permittedCapabilities:[]};
 validatePolicy(policy);for(const f of ['promptManifestHash','schemaVersion','engineVersion','registryVersion','rollbackEngineVersion'])if(!release[f])fail('CLASSROOM_RELEASE_MANIFEST_INCOMPLETE');
 if(!capabilityReadiness(policy,'session').ready)fail('CLASSROOM_SESSION_POLICY_NOT_ADOPTED');
 const permittedCapabilities=qualifiedRoutes.filter(r=>r.qualified===true&&r.schemaVersion===release.schemaVersion&&capabilityReadiness(policy,r.policyCapability).ready).map(r=>r.action);
 return {engine:REMODELED,engineVersion:release.engineVersion,promptManifestHash:release.promptManifestHash,schemaVersion:release.schemaVersion,registryVersion:release.registryVersion,policyVersion:policy.version,rollbackEngineVersion:release.rollbackEngineVersion,permittedCapabilities,upgrade:false};
}
function rollbackDisposition(binding,{newAdmissionEnabled=false,supportedEngines=[]}={}){
 if(binding.engine===LEGACY)return {action:'legacy',newAdmissionEnabled};
 return {action:supportedEngines.includes(binding.engineVersion)?'continue_pinned':'pause_preserving_state',newAdmissionEnabled:false,resetTimers:false,resetAllowances:false,discardQuestions:false};
}
module.exports={LEGACY,REMODELED,selectSessionContract,rollbackDisposition};
