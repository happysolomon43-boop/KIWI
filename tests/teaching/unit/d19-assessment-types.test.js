'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  D19_CONTRACT_VERSION,TYPE_PROFILES,normalizeDefinition,sanitizeAnnouncedScope,assertEligibility,
  assertIntegratedLineage,cumulativeCoverageAudit,assertCumulativeCoverage,assertImpromptuBudget,
  classTimeContract,missedDisposition,makeUpLineage,blueprintInputFromRow,markReviewHandoff,retentionEvidenceHandoff,
}=require('../../../teaching/d19/contracts');
const {createD19AssessmentTypeService}=require('../../../teaching/d19/service');

const impromptuPolicy={policy_version:'impromptu-budget.v1',decision:{maximum_graded_impromptu_per_completed_classes:{count:1,window:3},consecutive_scheduled_classes_allowed:false,maximum_class_time_ratio:0.20,default_course_grade_weight_cap:0.10,eligible_content_only:true,academic_trigger_required:true,package_must_be_ready_and_validated_before_class:true}};
const eligibilityPolicy={policy_version:'assessment-eligibility-exceptions.v1',decision:{graded_content_must_be:['TAUGHT','VALIDATED_PRIOR_KNOWLEDGE'],explicit_prerequisite_must_be_validated_before_graded_use:true}};
const policy={getTeachingDecision(id){if(id==='TCH-0079')return structuredClone(impromptuPolicy);if(id==='TCH-0694')return structuredClone(eligibilityPolicy);throw new Error(id);}};
const eligible=[{learning_unit_id:'lu-1',eligibility_basis:'TAUGHT'},{learning_unit_id:'lu-2',eligibility_basis:'VALIDATED_PRIOR_KNOWLEDGE'},{learning_unit_id:'lu-3',eligibility_basis:'TAUGHT'}];
const bp=(slots)=>({assessment_blueprint_id:'bp-1',version_no:1,blueprint_payload:{slots},duration_minutes:20,total_marks:20,response_form_architecture:{mode:'mixed'},timer_model:'OVERALL',resource_policy:{},accommodation_policy:{},source_state_versions:{}});

function slot(id,ids,marks=10,extra={}){return {slot_id:id,learning_unit_ids:ids,intended_marks:marks,response_family:extra.response_family||'CONSTRUCTED',rubric_contract:extra.rubric_contract||null,measurement_demand:extra.measurement_demand||{}};}

test('D19 defines all existing D17 Assessment types without inventing Impromptu Exam',()=>{
  assert.deepEqual(Object.keys(TYPE_PROFILES).sort(),['CLASSWORK','DIAGNOSTIC','FINAL_EXAMINATION','IMPROMPTU_TEST','MAKE_UP','MID_SEMESTER','RESIT','SCHEDULED_TEST','VERIFICATION'].sort());
  assert.equal(TYPE_PROFILES.IMPROMPTU_EXAM,undefined);
});

test('D19 Diagnostic is structurally non-graded and cannot be retroactively manufactured into Gradebook truth',()=>{
  assert.throws(()=>normalizeDefinition({courseId:'c',assessmentType:'DIAGNOSTIC',graded:true},{impromptuPolicy,eligibilityPolicy}),e=>e.code==='TEACHING_D19_DIAGNOSTIC_GRADED_PROHIBITED');
  const d=normalizeDefinition({courseId:'c',assessmentType:'DIAGNOSTIC',graded:false,title:'Diagnostic'},{impromptuPolicy,eligibilityPolicy});
  assert.equal(d.measurement.gradebook_posture,'PROHIBITED');assert.equal(d.measurement.d20_official_marks_owner,true);
});

test('D19 formal Scheduled Test, Mid-Semester and Final require declared graded posture',()=>{
  for(const type of ['SCHEDULED_TEST','MID_SEMESTER','FINAL_EXAMINATION'])assert.throws(()=>normalizeDefinition({courseId:'c',assessmentType:type,graded:false},{impromptuPolicy,eligibilityPolicy}),e=>e.code===`TEACHING_D19_${type}_MUST_BE_GRADED`);
});

test('D19 Classwork requires an authoritative Class and can remain ungraded or be declared graded',()=>{
  assert.throws(()=>normalizeDefinition({courseId:'c',assessmentType:'CLASSWORK',graded:true},{impromptuPolicy,eligibilityPolicy}),e=>e.code==='TEACHING_D19_CLASSWORK_CLASS_REQUIRED');
  const c=normalizeDefinition({courseId:'c',assessmentType:'CLASSWORK',graded:true,intendedClassId:'class-1'},{impromptuPolicy,eligibilityPolicy});
  assert.equal(c.measurement.scope_mode,'RECENT_TAUGHT');assert.equal(c.measurement.locked_standard_after_start,true);
});

test('D19 student-facing scope rejects protected question, answer, rubric and Blueprint leakage',()=>{
  assert.throws(()=>sanitizeAnnouncedScope('SCHEDULED_TEST',{scope_kind:'Unit 2',questions:['secret']}),e=>e.code==='TEACHING_D19_SCOPE_PROTECTED_CONTENT');
  const safe=sanitizeAnnouncedScope('SCHEDULED_TEST',{scope_kind:'Topics 1-2'});assert.equal(safe.exact_questions_hidden,true);assert.equal(safe.hidden_blueprint_exposed,false);
});

test('D19 Impromptu scope is hidden before exposure regardless of supplied public prose',()=>{
  const scope=sanitizeAnnouncedScope('IMPROMPTU_TEST',{scope_kind:'Do not leak this timing'});assert.deepEqual(scope,{visibility:'HIDDEN_UNTIL_EXPOSURE',scope_kind:'PREVIOUSLY_TAUGHT_OR_VALIDATED',exact_questions_hidden:true,hidden_blueprint_exposed:false});
});

test('D19 first-release graded eligibility rejects merely assumed prerequisites while Diagnostic may probe',()=>{
  const blueprint=bp([slot('s1',['lu-x'],20)]),rows=[{learning_unit_id:'lu-x',eligibility_basis:'EXPLICIT_ASSUMED_PREREQUISITE'}];
  assert.throws(()=>assertEligibility({assessment:{assessment_type:'SCHEDULED_TEST',graded:true},blueprint,eligibilityRows:rows}),e=>e.code==='TEACHING_D19_FORMAL_SCOPE_INELIGIBLE');
  assert.equal(assertEligibility({assessment:{assessment_type:'DIAGNOSTIC',graded:false},blueprint,eligibilityRows:[]}).diagnosticProbe,true);
});

test('D19 integrated questions require decomposable Learning Unit lineage',()=>{
  const missing=bp([slot('s1',['lu-1','lu-2'],20)]);assert.throws(()=>assertIntegratedLineage(missing),e=>e.code==='TEACHING_D19_INTEGRATED_LINEAGE_REQUIRED');
  const good=bp([slot('s1',['lu-1','lu-2'],20,{rubric_contract:{criteria:[{marks:10,learning_unit_ids:['lu-1']},{marks:10,learning_unit_ids:['lu-2']}]}})]);assert.equal(assertIntegratedLineage(good),true);
});

test('D19 cumulative coverage audit catches conversational/recency-only selection',()=>{
  const blueprint=bp([slot('s1',['lu-3'],20)]),plan=[{learning_unit_id:'lu-1',topic_id:'t1',criticality:'FOUNDATIONAL'},{learning_unit_id:'lu-2',topic_id:'t1',criticality:'HIGH'},{learning_unit_id:'lu-3',topic_id:'t2',criticality:'LOW'}];
  const audit=cumulativeCoverageAudit({assessmentType:'MID_SEMESTER',blueprint,eligibilityRows:eligible,planLearningUnits:plan,recentLearningUnitIds:['lu-3']});assert.equal(audit.pass,false);assert.ok(audit.findings.includes('RECENCY_ONLY_SELECTION'));assert.ok(audit.findings.includes('NO_HIGH_OR_FOUNDATIONAL_REPRESENTATION'));
  assert.throws(()=>assertCumulativeCoverage({assessmentType:'MID_SEMESTER',blueprint,eligibilityRows:eligible,planLearningUnits:plan,recentLearningUnitIds:['lu-3']}),e=>e.code==='TEACHING_D19_CUMULATIVE_COVERAGE_INVALID');
});

test('D19 Final strategic coverage requires more than one topic when eligible Course scope spans topics',()=>{
  const blueprint=bp([slot('s1',['lu-1','lu-2'],20,{measurement_demand:{learning_unit_lineage:['lu-1','lu-2']}})]),plan=[{learning_unit_id:'lu-1',topic_id:'t1',criticality:'FOUNDATIONAL'},{learning_unit_id:'lu-2',topic_id:'t1',criticality:'HIGH'},{learning_unit_id:'lu-3',topic_id:'t2',criticality:'MEDIUM'}];
  const audit=cumulativeCoverageAudit({assessmentType:'FINAL_EXAMINATION',blueprint,eligibilityRows:eligible,planLearningUnits:plan,recentLearningUnitIds:[]});assert.ok(audit.findings.includes('FINAL_TOPIC_REPRESENTATION_TOO_NARROW'));
});

test('D19 Impromptu trigger must be legitimate and uses the configured D06 frequency budget',()=>{
  const classes=[1,2,3,4].map(n=>({class_id:`c${n}`,scheduled_start_at:`2026-10-0${n}T10:00:00Z`,scheduled_end_at:`2026-10-0${n}T11:00:00Z`,completed:n<4}));
  assert.throws(()=>assertImpromptuBudget({policyDecision:impromptuPolicy.decision,classes,priorAssessments:[],targetClassId:'c4',trigger:'MODEL_FELT_LIKE_IT',graded:true}),e=>e.code==='TEACHING_D19_IMPROMPTU_TRIGGER_INVALID');
  const prior=[{assessment_type:'IMPROMPTU_TEST',graded:true,source_lineage:{d19_measurement:{intended_class_id:'c2'}}}];
  assert.throws(()=>assertImpromptuBudget({policyDecision:impromptuPolicy.decision,classes,priorAssessments:prior,targetClassId:'c4',trigger:'DELAYED_RETENTION_VERIFICATION',graded:true}),e=>e.code==='TEACHING_D19_IMPROMPTU_FREQUENCY_EXHAUSTED');
});

test('D19 Impromptu assessment cannot consume more than the configured Class-time ratio',()=>{
  const classes=[{class_id:'c1',scheduled_start_at:'2026-10-02T10:00:00Z',scheduled_end_at:'2026-10-02T11:00:00Z',completed:false}];
  assert.throws(()=>assertImpromptuBudget({policyDecision:impromptuPolicy.decision,classes,priorAssessments:[],targetClassId:'c1',durationMinutes:13,trigger:'PLANNED_GOVERNED_SURPRISE',graded:false}),e=>e.code==='TEACHING_D19_IMPROMPTU_CLASS_TIME_BUDGET_EXCEEDED');
  assert.equal(assertImpromptuBudget({policyDecision:impromptuPolicy.decision,classes,priorAssessments:[],targetClassId:'c1',durationMinutes:12,trigger:'PLANNED_GOVERNED_SURPRISE',graded:false}).classTimeRatioCap,0.2);
});

test('D19 active surprise takeover consumes existing Class time with zero schedule extension',()=>{
  const c=classTimeContract({classRow:{scheduled_end_at:'2026-10-02T11:00:00Z'},session:{lifecycle_state:'ACTIVE',instructional_substate:'ASSESSMENT'},durationMinutes:12,serverNow:new Date('2026-10-02T10:40:00Z')});
  assert.equal(c.scheduleExtensionMinutes,0);assert.equal(c.remainingAfterAssessmentMinutes,8);assert.equal(c.controllerReplanRequired,true);
  assert.throws(()=>classTimeContract({classRow:{scheduled_end_at:'2026-10-02T11:00:00Z'},session:{lifecycle_state:'ACTIVE',instructional_substate:'ASSESSMENT'},durationMinutes:12,serverNow:new Date('2026-10-02T10:50:00Z')}),e=>e.code==='TEACHING_D19_IMPROMPTU_REMAINING_TIME_INSUFFICIENT');
});

test('D19 missed-work outcomes keep not-attempted, invalidated, system-protected and valid failure concepts separate',()=>{
  assert.deepEqual(missedDisposition({assessmentType:'FINAL_EXAMINATION',graded:true,reason:'APPROVED_MISSED'}),{historyState:'INCOMPLETE',academicFailure:false,nextAction:'MAKE_UP_OR_INCOMPLETE'});
  assert.equal(missedDisposition({assessmentType:'SCHEDULED_TEST',graded:true,reason:'INVALIDATED'}).historyState,'INVALIDATED');
  assert.equal(missedDisposition({assessmentType:'CLASSWORK',graded:true,reason:'SYSTEM_PROTECTED'}).historyState,'SYSTEM_PROTECTED');
  assert.equal(missedDisposition({assessmentType:'SCHEDULED_TEST',graded:true,reason:'UNEXCUSED'}).historyState,'NOT_ATTEMPTED_UNRESOLVED');
});

test('D19 Make-Up lineage binds same intended Blueprint and forbids exposed candidate reuse',()=>{
  const line=makeUpLineage({sourceAssessment:{assessment_id:'a1',assessment_type:'SCHEDULED_TEST'},sourceBlueprint:{assessment_blueprint_id:'b1',version_no:3},authorityRef:'attendance:r1',reason:'APPROVED_MISSED'}).d19_measurement;
  assert.equal(line.source_blueprint_id,'b1');assert.equal(line.source_blueprint_version,3);assert.equal(line.fresh_candidate_generation_required,true);assert.equal(line.source_candidate_reuse_forbidden,true);assert.equal(line.source_answers_release,'BLOCKED_WHILE_REPLACEMENT_LIVE');
});

test('D19 Make-Up Blueprint cloning copies intended architecture but no candidate/question content',()=>{
  const source={assessment_blueprint_id:'b1',version_no:2,blueprint_payload:{slots:[slot('s1',['lu-1'],20)]},total_marks:20,duration_minutes:30,timer_model:'OVERALL',response_form_architecture:{mode:'constructed_only'},resource_policy:{calculator:false},accommodation_policy:{extra_time_percent:0},single_mode_justification:null};
  const clone=blueprintInputFromRow(source);assert.equal(clone.totalMarks,20);assert.equal(clone.slots[0].slot_id,'s1');assert.equal('candidate_version_id' in clone.slots[0],false);assert.equal('public_item_payload' in clone.slots[0],false);
});

test('D19 TCH-0394 mark/review boundary hands finalized Attempt to D20 without creating a mark',()=>{
  const h=markReviewHandoff({assessment:{assessment_id:'a',assessment_type:'FINAL_EXAMINATION'},attempt:{assessment_attempt_id:'t'}});assert.equal(h.owner,'D20');assert.equal(h.officialMark,null);assert.equal(h.gradebookMutation,false);assert.equal(h.d19MayMark,false);
});

test('D19 poor Impromptu performance can become a D13 retention-evidence candidate but cannot mutate SKM or Progression directly',()=>{
  const h=retentionEvidenceHandoff({assessment:{assessment_id:'a',assessment_type:'IMPROMPTU_TEST'},attemptId:'t',resultRef:'d20-result:r'});assert.equal(h.owner,'D13');assert.equal(h.directSkmMutation,false);assert.equal(h.progressionDecision,false);assert.equal(h.oneWeakResultErasesHistory,false);
});

test('D19 service hides future Impromptu Assessments from student list projections',async()=>{
  const future='2099-01-01T11:00:00Z';
  const base={createDefinition(){},async list(){return [
    {assessment_id:'i',assessment_type:'IMPROMPTU_TEST',source_lineage:{d19_measurement:{intended_class_scheduled_end_at:future}}},
    {assessment_id:'s',assessment_type:'SCHEDULED_TEST'},
  ];}};
  const repo={requireAssessment(){},currentEligibility(){},latestBlueprint(){}};
  const svc=createD19AssessmentTypeService({d17Service:base,d17Repository:repo,policy,clock:()=>new Date('2026-10-02T10:00:00Z')});
  assert.deepEqual((await svc.list({id:'u'})).map(x=>x.assessment_id),['s']);
});

test('D19 service creates Make-Up idempotently from source Assessment/Blueprint without copying candidates',async()=>{
  const source={assessment_id:'a1',course_id:'c1',assessment_type:'SCHEDULED_TEST',purpose:'Unit test',title:'Unit 2',graded:true,policy_version:'v1'};
  const sourceBp={assessment_blueprint_id:'b1',version_no:1,blueprint_payload:{slots:[slot('s1',['lu-1'],20)]},total_marks:20,duration_minutes:30,timer_model:'OVERALL',response_form_architecture:{mode:'constructed_only'},resource_policy:{},accommodation_policy:{},single_mode_justification:null};
  let definitionInput=null,blueprintInput=null;
  const d17={createDefinition:async(_u,input)=>{definitionInput=input;return {assessment:{assessment_id:'m1',course_id:'c1',assessment_type:'MAKE_UP'},idempotent:false};},prepareBlueprint:async(_u,_id,input)=>{blueprintInput=input;return {blueprint:{assessment_blueprint_id:'mb1'},idempotent:false};}};
  const repo={async requireAssessment(){return source;},async latestBlueprint(){return sourceBp;}};
  const svc=createD19AssessmentTypeService({d17Service:d17,d17Repository:repo,policy});
  const result=await svc.createMakeUp({id:'u'},'a1',{authorityRef:'attendance:r1',reason:'APPROVED_MISSED'});
  assert.equal(result.freshCandidateGenerationRequired,true);assert.equal(definitionInput.assessmentType,'MAKE_UP');assert.equal(definitionInput.sourceLineage.d19_measurement.source_assessment_id,'a1');assert.equal(blueprintInput.blueprint.slots[0].slot_id,'s1');assert.equal('candidate' in blueprintInput.blueprint,false);
});

test('D19 contract version remains provider/model independent and D30-held',()=>{assert.equal(D19_CONTRACT_VERSION,'d19.measurement.v1');assert.equal('model' in TYPE_PROFILES.FINAL_EXAMINATION,false);assert.equal('provider' in TYPE_PROFILES.FINAL_EXAMINATION,false);});
