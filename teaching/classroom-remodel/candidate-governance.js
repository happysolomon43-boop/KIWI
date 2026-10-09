'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {listCapabilities,getCapability,assertCapabilityBinding}=require('../capability-registry');
const {validateBehaviorBrief,assertAuthoringTransition}=require('../d30/governance');
const {COORDINATOR_MODES}=require('./contracts');
const directory=path.join(__dirname,'prompts');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function readCandidates(){const manifest=JSON.parse(fs.readFileSync(path.join(directory,'candidate-manifest.v1.json'),'utf8'));if(manifest.activation!=='INACTIVE'||manifest.canonicalRegistration!=='PROPOSED_NOT_FROZEN')throw Error('Candidate activation requires governed successor manifest');const ids=new Set();for(const f of manifest.families){if(ids.has(f.familyId)||!/^TPF-\d{2}$/.test(f.familyId)||path.basename(f.file)!==f.file||f.runtimeEffective!==false)throw Error('Invalid candidate identity');ids.add(f.familyId);if(hash(fs.readFileSync(path.join(directory,f.file)))!==f.sha256)throw Error('Candidate prompt hash drift');}return manifest;}
function candidateBody(familyId){const manifest=readCandidates();const f=manifest.families.find(f=>f.familyId===familyId);if(!f)throw Error('Unknown candidate');return {metadata:f,text:fs.readFileSync(path.join(directory,f.file),'utf8'),runtimeAuthorized:false};}
function validateMigrationProposal(proposal){
 const brief=validateBehaviorBrief(proposal.behaviorBrief);if(!brief.valid)throw Error(brief.errors.join(','));
 assertAuthoringTransition('BEHAVIOR_BRIEF_APPROVED','PROMPT_CANDIDATE_DRAFT',{behaviorBrief:proposal.behaviorBrief});
 const manifest=readCandidates();const family=proposal.familyId;
 if(family!==manifest.canonicalCoordinatorFamilyProposal||listCapabilities().some(c=>c.prompt_family_id===family))throw Error('Coordinator family collision or candidate identity mismatch');
 const legacy=listCapabilities().filter(c=>['TPF-04','TPF-06','TPF-07'].includes(c.prompt_family_id));
 if(!Array.isArray(proposal.bindings)||proposal.bindings.length!==legacy.length)throw Error('Incomplete capability migration');
 const seen=new Set();for(const b of proposal.bindings){if(seen.has(b.capabilityId))throw Error('Duplicate capability binding');seen.add(b.capabilityId);const c=getCapability(b.capabilityId);if(!legacy.includes(c)||!Array.isArray(b.modes)||!b.modes.length||b.modes.some(m=>!COORDINATOR_MODES.includes(m)))throw Error('Unknown capability or coordinator mode');assertCapabilityBinding(c.id,{authorityLevel:b.authorityCeiling,authoritativeOwnerBoundary:b.owner});if(b.authorityCeiling!==c.authority_ceiling||b.owner!==c.authoritative_owner_boundary)throw Error('Migration changes capability authority');if(b.active!==false)throw Error('Replacement cannot activate before qualification');}
 return {state:'PROMPT_CANDIDATE_DRAFT',canonicalProposal:family,designAlias:'TPF-5/8',activation:'INACTIVE',legacyBindingsRetained:true,migrationCount:seen.size,requiredNextGate:'MODE_SCHEMA_AND_ALL_CALLER_QUALIFICATION'};
}
module.exports={readCandidates,candidateBody,validateMigrationProposal};
