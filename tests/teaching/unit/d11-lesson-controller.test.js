'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const contracts=require('../../../teaching/d11/contracts');
const intelligence=require('../../../teaching/d11/intelligence');
const {scheduledEvent}=require('../../../teaching/d11/runtime');
const {getCapability}=require('../../../teaching/capability-registry');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');

function blueprint(overrides={}){
  return {
    status:'OK',
    review_required:false,
    review_reasons:[],
    objectives:[
      {id:'core-1',learning_unit_ref:'lu1',label:'Core objective',criticality:'CORE',minimum_safe_minutes:20,
        prerequisite_refs:[],evidence_descriptor_targets:['INDEPENDENT_FAMILIAR'],independent_evidence_required:true},
      {id:'sec-1',learning_unit_ref:'lu2',label:'Secondary objective',criticality:'SECONDARY',minimum_safe_minutes:5,
        prerequisite_refs:['lu1'],evidence_descriptor_targets:['GUIDED']},
      {id:'enr-1',learning_unit_ref:'lu2',label:'Enrichment objective',criticality:'ENRICHMENT',minimum_safe_minutes:0,
        prerequisite_refs:[],evidence_descriptor_targets:[]},
    ],
    segments:[
      {id:'seg-core',kind:'INSTRUCTION',objective_refs:['core-1'],planned_minutes:35,minimum_safe_minutes:20,
        criticality:'CORE',optional:false,learning_evidence_descriptor:'DEMONSTRATION',assistance_level:'NONE',
        representation:'worked example',stopping_condition:'core explanation complete'},
      {id:'seg-guided',kind:'GUIDED_PRACTICE',objective_refs:['core-1','sec-1'],planned_minutes:20,minimum_safe_minutes:5,
        criticality:'SECONDARY',optional:false,learning_evidence_descriptor:'GUIDED',assistance_level:'GUIDED',
        representation:'guided questions',stopping_condition:'guided evidence observed'},
      {id:'seg-enrich',kind:'ENRICHMENT',objective_refs:['enr-1'],planned_minutes:15,minimum_safe_minutes:0,
        criticality:'ENRICHMENT',optional:true,learning_evidence_descriptor:'INTEGRATION_TRANSFER',assistance_level:'NONE',
        representation:'extension',stopping_condition:'time permitting'},
    ],
    adaptive_reserve_minutes:10,
    stopping_conditions:['close when core evidence is sufficient'],
    prerequisite_checks:[],
    likely_misconceptions:[],
    examples:[],
    guided_work:[],
    independent_evidence_opportunities:[],
    remediation_branches:[],
    homework_candidates:[],
    unresolved_items:[],
    ...overrides,
  };
}
const validationContext={
  learningUnits:[{learning_unit_id:'lu1'},{learning_unit_id:'lu2'}],
  scheduledStartAt:'2026-10-01T10:00:00.000Z',
  scheduledEndAt:'2026-10-01T11:30:00.000Z',
};

test('D11 frozen Controller priority order is exact and deterministic',()=>{
  assert.deepEqual(contracts.PRIORITY_ORDER,[
    'CONCEPTUAL_CORRECTNESS','BLOCKING_PREREQUISITES','CORE_OBJECTIVES','INDEPENDENT_EVIDENCE',
    'TIMING','SECONDARY_OBJECTIVES','ENRICHMENT',
  ]);
});

test('D11 validates a structured Lesson Blueprint with explicit reserve and criticality',()=>{
  const result=contracts.validateLessonBlueprintProposal(blueprint(),validationContext);
  assert.equal(result.ok,true);
  assert.equal(result.value.scheduled_minutes,90);
  assert.equal(result.value.adaptive_reserve_minutes,10);
  assert.equal(result.value.objectives[0].criticality,'CORE');
  assert.equal(result.value.objectives[0].independent_evidence_required,true);
  assert.equal(result.value.descriptor_traversal_is_non_universal,true);
  assert.equal(result.value.assistance_is_separate_dimension,true);
});

test('D11 rejects 100-percent lesson allocation by requiring deterministic reserve',()=>{
  const noReserve=blueprint({adaptive_reserve_minutes:0});
  const result=contracts.validateLessonBlueprintProposal(noReserve,validationContext);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'TEACHING_D11_NUMBER_INVALID');
});

test('D11 rejects Blueprint duration overflow and infeasible minimum-safe load',()=>{
  const overflow=blueprint({segments:[
    {...blueprint().segments[0],planned_minutes:70,minimum_safe_minutes:65},
    {...blueprint().segments[1],planned_minutes:20},
    {...blueprint().segments[2],planned_minutes:10},
  ]});
  const result=contracts.validateLessonBlueprintProposal(overflow,validationContext);
  assert.equal(result.ok,false);
  assert.match(result.reason,/DURATION_OVERFLOW|MINIMUM_SAFE_LOAD/);
});

test('D11 rejects objective scope outside current Course Plan Learning Units',()=>{
  const bad=blueprint();
  bad.objectives[0]={...bad.objectives[0],learning_unit_ref:'lu-outside'};
  const result=contracts.validateLessonBlueprintProposal(bad,validationContext);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'TEACHING_D11_BLUEPRINT_SCOPE_INVALID');
});

test('D11 forbids CORE segments from becoming optional enrichment-like content',()=>{
  const bad=blueprint();
  bad.segments[0]={...bad.segments[0],optional:true};
  const result=contracts.validateLessonBlueprintProposal(bad,validationContext);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'TEACHING_D11_CORE_OPTIONAL_FORBIDDEN');
});

test('D11 Controller transition graph permits revisiting/remediation but blocks arbitrary jumps',()=>{
  assert.doesNotThrow(()=>contracts.assertTransitionAllowed({lifecycleState:'ACTIVE',fromState:'INSTRUCTION',toState:'REMEDIATION'}));
  assert.doesNotThrow(()=>contracts.assertTransitionAllowed({lifecycleState:'ACTIVE',fromState:'REMEDIATION',toState:'INSTRUCTION'}));
  assert.throws(()=>contracts.assertTransitionAllowed({lifecycleState:'ACTIVE',fromState:'OPENING',toState:'CLASSWORK'}),{code:'TEACHING_D11_TRANSITION_FORBIDDEN'});
  assert.throws(()=>contracts.assertTransitionAllowed({lifecycleState:'ACTIVE',fromState:'ASSESSMENT',toState:'BREAK'}),{code:'TEACHING_D11_TRANSITION_FORBIDDEN'});
});

test('D11 transition QA exhaustively accepts exactly the legal next-state set for every Controller state',()=>{
  const states=contracts.INSTRUCTIONAL_SUBSTATES;
  const resumeByState={BREAK:'INSTRUCTION',INTERRUPTED:'GUIDED_PRACTICE'};
  for(const fromState of states){
    const lifecycleState=fromState==='CLOSURE'?'CLOSED':(fromState==='INTERRUPTED'?'INTERRUPTED':'ACTIVE');
    const resumeState=resumeByState[fromState] || null;
    const legal=new Set(contracts.legalNextStates({lifecycleState,fromState,resumeState}));
    for(const toState of states){
      if(legal.has(toState)){
        assert.doesNotThrow(
          ()=>contracts.assertTransitionAllowed({lifecycleState,fromState,toState,resumeState}),
          fromState+' -> '+toState+' should be legal'
        );
      }else{
        assert.throws(
          ()=>contracts.assertTransitionAllowed({lifecycleState,fromState,toState,resumeState}),
          {code:'TEACHING_D11_TRANSITION_FORBIDDEN'},
          fromState+' -> '+toState+' should be forbidden'
        );
      }
    }
  }
});

test('D11 Break resumes only to the recorded pre-Break state and Closure is terminal',()=>{
  assert.doesNotThrow(()=>contracts.assertTransitionAllowed({lifecycleState:'ACTIVE',fromState:'BREAK',toState:'INSTRUCTION',resumeState:'INSTRUCTION'}));
  assert.throws(()=>contracts.assertTransitionAllowed({lifecycleState:'ACTIVE',fromState:'BREAK',toState:'GUIDED_PRACTICE',resumeState:'INSTRUCTION'}),{code:'TEACHING_D11_TRANSITION_FORBIDDEN'});
  assert.deepEqual(contracts.legalNextStates({lifecycleState:'CLOSED',fromState:'CLOSURE'}),[]);
  assert.throws(()=>contracts.assertTransitionAllowed({lifecycleState:'CLOSED',fromState:'CLOSURE',toState:'INSTRUCTION'}),{code:'TEACHING_D11_TRANSITION_FORBIDDEN'});
});

test('D11 instruction cycle is Teach → Elicit/Check → Diagnose → Respond → Verify and repeats',()=>{
  let phase='TEACH';
  const seen=[phase];
  for(let i=0;i<5;i+=1){phase=contracts.nextInstructionCyclePhase(phase);seen.push(phase);}
  assert.deepEqual(seen,['TEACH','ELICIT_CHECK','DIAGNOSE','RESPOND','VERIFY','TEACH']);
});

test('D11 learning/evidence descriptors are selectable independently from assistance and have no mandatory position',()=>{
  const a=contracts.validateDescriptorSelection({descriptor:'METHOD_SELECTION',assistanceLevel:'NONE'});
  const b=contracts.validateDescriptorSelection({descriptor:'DEMONSTRATION',assistanceLevel:'GUIDED'});
  assert.equal(a.descriptor,'METHOD_SELECTION');
  assert.equal(a.assistance_level,'NONE');
  assert.equal(b.descriptor,'DEMONSTRATION');
  assert.equal(b.assistance_level,'GUIDED');
  assert.equal(a.mandatory_sequence_position,null);
});

test('D11 live replan may remove enrichment while preserving unfinished CORE',()=>{
  const current=contracts.normalizeLessonBlueprintProposal(blueprint(),validationContext);
  const next=blueprint({
    objectives:blueprint().objectives.slice(0,2),
    segments:blueprint().segments.slice(0,2).map((s,i)=>({...s,planned_minutes:i===0?30:10})),
    adaptive_reserve_minutes:5,
  });
  const value=contracts.validateLiveReplanProposal(next,{
    blueprintContext:{learningUnits:validationContext.learningUnits,currentBlueprint:current},
    remainingMinutes:50,
    completedObjectiveRefs:[],
  });
  assert.equal(value.replan_policy.core_removed,false);
  assert.equal(value.replan_policy.enrichment_may_be_removed_before_secondary,true);
});

test('D11 live replan rejects silent removal of unfinished CORE objective',()=>{
  const current=contracts.normalizeLessonBlueprintProposal(blueprint(),validationContext);
  const bad=blueprint({
    objectives:[
      {id:'replacement-core',learning_unit_ref:'lu2',label:'Different core',criticality:'CORE',minimum_safe_minutes:10,
        prerequisite_refs:[],evidence_descriptor_targets:['INDEPENDENT_FAMILIAR'],independent_evidence_required:true},
      ...blueprint().objectives.slice(1),
    ],
    segments:[
      {id:'replacement-seg',kind:'INSTRUCTION',objective_refs:['replacement-core'],planned_minutes:15,minimum_safe_minutes:10,
        criticality:'CORE',optional:false,learning_evidence_descriptor:'DEMONSTRATION',assistance_level:'NONE'},
      {...blueprint().segments[1],objective_refs:['sec-1'],planned_minutes:15},
      {...blueprint().segments[2],objective_refs:['enr-1'],planned_minutes:10},
    ],
    adaptive_reserve_minutes:5,
  });
  assert.throws(()=>contracts.validateLiveReplanProposal(bad,{
    blueprintContext:{learningUnits:validationContext.learningUnits,currentBlueprint:current},
    remainingMinutes:45,
    completedObjectiveRefs:[],
  }),{code:'TEACHING_D11_REPLAN_CORE_DROPPED'});
});

test('D11 early Closure requires completed CORE and required independent evidence',()=>{
  const normalized=contracts.normalizeLessonBlueprintProposal(blueprint(),validationContext);
  const missing=contracts.earlyClosureReadiness({
    blueprintPayload:normalized,
    progressState:{completed_objective_refs:['core-1'],independent_evidence_objective_refs:[]},
  });
  assert.equal(missing.allowed,false);
  assert.deepEqual(missing.missing_independent_evidence_objective_refs,['core-1']);
  const ready=contracts.earlyClosureReadiness({
    blueprintPayload:normalized,
    progressState:{completed_objective_refs:['core-1'],independent_evidence_objective_refs:['core-1']},
  });
  assert.equal(ready.allowed,true);
  assert.equal(ready.no_busywork_required,true);
});

test('D11 Class time is server authoritative and overtime cannot exceed fifteen minutes',()=>{
  const time=contracts.classTimeEnvelope({
    scheduledStartAt:'2026-10-01T10:00:00Z',
    scheduledEndAt:'2026-10-01T11:00:00Z',
    serverNow:new Date('2026-10-01T10:50:00Z'),
  });
  assert.equal(time.remaining_minutes,10);
  assert.equal(time.time_authority,'SERVER');
  assert.equal(contracts.computeOvertimeCeiling({
    scheduledEndAt:'2026-10-01T11:00:00Z',requestedMinutes:15,serverNow:new Date('2026-10-01T10:59:00Z'),
  }),'2026-10-01T11:15:00.000Z');
  assert.throws(()=>contracts.computeOvertimeCeiling({
    scheduledEndAt:'2026-10-01T11:00:00Z',requestedMinutes:16,serverNow:new Date('2026-10-01T10:59:00Z'),
  }),{code:'TEACHING_D11_NUMBER_INVALID'});
});

test('D11 Closure Fact Pack contains actual-Class facts but no Gradebook, mastery or Attendance authority',()=>{
  const normalized=contracts.normalizeLessonBlueprintProposal(blueprint(),validationContext);
  const fact=contracts.buildClosureFactPack({
    session:{
      class_session_id:'sess1',started_at:'2026-10-01T10:00:00Z',overtime_started_at:null,overtime_ceiling_at:null,
      cycle_phase:'VERIFY',current_learning_evidence_descriptor:'INDEPENDENT_FAMILIAR',current_assistance_level:'NONE',
    },
    classRow:{class_id:'cl1',course_id:'c1',scheduled_start_at:'2026-10-01T10:00:00Z',scheduled_end_at:'2026-10-01T11:30:00Z'},
    blueprint:{lesson_blueprint_id:'bp1',version_no:1,blueprint_payload:normalized},
    progressState:{completed_segment_refs:['seg-core'],completed_objective_refs:['core-1'],independent_evidence_objective_refs:['core-1']},
    evidenceEvents:[{evidence_event_id:'ev1'}],
    history:[],
    serverNow:new Date('2026-10-01T11:00:00Z'),
    reason:'EARLY_CORE_EVIDENCE_ESTABLISHED',
  });
  assert.equal(fact.official_marks_included,false);
  assert.equal(fact.mastery_claim_included,false);
  assert.equal(fact.attendance_outcome_included,false);
  assert.equal(fact.student_translation_fact_pack.source_owner,'Teaching Controller');
  assert.ok(fact.student_translation_fact_pack.facts.every((f)=>f.truth_status==='AUTHORITATIVE'));
});

test('D11 intelligence builders use canonical capability/authority boundaries and never request commit',()=>{
  const context={
    classRow:{class_id:'cl1',course_id:'c1',student_id:'u1',scheduled_start_at:'2026-10-01T10:00:00Z',scheduled_end_at:'2026-10-01T11:30:00Z',timezone:'UTC',schedule_version:2,course_lifecycle_state:'ACTIVE',course_state_version:3},
    plan:{course_plan_id:'p1',version_no:4},
    learningUnits:[{learning_unit_id:'lu1',title:'A',metadata:{}}],
    learningUnitDependencies:[],planPrerequisites:[],session:null,
  };
  const req=intelligence.lessonPlanRequest({context,signals:{priorClassFacts:[],teacherNotes:[],workSignals:{status:'OWNER_PENDING_D16'},knowledgeModelSignals:{status:'OWNER_PENDING_D13'}},requestKey:'rk1'});
  assert.equal(req.capabilityId,'teaching.lesson.pre_class_lesson_planning');
  assert.equal(req.declaredAuthorityLevel,'T3');
  assert.equal(req.commit,false);
  assert.equal(req.idempotencyKey,'rk1');
  assert.equal(getCapability(req.capabilityId).prompt_family_id,'TPF-05');
  assert.equal(req.academicInput.active_assessment_answers_included,false);
});

test('D11 Class Summary translation uses TPF-19 and only the bounded student fact pack',()=>{
  const cap=getCapability('teaching.lesson.student_facing_class_summary_generation');
  assert.equal(cap.authority_ceiling,'T1');
  assert.equal(cap.prompt_family_id,'TPF-19');
  const closure={closure_fact_id:'cf1',fact_pack:{student_translation_fact_pack:{schema_version:'d11.student-facing-fact-pack.v1',facts:[]},internal_secret:'not-for-translator'}};
  const context={classRow:{class_id:'cl1',student_id:'u1',course_lifecycle_state:'ACTIVE',course_state_version:1,schedule_version:1},plan:{course_plan_id:'p1',version_no:1},session:{state_version:2}};
  const req=intelligence.translationRequest({context,closureFact:closure,requestKey:'sum1'});
  assert.deepEqual(req.academicInput.fact_pack,closure.fact_pack.student_translation_fact_pack);
  assert.equal(req.academicInput.source_fact_pack_ref,'class-closure:cf1');
});

test('D11 private Teacher Note binding is TPF-09/T2 and is explicitly not Gradebook or SKM authority',()=>{
  const cap=getCapability('teaching.lesson.internal_post_class_teacher_note_generation');
  assert.equal(cap.authority_ceiling,'T2');
  assert.equal(cap.prompt_family_id,'TPF-09');
  const context={classRow:{class_id:'cl1',student_id:'u1',course_lifecycle_state:'ACTIVE',course_state_version:1,schedule_version:1},plan:{course_plan_id:'p1',version_no:1},session:{state_version:2}};
  const req=intelligence.teacherNoteRequest({context,closureFact:{closure_fact_id:'cf1',fact_pack:{}},requestKey:'note1'});
  assert.equal(req.academicInput.private_internal_note,true);
  assert.equal(req.academicInput.not_gradebook,true);
  assert.equal(req.academicInput.not_skm_state,true);
});

test('D11 durable Class events use system_time and scheduled due-event authority',()=>{
  const event=scheduledEvent({
    eventType:TEACHING_EVENTS.CLASS_START_DUE,
    eventId:'d11-class-start:cl1:schedule-v2',
    studentId:'u1',
    classRow:{class_id:'cl1',course_id:'c1',schedule_version:2,source_timetable_version_id:'tt1'},
    dueAt:'2026-10-01T10:00:00Z',
  });
  assert.equal(event.triggerType,'system_time');
  assert.equal(event.eventCategory,'scheduled_due_event');
  assert.equal(event.aggregateVersion,2);
  assert.equal(event.idempotencyKey,event.eventId);
});

test('D11 migration preserves browser read-only authority, student Summary visibility and private Teacher Note',()=>{
  const sql=fs.readFileSync(path.resolve(__dirname,'../../../migrations/20260929_teaching_d11_lesson_controller.sql'),'utf8');
  for(const name of ['teaching_class_controller_history','teaching_class_closure_facts','teaching_class_summaries','teaching_post_class_teacher_notes']){
    assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS public\\.'+name));
  }
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/teaching_class_summaries_student_select/);
  assert.match(sql,/GRANT SELECT ON public.teaching_class_summaries TO authenticated/);
  assert.doesNotMatch(sql,/GRANT SELECT ON public.teaching_post_class_teacher_notes TO authenticated/);
  assert.doesNotMatch(sql,/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,220}TO\s+authenticated/i);
  assert.match(sql,/interval '15 minutes'/);
});

test('D11 source adds exact post-Request committed fact without changing D10 Request authority',()=>{
  const names=fs.readFileSync(path.resolve(__dirname,'../../../teaching/events/names.js'),'utf8');
  const d10=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d10/service.js'),'utf8');
  const runtime=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/runtime.js'),'utf8');
  assert.match(names,/REQUEST_APPLIED: 'teaching.request.applied'/);
  assert.match(d10,/eventType:TEACHING_EVENTS.REQUEST_APPLIED/);
  assert.match(d10,/outboxStore.appendUsing/);
  assert.match(runtime,/d11-request-applied-materiality/);
  assert.match(runtime,/interruptActive:true/);
});

test('D11 model-outage path preserves T0 Class start as safe route-held Controller state',()=>{
  const repo=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');
  const runtime=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/runtime.js'),'utf8');
  assert.match(repo,/CONTROLLER_STARTED_ROUTE_HELD/);
  assert.match(repo,/initialLifecycle = routeHeld \? 'INTERRUPTED' : 'ACTIVE'/);
  assert.match(repo,/academic_penalty_created:false/);
  assert.match(runtime,/model_route_required_for_t0_start:false/);
  assert.match(runtime,/disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE/);
  assert.match(runtime,/allowRouteHeldStart:true/);
  const service=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/service.js'),'utf8');
  assert.match(service,/allowRouteHeldStart:options\.allowRouteHeldStart===true && !bindBlueprint/);
});

test('D11 source never selects provider/model IDs or creates future-domain authority',()=>{
  const files=[
    'teaching/d11/contracts.js','teaching/d11/intelligence.js','teaching/d11/service.js',
    'teaching/d11/runtime.js','teaching/repositories/d11-lesson-controller.js',
  ];
  const src=files.map((file)=>fs.readFileSync(path.resolve(__dirname,'../../..',file),'utf8')).join('\n');
  assert.doesNotMatch(src,/@google\/generative-ai|\bopenai\b|\banthropic\b|gemini-[0-9]/i);
  assert.doesNotMatch(src,/insert into\s+public\.teaching_(gradebook|attendance|student_knowledge|progression)/i);
  assert.doesNotMatch(src,/active_assessment_answers_included:\s*true/i);
});

test('D11 backend exposes bounded Controller APIs but no private Teacher Note student route',()=>{
  const backend=fs.readFileSync(path.resolve(__dirname,'../../../teaching-backend.js'),'utf8');
  for(const route of [
    "/classes/:id/controller","lesson-blueprint/prepare","controller/start","controller/transition",
    "controller/cycle/advance","controller/evidence-descriptor","controller/progress",
    "controller/break","controller/overtime","controller/replan","controller/close","/classes/:id/summary",
  ]) assert.ok(backend.includes(route),route);
  assert.doesNotMatch(backend,/router\.get\('\/classes\/:id\/teacher-note/);
});
