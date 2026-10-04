'use strict';

const { integer, finite, text, freeze } = require('./contracts');

const DEFAULT_PPL_BUDGET = Object.freeze({maxModelStages:8,maxTotalTokens:120000,maxTotalCostUsd:5,maxWallClockMs:20*60*1000});

function normalizeBudget(input={}){ return freeze({
  maxModelStages:integer(input.maxModelStages ?? DEFAULT_PPL_BUDGET.maxModelStages,'maxModelStages',{min:1,max:50}),
  maxTotalTokens:integer(input.maxTotalTokens ?? DEFAULT_PPL_BUDGET.maxTotalTokens,'maxTotalTokens',{min:1000,max:5_000_000}),
  maxTotalCostUsd:finite(input.maxTotalCostUsd ?? DEFAULT_PPL_BUDGET.maxTotalCostUsd,'maxTotalCostUsd',{min:0,max:1000}),
  maxWallClockMs:integer(input.maxWallClockMs ?? DEFAULT_PPL_BUDGET.maxWallClockMs,'maxWallClockMs',{min:1000,max:24*60*60*1000}),
}); }
function normalizeUsage(input={}){ return freeze({modelStages:integer(input.modelStages ?? 0,'modelStages',{min:0,max:1000}),totalTokens:integer(input.totalTokens ?? 0,'totalTokens',{min:0,max:50_000_000}),totalCostUsd:finite(input.totalCostUsd ?? 0,'totalCostUsd',{min:0,max:100000}),wallClockMs:integer(input.wallClockMs ?? 0,'wallClockMs',{min:0,max:7*24*60*60*1000})}); }
function evaluatePplBudget({budget={},usage={},nextStage=null}={}){
  const b=normalizeBudget(budget),u=normalizeUsage(usage); const next=nextStage?freeze({tokens:integer(nextStage.tokens??0,'nextStage.tokens',{min:0,max:5_000_000}),costUsd:finite(nextStage.costUsd??0,'nextStage.costUsd',{min:0,max:1000}),wallClockMs:integer(nextStage.wallClockMs??0,'nextStage.wallClockMs',{min:0,max:24*60*60*1000}),modelStage:nextStage.modelStage!==false}):freeze({tokens:0,costUsd:0,wallClockMs:0,modelStage:false});
  const projected=freeze({modelStages:u.modelStages+(next.modelStage?1:0),totalTokens:u.totalTokens+next.tokens,totalCostUsd:Number((u.totalCostUsd+next.costUsd).toFixed(6)),wallClockMs:u.wallClockMs+next.wallClockMs});
  const breaches=[]; if(projected.modelStages>b.maxModelStages)breaches.push('MODEL_STAGE_LIMIT'); if(projected.totalTokens>b.maxTotalTokens)breaches.push('TOKEN_LIMIT'); if(projected.totalCostUsd>b.maxTotalCostUsd)breaches.push('COST_LIMIT'); if(projected.wallClockMs>b.maxWallClockMs)breaches.push('WALL_CLOCK_LIMIT');
  return freeze({allowed:breaches.length===0,budget:b,currentUsage:u,projectedUsage:projected,breaches:Object.freeze(breaches),academicQualificationGranted:false,ownerMutationAllowed:false});
}
function pplExecutionProvenance(input={}){ return freeze({workspaceId:text(input.workspaceId,'workspaceId',200),stage:text(input.stage,'stage',100),capabilityId:text(input.capabilityId,'capabilityId',200),routePosture:text(input.routePosture,'routePosture',100,false),promptFamily:text(input.promptFamily,'promptFamily',100,false),promptVersion:text(input.promptVersion,'promptVersion',100,false),model:text(input.model,'model',200,false),provider:text(input.provider,'provider',100,false),correlationId:text(input.correlationId,'correlationId',200),artifactVersionRef:text(input.artifactVersionRef,'artifactVersionRef',200,false),inputBundleRef:text(input.inputBundleRef,'inputBundleRef',200,false),tokens:integer(input.tokens??0,'tokens',{min:0,max:5_000_000}),costUsd:finite(input.costUsd??0,'costUsd',{min:0,max:1000}),latencyMs:integer(input.latencyMs??0,'latencyMs',{min:0,max:24*60*60*1000}),maturityClaimAllowed:false}); }
module.exports={DEFAULT_PPL_BUDGET,normalizeBudget,normalizeUsage,evaluatePplBudget,pplExecutionProvenance};
