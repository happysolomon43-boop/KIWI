'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  normalizeBlueprint,assertEligibleUnits,deterministicChoiceSet,finalizationReadiness,
  classifyClarification,attemptExpiry,packageHash,PROMPT_BINDINGS,
}=require('../../../teaching/d17/contracts');
const {CAPABILITIES,generationCapability}=require('../../../teaching/d17/intelligence');

const eligible=[{learning_unit_id:'lu-1',eligibility_basis:'TAUGHT',course_plan_id:'cp-1',coverage_version:4,owner_ref:'eligibility:e1',policy_version:'v1'}];

test('D17 keeps forecast scope separate from authoritative eligibility',()=>{
  assert.throws(()=>assertEligibleUnits(['lu-2'],eligible),e=>e.code==='TEACHING_D17_INELIGIBLE_SCOPE');
  assert.equal(assertEligibleUnits(['lu-1'],eligible).eligible,true);
});

test('D17 requires academic justification for single-mode major cumulative assessment',()=>{
  assert.throws(()=>normalizeBlueprint({assessmentType:'FINAL_EXAMINATION',lane:'ELIGIBLE_CANDIDATE',maturity:'PRE_LOCK_READY',totalMarks:100,durationMinutes:120,responseFormArchitecture:{mode:'mcq_only'},slots:[{slotId:'s1',learningUnitIds:['lu-1'],intendedMarks:100,responseFamily:'MCQ'}]}),e=>e.code==='TEACHING_D17_SINGLE_MODE_JUSTIFICATION_REQUIRED');
  const bp=normalizeBlueprint({assessmentType:'FINAL_EXAMINATION',lane:'ELIGIBLE_CANDIDATE',maturity:'PRE_LOCK_READY',totalMarks:100,durationMinutes:120,responseFormArchitecture:{mode:'mcq_only'},singleModeJustification:'The approved construct is objective recognition under strict timing.',slots:[{slotId:'s1',learningUnitIds:['lu-1'],intendedMarks:100,responseFamily:'MCQ'}]});
  assert.equal(bp.responseFormArchitecture.mode,'mcq_only');
});

test('D17 deterministic MCQ contract owns option count and stable IDs',()=>{
  const c=deterministicChoiceSet({slotId:'slot-a',optionCount:4});
  assert.deepEqual(c.stable_option_ids,['slot-a:opt:1','slot-a:opt:2','slot-a:opt:3','slot-a:opt:4']);
  assert.equal(c.model_may_change_option_count,false);
});

test('D17 finalization blocks when item pass exists but whole-package pass is absent',()=>{
  const blueprint={lane:'ELIGIBLE_CANDIDATE',maturity:'PRE_LOCK_READY'};
  const versions=[{candidate_version_id:'cv1',required_learning_unit_ids:['lu-1'],protection_state:'PROTECTED',candidate_state:'VALIDATED'}];
  const r=finalizationReadiness({blueprint,currentEligibilityRows:eligible,candidateVersions:versions,itemValidations:[{candidate_version_id:'cv1',outcome:'PASS'}],wholePackageValidation:null,contaminationEvents:[],sourceVersionsCurrent:true});
  assert.equal(r.ready,false);assert.ok(r.reasons.includes('WHOLE_PACKAGE_NOT_VALIDATED'));
});

test('D17 finalization fails closed on current-state eligibility loss',()=>{
  const r=finalizationReadiness({blueprint:{lane:'ELIGIBLE_CANDIDATE',maturity:'PRE_LOCK_READY'},currentEligibilityRows:[],candidateVersions:[{candidate_version_id:'cv1',required_learning_unit_ids:['lu-1'],protection_state:'PROTECTED',candidate_state:'VALIDATED'}],itemValidations:[{candidate_version_id:'cv1',outcome:'PASS'}],wholePackageValidation:{outcome:'PASS'},contaminationEvents:[],sourceVersionsCurrent:true});
  assert.equal(r.ready,false);assert.ok(r.reasons.includes('CURRENT_ELIGIBILITY_FAILED'));
});

test('D17 clarification gate deterministically blocks content help',()=>{
  assert.equal(classifyClarification('Which option is correct?'),'CONTENT_HELP_PROHIBITED');
  assert.equal(classifyClarification('Where do I submit this answer?'),'PROCEDURAL_CLARIFICATION');
});

test('D17 attempt expiry includes approved time accommodation without changing the standard',()=>{
  assert.equal(attemptExpiry('2026-10-02T10:00:00.000Z',60,25),'2026-10-02T11:15:00.000Z');
});

test('D17 frozen prompt bindings resolve current successor manifest versions',()=>{
  assert.deepEqual(PROMPT_BINDINGS.planning,{family:'TPF-12',version:'1.3'});
  assert.deepEqual(PROMPT_BINDINGS.generation,{family:'TPF-13',version:'1.3'});
  assert.deepEqual(PROMPT_BINDINGS.validation,{family:'TPF-14',version:'1.4'});
  assert.equal(generationCapability('FINAL_EXAMINATION'),CAPABILITIES.final);
});

test('D17 package hash is deterministic and content-addressed',()=>{
  const a=packageHash({blueprint:{assessment_blueprint_id:'b1',version_no:2,response_form_architecture:{mode:'mixed'},resource_policy:{notes:false},accommodation_policy:{}},items:[{ordinal:1,candidate_version_id:'cv1',item_hash:'abc'}],policySnapshot:{version:'v1'}});
  const b=packageHash({policySnapshot:{version:'v1'},items:[{item_hash:'abc',candidate_version_id:'cv1',ordinal:1}],blueprint:{accommodation_policy:{},resource_policy:{notes:false},response_form_architecture:{mode:'mixed'},version_no:2,assessment_blueprint_id:'b1'}});
  assert.equal(a,b);
});
