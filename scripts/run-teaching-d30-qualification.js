'use strict';

require('dotenv').config();

const fs=require('node:fs');
const { execFileSync }=require('node:child_process');
const { randomUUID }=require('node:crypto');
const { Pool }=require('pg');
const { createAIRuntime }=require('../services/ai/runtime');
const { requireRuntimeSecret }=require('../services/runtime-secrets');
const {
  createD30Repository,
  createAutomatedSemanticReviewer,
  createD30QualificationCoordinator,
  createD30BoundedCommand,
}=require('../teaching/d30');

const LIVE_CONFIRMATION='D30_EMPIRICAL_QUALIFICATION';
const PROVIDER_COMMANDS=new Set(['execute','ppl']);
const ALLOWED_ENVIRONMENTS=new Set(['LOCAL','CI','INTEGRATION','STAGING','PRODUCTION_SHADOW']);
const LIVE_ENVIRONMENTS=new Set(['INTEGRATION','STAGING','PRODUCTION_SHADOW']);

function parseArgs(argv){
  const args={_:[]};
  for(let index=0;index<argv.length;index+=1){
    const token=argv[index];
    if(!token.startsWith('--')){args._.push(token);continue;}
    const [rawKey,inline]=token.slice(2).split('=',2);
    const key=rawKey.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    if(inline!==undefined){args[key]=inline;continue;}
    const next=argv[index+1];
    if(next!=null&&!next.startsWith('--')){args[key]=next;index+=1;}
    else args[key]=true;
  }
  return args;
}

function integerOption(value,fallback,{min=1,max=100}={}){
  if(value==null||value==='')return fallback;
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`Expected integer from ${min} to ${max}; received ${value}.`);
  return parsed;
}

function resolveSourceSha(value){
  const explicit=String(value||process.env.GITHUB_SHA||process.env.RENDER_GIT_COMMIT||'').trim();
  if(/^[0-9a-f]{40}$/i.test(explicit))return explicit.toLowerCase();
  try{
    const local=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    if(/^[0-9a-f]{40}$/i.test(local))return local.toLowerCase();
  }catch(_){/* explicit SHA error below */}
  throw new Error('D30 qualification requires --source-sha with the exact 40-character Git commit SHA.');
}

function resolveEnvironment(value){
  const environment=String(value||process.env.D30_QUALIFICATION_ENVIRONMENT||'INTEGRATION').trim().toUpperCase();
  if(!ALLOWED_ENVIRONMENTS.has(environment))throw new Error(`Unsupported D30 qualification environment: ${environment}.`);
  return environment;
}

function requireLiveConfirmation(args,environment){
  const enabled=String(process.env.D30_LIVE_QUALIFICATION||'').toLowerCase()==='true';
  if(!enabled)throw new Error('Live D30 provider execution is disabled. Set D30_LIVE_QUALIFICATION=true only for an approved empirical run.');
  if(String(args.confirmLive||'')!==LIVE_CONFIRMATION)throw new Error(`Live D30 provider execution requires --confirm-live ${LIVE_CONFIRMATION}.`);
  if(!LIVE_ENVIRONMENTS.has(environment))throw new Error(`Live D30 provider execution is not permitted in ${environment}.`);
}

function readReviewFile(path){
  if(!String(path||'').trim())throw new Error('record-review requires --review-file <path>.');
  const parsed=JSON.parse(fs.readFileSync(path,'utf8'));
  const submissions=Array.isArray(parsed)?parsed:[parsed];
  if(!submissions.length||submissions.some((item)=>!item||typeof item!=='object'||Array.isArray(item)))throw new Error('Review file must contain one review object or a non-empty array of review objects.');
  return submissions;
}

function writeResult(value,args){
  const body=`${JSON.stringify(value,null,2)}\n`;
  if(args.out){fs.writeFileSync(String(args.out),body,{encoding:'utf8',mode:0o600});return;}
  process.stdout.write(body);
}

function summarizeExecution(result){
  return Object.freeze({
    sessionId:result.sessionId,
    resumed:result.resumed,
    executedCount:result.executedCount,
    expectedWorkItems:result.expectedWorkItems,
    pendingBeforeBatch:result.pendingBeforeBatch,
    pendingAfterBatch:result.pendingAfterBatch,
    empiricalExecutionComplete:result.empiricalExecutionComplete,
    pplExecutionComplete:result.pplExecutionComplete,
    pplDecision:result.comparison?.decision||null,
    counts:result.counts||null,
    productionAuthorized:false,
    authorizationGate:'D31',
  });
}

function summarizeFinalize(result){
  return Object.freeze({
    sessionStatus:result.sessionStatus,
    empiricalExecutionComplete:result.empiricalExecutionComplete,
    runScopedHumanReviewComplete:result.runScopedHumanReviewComplete,
    pendingHumanReviewCount:result.pendingHumanReviews?.length||0,
    pplDecision:result.pplComparison?.decision||null,
    evidenceComplete:result.evidenceComplete,
    specificationComplete:result.report?.specificationComplete===true,
    productionQualified:result.report?.productionQualified===true,
    productionAuthorized:false,
    authorizationGate:'D31',
  });
}

async function main(argv=process.argv.slice(2)){
  const args=parseArgs(argv);
  const command=String(args._[0]||'').trim();
  if(!['execute','ppl','status','review-queue','record-review','finalize'].includes(command)){
    throw new Error('Usage: node scripts/run-teaching-d30-qualification.js <execute|ppl|status|review-queue|record-review|finalize> [options]');
  }
  const environment=resolveEnvironment(args.environment);
  if(PROVIDER_COMMANDS.has(command))requireLiveConfirmation(args,environment);
  const databaseUrl=requireRuntimeSecret(process.env,'DATABASE_URL',['KIWI_DATABASE_URL']);
  const pool=new Pool({
    connectionString:databaseUrl,
    ssl:{rejectUnauthorized:false},
    max:4,
    min:0,
    idleTimeoutMillis:10000,
    connectionTimeoutMillis:5000,
    statement_timeout:30000,
    application_name:'kiwi-d30-qualification-cli',
  });
  const query=(text,params)=>pool.query(text,params);
  const runtime=createAIRuntime({query,randomUUID,env:process.env,fetchImpl:globalThis.fetch,logger:console});
  try{
    await runtime.initialize();
    const repository=createD30Repository({query,randomUUID});
    await repository.assertReady();
    const semanticReviewer=createAutomatedSemanticReviewer({
      baseOrchestrator:runtime.orchestrator,
      reviewerRouteKey:String(args.reviewerRoute||process.env.D30_SEMANTIC_REVIEWER_ROUTE||'').trim()||null,
    });
    const coordinator=createD30QualificationCoordinator({
      baseOrchestrator:runtime.orchestrator,
      repository,
      semanticReviewer,
      logger:console,
    });
    const bounded=createD30BoundedCommand({coordinator,repository});
    const sessionId=String(args.sessionId||'').trim();

    if(command==='execute'){
      const sourceSha=resolveSourceSha(args.sourceSha);
      const maxRuns=integerOption(args.maxRuns,24,{min:1,max:100});
      const result=await coordinator.executeBatch({
        sourceSha,environment,maxRuns,
        metadata:{command:'execute',boundedCliVersion:'d30-bounded-cli-v1'},
      });
      writeResult(summarizeExecution(result),args);
      return;
    }
    if(command==='ppl'){
      const sourceSha=resolveSourceSha(args.sourceSha);
      const maxRuns=integerOption(args.maxRuns,24,{min:1,max:72});
      const result=await coordinator.executePplBatch({
        sourceSha,environment,maxRuns,
        metadata:{command:'ppl',boundedCliVersion:'d30-bounded-cli-v1'},
      });
      writeResult(summarizeExecution(result),args);
      return;
    }
    if(!sessionId)throw new Error(`${command} requires --session-id <uuid>.`);

    if(command==='status'){
      const [empirical,ppl,reviews]=await Promise.all([
        coordinator.status({sessionId}),
        coordinator.pplStatus({sessionId}),
        bounded.reviewState({sessionId}),
      ]);
      writeResult({
        sessionId,
        empirical:{expectedWorkItems:empirical.expectedWorkItems,completedWorkItems:empirical.completedWorkItems,pendingWorkItems:empirical.pendingWorkItems,complete:empirical.empiricalExecutionComplete,counts:empirical.counts},
        ppl:{expectedWorkItems:ppl.expectedWorkItems,completedWorkItems:ppl.completedWorkItems,pendingWorkItems:ppl.pendingWorkItems,complete:ppl.pplExecutionComplete,comparisonPersisted:ppl.comparisonPersisted,decision:ppl.comparison?.decision||null},
        humanReview:{requiredCount:reviews.requiredCount,passedRunCount:reviews.passedRunCount,pendingCount:reviews.pendingCount},
        productionAuthorized:false,
        authorizationGate:'D31',
      },args);
      return;
    }
    if(command==='review-queue'){
      const state=await bounded.reviewState({sessionId});
      writeResult({
        sessionId,
        requiredCount:state.requiredCount,
        passedRunCount:state.passedRunCount,
        pendingCount:state.pendingCount,
        pendingQueue:state.pendingQueue,
        productionAuthorized:false,
        authorizationGate:'D31',
      },args);
      return;
    }
    if(command==='record-review'){
      const submissions=readReviewFile(args.reviewFile);
      const recorded=[];
      for(const submission of submissions){
        recorded.push(await bounded.recordHumanReview({sessionId,submission}));
      }
      writeResult({sessionId,recordedCount:recorded.length,reviewIds:recorded.map((item)=>item.id),productionAuthorized:false,authorizationGate:'D31'},args);
      return;
    }
    if(command==='finalize'){
      const result=await bounded.finalize({sessionId,closeBlocked:Boolean(args.closeBlocked)});
      writeResult(summarizeFinalize(result),args);
    }
  }finally{
    runtime.stopDiscoveryScheduler?.();
    runtime.stopRetentionScheduler?.();
    runtime.stopHealthSyncScheduler?.();
    runtime.stopInitializationRecovery?.();
    await pool.end().catch(()=>{});
  }
}

if(require.main===module){
  main().catch((error)=>{
    process.stderr.write(`[D30 CLI] ${error?.code?`${error.code}: `:''}${error?.message||String(error)}\n`);
    process.exitCode=1;
  });
}

module.exports={
  LIVE_CONFIRMATION,
  PROVIDER_COMMANDS,
  ALLOWED_ENVIRONMENTS,
  LIVE_ENVIRONMENTS,
  parseArgs,
  integerOption,
  resolveSourceSha,
  resolveEnvironment,
  requireLiveConfirmation,
  readReviewFile,
  summarizeExecution,
  summarizeFinalize,
  main,
};
