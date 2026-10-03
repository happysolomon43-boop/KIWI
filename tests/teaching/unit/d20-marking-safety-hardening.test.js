'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const contracts=require('../../../teaching/d20/contracts');
const {assertAuthoritativeResponseCapture}=require('../../../teaching/d20/authority-service');

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
