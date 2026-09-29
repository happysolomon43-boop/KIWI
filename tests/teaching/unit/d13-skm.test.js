'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const {
  SKM_ALGORITHM_ID,SKM_ALGORITHM_VERSION,computeKnowledgeState,projectEffectiveCertainty,
  learningAnalysisProjection,transferQualified,unresolvedMaterialContradiction,
}=require('../../../teaching/d13/state-engine');
const {
  validateNormalizedEvidence,normalizeD12EvaluationBundle,validateTPF09Output,forbiddenAuthorityPath,
}=require('../../../teaching/d13/contracts');
const {createD13Service}=require('../../../teaching/d13/service');
const {registerD13Runtime}=require('../../../teaching/d13/runtime');

function event(id,at,overrides={}){
  const base={
    evidence_event_id:id,
    occurred_at:new Date(at).toISOString(),
    independent_performance:true,
    evidence_validity:'VALID',
    evidential_strength:'STRONG',
    information_gain:'MODERATE',
    evidence_claim:'independent_performance',
    demand_vector:{
      familiarity:'fresh_equivalent',
      method_cueing:'none',
      representation_demand:'same_representation',
      integration_demand:'isolated_construct',
      retention_timing:'immediate',
    },
    response_quality:{
      final_result_correctness:'correct',
      evidence_sufficiency:'sufficient_for_requested_inference',
      conceptual_support:'strong',
      reasoning_or_method:'valid',
    },
    observed_errors:[],
    redundancy:'NEW_INFORMATION',
    comparability_group:null,
    confidence_sample:{provided:false},
    misconception_context:{status:'none_supported'},
    prerequisite_context:{status:'none_supported'},
    path_context:{prior_strategy_classes:[]},
  };
  return {
    ...base,...overrides,
    demand_vector:{...base.demand_vector,...(overrides.demand_vector||{})},
    response_quality:{...base.response_quality,...(overrides.response_quality||{})},
    confidence_sample:{...base.confidence_sample,...(overrides.confidence_sample||{})},
    misconception_context:{...base.misconception_context,...(overrides.misconception_context||{})},
    prerequisite_context:{...base.prerequisite_context,...(overrides.prerequisite_context||{})},
    path_context:{...base.path_context,...(overrides.path_context||{})},
  };
}
function failEvent(id,at,overrides={}){
  return event(id,at,{
    ...overrides,
    response_quality:{
      final_result_correctness:'incorrect',
      evidence_sufficiency:'sufficient_for_requested_inference',
      conceptual_support:'weak',
      reasoning_or_method:'invalid',
      ...(overrides.response_quality||{}),
    },
    observed_errors:overrides.observed_errors||[{type:'conceptual_error',severity_for_target_competence:'material'}],
  });
}
function assisted(id,at){
  return event(id,at,{independent_performance:false,evidential_strength:'WEAK',assistance_level:'conceptual'});
}
function d12Bundle({systemFailure=false,penaltyProtected=false,correctness='incorrect'}={}){
  return {
    evaluation:{
      evaluation_id:'ev1',evaluation_state:'VALIDATED',response_id:'r1',class_id:'c1',class_session_id:'s1',
      learning_unit_id:'lu1',evaluation_version:1,evidence_strength:'FULL',exposure_state:{},provenance_refs:[],
      evaluation_payload:{
        task_ref:'response:r1',
        item_validity:{
          status:'valid',student_penalty_protection_required:penaltyProtected,
          evidence_use_limit:penaltyProtected?'do_not_use_negative_evidence':'none',
        },
        evidence_claim_contract:{
          target_evidence_claim:'independent_performance',
          demand_vector:{
            familiarity:'fresh_equivalent',method_cueing:'none',representation_demand:'same_representation',
            integration_demand:'isolated_construct',retention_timing:'immediate',
          },
          instructional_lineage_refs:[],reuse_policy:'fresh_equivalent_required',
        },
        response_assessment:{
          final_result_correctness:correctness,evidence_sufficiency:'sufficient_for_requested_inference',
          conceptual_support:correctness==='correct'?'strong':'weak',reasoning_or_method:correctness==='correct'?'valid':'invalid',
          learning_stage_supported:'independent_familiar',
        },
        assistance_and_independence:{assistance_level:'none',independence_interpretation:'independent_supported',support_context:[]},
        attempt_context:{known_system_or_network_interruption:systemFailure},
        error_analysis:correctness==='correct'?[]:[{type:'conceptual_error',severity_for_target_competence:'material'}],
        misconception:{status:'none_supported'},prerequisite:{status:'none_supported'},
        student_reported_confidence:{provided:false},
      },
    },
    response:{
      response_id:'r1',submitted_at:'2026-09-29T10:00:00.000Z',server_received_at:'2026-09-29T10:00:01.000Z',
      assistance_context:{assistance_level:'none',answer_or_method_exposed:false,permitted_tools:[],accessibility_support:{}},
    },
    learningUnit:{learning_unit_id:'lu1',title:'Unit',intended_competence:'Explain',exit_conditions:[],metadata:{}},
    classRow:{class_id:'c1',course_id:'co1'},
    priorPedagogy:[],
  };
}
function normalizedEvidence(sourceOwner='ASSESSMENT_OWNER'){
  return {
    sourceOwner,sourceRef:'assessment-result:a1',courseId:'co1',classSessionId:null,sourceResponseId:null,
    learningUnitRefs:['lu1'],evidenceKind:'ASSESSMENT_RESULT',evidencePurpose:'LEARNING',formalAssessment:true,
    independentPerformance:true,assistanceLevel:'none',
    responseQuality:{final_result_correctness:'correct',evidence_sufficiency:'sufficient_for_requested_inference'},
    difficultyContext:{},noveltyContext:{},observedErrors:[],occurredAt:'2026-09-29T12:00:00.000Z',
    taskRef:'item:i1',evidenceClaim:'independent_performance',
    demandVector:{familiarity:'fresh_equivalent',method_cueing:'none',representation_demand:'same_representation',integration_demand:'isolated_construct',retention_timing:'immediate'},
    instructionalLineageRefs:[],supportContext:[],answerOrMethodExposed:false,permittedTools:[],accessibilitySupport:{},
    controlContext:'CONTROLLED',confidenceSample:{provided:false},misconceptionContext:{},prerequisiteContext:{},pathContext:{},
    evidenceValidity:'VALID',evidentialStrength:'STRONG',informationGain:'HIGH',comparabilityGroup:null,redundancy:'NEW_INFORMATION',
    provenanceRefs:['assessment:a1'],normalizationVersion:'d13.evidence-normalization.v1',
  };
}

test('D13 pins the D06 deterministic SKM algorithm',()=>{
  assert.equal(SKM_ALGORITHM_ID,'EVIDENCE_QUALITY_STATE_MACHINE_V1');
  assert.equal(SKM_ALGORITHM_VERSION,'skm-evidence-state-machine.v1');
});

test('UNSEEN is preserved when there is no meaningful evidence',()=>{
  assert.equal(computeKnowledgeState([],{studentId:'u1',learningUnitId:'lu1'}).base_state,'UNSEEN');
});

test('assisted success produces ASSISTED rather than independent knowledge',()=>{
  assert.equal(computeKnowledgeState([assisted('e1','2026-09-01')],{studentId:'u1',learningUnitId:'lu1'}).base_state,'ASSISTED');
});

test('one clean independent success is EMERGING',()=>{
  assert.equal(computeKnowledgeState([event('e1','2026-09-01')],{studentId:'u1',learningUnitId:'lu1'}).base_state,'EMERGING');
});

test('two distinct clean independent opportunities can establish INDEPENDENT',()=>{
  const s=computeKnowledgeState([event('e1','2026-09-01'),event('e2','2026-09-02')],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.base_state,'INDEPENDENT');
});

test('delayed independent retrieval establishes SECURE without inventing time decay',()=>{
  const s=computeKnowledgeState([
    event('e1','2026-09-01'),event('e2','2026-09-02'),
    event('e3','2026-09-12',{evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}}),
  ],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.base_state,'SECURE');
  assert.ok(s.retention_context.demonstrated_horizon_seconds>0);
});

test('legitimate uncued varied application can establish TRANSFERABLE',()=>{
  const varied=event('e3','2026-09-03',{evidence_claim:'integrate_or_transfer',demand_vector:{familiarity:'new_context_same_construct',integration_demand:'combine_eligible_constructs',method_cueing:'none'}});
  assert.equal(transferQualified(varied),true);
  assert.equal(computeKnowledgeState([event('e1','2026-09-01'),event('e2','2026-09-02'),varied],{studentId:'u1',learningUnitId:'lu1'}).base_state,'TRANSFERABLE');
});

test('surface variation with an explicit method cue is not transfer evidence',()=>{
  const cued=event('e3','2026-09-03',{evidence_claim:'integrate_or_transfer',demand_vector:{familiarity:'new_context_same_construct',integration_demand:'combine_eligible_constructs',method_cueing:'explicit'}});
  assert.equal(transferQualified(cued),false);
  assert.equal(computeKnowledgeState([event('e1','2026-09-01'),event('e2','2026-09-02'),cued],{studentId:'u1',learningUnitId:'lu1'}).base_state,'INDEPENDENT');
});

test('many weak repetitive successes cannot manufacture independent state',()=>{
  const events=Array.from({length:8},(_,i)=>event('w'+i,'2026-09-'+String(i+1).padStart(2,'0'),{
    evidential_strength:'WEAK',redundancy:'HIGHLY_REDUNDANT',comparability_group:'clone-a',
  }));
  assert.equal(computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'}).base_state,'INTRODUCED');
});

test('unresolved strong contrary evidence blocks INDEPENDENT and marks fragility',()=>{
  const events=[event('e1','2026-09-01'),event('e2','2026-09-02'),failEvent('n1','2026-09-03')];
  assert.equal(unresolvedMaterialContradiction(events),true);
  const s=computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.base_state,'EMERGING');
  assert.ok(s.overlays.includes('FRAGILE'));
  assert.equal(s.contradiction_state,true);
});

test('two distinct later independent successes resolve a material contradiction',()=>{
  const events=[event('e1','2026-09-01'),event('e2','2026-09-02'),failEvent('n1','2026-09-03'),event('e3','2026-09-04'),event('e4','2026-09-05')];
  assert.equal(unresolvedMaterialContradiction(events),false);
  const s=computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.base_state,'INDEPENDENT');
  assert.equal(s.overlays.includes('FRAGILE'),false);
});

test('failed delayed retrieval after established competence creates FRAGILE',()=>{
  const s=computeKnowledgeState([
    event('e1','2026-09-01'),event('e2','2026-09-02'),
    failEvent('n1','2026-09-12',{evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}}),
  ],{studentId:'u1',learningUnitId:'lu1'});
  assert.ok(s.overlays.includes('FRAGILE'));
});

test('repeated substantive later contrary evidence creates REGRESSED',()=>{
  const s=computeKnowledgeState([
    event('e1','2026-09-01'),event('e2','2026-09-02'),
    failEvent('n1','2026-09-03'),failEvent('n2','2026-09-04',{evidence_claim:'select_method'}),
  ],{studentId:'u1',learningUnitId:'lu1'});
  assert.ok(s.overlays.includes('REGRESSED'));
});

test('time beyond demonstrated retention horizon lowers certainty only, never base state',()=>{
  const state=computeKnowledgeState([
    event('e1','2026-09-01'),event('e2','2026-09-02'),
    event('e3','2026-09-12',{evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}}),
  ],{studentId:'u1',learningUnitId:'lu1'});
  const projected=projectEffectiveCertainty(state,{asOf:new Date('2026-10-30')});
  assert.equal(state.base_state,'SECURE');
  assert.equal(projected.band,'MEDIUM');
  assert.equal(projected.retention_check_recommended,true);
});

test('high-confidence wrong is calibration evidence, not an ability label',()=>{
  const s=computeKnowledgeState([failEvent('n1','2026-09-01',{confidence_sample:{provided:true,band:'high'}})],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.confidence_calibration.pattern,'HIGH_CONFIDENCE_WRONG');
  assert.equal(JSON.stringify(s).includes('ability_label'),false);
});

test('low-confidence correct is retained as calibration signal without guessing inference',()=>{
  const s=computeKnowledgeState([event('e1','2026-09-01',{confidence_sample:{provided:true,band:'low'}})],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.confidence_calibration.pattern,'LOW_CONFIDENCE_CORRECT');
  assert.equal(JSON.stringify(s).toLowerCase().includes('guess'),false);
});

test('path-to-success remembers bounded instructional evidence, not personality',()=>{
  const s=computeKnowledgeState([
    event('e1','2026-09-01',{path_context:{prior_strategy_classes:['representation_change'],representation:'diagram'}}),
    event('e2','2026-09-02',{path_context:{prior_strategy_classes:['representation_change'],representation:'diagram'}}),
  ],{studentId:'u1',learningUnitId:'lu1'});
  assert.ok(s.path_to_success.helpful_strategies.length>=1);
  assert.equal(JSON.stringify(s.path_to_success).toLowerCase().includes('personality'),false);
});

test('persistent misconception requires recurrence and preserves resolution evidence',()=>{
  const m={status:'candidate',hypothesis:'confuses numerator and denominator',affected_competence_refs:['lu1'],confidence:'medium'};
  const events=[
    failEvent('n1','2026-09-01',{misconception_context:m}),
    failEvent('n2','2026-09-02',{misconception_context:{...m,status:'recurring_supported'}}),
  ];
  let s=computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.misconceptions[0].status,'RECURRING');
  const corrected=[
    ...events,
    event('e3','2026-09-03',{misconception_context:{status:'none_supported'}}),
    event('e4','2026-09-12',{misconception_context:{status:'none_supported'},evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}}),
  ];
  s=computeKnowledgeState(corrected,{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.misconceptions[0].status,'RESOLVED');
  assert.ok(s.misconceptions[0].delayed_verification_refs.includes('e4'));
});

test('Learning Analysis is a derived projection with no raw probabilities or weights',()=>{
  const state=computeKnowledgeState([event('e1','2026-09-01'),event('e2','2026-09-02')],{studentId:'u1',learningUnitId:'lu1'});
  const p=learningAnalysisProjection(state);
  assert.ok(['strong','improving','fragile','needs_reinforcement','needs_verification'].includes(p.label));
  assert.equal(p.raw_probabilities_exposed,false);
  assert.equal(p.raw_weights_exposed,false);
  assert.equal(p.hidden_reasoning_exposed,false);
});

test('normalized evidence rejects official Gradebook/progression mutation payloads',()=>{
  assert.throws(()=>validateNormalizedEvidence({...normalizedEvidence(),official_mark:80}),/authorit/i);
  assert.throws(()=>validateNormalizedEvidence({...normalizedEvidence(),progression_decision:'ADVANCE'}),/authorit/i);
});

test('TPF-09 T2 output may signal but cannot set durable knowledge/mastery state',()=>{
  const base={
    status:'ok',input_state_reference:'skm:u1:lu1@2',
    analysis_scope:{task_mode:'learning_state_signal',learning_unit_refs:['lu1']},
    learning_findings:{state_signals:[{candidate:'FRAGILE',basis_refs:['e1']}]},
    official_record_boundaries:{gradebook_changed:false,skm_state_committed:false,vpk_certified:false,assessment_eligibility_changed:false,progression_decided:false},
  };
  assert.equal(validateTPF09Output(base,{expectedStateReference:'skm:u1:lu1@2',taskMode:'learning_state_signal',learningUnitRefs:['lu1']}).status,'ok');
  for(const mutation of [
    {mastery_state:'MASTERED'},{knowledge_state:'INDEPENDENT'},{durable_state:'SECURE'},
    {gradebook_mark:80},{progression_decision:'ADVANCE'}
  ]) assert.throws(()=>validateTPF09Output({...base,...mutation},{expectedStateReference:'skm:u1:lu1@2',taskMode:'learning_state_signal',learningUnitRefs:['lu1']}),/authorit/i);
});

test('authority-key scanner catches common disguised cross-owner state aliases',()=>{
  assert.equal(forbiddenAuthorityPath({nested:{mastery_state:'x'}}),'nested.mastery_state');
  assert.equal(forbiddenAuthorityPath({nested:{gradebook_percentage:80}}),'nested.gradebook_percentage');
});

test('D12 known KIWI/network interruption becomes unusable negative evidence',()=>{
  const n=normalizeD12EvaluationBundle(d12Bundle({systemFailure:true,correctness:'incorrect'}));
  assert.equal(n.evidenceValidity,'INVALID');
  assert.equal(n.evidentialStrength,'UNUSABLE');
  assert.equal(n.difficultyContext.kiwi_or_network_failure_protected,true);
});

test('D12 penalty-protected incorrect response cannot become negative SKM evidence',()=>{
  const n=normalizeD12EvaluationBundle(d12Bundle({penaltyProtected:true,correctness:'incorrect'}));
  assert.equal(n.evidenceValidity,'INVALID');
  assert.equal(n.evidentialStrength,'UNUSABLE');
});

test('D12 penalty-protected correct response may remain limited positive evidence',()=>{
  const n=normalizeD12EvaluationBundle(d12Bundle({penaltyProtected:true,correctness:'correct'}));
  assert.equal(n.evidenceValidity,'LIMITED');
  assert.notEqual(n.evidentialStrength,'UNUSABLE');
});

test('owner-validated evidence ingress rejects browser/client authority',async()=>{
  const service=createD13Service({
    repository:{loadKnowledgeSnapshot:async()=>null},
    randomUUID:()=> 'uuid',
  });
  await assert.rejects(()=>service.ingestOwnerValidatedEvidence({studentId:'u1',evidence:normalizedEvidence('CLIENT')}),/trusted server-side evidence owners/i);
});

test('TPF-09 route remains held when D30 intelligence is not injected',async()=>{
  const snapshot={unit:{course_id:'co1'},stateVersion:0,evidence:[],latestState:null,evidenceDigest:'digest'};
  const service=createD13Service({repository:{loadKnowledgeSnapshot:async()=>snapshot},randomUUID:()=> 'uuid'});
  const out=await service.analyzeEvidenceWithTpf09({id:'u1'},'lu1');
  assert.equal(out.state,'ROUTE_HELD');
  assert.equal(out.durableStateCommitted,false);
});

test('stale TPF-09 result is rejected after model work',async()=>{
  let reads=0;
  const repository={
    loadKnowledgeSnapshot:async()=>{
      reads+=1;
      return {unit:{course_id:'co1'},stateVersion:reads===1?2:3,evidence:[],latestState:{version_no:2},evidenceDigest:reads===1?'a':'b'};
    },
  };
  const intelligence={interpretEvidence:async()=>({accepted:true,validatedResult:{output:{status:'ok'}}})};
  const service=createD13Service({repository,intelligence,randomUUID:()=> 'uuid'});
  await assert.rejects(()=>service.analyzeEvidenceWithTpf09({id:'u1'},'lu1',{taskMode:'evidence_event_interpretation'}),/changed during TPF-09 analysis/i);
});

test('D13 response-event subscriber is registered after D12-compatible committed response events',async()=>{
  let registered=null,handled=null;
  const publishedEvents={register:(eventType,subscriber)=>{registered={eventType,subscriber};return {eventType,subscriberId:subscriber.subscriberId};}};
  const service={handleResponseSubmittedEvent:async(event)=>{handled=event;return {accepted:true};}};
  const runtime=registerD13Runtime({publishedEvents,service});
  assert.equal(runtime.eventType,'teaching.student.response_submitted');
  assert.equal(runtime.subscriberId,'d13-skm-evidence-application');
  const evt={eventId:'evt1',payload:{student_id:'u1',response_id:'r1'}};
  await registered.subscriber.handle(evt);
  assert.equal(handled,evt);
});

test('out-of-order evidence replay computes the same state from authoritative timestamps',()=>{
  const chronological=[
    event('e1','2026-09-01'),event('e2','2026-09-02'),
    event('e3','2026-09-12',{evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}}),
  ];
  const outOfOrder=[chronological[2],chronological[0],chronological[1]];
  assert.equal(computeKnowledgeState(chronological,{studentId:'u1',learningUnitId:'lu1'}).base_state,'SECURE');
  assert.equal(computeKnowledgeState(outOfOrder,{studentId:'u1',learningUnitId:'lu1'}).base_state,'SECURE');
});

test('D12 BLOCKED proposal evidence cannot directly set the durable BLOCKED overlay',()=>{
  const d12Proposal=failEvent('n1','2026-09-03',{
    source_owner:'D12_RESPONSE_EVALUATOR',
    prerequisite_context:{status:'investigation_needed',prerequisite_ref:'lu0'},
    path_context:{prior_strategy_classes:['representation','micro_remediation'],blocked_proposal_confirmed:true},
  });
  const s=computeKnowledgeState([event('e1','2026-09-01'),d12Proposal],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.overlays.includes('BLOCKED'),false);
});

test('authoritative Controller block condition sets and later clears BLOCKED orthogonally',()=>{
  const block=event('b1','2026-09-03',{source_owner:'TEACHING_CONTROLLER',evidential_strength:'WEAK',independent_performance:false,path_context:{block_condition:'BLOCKED'}});
  let s=computeKnowledgeState([event('e1','2026-09-01'),block],{studentId:'u1',learningUnitId:'lu1'});
  assert.ok(s.overlays.includes('BLOCKED'));
  const clear=event('b2','2026-09-04',{source_owner:'TEACHING_CONTROLLER',evidential_strength:'WEAK',independent_performance:false,path_context:{block_condition:'CLEAR'}});
  s=computeKnowledgeState([event('e1','2026-09-01'),block,clear],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.overlays.includes('BLOCKED'),false);
});

test('non-planning evidence owners cannot forge BLOCKED conditions',()=>{
  assert.throws(()=>validateNormalizedEvidence({...normalizedEvidence('ASSESSMENT_OWNER'),pathContext:{block_condition:'BLOCKED'}}),/Controller\/Lesson Planner authority/i);
});

test('algorithm/version and replay semantics are carried in every computed state',()=>{
  const s=computeKnowledgeState([event('e1','2026-09-01')],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(s.algorithm_id,SKM_ALGORITHM_ID);
  assert.equal(s.algorithm_version,SKM_ALGORITHM_VERSION);
});
