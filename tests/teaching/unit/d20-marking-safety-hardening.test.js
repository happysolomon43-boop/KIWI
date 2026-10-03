'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const contracts=require('../../../teaching/d20/contracts');
const {assertAuthoritativeResponseCapture,newestFirstRuns}=require('../../../teaching/d20/authority-service');
const {validateExactReviewScope}=require('../../../teaching/d20/intelligence');

function captureBundle(overrides={}){
  const base={
    context:{
      attempt_state:'SUBMITTED',
      attempt_result_state:'AWAITING_MARKING',
      attempt_invalidation_reason:null,
      finalization_version:1,
      final_snapshot_ref:'assessment-attempt:a1:final:v1',
      final_snapshot:{
        finalized_by:'SUBMITTED',
        responses:[
          {package_item_id:'item-1',response_version:1,renderer_payload:{text:'authoritative answer'},accepted_at:'2026-10-03T10:00:00.000Z'},
        ],
      },
    },
    items:[
      {package_item_id:'item-1',item_state:'ACTIVE'},
      {package_item_id:'item-2',item_state:'ACTIVE'},
    ],
    responses:[
      {package_item_id:'item-1',response_version:1,renderer_payload:{text:'authoritative answer'},accepted_at:'2026-10-03T10:00:00.000Z'},
    ],
  };
  return {
    ...base,
    ...overrides,
    context:{...base.context,...(overrides.context||{})},
    items:overrides.items||base.items,
    responses:overrides.responses||base.responses,
  };
}

function oneCriterion(overrides={}){
  return {criteria:[{
    criterion_id:'c1',
    criterion_max_marks:4,
    credit_precision:'exact_points',
    partial_credit_structure:[{credit:0,descriptor:'none'},{credit:2,descriptor:'partial'},{credit:4,descriptor:'full'}],
    answer_space_policy:'open_constrained',
    follow_through_policy:'not_applicable',
    negative_marking:'none',
    dependency_rule:'independent',
    ...overrides,
  }]};
}

function judgment(overrides={}){
  return {
    criterion_id:'c1',
    proposed_credit:2,
    satisfaction:'partial',
    evidence_refs:['response:line-1'],
    evidence_summary:'Bounded response evidence.',
    alternative_valid_route_used:false,
    follow_through_applied:false,
    negative_marking_trigger:{triggered:false,rule_ref:null,reason:null},
    double_count_check:'not_applicable',
    ...overrides,
  };
}

test('TCH-0396 authoritative response capture distinguishes a legitimate blank from lost evidence',()=>{
  const result=assertAuthoritativeResponseCapture(captureBundle());
  assert.equal(result.state,'complete');
  assert.equal(result.responseState,'final_submitted');
  assert.deepEqual([...result.capturedItemIds],['item-1']);
  assert.deepEqual([...result.blankItemIds],['item-2']);
});

test('TCH-0396 response capture rejects a snapshot/durable response version mismatch',()=>{
  const bundle=captureBundle({responses:[{package_item_id:'item-1',response_version:2,renderer_payload:{text:'newer durable response'}}]});
  assert.throws(()=>assertAuthoritativeResponseCapture(bundle),error=>error?.code==='TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED');
});

test('TCH-0396 response capture rejects durable evidence omitted from final snapshot',()=>{
  const bundle=captureBundle({context:{final_snapshot:{finalized_by:'SUBMITTED',responses:[]}}});
  assert.throws(()=>assertAuthoritativeResponseCapture(bundle),error=>error?.code==='TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED');
});

test('TCH-0396 response capture fails closed when final snapshot authority is unresolved',()=>{
  const bundle=captureBundle({context:{final_snapshot_ref:null,finalization_version:0,final_snapshot:{}}});
  assert.throws(()=>assertAuthoritativeResponseCapture(bundle),error=>error?.code==='TEACHING_D20_RESPONSE_CAPTURE_UNRESOLVED');
});

test('TCH-0396 response capture fails closed for an invalidated attempt',()=>{
  const bundle=captureBundle({context:{attempt_invalidation_reason:'SYSTEM_CAPTURE_FAILURE'}});
  assert.throws(()=>assertAuthoritativeResponseCapture(bundle),error=>error?.code==='TEACHING_D20_RESPONSE_CAPTURE_COMPROMISED');
});

test('TCH-0396 expiry auto-finalization is accepted only when final snapshot lineage agrees',()=>{
  const bundle=captureBundle({context:{attempt_state:'EXPIRED',final_snapshot:{finalized_by:'EXPIRED',responses:[{package_item_id:'item-1',response_version:1,renderer_payload:{text:'authoritative answer'}}]}}});
  const result=assertAuthoritativeResponseCapture(bundle);
  assert.equal(result.responseState,'auto_finalized_on_expiry');
});

test('TCH-0395 and TCH-0396 blank objective responses never coerce into correct answers',()=>{
  const numericItem={response_family:'NUMERIC',intended_marks:3,protected_marking_payload:{correct_value:0,absolute_tolerance:0}};
  const missing=contracts.deterministicMarkObjective(numericItem,null);
  const empty=contracts.deterministicMarkObjective(numericItem,{renderer_payload:{value:'   '}});
  const explicitZero=contracts.deterministicMarkObjective(numericItem,{renderer_payload:{value:0}});
  assert.equal(missing.earned,0);
  assert.equal(missing.method,'BLANK_FINAL_RESPONSE');
  assert.equal(empty.earned,0);
  assert.equal(empty.method,'BLANK_FINAL_RESPONSE');
  assert.equal(explicitZero.earned,3);
  assert.equal(explicitZero.method,'NUMERIC_TOLERANCE');
  const blankMcq=contracts.deterministicMarkObjective({response_family:'MCQ',intended_marks:1,protected_marking_payload:{correct_answer:'A'}},{renderer_payload:{answer:''}});
  assert.equal(blankMcq.earned,0);
  assert.equal(blankMcq.method,'BLANK_FINAL_RESPONSE');
});

test('TCH-0397 partial credit must be one of the locked rubric points or ranges',()=>{
  const rubric=oneCriterion();
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({proposed_credit:3})]},rubric),error=>error?.code==='TEACHING_D20_PARTIAL_CREDIT_NOT_DECLARED');
  const accepted=contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({proposed_credit:2})]},rubric);
  assert.equal(accepted[0].proposed_credit,2);
});

test('TCH-0397 follow-through is rejected unless the locked rubric authorizes it',()=>{
  const rubric=oneCriterion({follow_through_policy:'not_allowed'});
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({follow_through_applied:true,follow_through_note:'carried prior value'})]},rubric),error=>error?.code==='TEACHING_D20_FOLLOW_THROUGH_NOT_AUTHORIZED');
});

test('TCH-0397 conditional follow-through requires locked conditions and bounded justification',()=>{
  const missingConditions=oneCriterion({follow_through_policy:'conditional',follow_through_conditions:[]});
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({follow_through_applied:true,follow_through_note:'method remains valid'})]},missingConditions),error=>error?.code==='TEACHING_D20_FOLLOW_THROUGH_CONDITIONS_MISSING');
  const rubric=oneCriterion({follow_through_policy:'conditional',follow_through_conditions:['later method is valid given the carried value']});
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({follow_through_applied:true,follow_through_note:null})]},rubric),error=>error?.code==='TEACHING_D20_FOLLOW_THROUGH_CONDITION_JUSTIFICATION_REQUIRED');
  const accepted=contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({follow_through_applied:true,follow_through_note:'Later algebra is correct using the carried earlier value.'})]},rubric);
  assert.equal(accepted[0].follow_through_applied,true);
});

test('TCH-0396 alternative valid routes cannot rewrite an exhaustive locked answer space',()=>{
  const rubric=oneCriterion({answer_space_policy:'exhaustive'});
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({alternative_valid_route_used:true,alternative_route_note:'unlisted route'})]},rubric),error=>error?.code==='TEACHING_D20_ALTERNATIVE_ROUTE_NOT_AUTHORIZED');
  const open=oneCriterion({answer_space_policy:'open_constrained'});
  const accepted=contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({alternative_valid_route_used:true,alternative_route_note:'different defensible method'})]},open);
  assert.equal(accepted[0].alternative_valid_route_used,true);
});

test('TCH-0396 negative marking can never be silently invented or silently omitted',()=>{
  const unauthorized=oneCriterion({negative_marking:'none'});
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({negative_marking_trigger:{triggered:true,rule_ref:'r1',reason:'claimed'}})]},unauthorized),error=>error?.code==='TEACHING_D20_NEGATIVE_MARKING_NOT_AUTHORIZED');
  const explicit=oneCriterion({negative_marking:'explicitly_defined'});
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({negative_marking_trigger:{triggered:true,rule_ref:'policy:r1',reason:'trigger met'}})]},explicit),error=>error?.code==='TEACHING_D20_NEGATIVE_MARKING_DETERMINISTIC_RULE_REQUIRED');
  const clear=contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({negative_marking_trigger:{triggered:false,rule_ref:'policy:r1',reason:'not triggered'}})]},explicit);
  assert.equal(clear[0].negative_marking_trigger.triggered,false);
});

test('TCH-0397 no-double-count rubric rule rejects shared evidence across criteria',()=>{
  const rubric={criteria:[
    {...oneCriterion({criterion_id:'c1',dependency_rule:'no_double_count'}).criteria[0],criterion_id:'c1'},
    {...oneCriterion({criterion_id:'c2'}).criteria[0],criterion_id:'c2'},
  ]};
  const output={family:'TPF-15',marking_status:'markable',criterion_judgments:[
    judgment({criterion_id:'c1',evidence_refs:['response:shared']}),
    judgment({criterion_id:'c2',evidence_refs:['response:shared']}),
  ]};
  assert.throws(()=>contracts.validateCriterionJudgments(output,rubric),error=>error?.code==='TEACHING_D20_DOUBLE_COUNT_RULE_BREACH');
});

test('TCH-0760 a markable TPF-15 output must cover every locked rubric criterion',()=>{
  const rubric={criteria:[
    {...oneCriterion({criterion_id:'c1'}).criteria[0],criterion_id:'c1'},
    {...oneCriterion({criterion_id:'c2'}).criteria[0],criterion_id:'c2'},
  ]};
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',marking_status:'markable',criterion_judgments:[judgment({criterion_id:'c1'})]},rubric),error=>error?.code==='TEACHING_D20_CRITERION_JUDGMENT_MISSING');
});

test('TCH-0396 unsupported global rubric caps/dependencies fail closed instead of being ignored',()=>{
  const rubric={...oneCriterion(),global_caps_or_dependencies:[{type:'CUSTOM_DEPENDENCY',ref:'rule-x'}]};
  assert.throws(()=>contracts.deterministicAggregateCriteria([{criterion_id:'c1',proposed_credit:2}],rubric),error=>error?.code==='TEACHING_D20_AGGREGATION_RULE_UNSUPPORTED');
  const capped={...oneCriterion(),global_caps_or_dependencies:[{type:'MAX_TOTAL',max_marks:1}]};
  const result=contracts.deterministicAggregateCriteria([{criterion_id:'c1',proposed_credit:2}],capped);
  assert.equal(result.earned,1);
});

test('TCH-0402 and TCH-0763 TPF-16 output must exactly cover the authorized criterion scope',()=>{
  const passA={criterion_independent_judgments:[{criterion_id:'c1'}]};
  assert.equal(validateExactReviewScope(passA,'independent_pass_a',['c1']),null);
  assert.equal(validateExactReviewScope(passA,'independent_pass_a',['c1','c2']).reason,'TEACHING_D20_REVIEW_SCOPE_MISMATCH');
  const passB={criterion_reviews:[{criterion_id:'c1'},{criterion_id:'c2'}]};
  assert.equal(validateExactReviewScope(passB,'comparison_pass_b',['c1','c2']),null);
  assert.equal(validateExactReviewScope(passB,'comparison_pass_b',['c1']).reason,'TEACHING_D20_REVIEW_SCOPE_MISMATCH');
});

test('TCH-0404 and TCH-0405 repeat appeal aggregation prefers the terminal authorized correction lineage',()=>{
  const ordered=newestFirstRuns([
    {marking_run_id:'initial',parent_run_id:null,run_kind:'TPF15_INITIAL',run_status:'ACCEPTED',created_at:'2026-10-03T09:00:00.000Z'},
    {marking_run_id:'correction-1',parent_run_id:'initial',run_kind:'AUTHORIZED_CORRECTION',run_status:'ACCEPTED',created_at:'2026-10-03T10:00:00.000Z'},
    {marking_run_id:'correction-2',parent_run_id:'correction-1',run_kind:'AUTHORIZED_CORRECTION',run_status:'ACCEPTED',created_at:'2026-10-03T11:00:00.000Z'},
  ]);
  assert.equal(ordered[0].marking_run_id,'correction-2');
  assert.ok(ordered.findIndex(run=>run.marking_run_id==='correction-2')<ordered.findIndex(run=>run.marking_run_id==='correction-1'));
});
