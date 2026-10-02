'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const contracts=require('../../../teaching/d20/contracts');
const intelligence=require('../../../teaching/d20/intelligence');
const {assertD20TaskAccounting}=require('../../../teaching/d20/task-accounting');
const {renderCourseResults,renderTopicResult,renderAssessmentReview}=require('../../../teaching/d20/ui');

const rubric={criteria:[
  {criterion_id:'method',criterion_max_marks:3,credit_precision:'exact_points'},
  {criterion_id:'answer',criterion_max_marks:2,credit_precision:'exact_points'},
]};

test('D20 permanently accounts for exactly 38 assigned tasks',()=>{
  const accounting=assertD20TaskAccounting();
  assert.equal(accounting.taskCount,38);
  assert.equal(new Set(accounting.taskIds).size,38);
  assert.ok(accounting.taskIds.includes('TCH-0057'));
  assert.ok(accounting.taskIds.includes('TCH-0763'));
});

test('D20 default category budgets are fixed and sum to 100%',()=>{
  const policy=contracts.defaultPolicy({topicEvidencePolicy:{minimum_grade_contributing_events:3,minimum_distinct_assessment_contexts:2,minimum_separate_academic_occasions:2,controlled_independent_evidence_required:true}});
  assert.deepEqual(policy.category_weights,{CLASSWORK:.10,HOMEWORK:.05,IMPROMPTU:.10,SCHEDULED_TEST:.15,MID_SEMESTER:.20,FINAL_EXAMINATION:.40});
  assert.equal(Object.values(policy.category_weights).reduce((a,b)=>a+b,0),1);
  assert.equal(policy.rounding_policy.mode,'NONE');
  assert.equal(policy.appeal_policy.default_review_direction,null);
});

test('assessment frequency cannot inflate a fixed category budget',()=>{
  const policy=contracts.defaultPolicy();
  const one=contracts.calculateCourseScore([{source_ref:'a',category_key:'HOMEWORK',raw_percentage:80,entry_state:'PROVISIONAL'}],policy);
  const many=contracts.calculateCourseScore([
    {source_ref:'a',category_key:'HOMEWORK',raw_percentage:80,entry_state:'PROVISIONAL'},
    {source_ref:'b',category_key:'HOMEWORK',raw_percentage:80,entry_state:'PROVISIONAL'},
    {source_ref:'c',category_key:'HOMEWORK',raw_percentage:80,entry_state:'PROVISIONAL'},
    {source_ref:'d',category_key:'HOMEWORK',raw_percentage:80,entry_state:'PROVISIONAL'},
  ],policy);
  assert.equal(one.score_percentage,4);
  assert.equal(many.score_percentage,4);
  assert.equal(one.category_breakdown.HOMEWORK.course_contribution,many.category_breakdown.HOMEWORK.course_contribution);
});

test('objective marking handles MCQ numeric symbolic structured and trusted code tests deterministically',()=>{
  assert.equal(contracts.deterministicMarkObjective({response_family:'MCQ',intended_marks:2,protected_marking_payload:{correct_answer:'B'}},{renderer_payload:{answer:'B'}}).earned,2);
  assert.equal(contracts.deterministicMarkObjective({response_family:'NUMERIC',intended_marks:3,protected_marking_payload:{correct_value:9.81,absolute_tolerance:.02}},{renderer_payload:{value:9.8}}).earned,3);
  assert.equal(contracts.deterministicMarkObjective({response_family:'SYMBOLIC',intended_marks:2,protected_marking_payload:{accepted_forms:['x^2+1']}},{renderer_payload:{text:' x^2 + 1 '}}).earned,2);
  assert.equal(contracts.deterministicMarkObjective({response_family:'STRUCTURED_OBJECTIVE',intended_marks:4,protected_marking_payload:{expected_structure:{unit:'m/s',sign:'+'}}},{renderer_payload:{answer:{unit:'m/s',sign:'+'}}}).earned,4);
  const code=contracts.deterministicMarkObjective({response_family:'CODE_TESTS',intended_marks:6,protected_marking_payload:{test_cases:[{id:'a',weight:1},{id:'b',weight:2}]}},{deterministic_test_results:{results:[{id:'a',passed:true},{id:'b',passed:false}]}});
  assert.equal(code.earned,2);
});

test('T4 marking context excludes attendance personality GPA and unrelated history',()=>{
  for(const key of ['attendance','teacher_personality','previous_gpa','peer_performance','current_course_total','grade_boundary_position','student_reputation']){
    assert.throws(()=>contracts.markingContextAllowlist({task:{},locked_rubric:{},[key]:'forbidden'}),/forbidden student\/history context/i,key);
  }
  const safe=contracts.markingContextAllowlist({task:{id:'x'},locked_rubric:rubric,submitted_response:'answer',necessary_course_context:{assessment_type:'FINAL_EXAMINATION'}});
  assert.deepEqual(Object.keys(safe).sort(),['accessibility_interpretation','deterministic_checker_outputs','evaluation_purpose','item_validity','locked_rubric','necessary_course_context','permitted_source_context','provenance_refs','submitted_response','task'].sort());
});

test('TPF-15 output cannot seize total or Gradebook authority',()=>{
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',official_total:5,criterion_judgments:[]},rubric),error=>error?.code==='TEACHING_D20_MODEL_AUTHORITY_EXCEEDED');
  assert.deepEqual(intelligence.validateTpf15Controls({aggregation_handoff:{deterministic_aggregation_required:true,official_total_not_committed:true,rounding_external:true,gradebook_commit_external:true}}),null);
  assert.equal(intelligence.validateTpf15Controls({aggregation_handoff:{deterministic_aggregation_required:true}}).ok,false);
});

test('criterion aggregation obeys locked rubric and rejects fabricated precision',()=>{
  const out=contracts.deterministicAggregateCriteria([
    {criterion_id:'method',proposed_credit:2,criterion_max_marks:3},
    {criterion_id:'answer',proposed_credit:2,criterion_max_marks:2},
  ],rubric,{roundingPolicy:{mode:'NONE'}});
  assert.equal(out.earned,4);assert.equal(out.max,5);assert.equal(out.percentage,80);
  assert.throws(()=>contracts.validateCriterionJudgments({family:'TPF-15',criterion_judgments:[{criterion_id:'band',proposed_credit:3,satisfaction:'partial'}]},{criteria:[{criterion_id:'band',criterion_max_marks:5,credit_precision:'ranged_band'}]}),error=>error?.code==='TEACHING_D20_RUBRIC_PRECISION_GAP');
});

test('Topic score stays provisional until diversity policy is satisfied',()=>{
  const policy=contracts.defaultPolicy({topicEvidencePolicy:{minimum_grade_contributing_events:3,minimum_distinct_assessment_contexts:2,minimum_separate_academic_occasions:2,controlled_independent_evidence_required:true}});
  const thin=contracts.topicScore([{source_ref:'a',academic_occasion_ref:'o1',category_key:'CLASSWORK',raw_percentage:90,entry_state:'PROVISIONAL',topic_ids:['t'],controlled_independent:true}],policy,{topicId:'t'});
  assert.equal(thin.score_state,'PROVISIONAL_INSUFFICIENT_EVIDENCE');
  const enough=contracts.topicScore([
    {source_ref:'a',academic_occasion_ref:'o1',category_key:'CLASSWORK',raw_percentage:90,entry_state:'PROVISIONAL',topic_ids:['t'],controlled_independent:true},
    {source_ref:'b',academic_occasion_ref:'o2',category_key:'SCHEDULED_TEST',raw_percentage:80,entry_state:'PROVISIONAL',topic_ids:['t'],controlled_independent:true},
    {source_ref:'c',academic_occasion_ref:'o3',category_key:'CLASSWORK',raw_percentage:70,entry_state:'PROVISIONAL',topic_ids:['t'],controlled_independent:true},
  ],policy,{topicId:'t'});
  assert.equal(enough.score_state,'FINALIZED');
  assert.equal(enough.evidence_count,3);
  assert.equal(enough.distinct_context_count,2);
});

test('TPF-16 Pass A must be genuinely blind and frozen before comparison',()=>{
  const valid={review_stage:'independent_pass_a',criterion_independent_judgments:[],artifact_controls:{original_credit_seen:false,overall_result_seen:false,raw_appeal_text_seen:false,review_direction_policy_seen:false,downstream_consequence_seen:false,freeze_before_comparison_required:true}};
  assert.equal(intelligence.validatePassAControls(valid),null);
  const contaminated=structuredClone(valid);contaminated.artifact_controls.original_credit_seen=true;
  assert.equal(intelligence.validatePassAControls(contaminated).ok,false);
});

test('TPF-16 Pass B requires frozen blind Pass A and external authoritative commit',()=>{
  const valid={review_stage:'comparison_pass_b',criterion_reviews:[],blind_first:{attempted:true,achieved:true,pass_a_frozen_before_comparison:true,independent_pass_a_ref:'run-a'},review_outcome:{official_mark_not_committed:true,deterministic_reaggregation_required_if_changed:true,gradebook_commit_external:true,audit_history_preserve_original:true}};
  assert.equal(intelligence.validatePassBControls(valid),null);
  const unsafe=structuredClone(valid);unsafe.review_outcome.gradebook_commit_external=false;
  assert.equal(intelligence.validatePassBControls(unsafe).ok,false);
});

test('material marker disagreement escalates and is never averaged',()=>{
  const comparison=contracts.compareIndependentJudgments([{criterion_id:'c',proposed_credit:4}],[{criterion_id:'c',proposed_credit:2}]);
  assert.equal(comparison.material_disagreement,true);
  assert.equal(comparison.comparisons[0].classification,'material_credit_disagreement');
  assert.equal(Object.prototype.hasOwnProperty.call(comparison,'average'),false);
});

test('appeal direction is deterministic and never model-invented',()=>{
  assert.equal(contracts.applyReviewDirection({originalCredit:3,reviewedCredit:1,policy:'upward_only'}),3);
  assert.equal(contracts.applyReviewDirection({originalCredit:3,reviewedCredit:4,policy:'upward_only'}),4);
  assert.equal(contracts.applyReviewDirection({originalCredit:3,reviewedCredit:1,policy:'two_way'}),1);
  assert.equal(contracts.applyReviewDirection({originalCredit:3,reviewedCredit:5,policy:'retain_or_escalate_only'}),3);
  assert.throws(()=>contracts.applyReviewDirection({originalCredit:3,reviewedCredit:4,policy:null}),error=>error?.code==='TEACHING_D20_REVIEW_DIRECTION_REQUIRED');
});

test('D20 UI projects authoritative state without protected marking payloads',()=>{
  const course=renderCourseResults({courseResult:{score:72,state:'PROVISIONAL',categoryBreakdown:{}},policy:{version:1},topics:[],gradebookEntries:[]});
  const topic=renderTopicResult({topic:{topicId:'topic-1',score:null,state:'PROVISIONAL_INSUFFICIENT_EVIDENCE',evidence:{count:1,distinctContexts:1,distinctOccasions:1,controlledIndependentPresent:false}}});
  const review=renderAssessmentReview({markingState:'MODERATING',releaseState:'HELD',reviewBlocked:true,moderationRequired:true,runs:[],appeals:[]});
  for(const html of [course,topic,review]){assert.match(html,/KIWI Teaching/);assert.doesNotMatch(html,/protected_marking_payload|answer_key|chain[-_ ]of[-_ ]thought/i);}
  assert.match(course,/Course results, without hidden math/);
  assert.match(topic,/Evidence first/);
  assert.match(review,/Finalization is blocked/);
});
