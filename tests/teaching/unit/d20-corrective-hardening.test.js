'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  assertFinalSnapshotIntegrity,assertFollowThroughAuthorized,assertTpf15Output,assertTpf16Scope,guardedRepository,
}=require('../../../teaching/d20/corrected-authority-service');

function bundle({snapshotResponses=[],currentResponses=snapshotResponses,attemptState='SUBMITTED',attemptResultState='AWAITING_MARKING'}={}){
  const items=[
    {package_item_id:'item-1',protected_marking_payload:{rubric:{criteria:[{criterion_id:'c1',criterion_max_marks:5,follow_through_policy:'allowed',follow_through_conditions:[]},{criterion_id:'c2',criterion_max_marks:5,follow_through_policy:'not_allowed',follow_through_conditions:[]}]}}},
    {package_item_id:'item-blank',protected_marking_payload:{rubric:{criteria:[{criterion_id:'b1',criterion_max_marks:2,follow_through_policy:'not_applicable',follow_through_conditions:[]}]}}},
  ];
  return {
    context:{assessment_attempt_id:'attempt-1',assessment_package_id:'package-1',attempt_state:attemptState,attempt_result_state:attemptResultState,finalization_version:1,final_snapshot_ref:'attempt:attempt-1:final:1',final_snapshot:{responses:snapshotResponses}},
    items,
    responses:currentResponses,
    responseByItem:new Map(currentResponses.map(r=>[String(r.package_item_id),r])),
  };
}

const response={package_item_id:'item-1',assessment_response_id:'response-1',response_version:2,renderer_payload:{text:'final answer'}};

test('TCH-0396 authoritative final snapshot integrity distinguishes a legitimate blank from lost/corrupted evidence',()=>{
  const valid=bundle({snapshotResponses:[response],currentResponses:[{...response}]});
  assert.deepEqual(assertFinalSnapshotIntegrity(valid),{captureIntegrity:'complete',finalSnapshotRef:'attempt:attempt-1:final:1',responseCount:1});
  assert.equal(valid.responseByItem.has('item-blank'),false,'absence from both frozen/current response sets remains a legitimate blank');

  const missing=bundle({snapshotResponses:[response],currentResponses:[]});
  assert.throws(()=>assertFinalSnapshotIntegrity(missing),error=>error?.code==='TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION');

  const corrupted=bundle({snapshotResponses:[response],currentResponses:[{...response,renderer_payload:{text:'different'}}]});
  assert.throws(()=>assertFinalSnapshotIntegrity(corrupted),error=>error?.code==='TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION');

  const extra=bundle({snapshotResponses:[],currentResponses:[response]});
  assert.throws(()=>assertFinalSnapshotIntegrity(extra),error=>error?.code==='TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION');
});

test('TCH-0397/TCH-0399 follow-through credit is accepted only when the locked rubric authorizes it',()=>{
  const rubric={criteria:[
    {criterion_id:'allowed',criterion_max_marks:3,follow_through_policy:'allowed',follow_through_conditions:[]},
    {criterion_id:'conditional',criterion_max_marks:3,follow_through_policy:'conditional',follow_through_conditions:['prior arithmetic slip only']},
    {criterion_id:'forbidden',criterion_max_marks:3,follow_through_policy:'not_allowed',follow_through_conditions:[]},
  ]};
  assert.equal(assertFollowThroughAuthorized(rubric,[{criterion_id:'allowed',follow_through_applied:true}]),true);
  assert.equal(assertFollowThroughAuthorized(rubric,[{criterion_id:'conditional',follow_through_applied:true,follow_through_note:'Later method remains correct after the declared arithmetic slip.'}],{requireConditionalNote:true}),true);
  assert.throws(()=>assertFollowThroughAuthorized(rubric,[{criterion_id:'forbidden',follow_through_applied:true}]),error=>error?.code==='TEACHING_D20_FOLLOW_THROUGH_NOT_AUTHORIZED');
  assert.throws(()=>assertFollowThroughAuthorized({criteria:[{criterion_id:'conditional',follow_through_policy:'conditional',follow_through_conditions:[]}]},[{criterion_id:'conditional',follow_through_applied:true}]),error=>error?.code==='TEACHING_D20_FOLLOW_THROUGH_CONDITION_REQUIRED');
  assert.throws(()=>assertFollowThroughAuthorized(rubric,[{criterion_id:'conditional',follow_through_applied:true}],{requireConditionalNote:true}),error=>error?.code==='TEACHING_D20_FOLLOW_THROUGH_CONDITION_REQUIRED');
});

test('TCH-0760 markable TPF-15 output must cover the complete authorized locked-rubric scope',()=>{
  const input={marking_context:{locked_rubric:{criteria:[{criterion_id:'c1'},{criterion_id:'c2'}]},item_validity:{authorized_markable_criterion_ids:[]}}};
  const complete={accepted:true,output:{family:'TPF-15',marking_status:'markable',review_state:'ordinary',criterion_judgments:[{criterion_id:'c1',follow_through_applied:false},{criterion_id:'c2',follow_through_applied:false}]}};
  assert.equal(assertTpf15Output(complete,input),complete);
  const incomplete={accepted:true,output:{family:'TPF-15',marking_status:'markable',review_state:'ordinary',criterion_judgments:[{criterion_id:'c1',follow_through_applied:false}]}};
  assert.throws(()=>assertTpf15Output(incomplete,input),error=>error?.code==='TEACHING_D20_TPF15_CRITERION_COVERAGE_INVALID');
});

test('TCH-0396 unresolved negative-marking triggers fail closed instead of being silently ignored',()=>{
  const input={marking_context:{locked_rubric:{criteria:[{criterion_id:'c1',negative_marking:'explicitly_defined'}]},item_validity:{}}};
  const result={accepted:true,output:{family:'TPF-15',marking_status:'markable',review_state:'ordinary',criterion_judgments:[{criterion_id:'c1',follow_through_applied:false,negative_marking_trigger:{triggered:true,rule_ref:'rule-1',reason:'declared trigger met'}}]}};
  assert.throws(()=>assertTpf15Output(result,input),error=>error?.code==='TEACHING_D20_DEDUCTION_RESOLUTION_REQUIRED');
});

test('TCH-0402/TCH-0763 TPF-16 Pass A and Pass B must cover their exact authorized review scope',()=>{
  const input={review_scope:{criterion_ids:['c1','c2']}};
  const passA={accepted:true,output:{criterion_independent_judgments:[{criterion_id:'c1'}]}};
  assert.throws(()=>assertTpf16Scope(passA,input,'pass_a'),error=>error?.code==='TEACHING_D20_TPF16_SCOPE_COVERAGE_INVALID');
  const passB={accepted:true,output:{criterion_reviews:[{criterion_id:'c1'},{criterion_id:'c2'}]}};
  assert.equal(assertTpf16Scope(passB,input,'pass_b'),passB);
});

test('TCH-0404/TCH-0406 repeat-appeal reaggregation sees the newest authorized correction first',async()=>{
  const repository={
    runsForResult:async()=>[
      {marking_run_id:'correction-old',run_kind:'AUTHORIZED_CORRECTION',created_at:'2026-10-03T10:00:00Z'},
      {marking_run_id:'initial',run_kind:'TPF15_INITIAL',created_at:'2026-10-03T09:00:00Z'},
      {marking_run_id:'correction-new',run_kind:'AUTHORIZED_CORRECTION',created_at:'2026-10-03T11:00:00Z'},
    ],
  };
  const guarded=guardedRepository(repository),runs=await guarded.runsForResult('student-1','result-1');
  assert.deepEqual(runs.filter(r=>r.run_kind==='AUTHORIZED_CORRECTION').map(r=>r.marking_run_id),['correction-new','correction-old']);
});

test('TCH-0762 persistence guard rejects unauthorized follow-through even if an upstream model validator misses it',async()=>{
  const frozen=bundle({snapshotResponses:[response],currentResponses:[{...response}]});
  frozen.items[0].protected_marking_payload.rubric.criteria[0].follow_through_policy='not_allowed';
  const repository={
    loadMarkingBundle:async()=>frozen,
    resultById:async()=>({assessment_result_id:'result-1',assessment_attempt_id:'attempt-1'}),
    appendCriterionJudgments:async()=>{throw new Error('must not persist');},
  };
  const guarded=guardedRepository(repository);
  await assert.rejects(()=>guarded.appendCriterionJudgments({studentId:'student-1',resultId:'result-1',packageItemId:'item-1',judgments:[{criterion_id:'c1',follow_through_applied:true}]}),error=>error?.code==='TEACHING_D20_FOLLOW_THROUGH_NOT_AUTHORIZED');
});
