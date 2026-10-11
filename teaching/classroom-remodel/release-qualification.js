'use strict';
// Evidence is verified against operator-managed public trust roots, never
// accepted because a fixture, PR body or caller labels itself qualified.
const crypto=require('node:crypto');
const {hash}=require('./academic-artifacts');
const {DEFINITIONS,validatePolicy,capabilityReadiness}=require('./state-policy');
const VERSION='classroom-release-evidence.v1';
const CORE=['session','presentation','transport','messages','tasks','generation','history'];
function verifyAttestation(envelope,{manifestHash,trustRoots,now=new Date()}={}){
 try{
  const p=envelope.payload,root=trustRoots?.[envelope.keyId];
  if(!root||root.owner!==p.owner||!root.categories?.includes(p.category)||p.version!==VERSION||p.manifestHash!==manifestHash||p.result!=='ACCEPTED'||p.fixture!==false||!Array.isArray(p.evidenceRefs)||!p.evidenceRefs.length||p.evidenceRefs.some(r=>typeof r!=='string'||!r.trim())||!p.executionId||!p.subject||!Number.isFinite(Date.parse(p.observedAt))||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.observedAt)>+new Date(now)||Date.parse(p.expiresAt)<=+new Date(now))return null;
  if(p.category==='scenario'&&['given','actionOrFailure','expectedPublicBehavior','expectedPersistedFacts','forbiddenEffects','testedVersions'].some(k=>typeof p.observation?.[k]!=='string'||!p.observation[k].trim()))return null;
  const publicKey=crypto.createPublicKey(root.publicKey);
  if(publicKey.asymmetricKeyType!=='ed25519'||!crypto.verify(null,Buffer.from(hash(p)),publicKey,Buffer.from(envelope.signature,'base64')))return null;
  return p;
 }catch{return null;}
}
function evaluateRelease({manifest,policy,attestations=[],trustRoots={},now=new Date(),stage='GENERAL'}={}){
 const manifestHash=hash(manifest),accepted=attestations.map(e=>verifyAttestation(e,{manifestHash,trustRoots,now})).filter(Boolean),blockers=[];
 const need=(category,subject)=>{if(!accepted.some(p=>p.category===category&&p.subject===subject))blockers.push({category,subject,reason:'ACCEPTED_BOUND_EVIDENCE_MISSING'});};
 if(manifest?.version!=='classroom-release-manifest.v1'||!manifest.sourceRevision||manifest.migratedCapabilities?.length!==22||new Set(manifest.migratedCapabilities?.map(c=>c.id)).size!==22||!manifest.runtimeHash||!manifest.inventoryHash||!manifest.promptManifestHash||!manifest.assets?.length||!manifest.migrations?.length)blockers.push({category:'manifest',subject:'release',reason:'MANIFEST_INCOMPLETE'});
 try{validatePolicy(policy);for(const capability of CORE){const r=capabilityReadiness(policy,capability);if(!r.ready)blockers.push({category:'policy',subject:capability,reason:'POLICY_NOT_ADOPTED',missing:r.missing});}if(hash(policy)!==manifest.policyHash)blockers.push({category:'policy',subject:'release',reason:'POLICY_HASH_MISMATCH'});}catch{blockers.push({category:'policy',subject:'release',reason:'POLICY_NOT_ADOPTED'});}
 // A release attestation reviews the exact derived manifest and current census,
 // including retained modes, explicit close_class registration and history.
 for(let d=1;d<=7;d++)need('delivery','D'+d);
 for(let n=1;n<=44;n++)need('scenario',String(n));
 for(const c of manifest?.migratedCapabilities||[]){need('migration',c.id);if(accepted.some(p=>p.category==='migration'&&p.subject===c.id&&p.consumerHash!==c.consumerHash))blockers.push({category:'migration',subject:c.id,reason:'CONSUMER_CENSUS_MISMATCH'});}
 for(const subject of ['author','coordinator','presenter','study_notes','independent_reviewer'])need('live_provider',subject);
 for(const subject of ['api_worker','database','frontend','stream_auth','active_session_rollback'])need('deployment',subject);
 for(const subject of ['screen_reader','software_keyboard','zoom_reflow','reduced_motion','academic_quality_comparison'])need('human_review',subject);
 need('governance','canonical_registration_and_all_modes');need('policy','calibration_and_owner_adoption');need('rollout',stage==='COHORT'?'authorized_test_instance':'cohort_observation');
 if(!['COHORT','GENERAL'].includes(stage))blockers.push({category:'rollout',subject:'stage',reason:'INVALID_STAGE'});
 return {version:VERSION,manifestHash,status:blockers.length?'HELD':'QUALIFIED',blockers,acceptedEvidence:accepted.map(p=>({category:p.category,subject:p.subject,executionId:p.executionId,evidenceRefs:p.evidenceRefs})),retirementAuthorized:stage==='GENERAL'&&blockers.length===0,policyFieldCount:Object.keys(DEFINITIONS).length};
}
module.exports={VERSION,CORE,verifyAttestation,evaluateRelease};
