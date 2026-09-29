'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const {
  computeKnowledgeState,projectEffectiveCertainty,learningAnalysisProjection,
  SKM_ALGORITHM_ID,SKM_ALGORITHM_VERSION,
}=require('../../../teaching/d13/state-engine');
const {
  validateNormalizedEvidence,normalizeD12EvaluationBundle,validateTPF09Output,
}=require('../../../teaching/d13/contracts');
const {createD13Service}=require('../../../teaching/d13/service');
const {createTeachingEventSubscriberRegistry}=require('../../../teaching/events/dispatcher');
const {registerD12Runtime}=require('../../../teaching/d12/runtime');
const {registerD13Runtime}=require('../../../teaching/d13/runtime');
const {EVENT_CATEGORIES}=require('../../../teaching/runtime/constants');

function demand(overrides={}){
  return {
    familiarity:'fresh_equivalent',method_cueing:'none',representation_demand:'same_representation',
    integration_demand:'isolated_construct',retention_timing:'immediate',...overrides,
  };
}
function ev(id,overrides={}){
  const base={
    evidence_event_id:id,occurred_at:new Date(Date.UTC(2026,0,1,0,0,Number(String(id).replace(/\D/g,''))||0)).toISOString(),
    independent_performance:true,assistance_level:'none',evidence_validity:'VALID',evidential_strength:'MODERATE',
    information_gain:'MODERATE',redundancy:'NEW_INFORMATION',comparability_group:null,evidence_claim:'independent_performance',
    demand_vector:demand(),answer_or_method_exposed:false,
    response_quality:{final_result_correctness:'correct',evidence_sufficiency:'sufficient_for_requested_inference',conceptual_support:'strong',reasoning_or_method:'valid'},
    observed_errors:[],confidence_sample:{provided:false,band:null},misconception_context:{status:'none_supported'},
    prerequisite_context:{status:'none_supported'},path_context:{},
  };
  return {...base,...overrides,response_quality:{...base.response_quality,...(overrides.response_quality||{})},demand_vector:{...base.demand_vector,...(overrides.demand_vector||{})}};
}
function strong(id,o={}){return ev(id,{evidential_strength:'STRONG',information_gain:'HIGH',...o});}
function failure(id,o={}){
  return strong(id,{...o,response_quality:{final_result_correctness:'incorrect',evidence_sufficiency:'sufficient_for_requested_inference',conceptual_support:'weak',reasoning_or_method:'invalid'},observed_errors:[{type:'conceptual_error',severity_for_target_competence:'material'}]});
}

test('D13 pins the accepted deterministic SKM algorithm version',()=>{
  assert.equal(SKM_ALGORITHM_ID,'EVIDENCE_QUALITY_STATE_MACHINE_V1');
  assert.equal(SKM_ALGORITHM_VERSION,'skm-evidence-state-machine.v1');
});

test('two distinct credible independent successes establish INDEPENDENT',()=>{
  const state=computeKnowledgeState([ev('e1'),ev('e2')],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.base_state,'INDEPENDENT');
  assert.deepEqual(state.overlays,[]);
});

test('many weak repetitive successes cannot manufacture INDEPENDENT',()=>{
  const events=Array.from({length:20},(_,i)=>ev('w'+i,{evidential_strength:'WEAK',redundancy:'HIGHLY_REDUNDANT',comparability_group:'clone-family'}));
  assert.equal(computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'}).base_state,'INTRODUCED');
});

test('weak repetitive positives do not overpower later strong contrary evidence',()=>{
  const events=[strong('e1',{occurred_at:'2026-01-01T00:00:00Z'}),strong('e2',{occurred_at:'2026-01-02T00:00:00Z'}),...Array.from({length:20},(_,i)=>ev('w'+i,{occurred_at:new Date(Date.UTC(2026,0,2,1,0,i)).toISOString(),evidential_strength:'WEAK',redundancy:'HIGHLY_REDUNDANT',comparability_group:'clone'})),failure('f1',{occurred_at:'2026-01-03T00:00:00Z'}),failure('f2',{occurred_at:'2026-01-04T00:00:00Z'})];
  const state=computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.base_state,'EMERGING');
  assert.ok(state.overlays.includes('REGRESSED'));
});

test('delayed independent retrieval upgrades established independence to SECURE',()=>{
  const state=computeKnowledgeState([ev('e1'),ev('e2'),strong('e3',{evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}})],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.base_state,'SECURE');
  assert.equal(state.dimensions.retention.status,'SUPPORTED');
});

test('legitimate varied uncued independent performance supports TRANSFERABLE',()=>{
  const transfer=strong('e3',{evidence_claim:'integrate_or_transfer',demand_vector:{familiarity:'integrated',integration_demand:'combine_eligible_constructs',method_cueing:'none'}});
  const state=computeKnowledgeState([ev('e1'),ev('e2'),transfer],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.base_state,'TRANSFERABLE');
});

test('surface novelty with method cueing does not count as transfer',()=>{
  const superficiallyNew=strong('e3',{evidence_claim:'integrate_or_transfer',demand_vector:{familiarity:'new_context_same_construct',method_cueing:'explicit'}});
  const state=computeKnowledgeState([ev('e1'),ev('e2'),superficiallyNew],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.base_state,'INDEPENDENT');
});

test('failed delayed retrieval adds FRAGILE without erasing prior competence',()=>{
  const delayedFailure=failure('f1',{occurred_at:'2026-01-10T00:00:00Z',evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}});
  const state=computeKnowledgeState([ev('e1',{occurred_at:'2026-01-01T00:00:00Z'}),ev('e2',{occurred_at:'2026-01-02T00:00:00Z'}),delayedFailure],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.base_state,'EMERGING');
  assert.ok(state.overlays.includes('FRAGILE'));
});

test('repeated substantive later independent failure adds REGRESSED',()=>{
  const state=computeKnowledgeState([ev('e1',{occurred_at:'2026-01-01T00:00:00Z'}),ev('e2',{occurred_at:'2026-01-02T00:00:00Z'}),failure('f1',{occurred_at:'2026-01-03T00:00:00Z'}),failure('f2',{occurred_at:'2026-01-04T00:00:00Z'})],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.base_state,'EMERGING');
  assert.ok(state.overlays.includes('REGRESSED'));
});

test('BLOCKED requires repeated prerequisite evidence plus materially different strategies',()=>{
  const p1=failure('p1',{prerequisite_context:{status:'candidate_failure',prerequisite_ref:'pre1'},path_context:{prior_strategy_classes:['representation']}});
  const p2=failure('p2',{prerequisite_context:{status:'investigation_needed',prerequisite_ref:'pre1'},path_context:{prior_strategy_classes:['prerequisite_repair']}});
  const state=computeKnowledgeState([p1,p2],{studentId:'u1',learningUnitId:'lu1'});
  assert.ok(state.overlays.includes('BLOCKED'));
});

test('a D12 BLOCKED proposal alone cannot directly set the D13 BLOCKED overlay',()=>{
  const single=failure('p1',{prerequisite_context:{status:'investigation_needed',prerequisite_ref:'pre1'},path_context:{blocked_proposal_confirmed:true,prior_strategy_classes:['representation']}});
  const state=computeKnowledgeState([single],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.overlays.includes('BLOCKED'),false);
});

test('time alone changes effective certainty, not durable knowledge state',()=>{
  const events=[
    ev('e1',{occurred_at:'2026-01-01T00:00:00.000Z'}),
    ev('e2',{occurred_at:'2026-01-02T00:00:00.000Z'}),
    strong('e3',{occurred_at:'2026-01-08T00:00:00.000Z',evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}}),
  ];
  const state=computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.base_state,'SECURE');
  const effective=projectEffectiveCertainty(state,{asOf:new Date('2026-03-01T00:00:00Z')});
  assert.equal(state.base_state,'SECURE');
  assert.equal(effective.reason,'BEYOND_DEMONSTRATED_RETENTION_HORIZON');
});

test('high-confidence wrong is calibration/misconception evidence, not an ability label',()=>{
  const state=computeKnowledgeState([failure('f1',{confidence_sample:{provided:true,band:'high'},misconception_context:{status:'candidate',hypothesis:'adds denominators when adding fractions',confidence:'high',affected_competence_refs:['lu1']}})],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.confidence_calibration.pattern,'HIGH_CONFIDENCE_WRONG');
  assert.equal(state.misconceptions[0].status,'CANDIDATE');
  assert.equal('ability_label' in state,false);
});

test('low-confidence correct is treated as calibration evidence without guessing inference',()=>{
  const state=computeKnowledgeState([strong('e1',{confidence_sample:{provided:true,band:'low'}})],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.confidence_calibration.pattern,'LOW_CONFIDENCE_CORRECT');
  assert.equal(JSON.stringify(state).includes('guess'),false);
});

test('path-to-success memory stays context-specific instructional evidence',()=>{
  const state=computeKnowledgeState([strong('e1',{path_context:{representation:'number_line',prior_strategy_classes:['representation']}})],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.path_to_success.helpful_strategies[0].support,'PRELIMINARY');
  assert.match(state.path_to_success.helpful_strategies[0].limits,/not a permanent learning-style claim/i);
});

test('persistent misconception requires recurring evidence and independent/delayed correction to resolve',()=>{
  const candidate={status:'candidate',hypothesis:'sign changes incorrectly across equality',confidence:'medium',affected_competence_refs:['lu1']};
  const recurring={status:'recurring_supported',hypothesis:candidate.hypothesis,confidence:'high',affected_competence_refs:['lu1']};
  const events=[
    failure('f1',{occurred_at:'2026-01-01T00:00:00Z',misconception_context:candidate}),
    failure('f2',{occurred_at:'2026-01-02T00:00:00Z',misconception_context:recurring}),
    strong('c1',{occurred_at:'2026-01-03T00:00:00Z',misconception_context:{status:'none_supported'}}),
    strong('c2',{occurred_at:'2026-01-10T00:00:00Z',misconception_context:{status:'none_supported'},evidence_claim:'retain_after_delay',demand_vector:{retention_timing:'delayed'}}),
  ];
  const state=computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(state.misconceptions[0].status,'RESOLVED');
  assert.ok(state.misconceptions[0].delayed_verification_refs.length>=1);
});

test('invalid/system-failure evidence cannot regress or create knowledge',()=>{
  const invalid=failure('x1',{evidence_validity:'INVALID',evidential_strength:'UNUSABLE'});
  const unseen=computeKnowledgeState([invalid],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(unseen.base_state,'UNSEEN');
  const established=computeKnowledgeState([ev('e1'),ev('e2'),invalid],{studentId:'u1',learningUnitId:'lu1'});
  assert.equal(established.base_state,'INDEPENDENT');
  assert.deepEqual(established.overlays,[]);
});

test('out-of-order replay produces the same current inference',()=>{
  const events=[ev('e1',{occurred_at:'2026-01-01T00:00:00Z'}),failure('f1',{occurred_at:'2026-01-03T00:00:00Z'}),ev('e2',{occurred_at:'2026-01-02T00:00:00Z'})];
  const a=computeKnowledgeState(events,{studentId:'u1',learningUnitId:'lu1'});
  const b=computeKnowledgeState([events[2],events[0],events[1]],{studentId:'u1',learningUnitId:'lu1'});
  assert.deepEqual(a,b);
});

test('Learning Analysis projection hides raw probabilities, weights and hidden reasoning',()=>{
  const state=computeKnowledgeState([ev('e1'),ev('e2')],{studentId:'u1',learningUnitId:'lu1'});
  const view=learningAnalysisProjection(state);
  assert.equal(view.label,'strong');
  assert.equal(view.raw_probabilities_exposed,false);
  assert.equal(view.raw_weights_exposed,false);
  assert.equal(view.hidden_reasoning_exposed,false);
});

test('normalized evidence rejects direct Gradebook/mastery authority fields',()=>{
  assert.throws(()=>validateNormalizedEvidence({
    sourceOwner:'ASSESSMENT_DOMAIN',sourceRef:'a1',courseId:'c1',learningUnitRefs:['lu1'],evidenceClaim:'independent_performance',
    demandVector:demand(),evidenceValidity:'VALID',evidentialStrength:'STRONG',informationGain:'HIGH',redundancy:'NEW_INFORMATION',
    controlContext:'CONTROLLED',assistanceLevel:'none',occurredAt:'2026-01-01T00:00:00Z',official_mark:88,
  }),/authorit/i);
});

test('TPF-09 T2 interpretation cannot commit durable SKM or Gradebook truth',()=>{
  const base={
    status:'ok',input_state_reference:'skm:u1:lu1@2',analysis_scope:{task_mode:'evidence_event_interpretation',learning_unit_refs:['lu1']},
    learning_findings:{state_signals:[]},
    official_record_boundaries:{gradebook_changed:false,skm_state_committed:false,vpk_certified:false,assessment_eligibility_changed:false,progression_decided:false},
  };
  assert.equal(validateTPF09Output(base,{expectedStateReference:'skm:u1:lu1@2',taskMode:'evidence_event_interpretation',learningUnitRefs:['lu1']}).status,'ok');
  assert.throws(()=>validateTPF09Output({...base,official_record_boundaries:{...base.official_record_boundaries,skm_state_committed:true}},{expectedStateReference:'skm:u1:lu1@2',taskMode:'evidence_event_interpretation',learningUnitRefs:['lu1']}),/authorit/i);
  assert.throws(()=>validateTPF09Output({...base,mastery_probability:0.91},{expectedStateReference:'skm:u1:lu1@2',taskMode:'evidence_event_interpretation',learningUnitRefs:['lu1']}),/authorit/i);
});

test('D12 validated evaluation normalizes multidimensional evidence and exposed answers become unusable',()=>{
  const output={
    item_validity:{status:'valid',evidence_use_limit:'none'},
    evidence_claim_contract:{target_evidence_claim:'independent_performance',demand_vector:demand(),instructional_lineage_refs:['lesson:1'],reuse_policy:'fresh_equivalent_required'},
    response_assessment:{final_result_correctness:'correct',evidence_sufficiency:'sufficient_for_requested_inference',conceptual_support:'strong',reasoning_or_method:'valid'},
    error_analysis:[],misconception:{status:'none_supported'},prerequisite:{status:'none_supported'},
    assistance_and_independence:{assistance_level:'none',independence_interpretation:'independent_supported',support_context:[]},
    student_reported_confidence:{provided:false},
  };
  const normalized=normalizeD12EvaluationBundle({
    evaluation:{evaluation_id:'eval1',evaluation_state:'VALIDATED',response_id:'r1',class_id:'cl1',class_session_id:'s1',learning_unit_id:'lu1',evaluation_payload:output,evidence_strength:'CONTAMINATED',exposure_state:{answer_or_method_exposed:true},candidate_misconception:{status:'none_supported'},provenance_refs:[]},
    response:{response_id:'r1',assistance_context:{assistance_level:'none',answer_or_method_exposed:true},server_received_at:'2026-01-01T00:00:00Z'},
    learningUnit:{learning_unit_id:'lu1'},classRow:{course_id:'c1'},priorPedagogy:[],
  });
  assert.equal(normalized.answerOrMethodExposed,true);
  assert.equal(normalized.evidentialStrength,'UNUSABLE');
  assert.equal(normalized.independentPerformance,false);
  assert.equal(normalized.demandVector.familiarity,'fresh_equivalent');
});

test('D13 response subscriber runs after D12 subscriber when registered in foundation order',async()=>{
  const registry=createTeachingEventSubscriberRegistry();
  const calls=[];
  registerD12Runtime({publishedEvents:registry,service:{handleResponseSubmittedEvent:async()=>{calls.push('d12');return {accepted:true};}}});
  registerD13Runtime({publishedEvents:registry,service:{handleResponseSubmittedEvent:async()=>{calls.push('d13');return {accepted:true};}}});
  await registry.publish({
    eventId:'e',schemaVersion:1,eventType:'teaching.student.response_submitted',eventCategory:EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,
    triggerType:'committed_domain_event',source:'test',origin:'test',actorId:'u1',aggregateType:'teaching_student_response',aggregateId:'r1',
    aggregateVersion:1,occurredAt:'2026-01-01T00:00:00Z',effectiveAt:'2026-01-01T00:00:00Z',dueAt:null,
    correlationId:'e',causationId:null,idempotencyKey:'e',payload:{student_id:'u1',response_id:'r1'},auditRefs:[],provenanceRefs:[],
  });
  assert.deepEqual(calls,['d12','d13']);
});

test('route-held D12 evaluation is a D13 no-op, not fabricated knowledge',async()=>{
  const repo={
    loadKnowledgeSnapshot:async()=>null,
    latestEvaluationForResponse:async()=>({evaluation_id:'x',evaluation_state:'ROUTE_HELD'}),
  };
  const service=createD13Service({repository:repo,randomUUID:()=> 'x'});
  const out=await service.handleResponseSubmittedEvent({eventId:'evt',actorId:'u1',payload:{response_id:'r1'}});
  assert.equal(out.noop,true);
  assert.equal(out.evaluationState,'ROUTE_HELD');
});

test('internal owner-validated evidence seam refuses Gradebook as direct SKM assigner',async()=>{
  const repo={loadKnowledgeSnapshot:async()=>null};
  const service=createD13Service({repository:repo,randomUUID:()=> 'x'});
  const evidence={
    sourceOwner:'GRADEBOOK',sourceRef:'g1',courseId:'c1',learningUnitRefs:['lu1'],evidenceClaim:'independent_performance',
    demandVector:demand(),evidenceValidity:'VALID',evidentialStrength:'STRONG',informationGain:'HIGH',redundancy:'NEW_INFORMATION',
    controlContext:'CONTROLLED',assistanceLevel:'none',occurredAt:'2026-01-01T00:00:00Z',
  };
  await assert.rejects(()=>service.ingestOwnerValidatedEvidence({studentId:'u1',evidence}),/Gradebook/i);
});
