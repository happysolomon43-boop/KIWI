'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {hash}=require('../../../teaching/classroom-remodel/academic-artifacts');
const {VERSION,verifyAttestation,evaluateRelease}=require('../../../teaching/classroom-remodel/release-qualification');
const {sessionSupport,runtimeIdentity}=require('../../../teaching/classroom-remodel/release-control');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const trustRoots={fixtureReviewer:{owner:'FIXTURE_ONLY',categories:['scenario'],publicKey:publicKey.export({type:'spki',format:'pem'})}};
const now=new Date('2026-10-11T00:00:00Z');
function signed(extra={}){const payload={version:VERSION,owner:'FIXTURE_ONLY',category:'scenario',subject:'44',manifestHash:'a'.repeat(64),result:'ACCEPTED',fixture:false,executionId:'fixture-verifier-test',evidenceRefs:['fixture-private-local-reference'],observation:{given:'Fixture verifier input',actionOrFailure:'Verify signature',expectedPublicBehavior:'No release',expectedPersistedFacts:'No mutation',forbiddenEffects:'No activation',testedVersions:'Fixture-only verifier test'},observedAt:'2026-10-10T23:00:00Z',expiresAt:'2026-10-12T00:00:00Z',...extra};return {keyId:'fixtureReviewer',payload,signature:crypto.sign(null,Buffer.from(hash(payload)),privateKey).toString('base64')};}
test('release verification rejects tampering, stale versions, fixture evidence, wrong owner and untrusted signatures',()=>{
 const options={trustRoots,manifestHash:'a'.repeat(64),now};assert.ok(verifyAttestation(signed(),options));
 for(const extra of [{fixture:true},{owner:'OTHER'},{category:'deployment'},{manifestHash:'b'.repeat(64)},{expiresAt:now.toISOString()},{observedAt:'2026-10-12T00:00:00Z'},{evidenceRefs:[]}])assert.equal(verifyAttestation(signed(extra),options),null);
 const edited=signed();edited.payload.subject='1';assert.equal(verifyAttestation(edited,options),null);assert.equal(verifyAttestation(signed(),{...options,trustRoots:{}}),null);
});
test('green deterministic evidence cannot qualify an unadopted release or retire any legacy binding',()=>{
 const {buildManifest}=require('../../../scripts/build-classroom-release-manifest');const manifest=buildManifest(),decision=evaluateRelease({manifest});assert.equal(manifest.migratedCapabilities.length,22);assert.equal(decision.status,'HELD');assert.equal(decision.retirementAuthorized,false);assert.equal(decision.blockers.filter(x=>x.category==='scenario').length,44);assert.equal(decision.blockers.filter(x=>x.category==='delivery').length,7);assert.equal(decision.blockers.filter(x=>x.category==='migration').length,22);
 const p=signed({manifestHash:hash(manifest)});const result=evaluateRelease({manifest,attestations:[p],trustRoots,now});assert.equal(result.blockers.filter(x=>x.category==='scenario').length,43);assert.equal(result.status,'HELD');
});
test('runtime compatibility ignores instance ids but retains prompt, schema and engine fingerprints',()=>{
 const a={engineVersion:'v1',promptBindings:[{artifact_version_id:'a',artifact_kind:'chapter',prompt_sha256:'x',schema_version:'v1'}]},b={...a,promptBindings:[{...a.promptBindings[0],artifact_version_id:'b'}]};assert.deepEqual(runtimeIdentity(a),runtimeIdentity(b));assert.notDeepEqual(runtimeIdentity(a),runtimeIdentity({...b,engineVersion:'v2'}));
 assert.equal(sessionSupport({supported_manifest_hashes:['pin']},{authority:{releaseManifestHash:'pin'}}),true);assert.equal(sessionSupport({supported_manifest_hashes:['pin']},{authority:{}}),false);assert.equal(sessionSupport({supported_manifest_hashes:[]},{authority:{releaseManifestHash:'pin'}}),false);
});
test('all 44 scenarios have executable support references without replacing qualification with file existence',()=>{
 const {run}=require('../../../scripts/run-classroom-release-qualification');const report=run();assert.equal(report.scenarioCount,44);assert.equal(report.scenarios.length,44);assert.equal(report.scenarios.every(s=>s.status==='NOT_QUALIFIED'),true);assert.equal(report.productionActivated,false);assert.equal(report.activeBindingsRetired,0);
});

test('cohort preflight and general expansion require distinct signed evidence; retirement waits for observed cohort',()=>{
 const {DEFINITIONS}=require('../../../teaching/classroom-remodel/state-policy');
 const policy=require('../fixtures/classroom-task-policy').taskPolicy();
 for(const [key,value] of Object.entries({historyRetention:{archiveDays:30,recentExactClassHorizon:3},summaryVersion:'fixture',cohort:'fixture',rollbackEngineVersion:'fixture'}))policy.fields[key]={value,owner:DEFINITIONS[key].owner,authoritySource:'FIXTURE ONLY',adoptedVersion:'fixture',effectiveRule:'future_sessions'};
 const manifest=require('../../../scripts/build-classroom-release-manifest').buildManifest({policy});
 const categories=['delivery','scenario','migration','live_provider','deployment','human_review','governance','policy','rollout'];
 const roots={fixtureReviewer:{...trustRoots.fixtureReviewer,categories}};
 const missing=evaluateRelease({manifest,policy,stage:'COHORT',now}).blockers;
 assert.equal(missing.some(b=>b.category==='policy'&&b.reason==='POLICY_NOT_ADOPTED'),false);
 const evidence=missing.map(b=>signed({category:b.category,subject:b.subject,manifestHash:hash(manifest),consumerHash:manifest.migratedCapabilities.find(c=>c.id===b.subject)?.consumerHash}));
 const cohort=evaluateRelease({manifest,policy,attestations:evidence,trustRoots:roots,stage:'COHORT',now});
 assert.equal(cohort.status,'QUALIFIED');assert.equal(cohort.retirementAuthorized,false);
 const held=evaluateRelease({manifest,policy,attestations:evidence,trustRoots:roots,now});assert.equal(held.status,'HELD');assert.deepEqual(held.blockers,[{category:'rollout',subject:'cohort_observation',reason:'ACCEPTED_BOUND_EVIDENCE_MISSING'}]);
 evidence.push(signed({category:'rollout',subject:'cohort_observation',manifestHash:hash(manifest)}));
 assert.equal(evaluateRelease({manifest,policy,attestations:evidence,trustRoots:roots,now}).retirementAuthorized,true);
 evidence[0].payload.manifestHash='obsolete';assert.equal(evaluateRelease({manifest,policy,attestations:evidence,trustRoots:roots,now}).status,'HELD');
});
