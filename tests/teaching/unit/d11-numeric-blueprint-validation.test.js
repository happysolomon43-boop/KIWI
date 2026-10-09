'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  validateLessonBlueprintProposal,
  reserveBounds
}=require('../../../teaching/d11/contracts');
const {
  lessonPlanRequest,
  lessonBlueprintTimeBudget
}=require('../../../teaching/d11/intelligence');
const {validateModelOutput}=require('../../../teaching/ai/output-validation');
const {D11_BLUEPRINT_OUTPUT_FORMAT}=require('../../../teaching/d11/blueprint-output-contract');

function contextFor(start,end){
  return {
    classRow:{class_id:'class-phy101',student_id:'student-1',course_id:'phy101',
      course_lifecycle_state:'ACTIVE',scheduled_start_at:start,scheduled_end_at:end,
      timezone:'Africa/Lagos',schedule_version:27,source_timetable_version_id:'v27'},
    plan:{course_plan_id:'plan-1',version_no:3},
    learningUnits:[{learning_unit_id:'kinematics',title:'Kinematics'}],
    learningUnitDependencies:[],planPrerequisites:[]
  };
}
const late=contextFor('2026-10-09T00:27:00Z','2026-10-09T01:00:00Z');
const window={learningUnits:late.learningUnits,scheduledStartAt:late.classRow.scheduled_start_at,
  scheduledEndAt:late.classRow.scheduled_end_at};
function proposal(){
  return {
    status:'OK',review_required:false,review_reasons:[],
    objectives:[{id:'o1',learning_unit_ref:'kinematics',label:'Measure displacement',
      criticality:'CORE',minimum_safe_minutes:5,prerequisite_refs:[],evidence_descriptor_targets:[]}],
    segments:[{id:'s1',kind:'INSTRUCTION',objective_refs:['o1'],
      planned_minutes:24,minimum_safe_minutes:10,criticality:'CORE',optional:false,
      learning_evidence_descriptor:null,assistance_level:'NONE'}],
    adaptive_reserve_minutes:5,
    stopping_conditions:[],prerequisite_checks:[],likely_misconceptions:[],
    examples:[],guided_work:[],independent_evidence_opportunities:[],
    remediation_branches:[],homework_candidates:[],unresolved_items:[]
  };
}

test('Real late PHY101 time budget is an explicit finite JSON-integer contract',()=>{
  const t=lessonBlueprintTimeBudget(late);
  assert.equal(t.scheduled_minutes,33);
  assert.equal(t.adaptive_reserve_min_minutes,4);
  assert.equal(t.adaptive_reserve_target_minutes,5);
  assert.equal(t.adaptive_reserve_max_minutes,5);
  assert.equal(t.maximum_segment_minutes_total,29);
  assert.deepEqual(reserveBounds(33),{...reserveBounds(33)});
  assert.match(t.arithmetic_rule,/JSON integer numbers/);
  assert.match(D11_BLUEPRINT_OUTPUT_FORMAT.time_rules,/reduced time budget/);
  assert.equal(validateLessonBlueprintProposal(proposal(),window).ok,true);
  const req=lessonPlanRequest({context:late,signals:{},requestKey:'recovery-phy101'});
  assert.deepEqual(req.academicInput.lesson_time_budget,t);
  assert.equal(req.academicInput.class.scheduled_start_at,'2026-10-09T00:27:00Z');
  assert.equal(req.academicInput.class.scheduled_end_at,'2026-10-09T01:00:00Z');
  assert.equal(req.academicInput.lesson_time_budget.no_schedule_override,true);
});

test('Every genuine D11 numeric rejection carries only a STATIC allowlisted repair path',async()=>{
  const cases=[
    ['objective.minimum_safe_minutes',p=>p.objectives[0].minimum_safe_minutes='10-15'],
    ['segment.planned_minutes',p=>p.segments[0].planned_minutes='twenty-four minutes'],
    ['segment.minimum_safe_minutes',p=>p.segments[0].minimum_safe_minutes=11.5],
    ['adaptive_reserve_minutes',p=>p.adaptive_reserve_minutes='5 min'],
    ['adaptive_reserve_minutes',p=>p.adaptive_reserve_minutes=7],
  ];
  for(const [field,edit] of cases) {
    const bad=proposal();
    edit(bad);
    const validation=validateLessonBlueprintProposal(bad,window);
    assert.equal(validation.ok,false,field);
    assert.equal(validation.reason,'TEACHING_D11_NUMBER_INVALID',field);
    assert.equal(validation.fieldPath,field,field);
    assert.equal(JSON.stringify(validation).includes('twenty-four minutes'),false);
    const result=await validateModelOutput({
      output:bad,authorityLevel:'T3',
      schemaValidator:out=>validateLessonBlueprintProposal(out,window),
      domainValidator:async()=>({ok:true})
    });
    assert.equal(result.accepted,false,field);
    assert.equal(result.validationFailure.fieldPath,field);
    assert.equal(result.validationFailure.repairable,'MODEL_RETRY');
  }
});

test('A bounded model repair is given the precise field and same authoritative minute envelope',()=>{
  const request=lessonPlanRequest({context:late,signals:{},requestKey:'original'});
  const bad=proposal();bad.segments[0].planned_minutes='24 minutes';
  const failure=validateLessonBlueprintProposal(bad,window);
  const repair=lessonPlanRequest({context:late,signals:{},
    requestKey:'original:blueprint-schema-repair-1',
    repairFeedback:{reason:failure.reason,fieldPath:failure.fieldPath}});
  assert.deepEqual(repair.academicInput.lesson_time_budget,request.academicInput.lesson_time_budget);
  assert.equal(repair.academicInput.validation_repair.missing_field_path,'segment.planned_minutes');
  assert.equal(repair.academicInput.validation_repair.previous_validation_code,'TEACHING_D11_NUMBER_INVALID');
  assert.equal(repair.academicInput.validation_repair.attempt,1);
  assert.equal(repair.academicInput.validation_repair.directive.includes('ENTIRE required D11'),true);
  const fixed=proposal();
  assert.equal(validateLessonBlueprintProposal(fixed,window).ok,true);
});

test('Duration overflow, fabricated unit refs and unauthorized numeric changes remain rejected',()=>{
  const overflow=proposal();overflow.segments[0].planned_minutes=29;
  assert.equal(validateLessonBlueprintProposal(overflow,window).reason,'TEACHING_D11_BLUEPRINT_DURATION_OVERFLOW');
  const wrongUnit=proposal();wrongUnit.objectives[0].learning_unit_ref='fabricated-unit';
  assert.equal(validateLessonBlueprintProposal(wrongUnit,window).reason,'TEACHING_D11_BLUEPRINT_SCOPE_INVALID');
  const impossible=proposal();impossible.segments[0].minimum_safe_minutes=40;
  assert.equal(validateLessonBlueprintProposal(impossible,window).reason,'TEACHING_D11_NUMBER_INVALID');
  assert.throws(()=>lessonBlueprintTimeBudget(contextFor('2026-10-09T02:00:00Z','2026-10-09T01:00:00Z')),
    {code:'TEACHING_D11_CLASS_DURATION_INVALID'});
});
