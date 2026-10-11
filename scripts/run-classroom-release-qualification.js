'use strict';
// Executes the final deterministic suite and builds an honest release decision.
// No provider call, migration, deployment, or retirement is performed here.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {buildManifest}=require('./build-classroom-release-manifest');
const {evaluateRelease}=require('../teaching/classroom-remodel/release-qualification');
const root=path.resolve(__dirname,'..');
function run({execute=false,policy=null,attestations=[],trustRoots={},stage='GENERAL'}={}){
 const ledger=require('../docs/teaching/classroom-remodel/qualification-ledger.v1.json');
 const catalog=require('../docs/teaching/classroom-remodel/delivery-8-scenarios.v1.json');
 if(catalog.scenarios.length!==44||new Set(catalog.scenarios.map(s=>s.number)).size!==44||catalog.scenarios.some(s=>s.number<1||s.number>44||!s.testFiles.length||s.testFiles.some(f=>!fs.existsSync(path.join(root,f)))))throw Error('Complete 44-scenario traceability required');
 const checks=[];
 if(execute){
  const commands=[['foundation',process.execPath,['scripts/verify-classroom-remodel-foundation.js']],['release_proposal',process.execPath,['scripts/build-classroom-release-proposal.js','--check']],['unit_ai','npm',['test']],['web','npm',['run','build:web']]];
  if(process.env.TEACHING_TEST_DATABASE_URL)commands.push(['native_database','npm',['run','test:teaching:integration']]);
  for(const [kind,bin,args] of commands){const r=cp.spawnSync(bin,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});checks.push({kind,passed:r.status===0,exitCode:r.status,summary:(r.stdout||r.stderr||'').slice(-1800)});}
 }
 const manifest=buildManifest({policy}),decision=evaluateRelease({manifest,policy,attestations,trustRoots,stage});
 return {version:'classroom-delivery-8-report.v1',manifest,decision,checks,scenarioCount:44,scenarios:catalog.scenarios.map(s=>({...s,status:decision.acceptedEvidence.some(e=>e.category==='scenario'&&e.subject===String(s.number))?'ACCEPTED':'NOT_QUALIFIED',priorFixtureEvidenceCount:ledger.scenarios.find(e=>e.number===s.number)?.fixtureEvidence?.length||0})),productionActivated:false,activeBindingsRetired:0};
}
module.exports={run};
if(require.main===module){
 const args=process.argv.slice(2),outIndex=args.indexOf('--out');
 const input=flag=>{const i=args.indexOf(flag);return i<0?undefined:JSON.parse(fs.readFileSync(path.resolve(args[i+1]),'utf8'));};
 const report=run({execute:args.includes('--execute'),policy:input('--policy'),attestations:input('--attestations'),trustRoots:input('--trust-roots'),stage:args.includes('--cohort')?'COHORT':'GENERAL'});
 if(outIndex>=0)fs.writeFileSync(path.resolve(args[outIndex+1]),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({sourceRevision:report.manifest.sourceRevision,scenarioCount:44,status:report.decision.status,blockers:report.decision.blockers.length,checks:report.checks.map(({kind,passed})=>({kind,passed})),productionActivated:false,retired:0},null,2));
 if(report.checks.some(c=>!c.passed)||args.includes('--require-release')&&report.decision.status!=='QUALIFIED')process.exitCode=1;
}
