'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {hash}=require('../teaching/classroom-remodel/academic-artifacts');
const {integrity}=require('../teaching/capability-registry');
const {readCandidates}=require('../teaching/classroom-remodel/candidate-governance');
const {buildInventory}=require('./build-classroom-remodel-inventory');
const {buildReleaseProposal}=require('./build-classroom-release-proposal');
const root=path.resolve(__dirname,'..');
function buildManifest({policy=null,sourceRevision=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}={}){
 const inventory=buildInventory(),prompts=readCandidates(),proposal=buildReleaseProposal();
 const files=cp.execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 const pins=paths=>paths.sort().map(file=>({file,sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
 const families=Object.fromEntries(prompts.families.map(f=>[f.familyId,f]));
 const promptBindings=['chapter','guide','opening','plan'].map(kind=>{const id=kind==='guide'?'TPF-21':kind==='opening'?'TPF-08':'TPF-05',f=families[id];return {artifact_kind:kind,prompt_sha256:f.sha256,schema_version:'classroom-contracts.v1',prompt_family_ref:id+'@'+f.version};});
 const runtime={boardProjection:require('../teaching/d14/board').PUBLIC_BLOCK_VERSION,engine:'CLASSROOM_V1',engineVersion:require('../teaching/classroom-remodel/release-control').ENGINE_VERSION,contracts:'classroom-contracts.v1',domain:'classroom-domain.v1',wire:'classroom-presentation-wire.v1',registrySha256:integrity.compiledSha256,canonicalRegistration:require('../teaching/classroom-remodel/canonical-registration.v1.json').version,promptBindings};
 return {version:'classroom-release-manifest.v1',sourceRevision,activation:'INACTIVE',runtime,runtimeHash:hash(runtime),policyHash:hash(policy),inventoryHash:hash(inventory),promptManifestHash:proposal.sha256,registry:integrity,
  migratedCapabilities:inventory.entries.filter(e=>e.targetModes).map(e=>({id:e.capability.id,aliases:e.capability.legacy_aliases,ceiling:e.capability.authority_ceiling,owner:e.capability.authoritative_owner_boundary,modes:e.targetModes,consumerHash:hash(e.references),historicalFamily:e.capability.prompt_family_id})),
  schemas:pins(files.filter(f=>f.startsWith('teaching/classroom-remodel/')&&f.endsWith('.js'))),
  migrations:pins(files.filter(f=>f.startsWith('migrations/')&&/classroom_/.test(f))),
  assets:pins(files.filter(f=>f.startsWith('public/classroom/')||['public/teaching-classroom.js','public/teaching-classroom.css','public/kiwi-api-client.js'].includes(f))),
  compatibility:{legacyBodiesRetained:true,legacySessionReadersRetained:true,newSessionEngine:'CLASSROOM_V1',oldEngine:'LEGACY',rollbackEngine:runtime.engineVersion,retirementAuthorized:false}};
}
module.exports={buildManifest};
if(require.main===module)process.stdout.write(JSON.stringify(buildManifest(),null,2)+'\n');
