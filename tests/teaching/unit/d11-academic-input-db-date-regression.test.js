'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeD11AcademicInput,lessonPlanRequest}=require('../../../teaching/d11/intelligence');
const {serializeAcademicInput}=require('../../../teaching/prompt-runtime/academic-input');

test('D11 treats PostgreSQL timestamptz values as ISO academic facts without relaxing the shared serializer',()=>{
  const when=new Date('2026-10-10T13:30:00.000Z');
  const modelRecord={
    class:{scheduled_start_at:when,scheduled_end_at:new Date('2026-10-10T15:30:00Z')},
    provenance:[{created_at:when,optional:undefined}],
    nested:{sample:[{at:when}]},
  };
  assert.throws(()=>serializeAcademicInput(modelRecord),{code:'TEACHING_ACADEMIC_INPUT_INVALID'});
  const normalized=normalizeD11AcademicInput(modelRecord);
  assert.equal(normalized.class.scheduled_start_at,when.toISOString());
  assert.equal(normalized.provenance[0].created_at,when.toISOString());
  assert.equal(Object.hasOwn(normalized.provenance[0],'optional'),false);
  assert.equal(normalized.nested.sample[0].at,when.toISOString());
  assert.ok(serializeAcademicInput(normalized).includes('2026-10-10T13:30:00.000Z'));
  assert.equal(modelRecord.class.scheduled_start_at,when);
});
test('D11 normalizer does not accept arbitrary objects, circular data, sparse arrays or custom getters',()=>{
  for(const value of [new Map(),new Set(),Buffer.from('x'),Object.create({unexpected:true})]){
    assert.throws(()=>normalizeD11AcademicInput({unsafe:value}),{code:'TEACHING_D11_ACADEMIC_INPUT_UNSERIALIZABLE'});
  }
  const cyclic={};cyclic.self=cyclic;
  assert.throws(()=>normalizeD11AcademicInput(cyclic),{code:'TEACHING_D11_ACADEMIC_INPUT_UNSERIALIZABLE'});
  const sparse=[];sparse[2]='x';
  assert.throws(()=>normalizeD11AcademicInput({sparse}),{code:'TEACHING_D11_ACADEMIC_INPUT_UNSERIALIZABLE'});
  const invalid=new Date('invalid');
  assert.throws(()=>normalizeD11AcademicInput({when:invalid}),{code:'TEACHING_D11_ACADEMIC_INPUT_UNSERIALIZABLE'});
  const accessor={};Object.defineProperty(accessor,'secret',{enumerable:true,get(){throw Error('getter executed');}});
  assert.throws(()=>normalizeD11AcademicInput({accessor}),{code:'TEACHING_D11_ACADEMIC_INPUT_UNSERIALIZABLE'});
});
test('D11 real pre-Class request serializes dates from Class and prior Teacher/provenance and retains version controls',()=>{
  const start=new Date('2026-10-10T13:30:00.000Z');
  const context={
    classRow:{student_id:'student-1',class_id:'class-1',course_id:'course-1',course_lifecycle_state:'ACTIVE',
      course_state_version:5,scheduled_start_at:start,scheduled_end_at:new Date('2026-10-10T15:30:00Z'),timezone:'UTC',schedule_version:10},
    plan:{course_plan_id:'plan-1',version_no:3},
    learningUnits:[{learning_unit_id:'unit-1',title:'Motion',intended_competence:'Explain Newtonian motion',criticality:'HIGH',foundational:true,exit_conditions:{},metadata:{}}],
    learningUnitDependencies:[],planPrerequisites:[],session:null,
  };
  const signals={
    priorClassFacts:[{closure_fact_id:'closure-1',class_id:'prior-class',fact_pack:{facts:[]},closed_at:new Date('2026-10-08T05:20:00Z')}],
    teacherNotes:[{teacher_note_id:'teacher-1',class_id:'prior-class',note_state:'ACTIVE',note_payload:{summary:'Prior work'},provenance_refs:[]}],
    governedRequestSignals:[{effective_at:new Date('2026-10-09T10:00:00Z')}],
    diagnosticSignals:[{created_at:new Date('2026-10-01T08:00:00Z')}],
    validatedPriorKnowledgeSignals:[],
    pacingSignals:{source_owner:'Scheduler/Calendar',scheduleDebtEntries:[{recorded_at:new Date('2026-10-09T11:00:00Z')}]},
    workSignals:{status:'OWNER_PENDING_D16'},knowledgeModelSignals:{status:'EMPTY'},
  };
  const request=lessonPlanRequest({context,signals,requestKey:'unique-request'});
  assert.equal(request.idempotencyKey,'unique-request');
  assert.equal(request.stateReference.aggregate_type,'teaching_class_controller');
  assert.equal(request.preconditions.class_schedule_version,'10');
  assert.equal(request.academicInput.class.scheduled_start_at,start.toISOString());
  assert.equal(request.academicInput.prior_class_facts[0].closed_at,'2026-10-08T05:20:00.000Z');
  const json=serializeAcademicInput(request.academicInput);
  assert.ok(json.includes('"learning_unit_id":"unit-1"'));
  assert.ok(json.includes('"closed_at":"2026-10-08T05:20:00.000Z"'));
  assert.ok(json.includes('"recorded_at":"2026-10-09T11:00:00.000Z"'));
});
