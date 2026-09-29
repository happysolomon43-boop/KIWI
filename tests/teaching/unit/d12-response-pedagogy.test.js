'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  validateResponseEvaluation,enforceAssistanceCeiling,evidenceConsequenceForAssistance,
  determineBoundedPedagogyFromEvaluation,validatePedagogyDecision,validatePedagogyProfile,
  subjectTemplateFor,productiveStruggleDecision,validateTeacherCorrection,
}=require('../../../teaching/d12/contracts');
const {createD12Service,assistanceCeiling,inferSubjectFamily,misconceptionOwnerHandoff}=require('../../../teaching/d12/service');

function demand(){return {familiarity:'fresh_equivalent',method_cueing:'none',representation_demand:'same_representation',integration_demand:'isolated_construct',retention_timing:'immediate'};}
function evaluation(overrides={}){
  const base={
    status:'ok',input_state_reference:'class-session:s1@4',task_ref:'response:r1',target_competence_refs:['lu1'],review_required:false,review_reasons:[],
    item_validity:{status:'valid',issues:[],student_penalty_protection_required:false,evidence_use_limit:'none'},
    evidence_claim_contract:{target_evidence_claim:'independent_performance',demand_vector:demand(),instructional_lineage_refs:[],reuse_policy:'fresh_equivalent_required',support_state:'none',transfer_representation_profile_ref:null,inference_ceiling:'current task only'},
    response_assessment:{final_result_correctness:'correct',conceptual_support:'strong',reasoning_or_method:'valid',completeness:'complete',response_alignment:'direct',evidence_sufficiency:'sufficient_for_requested_inference',learning_stage_supported:'independent_familiar',learning_stage_support_status:'supported',copyability_risk:'low',method_selection_observed:'not_required',evaluator_confidence:'high',evaluator_confidence_basis:'response supplies required reasoning'},
    component_analysis:[],error_analysis:[],misconception:{status:'none_supported',hypothesis:null,affected_competence_refs:[],supporting_evidence_refs:[],alternative_explanations:[],confidence:'not_applicable'},
    prerequisite:{status:'none_supported',prerequisite_ref:null,supporting_evidence_refs:[],alternative_explanations:[],confidence:'not_applicable'},
    attempt_context:{attempt_count:1,self_correction_without_new_help:false,known_system_or_network_interruption:false,notes:''},
    assistance_and_independence:{support_context:[],assistance_level:'none',resource_context:[],independence_interpretation:'independent_supported',evidence_limit:'none'},
    student_reported_confidence:{provided:false,value_or_band:null,note:''},
    next_evidence_need:{needed:false,question_to_resolve:'',evidence_characteristics:'',required_demand_vector:demand()},
    handoff:{evidence_pipeline:'TPF-09/SKM evidence pipeline',pedagogy_owner:'TPF-07/Controller',formal_marking_owner:'TPF-15/deterministic marking when applicable'},uncertainties:[],
  };
  return {...base,...overrides,response_assessment:{...base.response_assessment,...(overrides.response_assessment||{})},item_validity:{...base.item_validity,...(overrides.item_validity||{})},misconception:{...base.misconception,...(overrides.misconception||{})},prerequisite:{...base.prerequisite,...(overrides.prerequisite||{})}};
}


function correction(overrides={}){
  return {
    status:'ok',input_state_reference:'class-session:s1@4',capability_id:'teaching.lesson.teacher_self_correction_analysis',task_mode:'teacher_self_correction',
    interaction:{purpose:'correct prior explanation'},grounding:{basis:'authoritative_scope',source_refs:['source:s1'],material_conflict:false,conflict_note:null},
    teacher_correction:{challenge_received:true,result:'teacher_error_confirmed',correction_summary:'Corrected explanation',board_repair_needed:false,affected_evidence_recheck_needed:false,...(overrides.teacher_correction||{})},
    uncertainties:[],handoff:{controller:null,response_evaluator:null,pedagogy:null,lesson_planner:null,evidence_pipeline:null,content_integrity:null,scope_or_other_service:null},...overrides,
  };
}

function context(overrides={}){return {classRow:{class_id:'c1',course_id:'co1',subject_id:'sub1',course_lifecycle_state:'ACTIVE',course_state_version:2,schedule_version:1},plan:{course_plan_id:'p1',version_no:3},learningUnitDependencies:[],session:{class_session_id:'s1',lifecycle_state:'ACTIVE',state_version:4,instructional_substate:'INDEPENDENT_PRACTICE',current_learning_evidence_descriptor:'INDEPENDENT_FAMILIAR',current_assistance_level:'NONE'},...overrides};}

function teacherCorrection(overrides={}){
  const base={status:'correction_required',input_state_reference:'class-session:s1@4',capability_id:'teaching.lesson.teacher_self_correction_analysis',task_mode:'teacher_self_correction',interaction:{purpose:'correct a challenged teacher claim'},grounding:{basis:'course_source',source_refs:['source:s1'],material_conflict:false,conflict_note:null},teacher_correction:{challenge_received:true,result:'teacher_error_confirmed',correction_summary:'The earlier teacher claim was wrong; corrected explanation supplied.',board_repair_needed:false,affected_evidence_recheck_needed:false},uncertainties:[],handoff:{controller:null,response_evaluator:null,pedagogy:null,lesson_planner:null,evidence_pipeline:null,content_integrity:null,scope_or_other_service:null}};
  return {...base,...overrides,teacher_correction:{...base.teacher_correction,...(overrides.teacher_correction||{})}};
}

// Response Evaluation / authority boundaries

test('TPF-06 evaluation accepts structured one-response evidence',()=>assert.equal(validateResponseEvaluation(evaluation()).response_assessment.final_result_correctness,'correct'));
test('one response cannot set mastery',()=>assert.throws(()=>validateResponseEvaluation({...evaluation(),mastery_state:'MASTERED'}),/authority/i));
test('one response cannot persist misconception state',()=>assert.throws(()=>validateResponseEvaluation({...evaluation(),persistent_misconception:true}),/authority/i));
test('recurring misconception requires trusted recurrence evidence',()=>assert.throws(()=>validateResponseEvaluation(evaluation({misconception:{status:'recurring_supported',hypothesis:'wrong inverse rule',affected_competence_refs:['lu1'],supporting_evidence_refs:['r1'],alternative_explanations:[],confidence:'medium'}})),/recurrence/i));
test('trusted recurrence permits recurring-supported hypothesis without committing SKM',()=>assert.equal(validateResponseEvaluation(evaluation({misconception:{status:'recurring_supported',hypothesis:'wrong inverse rule',affected_competence_refs:['lu1'],supporting_evidence_refs:['r1'],alternative_explanations:[],confidence:'medium'}}),{trustedPriorRecurrence:true}).misconception.status,'recurring_supported'));
test('prerequisite failure must reference trusted dependency',()=>assert.throws(()=>validateResponseEvaluation(evaluation({prerequisite:{status:'candidate_failure',prerequisite_ref:'lu0',supporting_evidence_refs:['r1'],alternative_explanations:[],confidence:'medium'}}),{trustedPrerequisiteRefs:[]}),/trusted.*dependency|prerequisite.*trusted/i));
test('item penalty protection blocks unrestricted negative inference',()=>assert.throws(()=>validateResponseEvaluation(evaluation({item_validity:{status:'invalid',issues:['ambiguous'],student_penalty_protection_required:true,evidence_use_limit:'do_not_use_negative_evidence'},response_assessment:{final_result_correctness:'incorrect',evidence_sufficiency:'sufficient_for_requested_inference'}})),/protected|protection/i));

// Assistance / contamination

test('repeated help requests never change assistance ceiling',()=>{const r=enforceAssistanceCeiling({currentLevel:'directional',proposedLevel:'directional',ceiling:'conceptual',helpRequestCount:9});assert.equal(r.student_help_request_changed_ceiling,false);assert.equal(r.assistance_ceiling,'conceptual');});
test('proposed hint above ceiling is rejected',()=>assert.throws(()=>enforceAssistanceCeiling({currentLevel:'none',proposedLevel:'conceptual',ceiling:'directional'}),/ceiling/i));
test('access support is tracked separately from instructional assistance',()=>{const r=enforceAssistanceCeiling({currentLevel:'none',proposedLevel:'none',ceiling:'none',accessSupport:true,allowedTool:true});assert.equal(r.accessibility_or_access_support,true);assert.equal(r.proposed_level,'none');});
test('hints reduce evidence strength',()=>assert.equal(evidenceConsequenceForAssistance({assistanceLevel:'conceptual'}).evidence_strength,'ASSISTED'));
test('worked example contaminates current independent item and requires fresh verification',()=>{const r=evidenceConsequenceForAssistance({assistanceLevel:'worked_example'});assert.equal(r.current_item_evidence_status,'contaminated_for_independent_evidence');assert.equal(r.fresh_verification_needed,true);});
test('explicit answer exposure contaminates even with no prior hint',()=>assert.equal(evidenceConsequenceForAssistance({assistanceLevel:'none',answerOrEssentialMethodExposed:true}).evidence_strength,'CONTAMINATED'));

// Bounded pedagogy

test('correct but insufficient evidence selects focused probe',()=>{const e=evaluation({response_assessment:{final_result_correctness:'correct',evidence_sufficiency:'insufficient',reasoning_or_method:'not_shown'}});const r=determineBoundedPedagogyFromEvaluation(e,{currentAssistance:'none',assistanceCeiling:'directional'});assert.equal(r.recommended_action,'probe');});
test('partial response selects decomposition/probe instead of binary reteach',()=>{const e=evaluation({response_assessment:{final_result_correctness:'partially_correct',completeness:'partial',evidence_sufficiency:'partially_sufficient'}});const r=determineBoundedPedagogyFromEvaluation(e,{currentAssistance:'none',assistanceCeiling:'conceptual'});assert.equal(r.strategy_class,'decomposition');});
test('procedural slip selects self-correction probe',()=>{const e=evaluation({response_assessment:{final_result_correctness:'incorrect'},error_analysis:[{type:'procedural_slip',severity_for_target_competence:'local',confidence:'high'}]});const r=determineBoundedPedagogyFromEvaluation(e,{currentAssistance:'none',assistanceCeiling:'directional'});assert.equal(r.strategy_class,'probe');});
test('prerequisite failure selects surgical prerequisite repair',()=>{const e=evaluation({response_assessment:{final_result_correctness:'incorrect'},prerequisite:{status:'candidate_failure',prerequisite_ref:'lu0',supporting_evidence_refs:['r1'],alternative_explanations:[],confidence:'high'}});validateResponseEvaluation(e,{trustedPrerequisiteRefs:['lu0']});const r=determineBoundedPedagogyFromEvaluation(e,{currentAssistance:'none',assistanceCeiling:'conceptual'});assert.equal(r.recommended_action,'micro_remediation');});
test('failed strategy class cannot be silently repeated',()=>{const e=evaluation({response_assessment:{final_result_correctness:'incorrect'},misconception:{status:'candidate',hypothesis:'x',affected_competence_refs:['lu1'],supporting_evidence_refs:['r1'],alternative_explanations:[],confidence:'medium'}});const r=determineBoundedPedagogyFromEvaluation(e,{failedStrategyClasses:['representation'],currentAssistance:'none',assistanceCeiling:'conceptual'});assert.notEqual(r.strategy_class,'representation');});

test('productive struggle decisions use observable behavior only',()=>{assert.equal(productiveStruggleDecision({responsePending:true,elapsedSeconds:20}).decision,'wait');assert.equal(productiveStruggleDecision({attemptCount:2,repeatedSameError:true,elapsedSeconds:90}).decision,'change_strategy');});

// Profile / cross-subject QA

test('subject templates are explicitly default-only',()=>{for(const s of ['mathematics','science','humanities','languages','computer_science','geography','economics_business','government_civics','accounting','visual_practical']){const t=subjectTemplateFor(s);assert.equal(t.authoritative,false);assert.equal(t.default_only,true);}});
test('Learning Unit profile may override subject template',()=>{const p=validatePedagogyProfile({status:'ok',profile:{learning_unit_ref:'lu1',knowledge_type:'interpretive',primary_student_actions:['argue','analyze_evidence'],answer_space:'open_interpretation',representations:['source','text'],subject_template_authoritative:false}},{learningUnitRef:'lu1'});assert.equal(p.profile.answer_space,'open_interpretation');});
test('Literature/History profile supports defensible open interpretation',()=>{for(const s of ['Literature','History']){assert.equal(subjectTemplateFor(inferSubjectFamily(s)).answer_space,'open_interpretation');}});
test('programming profile preserves process evidence through debug/trace actions',()=>{const t=subjectTemplateFor('computer_science');assert.ok(t.primary_student_actions.includes('debug'));assert.ok(t.primary_student_actions.includes('trace'));});
test('mathematics profile supports multiple valid approaches and derivation',()=>{const t=subjectTemplateFor('mathematics');assert.equal(t.answer_space,'multiple_valid_approaches');assert.ok(t.primary_student_actions.includes('derive'));});
test('visual/practical profile acknowledges performance modality',()=>assert.ok(subjectTemplateFor('visual_practical').representations.includes('physical_performance')));
test('geography profile retains map representation as a valid subject default',()=>assert.ok(subjectTemplateFor('geography').representations.includes('map')));

// Correction and future-owner boundary

test('teacher correction requires explicit correction flags and structured grounding',()=>assert.equal(validateTeacherCorrection(teacherCorrection()).teacher_correction.affected_evidence_recheck_needed,false));
test('teacher error can request evidence recheck without D12 mutating SKM',()=>assert.equal(validateTeacherCorrection(teacherCorrection({teacher_correction:{board_repair_needed:true,affected_evidence_recheck_needed:true}})).teacher_correction.affected_evidence_recheck_needed,true));
test('misconception handoff points to D13 and commits nothing',()=>{const h=misconceptionOwnerHandoff(evaluation({misconception:{status:'candidate',hypothesis:'x'}}),[]);assert.equal(h.owner_delivery,'D13');assert.equal(h.durable_state_committed,false);});

// D11 assistance stage interop

test('independent evidence descriptor makes assistance ceiling none',()=>assert.equal(assistanceCeiling(context()),'none'));
test('guided descriptor permits strong scaffold but not automatic full instruction',()=>assert.equal(assistanceCeiling(context({session:{...context().session,current_learning_evidence_descriptor:'GUIDED',instructional_substate:'GUIDED_PRACTICE'}})),'strong_scaffold'));

// Service route-held behavior while D30 remains unresolved

test('service captures response but leaves model interpretation route-held without D12 intelligence',async()=>{
  const ctx=context();
  let response={response_id:'r1',student_id:'u1',class_session_id:'s1',learning_unit_id:'lu1',controller_version:4,response_kind:'text',response_payload:{text:'42'},assistance_context:{assistance_level:'none'},submitted_at:new Date().toISOString()};
  let held=null;
  const repo={
    getClassContext:async()=>ctx,getLearningUnit:async()=>({learning_unit_id:'lu1',course_plan_id:'p1',title:'Unit',intended_competence:'Solve',exit_conditions:[],metadata:{}}),
    createResponse:async()=>({response,idempotent:false}),getResponse:async()=>response,latestEvaluation:async()=>held,recentLearningUnitEvaluations:async()=>[],
    saveRouteHeldEvaluation:async()=>held={evaluation_id:'e1',response_id:'r1',learning_unit_id:'lu1',evaluation_state:'ROUTE_HELD',controller_version:4,evaluation_version:1,evaluation_payload:{route_qualification:'UNQUALIFIED_UNTIL_D30'},evidence_strength:'UNKNOWN',evaluator_confidence:null,candidate_misconception:null,prerequisite_hypothesis:null},
  };
  const s=createD12Service({repository:repo,randomUUID:()=> 'uuid'});
  const out=await s.evaluateResponse({id:'u1'},'c1',{learningUnitId:'lu1',responsePayload:{text:'42'}});
  assert.equal(out.state,'ROUTE_HELD');assert.equal(out.persistentMisconceptionCommitted,false);
});

test('D12 durable response event subscriber delegates committed responses to the service',async()=>{
  const {registerD12Runtime}=require('../../../teaching/d12/runtime');
  let registered=null;let handled=null;
  const publishedEvents={register:(eventType,subscriber)=>{registered={eventType,subscriber};return {eventType,subscriberId:subscriber.subscriberId};}};
  const service={handleResponseSubmittedEvent:async(event)=>{handled=event;return {accepted:true};}};
  const runtime=registerD12Runtime({publishedEvents,service});
  assert.equal(runtime.eventType,'teaching.student.response_submitted');
  assert.equal(registered.eventType,'teaching.student.response_submitted');
  const event={eventId:'evt1',payload:{response_id:'r1'}};
  await registered.subscriber.handle(event);
  assert.equal(handled,event);
});

test('client cannot self-declare answer exposure to weaken independent evidence',async()=>{
  const ctx=context();let capturedAssistance=null;
  const repo={
    getClassContext:async()=>ctx,getLearningUnit:async()=>({learning_unit_id:'lu1',course_plan_id:'p1'}),
    createResponse:async(args)=>{capturedAssistance=args.assistanceContext;return {response:{response_id:'r2',class_session_id:'s1',controller_version:4,server_received_at:new Date().toISOString()},idempotent:false};},
  };
  const s=createD12Service({repository:repo,randomUUID:()=> 'uuid'});
  await s.captureResponse({id:'u1'},'c1',{learningUnitId:'lu1',answerOrMethodExposed:true,responsePayload:{text:'x'}});
  assert.equal(capturedAssistance.answer_or_method_exposed,false);
});

test('untrusted client failed-strategy fields cannot steer Pedagogy Engine policy',async()=>{
  const ctx=context();const diagnosis=evaluation({response_assessment:{final_result_correctness:'correct',evidence_sufficiency:'insufficient',reasoning_or_method:'not_shown'}});
  let saved=null;
  const repo={
    getEvaluation:async()=>({evaluation_id:'e1',student_id:'u1',class_id:'c1',class_session_id:'s1',learning_unit_id:'lu1',controller_version:4,evaluation_state:'VALIDATED',evaluation_payload:diagnosis,exposure_state:{},evidence_strength:'FULL'}),
    getClassContext:async()=>ctx,getLearningUnit:async()=>({learning_unit_id:'lu1',course_plan_id:'p1',title:'Unit',intended_competence:'Explain',exit_conditions:[],metadata:{}}),
    recentPedagogyDecisions:async()=>[],
    savePedagogyDecision:async(args)=>saved={pedagogy_decision_id:'pd1',decision_state:args.state,decision_payload:args.payload,assistance_ceiling:args.assistanceCeiling,assistance_level:args.assistanceLevel},
  };
  const s=createD12Service({repository:repo,randomUUID:()=> 'uuid'});
  const out=await s.recommendPedagogy({id:'u1'},'c1','e1',{__trustedControllerContext:true,failedStrategyClasses:['probe']});
  assert.equal(out.payload.strategy.strategy_class,'probe');
  assert.deepEqual(out.payload.decision_frame.failed_strategy_classes,[]);
  assert.equal(saved.decision_state,'DETERMINISTIC_BOUND');
});

test('route-held response can be reevaluated after a qualified D12 intelligence route becomes available',async()=>{
  const ctx=context();const response={response_id:'r1',student_id:'u1',class_session_id:'s1',learning_unit_id:'lu1',controller_version:4,response_kind:'text',response_payload:{text:'42'},assistance_context:{assistance_level:'none',answer_or_method_exposed:false},submitted_at:new Date().toISOString()};
  const held={evaluation_id:'held1',response_id:'r1',learning_unit_id:'lu1',evaluation_state:'ROUTE_HELD',controller_version:4,evaluation_version:1,evaluation_payload:{route_qualification:'UNQUALIFIED_UNTIL_D30'}};
  let savedArgs=null;
  const repo={
    getResponse:async()=>response,getClassContext:async()=>ctx,getLearningUnit:async()=>({learning_unit_id:'lu1',course_plan_id:'p1',title:'Unit',intended_competence:'Solve',exit_conditions:[],metadata:{}}),
    latestEvaluation:async()=>held,recentLearningUnitEvaluations:async()=>[],
    saveEvaluation:async(args)=>{savedArgs=args;return {evaluation_id:'e2',response_id:'r1',learning_unit_id:'lu1',evaluation_state:'VALIDATED',controller_version:4,evaluation_version:2,evaluation_payload:args.payload,evidence_strength:args.evidenceStrength,evaluator_confidence:args.evaluatorConfidence,candidate_misconception:args.candidateMisconception,prerequisite_hypothesis:args.prerequisiteHypothesis};},
  };
  const intelligence={evaluateResponse:async()=>({accepted:true,executionId:'x1',validatedResult:{output:evaluation()}})};
  const s=createD12Service({repository:repo,intelligence,randomUUID:()=> 'uuid'});
  const out=await s.evaluateCapturedResponse('u1','c1','r1');
  assert.equal(out.state,'VALIDATED');
  assert.match(savedArgs.idempotencyKey,/qualified-v1$/);
});

test('stale Controller version blocks response evaluation before model consequence',async()=>{
  const ctx=context();const response={response_id:'r1',student_id:'u1',class_session_id:'s1',learning_unit_id:'lu1',controller_version:3,response_kind:'text',response_payload:{},assistance_context:{},submitted_at:new Date().toISOString()};
  const repo={getResponse:async()=>response,getClassContext:async()=>ctx,getLearningUnit:async()=>({learning_unit_id:'lu1',course_plan_id:'p1'})};
  const s=createD12Service({repository:repo,randomUUID:()=> 'uuid'});
  await assert.rejects(()=>s.evaluateCapturedResponse('u1','c1','r1'),/Controller advanced|stale/i);
});

test('protected assessment mode blocks D12 instructional response feedback',async()=>{
  const ctx=context({session:{...context().session,instructional_substate:'ASSESSMENT'}});
  const repo={getClassContext:async()=>ctx,getLearningUnit:async()=>({learning_unit_id:'lu1',course_plan_id:'p1'})};
  const s=createD12Service({repository:repo,randomUUID:()=> 'uuid'});
  await assert.rejects(()=>s.captureResponse({id:'u1'},'c1',{learningUnitId:'lu1',responsePayload:{}}),/protected assessment/i);
});



test('validated evaluation replay is idempotent and does not invoke model again',async()=>{
  const ctx=context();
  const response={response_id:'r1',student_id:'u1',class_session_id:'s1',learning_unit_id:'lu1',controller_version:4,response_kind:'text',response_payload:{text:'42'},assistance_context:{assistance_level:'none'}};
  const existing={evaluation_id:'e1',response_id:'r1',learning_unit_id:'lu1',evaluation_state:'VALIDATED',controller_version:4,evaluation_version:1,evaluation_payload:evaluation(),evidence_strength:'FULL',evaluator_confidence:'high',candidate_misconception:null,prerequisite_hypothesis:null};
  let called=false;
  const repo={
    getClassContext:async()=>ctx,
    getLearningUnit:async()=>({learning_unit_id:'lu1',course_plan_id:'p1'}),
    getResponse:async()=>response,
    latestEvaluation:async()=>existing,
  };
  const service=createD12Service({repository:repo,randomUUID:()=> 'uuid',intelligence:{evaluateResponse:async()=>{called=true;}}});
  const out=await service.evaluateCapturedResponse('u1','c1','r1');
  assert.equal(out.evaluationId,'e1');
  assert.equal(called,false);
});

