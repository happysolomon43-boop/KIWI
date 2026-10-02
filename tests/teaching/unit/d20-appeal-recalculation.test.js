'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createD20Service}=require('../../../teaching/d20/authority-service');

function lockedPolicy(){return {
  grading_policy_id:'policy-1',version_no:1,category_weights:{CLASSWORK:.10,HOMEWORK:.05,IMPROMPTU:.10,SCHEDULED_TEST:.15,MID_SEMESTER:.20,FINAL_EXAMINATION:.40},rounding_policy:{mode:'NONE'},grade_scale_policy:{scale:'KIWI_PERCENTAGE_100_V1'},topic_evidence_policy:{},essential_outcome_policy:{},moderation_policy:{},appeal_policy:{default_review_direction:'two_way',authority_ref:'institution-policy:appeals:v1'},
};}

test('TCH-0425 successful appeal deterministically recalculates result and Gradebook while preserving audit lineage',async()=>{
  let result={assessment_result_id:'result-1',assessment_attempt_id:'attempt-1',assessment_id:'assessment-1',course_id:'course-1',category_key:'CLASSWORK',marking_state:'MODERATED',release_state:'APPEALABLE',review_blocked:false,raw_earned_marks:5,raw_max_marks:10,raw_percentage:50,result_version:1};
  let appeal={grade_appeal_id:'appeal-1',assessment_result_id:'result-1',package_item_id:'item-1',criterion_id:'c1',appeal_state:'SUBMITTED',review_direction_policy:'two_way',rubric_ref:'rubric-1',normalized_artifact:{criterion_id:'c1',package_item_id:'item-1'},raw_appeal_text:'The rubric criterion was applied incorrectly.'};
  const policy=lockedPolicy();
  const item={package_item_id:'item-1',item_state:'ACTIVE',item_hash:'hash-1',response_family:'CONSTRUCTED',intended_marks:10,learning_unit_ids:['lu-1'],public_item_payload:{stem:'Explain.'},protected_marking_payload:{rubric:{rubric_ref:'rubric-1',criteria:[{criterion_id:'c1',criterion_max_marks:10,credit_precision:'exact_points'}]}}};
  const response={assessment_response_id:'response-1',response_version:1,renderer_payload:{text:'Student answer'}};
  const bundle={context:{graded:true,assessment_type:'CLASSWORK',assessment_id:'assessment-1',assessment_attempt_id:'attempt-1',assessment_package_id:'package-1',final_snapshot_ref:'attempt:1:final',policy_snapshot:{}},policy,items:[item],responseByItem:new Map([['item-1',response]])};
  const runs=[{marking_run_id:'run-original',package_item_id:'item-1',run_kind:'TPF15_INITIAL',run_status:'ACCEPTED'}];
  const judgmentByRun=new Map([['run-original',[{criterion_id:'c1',criterion_max_marks:10,proposed_credit:5,proposed_band_id:null,supported_credit_range:null,satisfaction:'partial',evidence_refs:[],evidence_summary:'Original rubric judgment',review_state:'ordinary',confidence:'high',alternative_valid_route_used:false,follow_through_applied:false,defect_flags:[]}]]]);
  let entries=[{gradebook_entry_id:'entry-v1',source_kind:'ASSESSMENT',source_ref:'attempt-1',source_result_id:'result-1',category_key:'CLASSWORK',category_weight:.10,within_category_weight:1,raw_earned_marks:5,raw_max_marks:10,raw_percentage:50,course_contribution:5,entry_state:'APPEALABLE',learning_unit_ids:['lu-1'],topic_ids:[],version_no:1}];
  const audits=[];
  const repository={
    sha:()=> 'test-digest',
    loadMarkingBundle:async()=>bundle,
    resultById:async()=>result,
    appealById:async()=>appeal,
    runsForResult:async()=>runs,
    judgmentsForRun:async(_student,runId)=>judgmentByRun.get(runId)||[],
    updateAppeal:async({patch})=>{appeal={...appeal,...patch};return appeal;},
    appendRun:async(input)=>{const run={marking_run_id:`run-${runs.length+1}`,package_item_id:input.packageItemId,run_kind:input.runKind,run_status:input.runStatus};runs.push(run);return {run,idempotent:false};},
    appendCriterionJudgments:async({runId,judgments})=>{judgmentByRun.set(runId,judgments);return judgments;},
    updateResult:async({patch})=>{result={...result,...patch,result_version:result.result_version+1};return result;},
    activeGradebookEntries:async()=>entries,
    topicsForLearningUnits:async()=>[],
    upsertGradebookVersion:async(input)=>{const previous=entries[0],entry={...previous,gradebook_entry_id:`entry-v${Number(previous.version_no)+1}`,version_no:Number(previous.version_no)+1,raw_earned_marks:input.rawEarnedMarks,raw_max_marks:input.rawMaxMarks,raw_percentage:input.rawPercentage,course_contribution:input.courseContribution,entry_state:input.entryState,learning_unit_ids:input.learningUnitIds,topic_ids:input.topicIds,change_reason:input.changeReason};entries=[entry];return {entry,previous,idempotent:false};},
    courseTopics:async()=>[],
    appendCourseSnapshot:async({snapshot})=>({...snapshot,course_result_snapshot_id:'course-snapshot-2',essential_outcome_flags:snapshot.essential_outcome_flags||[]}),
    appendTopicSnapshot:async()=>{throw new Error('no topics expected');},
    appendAudit:async(input)=>{audits.push(input);return input;},
  };
  const intelligence={
    appealPassA:async()=>({accepted:true,output:{family:'TPF-16',review_stage:'independent_pass_a',criterion_independent_judgments:[{criterion_id:'c1',criterion_max_marks:10,independent_credit:8,independent_band_id:null,supported_credit_range:null,response_evidence_refs:['response-1'],rubric_grounded_basis:'Criterion supports 8/10.',review_issue:'none',confidence:'high',alternative_valid_route_recognized:false,follow_through_review:'not_applicable'}],artifact_controls:{original_credit_seen:false,overall_result_seen:false,raw_appeal_text_seen:false,review_direction_policy_seen:false,downstream_consequence_seen:false,freeze_before_comparison_required:true}}}),
    appealPassB:async()=>({accepted:true,output:{family:'TPF-16',review_stage:'comparison_pass_b',criterion_reviews:[{criterion_id:'c1'}],blind_first:{attempted:true,achieved:true,pass_a_frozen_before_comparison:true,independent_pass_a_ref:'run-pass-a'},review_outcome:{official_mark_not_committed:true,deterministic_reaggregation_required_if_changed:true,gradebook_commit_external:true,audit_history_preserve_original:true}}}),
  };
  const service=createD20Service({repository,d17Repository:{requireAttempt:async()=>({attempt_state:'SUBMITTED'})},intelligence,randomUUID:()=> 'uuid-1'});
  const out=await service.reviewAppeal({id:'student-1'},'appeal-1',{idempotencyKey:'appeal-review-1'});

  assert.equal(out.state,'RESOLVED');
  assert.equal(out.disposition,'REVISED');
  assert.equal(out.originalCredit,5);
  assert.equal(out.officialCorrectedCredit,8);
  assert.equal(out.rawAppealBecameAnswerContent,false);
  assert.equal(result.raw_earned_marks,8);
  assert.equal(result.raw_max_marks,10);
  assert.equal(result.raw_percentage,80);
  assert.equal(entries[0].raw_percentage,80);
  assert.equal(entries[0].change_reason,'SUCCESSFUL_APPEAL');
  assert.equal(audits.length,1);
  assert.equal(audits[0].reasonCode,'SUCCESSFUL_APPEAL');
  assert.deepEqual(audits[0].boundedReasonRefs,['appeal:appeal-1']);
  assert.ok(runs.some(run=>run.run_kind==='APPEAL_PASS_A'));
  assert.ok(runs.some(run=>run.run_kind==='APPEAL_PASS_B'));
  assert.ok(runs.some(run=>run.run_kind==='AUTHORIZED_CORRECTION'));
});
