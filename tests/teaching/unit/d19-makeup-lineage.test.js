'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createD19AssessmentTypeService}=require('../../../teaching/d19/service');

const impromptuPolicy={policy_version:'impromptu-budget.v1',decision:{maximum_graded_impromptu_per_completed_classes:{count:1,window:3},consecutive_scheduled_classes_allowed:false,maximum_class_time_ratio:0.20,default_course_grade_weight_cap:0.10,eligible_content_only:true,academic_trigger_required:true,package_must_be_ready_and_validated_before_class:true}};
const eligibilityPolicy={policy_version:'assessment-eligibility-exceptions.v1',decision:{graded_content_must_be:['TAUGHT','VALIDATED_PRIOR_KNOWLEDGE'],explicit_prerequisite_must_be_validated_before_graded_use:true}};
const policy={getTeachingDecision(id){if(id==='TCH-0079')return structuredClone(impromptuPolicy);if(id==='TCH-0694')return structuredClone(eligibilityPolicy);throw new Error(id);}};
const source={assessment_id:'a1',course_id:'c1',assessment_type:'SCHEDULED_TEST',purpose:'Unit test',title:'Unit 2',graded:true,policy_version:'v1'};
const makeBlueprint=(id,version)=>({assessment_blueprint_id:id,assessment_id:'a1',version_no:version,lane:'ELIGIBLE_CANDIDATE',blueprint_payload:{slots:[{slot_id:'s1',learning_unit_ids:['lu-1'],intended_marks:20,response_family:'CONSTRUCTED'}]},total_marks:20,duration_minutes:30,timer_model:'OVERALL',response_form_architecture:{mode:'constructed_only'},resource_policy:{},accommodation_policy:{},single_mode_justification:null});

function makeD17(capture,{idempotent=false,priorLineage=null}={}){
  return {
    async createDefinition(_user,input){capture.definition=input;return {assessment:{assessment_id:'m1',course_id:'c1',assessment_type:'MAKE_UP',source_lineage:priorLineage||input.sourceLineage},idempotent};},
    async prepareBlueprint(_user,_assessmentId,input){capture.blueprint=input;return {blueprint:{assessment_blueprint_id:'mb1'},idempotent};},
  };
}

test('D19 Make-Up reuses the Blueprint bound to the historical Package instead of a later Blueprint revision',async()=>{
  const b1=makeBlueprint('b1',1),b2=makeBlueprint('b2',2),capture={};let latestBlueprintCalls=0;
  const repo={
    async requireAssessment(){return source;},
    async latestPackage(){return {assessment_package_id:'p1',assessment_id:'a1',assessment_blueprint_id:'b1',version_no:1,package_state:'LOCKED'};},
    async blueprint(_studentId,id){assert.equal(id,'b1');return b1;},
    async latestBlueprint(){latestBlueprintCalls+=1;return b2;},
  };
  const svc=createD19AssessmentTypeService({d17Service:makeD17(capture),d17Repository:repo,policy});
  const result=await svc.createMakeUp({id:'u'},'a1',{authorityRef:'attendance:r1',reason:'APPROVED_MISSED'});
  assert.equal(latestBlueprintCalls,0);
  assert.equal(result.sourceBlueprintId,'b1');
  assert.equal(result.sourcePackageId,'p1');
  assert.equal(result.sourceLineageBasis,'LATEST_HISTORICAL_PACKAGE');
  assert.equal(capture.definition.sourceLineage.d19_measurement.source_blueprint_id,'b1');
  assert.equal(capture.definition.sourceLineage.d19_measurement.source_package_id,'p1');
  assert.equal(capture.blueprint.sourceStateVersions.source_blueprint_id,'b1');
  assert.equal(capture.blueprint.blueprint.slots[0].slot_id,'s1');
});

test('D19 Make-Up can bind an exact historical Attempt and rejects a conflicting Package selector',async()=>{
  const b1=makeBlueprint('b1',1),capture={};
  const repo={
    async requireAssessment(){return source;},
    async requireAttempt(){return {assessment_attempt_id:'t1',assessment_id:'a1',assessment_package_id:'p1',state_version:4};},
    async packageById(_studentId,id){assert.equal(id,'p1');return {assessment_package_id:'p1',assessment_id:'a1',assessment_blueprint_id:'b1',version_no:1,package_state:'LOCKED'};},
    async blueprint(){return b1;},
  };
  const svc=createD19AssessmentTypeService({d17Service:makeD17(capture),d17Repository:repo,policy});
  const result=await svc.createMakeUp({id:'u'},'a1',{authorityRef:'system:incident-1',reason:'SYSTEM_PROTECTED',sourceAttemptId:'t1'});
  assert.equal(result.sourceAttemptId,'t1');
  assert.equal(result.sourcePackageId,'p1');
  assert.equal(result.sourceLineageBasis,'ATTEMPT_PACKAGE');
  assert.equal(capture.blueprint.sourceStateVersions.source_attempt_id,'t1');
  await assert.rejects(()=>svc.createMakeUp({id:'u'},'a1',{authorityRef:'system:incident-1',reason:'SYSTEM_PROTECTED',sourceAttemptId:'t1',sourcePackageId:'p2'}),e=>e.code==='TEACHING_D19_MAKE_UP_PACKAGE_MISMATCH');
});

test('D19 invalidated/system-protected replacement fails closed without exact historical Attempt or Package lineage',async()=>{
  const repo={async requireAssessment(){return source;}};
  const svc=createD19AssessmentTypeService({d17Service:makeD17({}),d17Repository:repo,policy});
  await assert.rejects(()=>svc.createMakeUp({id:'u'},'a1',{authorityRef:'integrity:i1',reason:'INVALIDATED'}),e=>e.code==='TEACHING_D19_MAKE_UP_HISTORY_REFERENCE_REQUIRED');
});

test('D19 never-packaged approved miss falls back to the current intended Blueprint',async()=>{
  const b2=makeBlueprint('b2',2),capture={};
  const repo={async requireAssessment(){return source;},async latestPackage(){return null;},async latestBlueprint(){return b2;}};
  const svc=createD19AssessmentTypeService({d17Service:makeD17(capture),d17Repository:repo,policy});
  const result=await svc.createMakeUp({id:'u'},'a1',{authorityRef:'attendance:r2',reason:'APPROVED_MISSED'});
  assert.equal(result.sourceBlueprintId,'b2');
  assert.equal(result.sourcePackageId,null);
  assert.equal(result.sourceLineageBasis,'CURRENT_INTENDED_BLUEPRINT');
});

test('D19 Make-Up idempotency cannot silently rebind an existing replacement to different historical lineage',async()=>{
  const b2=makeBlueprint('b2',2),capture={};
  const priorLineage={d19_measurement:{source_blueprint_id:'b1',source_authority_ref:'attendance:r1',source_package_id:'p1'}};
  const repo={
    async requireAssessment(){return source;},
    async latestPackage(){return {assessment_package_id:'p2',assessment_id:'a1',assessment_blueprint_id:'b2',version_no:2,package_state:'LOCKED'};},
    async blueprint(){return b2;},
  };
  const svc=createD19AssessmentTypeService({d17Service:makeD17(capture,{idempotent:true,priorLineage}),d17Repository:repo,policy});
  await assert.rejects(()=>svc.createMakeUp({id:'u'},'a1',{authorityRef:'attendance:r1',reason:'APPROVED_MISSED',idempotencyKey:'same-key'}),e=>e.code==='TEACHING_D19_MAKE_UP_IDEMPOTENCY_CONFLICT');
});
