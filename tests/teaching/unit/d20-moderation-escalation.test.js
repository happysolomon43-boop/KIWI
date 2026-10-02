'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createD20Service}=require('../../../teaching/d20/authority-service');

function policy(){return {grading_policy_id:'policy-1',version_no:1,category_weights:{CLASSWORK:.10,HOMEWORK:.05,IMPROMPTU:.10,SCHEDULED_TEST:.15,MID_SEMESTER:.20,FINAL_EXAMINATION:.40},rounding_policy:{mode:'NONE'},grade_scale_policy:{scale:'KIWI_PERCENTAGE_100_V1'},topic_evidence_policy:{},essential_outcome_policy:{},moderation_policy:{final_exam_constructed_response_requires_independent_moderation:true,blind_first_pass_required:true},appeal_policy:{default_review_direction:null}};}

test('TCH-0763 material high-stakes moderation disagreement preserves judgments and blocks finalization',async()=>{
  let result={assessment_result_id:'result-1',assessment_attempt_id:'attempt-1',assessment_id:'assessment-1',course_id:'course-1',category_key:'FINAL_EXAMINATION',marking_state:'MODERATING',release_state:'HELD',moderation_required:true,review_blocked:false,raw_earned_marks:null,raw_max_marks:null,raw_percentage:null,result_version:2};
  const item={package_item_id:'item-1',item_state:'ACTIVE',item_hash:'hash-1',response_family:'CONSTRUCTED',intended_marks:10,public_item_payload:{stem:'Explain.'},protected_marking_payload:{rubric:{rubric_ref:'rubric-1',criteria:[{criterion_id:'c1',criterion_max_marks:10,credit_precision:'exact_points'}]}}};
  const response={assessment_response_id:'response-1',response_version:1,renderer_payload:{text:'Student answer'}};
  const bundle={context:{assessment_type:'FINAL_EXAMINATION',assessment_id:'assessment-1',assessment_attempt_id:'attempt-1',assessment_package_id:'package-1',final_snapshot_ref:'attempt:1:final'},policy:policy(),items:[item],responseByItem:new Map([['item-1',response]])};
  const runs=[{marking_run_id:'run-original',package_item_id:'item-1',run_kind:'TPF15_INITIAL',run_status:'ACCEPTED'}];
  const judgmentByRun=new Map([['run-original',[{criterion_id:'c1',criterion_max_marks:10,proposed_credit:5,proposed_band_id:null,supported_credit_range:null,satisfaction:'partial',evidence_refs:['response-1'],evidence_summary:'Original rubric judgment',review_state:'ordinary',confidence:'high',alternative_valid_route_used:false,follow_through_applied:false,defect_flags:[]}]]]);
  let gradebookWrites=0;
  const repository={
    sha:()=> 'test-digest',
    loadMarkingBundle:async()=>bundle,
    resultById:async()=>result,
    assessmentResultDetail:async()=>({result,runs,appeals:[]}),
    runsForResult:async()=>runs,
    judgmentsForRun:async(_student,runId)=>judgmentByRun.get(runId)||[],
    appendRun:async(input)=>{const run={marking_run_id:`run-${runs.length+1}`,package_item_id:input.packageItemId,run_kind:input.runKind,run_status:input.runStatus,original_credit_visible:input.originalCreditVisible,raw_appeal_visible:input.rawAppealVisible,review_direction_visible:input.reviewDirectionVisible};runs.push(run);return {run,idempotent:false};},
    appendCriterionJudgments:async({runId,judgments})=>{judgmentByRun.set(runId,judgments);return judgments;},
    updateResult:async({patch})=>{result={...result,...patch,result_version:result.result_version+1};return result;},
    upsertGradebookVersion:async()=>{gradebookWrites+=1;throw new Error('must not write Gradebook while moderation is unresolved');},
  };
  const intelligence={
    moderatePassA:async()=>({accepted:true,output:{family:'TPF-16',review_stage:'independent_pass_a',criterion_independent_judgments:[{criterion_id:'c1',criterion_max_marks:10,independent_credit:8,independent_band_id:null,supported_credit_range:null,response_evidence_refs:['response-1'],rubric_grounded_basis:'Independent blind review supports 8/10.',review_issue:'none',confidence:'high',alternative_valid_route_recognized:false,follow_through_review:'not_applicable'}],artifact_controls:{original_credit_seen:false,overall_result_seen:false,raw_appeal_text_seen:false,review_direction_policy_seen:false,downstream_consequence_seen:false,freeze_before_comparison_required:true}}}),
    moderatePassB:async()=>({accepted:true,output:{family:'TPF-16',review_stage:'comparison_pass_b',criterion_reviews:[{criterion_id:'c1'}],blind_first:{attempted:true,achieved:true,pass_a_frozen_before_comparison:true,independent_pass_a_ref:'run-pass-a'},review_outcome:{official_mark_not_committed:true,deterministic_reaggregation_required_if_changed:true,gradebook_commit_external:true,audit_history_preserve_original:true}}}),
  };
  const service=createD20Service({repository,d17Repository:{requireAttempt:async()=>({attempt_state:'SUBMITTED'})},intelligence,randomUUID:()=> 'uuid-1'});
  const out=await service.moderateResult({id:'student-1'},'result-1',{idempotencyKey:'moderate-1'});

  assert.equal(out.state,'REVIEW_NEEDED');
  assert.equal(out.finalizationBlocked,true);
  assert.equal(out.materialDisagreement,true);
  assert.equal(result.marking_state,'REVIEW_NEEDED');
  assert.equal(result.review_blocked,true);
  assert.equal(gradebookWrites,0);
  const passA=runs.find(run=>run.run_kind==='TPF16_PASS_A');
  const passB=runs.find(run=>run.run_kind==='TPF16_PASS_B');
  assert.ok(passA);assert.ok(passB);
  assert.equal(passA.original_credit_visible,false);
  assert.equal(passB.original_credit_visible,true);
  assert.equal(judgmentByRun.get('run-original')[0].proposed_credit,5);
  assert.equal(judgmentByRun.get(passA.marking_run_id)[0].proposed_credit,8);
  assert.equal(passB.run_status,'ADDITIONAL_REVIEW_REQUIRED');
});
