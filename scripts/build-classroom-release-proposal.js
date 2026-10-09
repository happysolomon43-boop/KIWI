'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {listCapabilities,integrity}=require('../teaching/capability-registry');
const {listPromptFamilies,promptCatalogStatus}=require('../teaching/prompt-runtime/prompt-catalog');
const {readCandidates,validateMigrationProposal}=require('../teaching/classroom-remodel/candidate-governance');
const migration=require('../teaching/classroom-remodel/migration-proposal.v1.json');
function buildReleaseProposal(){
 validateMigrationProposal(migration);const candidates=readCandidates();
 const families=new Map(listPromptFamilies().map(f=>[f.id,{id:f.id,version:f.version,promptSha256:f.promptSha256,role:'RETAINED_ACTIVE_OR_HISTORICAL'}]));
 for(const f of candidates.families)families.set(f.familyId,{id:f.familyId,version:f.version,promptSha256:f.sha256,role:'INACTIVE_CANDIDATE'});
 const capabilities=listCapabilities().map(c=>{const replacement=migration.bindings.find(b=>b.capabilityId===c.id);return {id:c.id,aliases:c.legacy_aliases,authorityCeiling:c.authority_ceiling,owner:c.authoritative_owner_boundary,activeFamily:c.prompt_family_id,candidateFamily:replacement?migration.familyId:c.prompt_family_id,candidateModes:replacement?.modes||[],retirementAuthorized:false};});
 const payload={version:'classroom-release-proposal.v1',activation:'INACTIVE',qualification:'NOT_QUALIFIED',baseRegistryVersion:integrity.registryVersion,basePromptManifestVersion:promptCatalogStatus().manifestVersion,canonicalCoordinator:{id:migration.familyId,alias:migration.designAlias,governanceState:migration.state,registration:'CANDIDATE_ONLY'},families:[...families.values()].sort((a,b)=>a.id.localeCompare(b.id)),capabilities,counts:{families:families.size,capabilities:capabilities.length,modelEligible:listCapabilities().filter(c=>c.prompt_family_id!==null).length,replacementBindings:migration.bindings.length,retiredActiveBindings:0}};
 if(new Set(capabilities.map(c=>c.id)).size!==capabilities.length)throw Error('Duplicate capability');
 for(const c of capabilities)if(c.candidateFamily&&!families.has(c.candidateFamily))throw Error('Unregistered destination');
 return {payload,sha256:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
if(require.main===module){const value=JSON.stringify(buildReleaseProposal(),null,2)+'\n';const file=path.join(__dirname,'../teaching/classroom-remodel/release-proposal.v1.json');if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==value)throw Error('Release proposal drift');}else fs.writeFileSync(file,value);console.log('Inactive successor census and hash derived from verified registry/catalog candidates.');}
module.exports={buildReleaseProposal};
