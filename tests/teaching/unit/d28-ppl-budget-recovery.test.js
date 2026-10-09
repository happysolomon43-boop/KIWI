'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createD28PolicyConfig}=require('../../../teaching/d28/contracts');
const {createD28RuntimeService}=require('../../../teaching/d28/runtime-service');

const baseline=createD28PolicyConfig({});
test('PPL defaults cover three validated AI planning stages with bounded repairs',()=>{
  const p=baseline.ppl;
  assert.ok(p.maxTotalTokens>=180000 && p.maxTotalTokens<=300000);
  assert.ok(p.maxModelCalls>=10 && p.maxModelCalls<=16);
  assert.ok(p.maxScheduledReviews>=5 && p.maxScheduledReviews<=8);
  assert.equal(p.maxConcurrentExecutions,2);
  assert.equal(p.maxEstimatedCostMicrounits,5000000);
  const restricted=createD28PolicyConfig({
    TEACHING_D28_PPL_MAX_TOKENS:'100000',
    TEACHING_D28_PPL_MAX_MODEL_CALLS:'5',
    TEACHING_D28_PPL_MAX_SCHEDULED_REVIEWS:'3'
  }).ppl;
  assert.equal(restricted.maxTotalTokens,100000);
  assert.equal(restricted.maxModelCalls,5);
  assert.equal(restricted.maxScheduledReviews,3);
});

function fakeStore(seed=[]){
  const rows=seed.map(item=>({...item}));
  const reads=[];
  return {
    rows,reads,
    async query(sql,params=[]){
      if(sql.includes('from teaching_runtime.d28_ppl_budget_usage')&&sql.includes('count(*) filter')){
        reads.push(sql);
        const forWorkspace=rows.filter(x=>x.workspace_id===params[0]);
        const allowed=new Set(['OWNER_AUTHORIZED_BOUNDED_WORK','BOUNDED_WORK_ALLOWED','DEFECT_DRIVEN_ESCALATION_ALLOWED']);
        return {rows:[{
          scheduled_reviews:forWorkspace.filter(x=>allowed.has(x.disposition)&&x.provenance?.scheduledReview===true).length,
          candidates:forWorkspace.filter(x=>allowed.has(x.disposition)&&x.provenance?.candidateAttempt===true).length,
          model_calls:forWorkspace.reduce((n,x)=>n+x.model_calls,0),
          total_tokens:forWorkspace.reduce((n,x)=>n+x.total_tokens,0),
          estimated_cost:forWorkspace.reduce((n,x)=>n+(x.estimated_cost_microunits||0),0),
          material_noops:forWorkspace.filter(x=>x.material_noop).length
        }]};
      }
      if(sql.includes('insert into teaching_runtime.d28_ppl_budget_usage')){
        rows.push({workspace_id:params[1],disposition:params[5],
          model_calls:params[7],total_tokens:params[8],estimated_cost_microunits:params[9],
          material_noop:params[6],provenance:JSON.parse(params[11])});
        return {rows:[]};
      }
      throw Error('Unexpected SQL for PPL test');
    }
  };
}
function runtime(store,env={}){
  let i=0;
  return createD28RuntimeService({
    query:store.query.bind(store),
    randomUUID:()=> 'ppl-budget-test-'+(++i),
    env:{TEACHING_D31_AI_RELEASE_MODE:'OWNER_OVERRIDE_V1',...env}
  });
}
function invocation(stage,version=1){
  return {
    preparation:{
      workspace_ref:'existing-phy101-workspace',workspace_version:version,
      material_delta:{material:true},repair_attempt:0,
      route_posture:stage==='PRE_LOCK_READY'?'final_reconciliation':stage==='CANDIDATE'?'strong_design':'bounded_interpretive',
      maturity_target:stage==='PRE_LOCK_READY'?'Pre-Lock Ready':stage==='CANDIDATE'?'Candidate':'Skeleton',
      authoritative_input_bundle:{course_plan_version:'v2'},
      correlation_id:'safe-review-'+stage
    },
    route_control:{qualificationStatus:'UNQUALIFIED',productionAuthorized:false}
  };
}

test('After real spent tokens, bounded PPL may finish remaining stages without resetting the history',async()=>{
  const store=fakeStore([
    {workspace_id:'existing-phy101-workspace',disposition:'OWNER_AUTHORIZED_BOUNDED_WORK',model_calls:1,total_tokens:0,provenance:{scheduledReview:true,candidateAttempt:false}},
    {workspace_id:'existing-phy101-workspace',disposition:'EXECUTION_COMPLETED',model_calls:1,total_tokens:27844,provenance:{}},
    {workspace_id:'existing-phy101-workspace',disposition:'OWNER_AUTHORIZED_BOUNDED_WORK',model_calls:1,total_tokens:0,provenance:{scheduledReview:false,candidateAttempt:false}},
    {workspace_id:'existing-phy101-workspace',disposition:'EXECUTION_COMPLETED',model_calls:0,total_tokens:27353,provenance:{}},
    {workspace_id:'existing-phy101-workspace',disposition:'OWNER_AUTHORIZED_BOUNDED_WORK',model_calls:1,total_tokens:0,provenance:{scheduledReview:true,candidateAttempt:false}},
    {workspace_id:'existing-phy101-workspace',disposition:'EXECUTION_COMPLETED',model_calls:0,total_tokens:29708,provenance:{}},
    // Last rejected stage was audited but must never spend model/review/candidate budget.
    {workspace_id:'existing-phy101-workspace',disposition:'FAIL_SAFE_BUDGET_EXHAUSTED',model_calls:0,total_tokens:0,provenance:{scheduledReview:true,candidateAttempt:true}}
  ]);
  const r=runtime(store);
  const candidate=await r.governPplInvocation({invocation:invocation('CANDIDATE',3)});
  assert.equal(candidate.decision.modelCallAllowed,true);
  await r.completePplInvocation(candidate,{modelMetadata:{totalTokens:30500},validationOutcome:'ACCEPTED'});
  const final=await r.governPplInvocation({invocation:invocation('PRE_LOCK_READY',4)});
  assert.equal(final.decision.modelCallAllowed,true);
  await r.completePplInvocation(final,{modelMetadata:{totalTokens:31500},validationOutcome:'ACCEPTED'});
  const spent=store.rows.reduce((n,x)=>n+x.total_tokens,0);
  assert.equal(spent,146905);
  assert.ok(spent<baseline.ppl.maxTotalTokens);
  assert.equal(store.rows.filter(x=>x.disposition==='FAIL_SAFE_BUDGET_EXHAUSTED').length,1);
  assert.ok(store.reads.every(sql=>sql.includes('disposition in (')));
});

test('A real exhausted workspace stays fail-closed; denied checks never poison subsequent authorized review counts',async()=>{
  const store=fakeStore([
    {workspace_id:'existing-phy101-workspace',disposition:'OWNER_AUTHORIZED_BOUNDED_WORK',model_calls:1,total_tokens:0,provenance:{scheduledReview:true}},
    {workspace_id:'existing-phy101-workspace',disposition:'EXECUTION_COMPLETED',model_calls:0,total_tokens:239999,provenance:{}}
  ]);
  const r=runtime(store);
  for(let i=0;i<3;i++){
    await assert.rejects(r.governPplInvocation({invocation:invocation('CANDIDATE')}),e=>
      e.code==='TEACHING_D28_PPL_BUDGET_EXHAUSTED'
      && e.budgetReason==='BUDGET_EXCEEDED:totalTokens');
  }
  assert.equal(store.rows.filter(x=>x.disposition==='FAIL_SAFE_BUDGET_EXHAUSTED').length,3);
  assert.ok(store.rows.every(x=>x.total_tokens>=0));
  assert.equal(store.rows.reduce((n,x)=>n+x.total_tokens,0),239999);
  // A separately authorized policy adjustment can resume with the same
  // persisted counters. Do not delete usage rows or bypass the model limits.
  const recovered=runtime(store,{TEACHING_D28_PPL_MAX_TOKENS:'300000'});
  const lease=await recovered.governPplInvocation({invocation:invocation('CANDIDATE')});
  assert.equal(lease.decision.modelCallAllowed,true);
  recovered.releasePplInvocation(lease);
});

test('Denied PPL admission never starts central model inference or erases usage',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d28/runtime-service.js'),'utf8');
  assert.match(source,/where disposition in \('OWNER_AUTHORIZED_BOUNDED_WORK'/);
  assert.match(source,/if\(!decision\.modelCallAllowed\)/);
  assert.match(source,/totalTokens:Math\.max\(12000,Math\.min\(60000,Math\.ceil\(state\.totalTokens\/Math\.max\(1,state\.modelCalls\)\)\)\)/);
  assert.match(source,/modelCalls:decision\.modelCallAllowed\?1:0/);
  const adapter=fs.readFileSync(path.resolve(__dirname,'../../../teaching/orchestrator/ai-adapter.js'),'utf8');
  assert.ok(adapter.indexOf('await d28.governPplInvocation')<adapter.indexOf('await aiBoundary.execute'));
});
