'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createD20Service}=require('../../../teaching/d20/authority-service');

function policyRow(overrides={}){
  return {
    grading_policy_id:'policy-1',course_id:'course-1',version_no:1,policy_state:'LOCKED',locked_at:'2026-10-02T00:00:00Z',
    category_weights:{CLASSWORK:.10,HOMEWORK:.05,IMPROMPTU:.10,SCHEDULED_TEST:.15,MID_SEMESTER:.20,FINAL_EXAMINATION:.40},
    rounding_policy:{mode:'NONE'},grade_scale_policy:{scale:'KIWI_PERCENTAGE_100_V1'},topic_evidence_policy:{},essential_outcome_policy:{},moderation_policy:{},appeal_policy:{default_review_direction:null},source_policy_refs:[],
    ...overrides,
  };
}

function makeService(repository){
  return createD20Service({repository,d17Repository:{requireAttempt:async()=>({attempt_state:'SUBMITTED'})},randomUUID:()=>`uuid-${Math.random()}`});
}

test('D20 authority boundary never invents an appeal review direction while locking policy',async()=>{
  let captured=null;
  const repository={
    loadMarkingBundle:async()=>null,
    lockedPolicy:async()=>null,
    createLockedPolicy:async({policy})=>{captured=policy;return {policy:{...policyRow(),appeal_policy:policy.appeal_policy,source_policy_refs:policy.source_policy_refs},idempotent:false};},
  };
  const service=makeService(repository);
  const projected=await service.ensurePolicy({id:'student-1'},'course-1',{});
  assert.equal(captured.appeal_policy.default_review_direction,null);
  assert.equal(projected.appealPolicy.default_review_direction,null);
  assert.equal(service.authorityBoundary,'D20_CANONICAL_MARKING_SAFETY_V2');
});

test('D20 rejects a configured appeal direction without explicit versioned authority',async()=>{
  const repository={loadMarkingBundle:async()=>null,lockedPolicy:async()=>null,createLockedPolicy:async()=>{throw new Error('must not persist');}};
  const service=makeService(repository);
  await assert.rejects(()=>service.ensurePolicy({id:'student-1'},'course-1',{appealPolicy:{default_review_direction:'two_way'}}),error=>error.code==='TEACHING_D20_APPEAL_DIRECTION_AUTHORITY_REQUIRED');
});

test('appeal requests cannot select review direction and configured policy direction is used',async()=>{
  const result={assessment_result_id:'result-1',assessment_attempt_id:'attempt-1',course_id:'course-1',release_state:'APPEALABLE'};
  const bundle={
    context:{assessment_attempt_id:'attempt-1'},
    policy:policyRow({appeal_policy:{default_review_direction:'upward_only',authority_ref:'institution-policy:appeals:v3'}}),
    items:[{package_item_id:'item-1',protected_marking_payload:{rubric:{criteria:[{criterion_id:'c1',criterion_max_marks:2}]}}}],
  };
  let writtenDirection=null;
  const repository={
    loadMarkingBundle:async()=>bundle,
    resultById:async()=>result,
    createAppeal:async(input)=>{writtenDirection=input.reviewDirectionPolicy;return {appeal:{grade_appeal_id:'appeal-1',appeal_state:'SUBMITTED'},idempotent:false};},
  };
  const service=makeService(repository);
  await assert.rejects(()=>service.createAppeal({id:'student-1'},'result-1',{packageItemId:'item-1',criterionId:'c1',reviewDirectionPolicy:'two_way'}),error=>error.code==='TEACHING_D20_APPEAL_DIRECTION_REQUEST_FORBIDDEN');
  const created=await service.createAppeal({id:'student-1'},'result-1',{packageItemId:'item-1',criterionId:'c1',ground:'rubric_application',text:'Please review this criterion.',idempotencyKey:'appeal-key'});
  assert.equal(writtenDirection,'upward_only');
  assert.equal(created.appealId,'appeal-1');
  assert.equal(created.rawAppealBecomesAnswerContent,false);
});

test('TCH-0425 invalidated question recalculates and version-propagates authoritative score',async()=>{
  let result={assessment_result_id:'result-1',assessment_attempt_id:'attempt-1',assessment_id:'assessment-1',course_id:'course-1',category_key:'CLASSWORK',marking_state:'PROVISIONAL',release_state:'HELD',review_blocked:false,raw_earned_marks:10,raw_max_marks:20,raw_percentage:50,result_version:1};
  const policy=policyRow();
  const bundle={
    context:{graded:true,assessment_attempt_id:'attempt-1'},policy,
    items:[
      {package_item_id:'item-active',item_state:'ACTIVE',response_family:'MCQ',intended_marks:10,learning_unit_ids:['lu-1']},
      {package_item_id:'item-bad',item_state:'INVALIDATED',invalidation_reason:'SYSTEM_MEASUREMENT_DEFECT',response_family:'MCQ',intended_marks:10,learning_unit_ids:['lu-2']},
    ],
  };
  const runs=[
    {marking_run_id:'run-active',package_item_id:'item-active',run_kind:'DETERMINISTIC',run_status:'ACCEPTED'},
    {marking_run_id:'run-bad',package_item_id:'item-bad',run_kind:'DETERMINISTIC',run_status:'ACCEPTED'},
  ];
  const judgments={
    'run-active':[{criterion_id:'OBJECTIVE_KEY',criterion_max_marks:10,proposed_credit:8}],
    'run-bad':[{criterion_id:'OBJECTIVE_KEY',criterion_max_marks:10,proposed_credit:2}],
  };
  let entries=[{gradebook_entry_id:'entry-v1',student_id:'student-1',course_id:'course-1',grading_policy_id:'policy-1',source_kind:'ASSESSMENT',source_ref:'attempt-1',source_result_id:'result-1',category_key:'CLASSWORK',category_weight:.10,within_category_weight:1,raw_earned_marks:10,raw_max_marks:20,raw_percentage:50,course_contribution:5,entry_state:'PROVISIONAL',learning_unit_ids:['lu-1','lu-2'],topic_ids:[],version_no:1}];
  const audits=[];const courseSnapshots=[];
  const repository={
    loadMarkingBundle:async()=>bundle,
    resultById:async()=>result,
    runsForResult:async()=>runs,
    judgmentsForRun:async(_student,runId)=>judgments[runId],
    updateResult:async({patch})=>{result={...result,...patch,result_version:result.result_version+1};return result;},
    activeGradebookEntries:async()=>entries,
    topicsForLearningUnits:async()=>[],
    upsertGradebookVersion:async(input)=>{const previous=entries[0],entry={...previous,gradebook_entry_id:'entry-v2',version_no:2,raw_earned_marks:input.rawEarnedMarks,raw_max_marks:input.rawMaxMarks,raw_percentage:input.rawPercentage,course_contribution:input.courseContribution,learning_unit_ids:input.learningUnitIds,topic_ids:input.topicIds,change_reason:input.changeReason};entries=[entry];return {entry,previous,idempotent:false};},
    courseTopics:async()=>[],
    appendTopicSnapshot:async()=>{throw new Error('no topics expected');},
    appendCourseSnapshot:async({snapshot})=>{const row={...snapshot,course_result_snapshot_id:'course-snapshot-2',essential_outcome_flags:snapshot.essential_outcome_flags||[]};courseSnapshots.push(row);return row;},
    appendAudit:async(audit)=>{audits.push(audit);return audit;},
  };
  const service=makeService(repository);
  const out=await service.recalculateAfterItemInvalidation({id:'student-1'},'result-1',{packageItemId:'item-bad',idempotencyKey:'reflow-1'});
  assert.equal(out.changed,true);
  assert.deepEqual(out.rawMarks,{earned:16,max:20,percentage:80});
  assert.equal(out.invalidationReweightFactor,2);
  assert.deepEqual(out.invalidatedItemIds,['item-bad']);
  assert.equal(entries[0].raw_percentage,80);
  assert.equal(entries[0].learning_unit_ids.length,1);
  assert.equal(entries[0].learning_unit_ids[0],'lu-1');
  assert.equal(audits.length,1);
  assert.deepEqual(audits[0].boundedReasonRefs,['invalidated-item:item-bad']);
  assert.equal(courseSnapshots.length,1);
  assert.equal(out.gradebook.downstreamHandoff.owner,'D21');
  assert.equal(out.gradebook.downstreamHandoff.gpaMutationByD20,false);

  const repeat=await service.recalculateAfterItemInvalidation({id:'student-1'},'result-1',{packageItemId:'item-bad',idempotencyKey:'reflow-1'});
  assert.equal(repeat.changed,false);
  assert.equal(repeat.idempotent,true);
  assert.equal(audits.length,1);
});

test('invalidation reflow refuses retired/non-invalidated items',async()=>{
  const result={assessment_result_id:'result-1',assessment_attempt_id:'attempt-1',marking_state:'PROVISIONAL',raw_percentage:50};
  const repository={loadMarkingBundle:async()=>({policy:policyRow(),items:[{package_item_id:'retired',item_state:'RETIRED_AS_CLEAN_EVIDENCE',intended_marks:10}]}),resultById:async()=>result};
  const service=makeService(repository);
  await assert.rejects(()=>service.recalculateAfterItemInvalidation({id:'student-1'},'result-1',{packageItemId:'retired'}),error=>error.code==='TEACHING_D20_ITEM_NOT_INVALIDATED');
});
