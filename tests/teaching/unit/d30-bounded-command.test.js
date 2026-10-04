'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const d30=require('../../../teaching/d30');

function queueItem(runId,attemptNo=1){
  return Object.freeze({
    sessionId:'00000000-0000-4000-8000-000000000001',
    runId,
    attemptNo,
    caseId:'D30-REPEATED-C4-001',
    familyId:'TPF-14',
    capabilityId:'teaching.assessment.assessment_item_independent_validation',
    routeKey:'google::strong',
  });
}
function review(item,decision='PASS',reviewerRef='reviewer-1'){
  return {
    ...item,
    reviewerRef,
    reviewerKind:'HUMAN_ACADEMIC',
    independent:true,
    decision,
    rubric:{academicCorrectness:decision},
  };
}
function pass(item,reviewerRef='reviewer-1'){return review(item,'PASS',reviewerRef);}

test('a PASS on attempt 1 cannot satisfy another queued replay of the same case',()=>{
  const first=queueItem('00000000-0000-4000-8000-000000000101',1);
  const second=queueItem('00000000-0000-4000-8000-000000000102',2);
  const partial=d30.scopeReviewsToCompletedRunGroups([first,second],[pass(first)]);
  assert.equal(partial.pendingQueue.length,1);
  assert.equal(partial.pendingQueue[0].runId,second.runId);
  assert.equal(partial.eligibleReviews.length,0);
  assert.equal(partial.completedGroups.length,0);

  const complete=d30.scopeReviewsToCompletedRunGroups([first,second],[pass(first),pass(second,'reviewer-2')]);
  assert.equal(complete.pendingQueue.length,0);
  assert.equal(complete.eligibleReviews.length,2);
  assert.equal(complete.completedGroups.length,1);
});

test('a human reviewer disagreement remains unresolved even when another reviewer passes the same run',()=>{
  const item=queueItem('00000000-0000-4000-8000-000000000201',1);
  const state=d30.scopeReviewsToCompletedRunGroups([item],[
    pass(item,'reviewer-pass'),
    review(item,'REVIEW_NEEDED','reviewer-disagree'),
  ]);
  assert.equal(state.passedRunIds.length,0);
  assert.equal(state.pendingQueue.length,1);
  assert.equal(state.eligibleReviews.length,0);
  assert.equal(state.completedGroups.length,0);
});

test('bounded review recorder rejects a human decision for a run that is not currently queued',async()=>{
  const first=queueItem('00000000-0000-4000-8000-000000000101',1);
  let writes=0;
  const coordinator={
    async reviewQueue(){return [first];},
    async finalize(){return {empiricalExecutionComplete:false,pplComparison:null,evidenceComplete:false};},
  };
  const repository={
    async recordHumanReview(){writes+=1;return 'review-id';},
    async listHumanReviews(){return [];},
  };
  const command=d30.createD30BoundedCommand({coordinator,repository});
  await assert.rejects(()=>command.recordHumanReview({
    sessionId:first.sessionId,
    submission:pass({...first,runId:'00000000-0000-4000-8000-000000000999'}),
  }),/not in the current required queue/i);
  assert.equal(writes,0);
});

test('bounded review recorder persists the exact queued run and attempt',async()=>{
  const first=queueItem('00000000-0000-4000-8000-000000000101',1);
  let persisted=null;
  const coordinator={
    async reviewQueue(){return [first];},
    async finalize(){return {empiricalExecutionComplete:false,pplComparison:null,evidenceComplete:false};},
  };
  const repository={
    async recordHumanReview(input){persisted=input;return 'review-id';},
    async listHumanReviews(){return [];},
  };
  const command=d30.createD30BoundedCommand({coordinator,repository});
  const result=await command.recordHumanReview({sessionId:first.sessionId,submission:pass(first)});
  assert.equal(persisted.runId,first.runId);
  assert.equal(persisted.attemptNo,1);
  assert.equal(result.productionAuthorized,false);
  assert.equal(result.authorizationGate,'D31');
});
