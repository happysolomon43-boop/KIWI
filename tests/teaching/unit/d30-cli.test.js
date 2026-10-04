'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const cli=require('../../../scripts/run-teaching-d30-qualification');

test('D30 CLI parses bounded run options without enabling live execution implicitly',()=>{
  const args=cli.parseArgs(['execute','--max-runs','12','--environment=INTEGRATION','--confirm-live',cli.LIVE_CONFIRMATION]);
  assert.equal(args._[0],'execute');
  assert.equal(args.maxRuns,'12');
  assert.equal(args.environment,'INTEGRATION');
  assert.equal(args.confirmLive,cli.LIVE_CONFIRMATION);
  assert.equal(cli.integerOption(args.maxRuns,24,{min:1,max:100}),12);
});

test('provider commands require both the live environment flag and exact confirmation token',()=>{
  const previous=process.env.D30_LIVE_QUALIFICATION;
  try{
    delete process.env.D30_LIVE_QUALIFICATION;
    assert.throws(()=>cli.requireLiveConfirmation({confirmLive:cli.LIVE_CONFIRMATION},'INTEGRATION'),/disabled/i);
    process.env.D30_LIVE_QUALIFICATION='true';
    assert.throws(()=>cli.requireLiveConfirmation({confirmLive:'wrong'},'INTEGRATION'),/requires --confirm-live/i);
    assert.throws(()=>cli.requireLiveConfirmation({confirmLive:cli.LIVE_CONFIRMATION},'CI'),/not permitted/i);
    assert.doesNotThrow(()=>cli.requireLiveConfirmation({confirmLive:cli.LIVE_CONFIRMATION},'INTEGRATION'));
  }finally{
    if(previous==null)delete process.env.D30_LIVE_QUALIFICATION;
    else process.env.D30_LIVE_QUALIFICATION=previous;
  }
});

test('D30 qualification runtime freezes automatic discovery and promotion for reproducible route evidence',()=>{
  const env=cli.buildQualificationRuntimeEnv({AI_AUTO_DISCOVERY:'true',AI_AUTO_PROMOTE:'true',GEMINI_API_KEY:'masked-fixture'});
  assert.equal(env.AI_AUTO_DISCOVERY,'false');
  assert.equal(env.AI_AUTO_PROMOTE,'false');
  assert.equal(env.GEMINI_API_KEY,'masked-fixture');
  assert.equal(Object.isFrozen(env),true);
});

test('D30 CLI never treats D30 evidence as D31 production authorization',()=>{
  const summary=cli.summarizeFinalize({
    sessionStatus:'QUALIFIED',empiricalExecutionComplete:true,runScopedHumanReviewComplete:true,
    pendingHumanReviews:[],pplComparison:{decision:'PROGRESSIVE_QUALIFIED'},evidenceComplete:true,
    report:{specificationComplete:true,productionQualified:true},
  });
  assert.equal(summary.productionQualified,true);
  assert.equal(summary.productionAuthorized,false);
  assert.equal(summary.authorizationGate,'D31');
});
