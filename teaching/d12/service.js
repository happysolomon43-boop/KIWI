'use strict';

const {
  validateResponseEvaluation,
  validatePedagogyDecision,
  validatePedagogyProfile,
  validateTeacherCorrection,
  enforceAssistanceCeiling,
  evidenceConsequenceForAssistance,
  determineBoundedPedagogyFromEvaluation,
  subjectTemplateFor,
  productiveStruggleDecision,
  ASSISTANCE_LEVELS,
} = require('./contracts');

function fail(message,code,status=409,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;throw e;}
function stateReference(context){return 'class-session:'+context.session.class_session_id+'@'+String(context.session.state_version);}

const D11_TO_D12_ASSISTANCE=Object.freeze({NONE:'none',LIGHT:'directional',GUIDED:'partial_step',MODELED:'worked_example'});
const DESCRIPTOR_CEILINGS=Object.freeze({
  DEMONSTRATION:'full_instruction',GUIDED:'strong_scaffold',INDEPENDENT_FAMILIAR:'none',INDEPENDENT_VARIED:'none',
  METHOD_SELECTION:'none',DELAYED_RETRIEVAL:'none',INTEGRATION_TRANSFER:'none',
});
const SUBSTATE_CEILINGS=Object.freeze({
  OPENING:'conceptual',DIAGNOSTIC:'attention',INSTRUCTION:'full_instruction',GUIDED_PRACTICE:'strong_scaffold',
  INDEPENDENT_PRACTICE:'none',CLASSWORK:'directional',REMEDIATION:'worked_example',ASSESSMENT:'none',CLOSURE:'none',BREAK:'none',INTERRUPTED:'none',
});

function currentAssistance(context){return D11_TO_D12_ASSISTANCE[String(context.session.current_assistance_level||'NONE').toUpperCase()]||'none';}
function assistanceCeiling(context){
  const descriptor=String(context.session.current_learning_evidence_descriptor||'').toUpperCase();
  if(DESCRIPTOR_CEILINGS[descriptor]) return DESCRIPTOR_CEILINGS[descriptor];
  return SUBSTATE_CEILINGS[String(context.session.instructional_substate||'').toUpperCase()]||'conceptual';
}
function learningStage(context){return String(context.session.current_learning_evidence_descriptor||'UNKNOWN').toLowerCase();}
function activeMode(context){
  const mode=String(context.session.instructional_substate||'').toUpperCase();
  const map={OPENING:'learning',DIAGNOSTIC:'learning',INSTRUCTION:'learning',GUIDED_PRACTICE:'guided_practice',INDEPENDENT_PRACTICE:'independent_practice',CLASSWORK:'independent_practice',REMEDIATION:'learning',ASSESSMENT:'controlled_assessment',CLOSURE:'other',BREAK:'other',INTERRUPTED:'other'};
  return map[mode]||'other';
}
function nextAssistance(level,ceiling){
  const i=ASSISTANCE_LEVELS.indexOf(level);const c=ASSISTANCE_LEVELS.indexOf(ceiling);
  if(i<0||c<0) return level;
  return ASSISTANCE_LEVELS[Math.min(c,i+1)];
}

function defaultDemandVector(){return Object.freeze({familiarity:'fresh_equivalent',method_cueing:'none',representation_demand:'same_representation',integration_demand:'isolated_construct',retention_timing:'immediate'});}
function evidenceClaimForContext(context,learningUnit){
  const descriptor=String(context.session.current_learning_evidence_descriptor||'').toUpperCase();
  const map={DEMONSTRATION:'reproduce',GUIDED:'reproduce',INDEPENDENT_FAMILIAR:'independent_performance',INDEPENDENT_VARIED:'adapt_to_variation',METHOD_SELECTION:'select_method',DELAYED_RETRIEVAL:'retain_after_delay',INTEGRATION_TRANSFER:'integrate_or_transfer'};
  const vector={...defaultDemandVector()};
  if(descriptor==='DEMONSTRATION') {vector.familiarity='exact_reuse';vector.method_cueing='explicit';}
  if(descriptor==='GUIDED') {vector.familiarity='near_reuse';vector.method_cueing='partial';}
  if(descriptor==='INDEPENDENT_VARIED') vector.familiarity='fresh_equivalent';
  if(descriptor==='METHOD_SELECTION') {vector.familiarity='familiar_family';vector.method_cueing='none';}
  if(descriptor==='DELAYED_RETRIEVAL') vector.retention_timing='delayed';
  if(descriptor==='INTEGRATION_TRANSFER') {vector.familiarity='integrated';vector.integration_demand='combine_eligible_constructs';}
  return Object.freeze({
    target_evidence_claim:map[descriptor]||'other',demand_vector:Object.freeze(vector),instructional_lineage_refs:[],reuse_policy:'fresh_equivalent_required',
    support_state:currentAssistance(context),transfer_representation_profile_ref:null,
    inference_ceiling:'Only the current Learning Unit/response claim may be interpreted; no durable SKM or mastery mutation.',
    target_learning_unit_ref:learningUnit.learning_unit_id,
  });
}

function inferSubjectFamily(name){
  const n=String(name||'').toLowerCase();
  if(/math|algebra|calculus|geometry|statistics/.test(n)) return 'mathematics';
  if(/physics|chem|bio|science/.test(n)) return 'science';
  if(/computer|program|coding|software/.test(n)) return 'computer_science';
  if(/english|language|french|spanish|german|lingu/.test(n)) return 'languages';
  if(/econom|business|commerce|marketing|management/.test(n)) return 'economics_business';
  if(/government|civic|politic/.test(n)) return 'government_civics';
  if(/account/.test(n)) return 'accounting';
  if(/geograph/.test(n)) return 'geography';
  if(/art|design|practical|studio|lab/.test(n)) return 'visual_practical';
  return 'humanities';
}

function misconceptionOwnerHandoff(payload,priorEvaluations=[]){
  const current=payload?.misconception||{};
  const priorCandidates=priorEvaluations.filter((e)=>['candidate','recurring_supported'].includes(String(e?.evaluation_payload?.misconception?.status))).length;
  let action='NO_DURABLE_MUTATION';
  if(current.status==='candidate') action=priorCandidates?'CONSIDER_UPDATE_CANDIDATE':'CONSIDER_CREATE_CANDIDATE';
  if(current.status==='recurring_supported') action='CONSIDER_SYNTHESIS_FROM_RECURRING_EVIDENCE';
  if(current.status==='none_supported'&&priorCandidates) action='CONSIDER_RESOLUTION_EVIDENCE';
  return Object.freeze({owner:'SKM',owner_delivery:'D13',action,durable_state_committed:false,source:'D12_RESPONSE_EVALUATION'});
}

function deterministicPedagogyArtifact({context,evaluation,learningUnit,frame,recommendedAction,strategyClass,reason,proposedAssistance=null,blockedProposal=false,replanRecommended=false,freshVerificationNeeded=false}){
  const current=frame.current_assistance_level;
  const proposed=proposedAssistance||current;
  const enforced=enforceAssistanceCeiling({currentLevel:current,proposedLevel:proposed,ceiling:frame.assistance_ceiling});
  const consequence=evidenceConsequenceForAssistance({assistanceLevel:proposed,answerOrEssentialMethodExposed:freshVerificationNeeded});
  return {
    status:replanRecommended?'replan_needed':'ok',input_state_reference:stateReference(context),capability_id:'teaching.lesson.next_pedagogical_action_recommendation',task_mode:'next_action_recommendation',review_required:false,review_reasons:[],
    target:{learning_unit_ref:learningUnit.learning_unit_id,competence:learningUnit.intended_competence,active_mode:activeMode(context),evidence_refs:['response-evaluation:'+evaluation.evaluation_id]},
    decision_frame:{current_learning_stage:frame.current_learning_stage,desired_next_stage:frame.desired_next_stage,assistance_ceiling:frame.assistance_ceiling,recent_strategy_refs:frame.recent_strategy_refs,failed_strategy_classes:frame.failed_strategy_classes,time_or_momentum_budget:frame.time_or_momentum_budget,evidence_goal:frame.evidence_goal,target_demand_vector:frame.target_demand_vector,transfer_representation_profile_ref:null,instructional_lineage_refs:[]},
    pedagogical_judgment:{recommended_action:recommendedAction,why_this_action:reason,alternatives_considered:[],certainty:'high'},
    assistance:{current_level:current,proposed_level:proposed,permission_basis:'D11 Controller learning/evidence descriptor + D12 deterministic assistance policy',independence_consequence:consequence.independence_consequence,fresh_verification_needed:consequence.fresh_verification_needed,student_help_request_changed_ceiling:false},
    progression_design:{support_removal_needed:proposed!=='none',next_task_demand:{...frame.target_demand_vector},reuse_intent:freshVerificationNeeded?'fresh_equivalent':'not_applicable',instructional_lineage_refs:[],copyability_risk:freshVerificationNeeded?'high':'unknown'},
    strategy:{representation:'preserve current representation unless strategy explicitly changes it',instructional_move:reason,practice_or_evidence_form:freshVerificationNeeded?'fresh equivalent verification required':null,success_signal:'observable correct/complete response at the intended assistance level',failure_signal:'repeated supported error or inability to proceed within the bounded move',strategy_class:strategyClass,materially_differs_from_failed_strategy:!frame.failed_strategy_classes.includes(strategyClass)},
    artifact:{content:null,expected_solution_or_evidence:null,content_validation:'not_applicable'},
    state_implications:{blocked_proposal:Boolean(blockedProposal),replan_recommended:Boolean(replanRecommended),controller_action_required:Boolean(blockedProposal||replanRecommended),durable_state_not_committed:true},
    uncertainties:[],handoff:{controller:blockedProposal?'Controller must decide whether progression changes.':null,lesson_planner:replanRecommended?'Live replanning may be required.':null,evidence_pipeline:freshVerificationNeeded?'Current item is not independent evidence; obtain fresh equivalent verification.':'D13 may later interpret validated evidence; no D12 durable SKM mutation.'},
  };
}

const TRUSTED_CONTROLLER_SIGNAL=Symbol('D12_TRUSTED_CONTROLLER_SIGNAL');

function createD12Service({repository,intelligence=null,randomUUID,clock=()=>new Date()}={}){
  if(!repository||typeof repository.getClassContext!=='function') throw new TypeError('D12 service requires repository.');
  if(typeof randomUUID!=='function') throw new TypeError('D12 service requires randomUUID().');

  function assertContext(context){
    if(!context?.classRow) fail('Teaching Class not found.','TEACHING_D12_CLASS_NOT_FOUND',404);
    if(!context.session) fail('D12 requires an active D11 Controller session.','TEACHING_D12_CONTROLLER_REQUIRED',409);
    if(context.session.lifecycle_state==='CLOSED') fail('Closed Class cannot run D12 response/pedagogy work.','TEACHING_D12_CLASS_CLOSED',409);
    if(!context.plan) fail('Current Course Plan is required.','TEACHING_D12_COURSE_PLAN_REQUIRED',409);
  }

  function assertD12InstructionalMode(context){
    if(String(context?.session?.instructional_substate||'').toUpperCase()==='ASSESSMENT'){
      fail('D12 instructional feedback is disabled during protected assessment mode.','TEACHING_D12_PROTECTED_ASSESSMENT_MODE',409);
    }
  }

  async function contextAndUnit(studentId,classId,learningUnitId){
    const context=await repository.getClassContext(studentId,classId);assertContext(context);
    const unit=await repository.getLearningUnit(studentId,learningUnitId);
    if(!unit||String(unit.course_plan_id)!==String(context.plan.course_plan_id)) fail('Learning Unit is not current for this Class.','TEACHING_D12_LEARNING_UNIT_NOT_CURRENT',409);
    return {context,unit};
  }

  async function captureResponse(user,classId,input={}){
    const studentId=user.id;
    const learningUnitId=String(input.learningUnitId||'').trim();
    if(!learningUnitId) fail('learningUnitId is required.','TEACHING_D12_LEARNING_UNIT_REQUIRED',400);
    const {context}=await contextAndUnit(studentId,classId,learningUnitId);
    assertD12InstructionalMode(context);
    const captureKey=String(input.idempotencyKey||('d12-response:'+classId+':'+randomUUID()));
    const assistanceContext={
      assistance_level:currentAssistance(context),
      controller_assistance_level:context.session.current_assistance_level||'NONE',
      assistance_ceiling:assistanceCeiling(context),
      answer_or_method_exposed:['worked_example','full_instruction'].includes(currentAssistance(context)),
      accessibility_support:null,
      permitted_tools:[],
      accessibility_or_access_support_is_instructional_assistance:false,
    };
    const captured=await repository.createResponse({
      studentId,classId,learningUnitId,responseKind:String(input.responseKind||'text'),responsePayload:input.responsePayload||{},assistanceContext,
      provenance:{
        source:'D12_RESPONSE_CAPTURE',controller_state_ref:stateReference(context),client_ref:input.clientRef||null,
        client_submitted_at:input.submittedAt||null,client_timestamp_authoritative:false,
        untrusted_student_content:true,protected_assessment_content_included:false,
      },
      submittedAt:clock(),
      idempotencyKey:captureKey,expectedControllerVersion:input.expectedControllerVersion??context.session.state_version,boardItemId:input.boardItemId||null,
    });
    return Object.freeze({
      responseId:captured.response.response_id,classId,learningUnitId,classSessionId:captured.response.class_session_id,
      controllerVersion:Number(captured.response.controller_version),idempotent:captured.idempotent,serverReceivedAt:captured.response.server_received_at,
      eventDrivenEvaluation:true,routeQualification:intelligence?'QUALIFIED_EXECUTION_REQUIRED':'UNQUALIFIED_UNTIL_D30',
    });
  }

  async function evaluateCapturedResponse(studentId,classId,responseId,{requestKey=null}={}){
    const response=await repository.getResponse(studentId,responseId);
    if(!response) fail('Student response not found.','TEACHING_D12_RESPONSE_NOT_FOUND',404);
    const learningUnitId=String(response.learning_unit_id||'').trim();
    if(!learningUnitId) fail('Captured response lacks a Learning Unit reference.','TEACHING_D12_RESPONSE_LEARNING_UNIT_MISSING',409);
    const {context,unit}=await contextAndUnit(studentId,classId,learningUnitId);
    assertD12InstructionalMode(context);
    if(String(context.session.class_session_id)!==String(response.class_session_id)) fail('Response belongs to a stale Class session.','TEACHING_D12_STALE_RESPONSE_SESSION',409);
    if(Number(context.session.state_version)!==Number(response.controller_version)) fail('Controller advanced before response evaluation.','TEACHING_D12_STALE_RESPONSE_CONTROLLER_VERSION',409);
    const existing=await repository.latestEvaluation(studentId,response.response_id);
    if(existing && (existing.evaluation_state!=='ROUTE_HELD' || !intelligence)) return publicEvaluation(existing);
    const prior=await repository.recentLearningUnitEvaluations(studentId,learningUnitId,8);
    const baseEvalKey=String(requestKey||('d12-eval:'+response.response_id+':'+String(context.session.state_version)));
    const evalKey=existing?.evaluation_state==='ROUTE_HELD'&&intelligence ? baseEvalKey+':qualified-v1' : baseEvalKey;
    if(!intelligence){
      const held=await repository.saveRouteHeldEvaluation({studentId,classId,response,learningUnit:unit,context,idempotencyKey:evalKey});
      return publicEvaluation(held);
    }
    const taskContract=evidenceClaimForContext(context,unit);
    const result=await intelligence.evaluateResponse({context,response,learningUnit:unit,taskContract,priorEvaluations:prior,requestKey:evalKey});
    const output=result?.validatedResult?.output;
    if(!result?.accepted||!output) fail('Response Evaluator did not produce an accepted bounded interpretation.','TEACHING_D12_RESPONSE_EVALUATION_NOT_ACCEPTED',422);
    const trustedPrereqs=(context.learningUnitDependencies||[]).filter((d)=>String(d.learning_unit_id)===learningUnitId).map((d)=>String(d.prerequisite_learning_unit_id));
    const value=validateResponseEvaluation(output,{trustedPrerequisiteRefs:trustedPrereqs,trustedPriorRecurrence:prior.some((r)=>['candidate','recurring_supported'].includes(String(r?.evaluation_payload?.misconception?.status)))});
    const responseAssistance=response.assistance_context||{};
    const consequence=evidenceConsequenceForAssistance({assistanceLevel:responseAssistance.assistance_level||'none',answerOrEssentialMethodExposed:Boolean(responseAssistance.answer_or_method_exposed)});
    const candidate={...(value.misconception||{}),owner_handoff:misconceptionOwnerHandoff(value,prior)};
    const saved=await repository.saveEvaluation({
      studentId,classId,response,learningUnit:unit,context,state:value.status==='item_validity_concern'?'REVIEW_NEEDED':'VALIDATED',payload:value,
      provenanceRefs:['response:'+response.response_id,'learning-unit:'+learningUnitId,'class-session:'+context.session.class_session_id],idempotencyKey:evalKey,executionId:result.executionId||null,
      evaluatorConfidence:value.response_assessment.evaluator_confidence,evidenceStrength:consequence.evidence_strength,assistanceState:{...value.assistance_and_independence,deterministic_consequence:consequence},
      exposureState:{answer_or_method_exposed:Boolean(responseAssistance.answer_or_method_exposed),fresh_verification_needed:consequence.fresh_verification_needed},candidateMisconception:candidate,prerequisiteHypothesis:value.prerequisite,
    });
    return publicEvaluation(saved);
  }

  async function evaluateResponse(user,classId,input={}){
    const captured=await captureResponse(user,classId,input);
    return evaluateCapturedResponse(user.id,classId,captured.responseId,{requestKey:'d12-eval:'+captured.responseId+':'+String(captured.controllerVersion)});
  }

  async function handleResponseSubmittedEvent(event={}){
    const payload=event.payload||{};
    const studentId=event.actorId??event.actor_id??payload.student_id;
    const classId=payload.class_id;
    const responseId=payload.response_id??event.aggregateId??event.aggregate_id;
    if(!studentId||!classId||!responseId) return Object.freeze({accepted:true,noop:true,reason:'D12_RESPONSE_EVENT_CONTEXT_MISSING'});
    const evaluation=await evaluateCapturedResponse(studentId,classId,responseId,{requestKey:'d12-event-eval:'+String(event.eventId??event.event_id??responseId)});
    return Object.freeze({accepted:true,responseId,evaluation});
  }

  function publicEvaluation(row){
    if(!row) return null;
    return Object.freeze({
      evaluationId:row.evaluation_id,responseId:row.response_id,learningUnitId:row.learning_unit_id,state:row.evaluation_state,controllerVersion:Number(row.controller_version),version:Number(row.evaluation_version),
      routeQualification:row.evaluation_state==='ROUTE_HELD'?'UNQUALIFIED_UNTIL_D30':'QUALIFIED_EXECUTION_REQUIRED',
      evaluation:row.evaluation_state==='VALIDATED'||row.evaluation_state==='REVIEW_NEEDED'?row.evaluation_payload:null,
      evidenceStrength:row.evidence_strength,evaluatorConfidence:row.evaluator_confidence,candidateMisconception:row.candidate_misconception,prerequisiteHypothesis:row.prerequisite_hypothesis,
      durableMasteryCommitted:false,persistentMisconceptionCommitted:false,skmOwner:'D13',
    });
  }

  async function getResponseEvaluation(user,responseId){const row=await repository.latestEvaluation(user.id,responseId);if(!row) fail('Response evaluation not found.','TEACHING_D12_EVALUATION_NOT_FOUND',404);return publicEvaluation(row);}

  function decisionFrame(context,evaluation,failedStrategyClasses=[],recentDecisions=[]){
    return Object.freeze({
      target_competence_ref:evaluation.learning_unit_id,diagnosis_ref:'response-evaluation:'+evaluation.evaluation_id,current_learning_stage:learningStage(context),desired_next_stage:'stabilize_current',
      current_assistance_level:currentAssistance(context),assistance_ceiling:assistanceCeiling(context),recent_strategy_refs:Object.freeze(recentDecisions.map((row)=>'pedagogy-decision:'+row.pedagogy_decision_id)),failed_strategy_classes:Object.freeze(failedStrategyClasses),
      time_or_momentum_budget:'bounded_current_class_turn',evidence_goal:'advance or clarify the current Learning Unit without overstating evidence',target_demand_vector:defaultDemandVector(),transfer_representation_profile_ref:null,instructional_lineage_refs:[],
    });
  }

  async function recommendPedagogy(user,classId,evaluationId,input={},controllerSignals=null){
    const evaluation=await repository.getEvaluation(user.id,evaluationId);
    if(!evaluation) fail('Response evaluation not found.','TEACHING_D12_EVALUATION_NOT_FOUND',404);
    if(!['VALIDATED','REVIEW_NEEDED'].includes(evaluation.evaluation_state)) fail('Validated diagnosis is required before response-dependent pedagogy.','TEACHING_D12_DIAGNOSIS_REQUIRED',409);
    const {context,unit}=await contextAndUnit(user.id,classId,evaluation.learning_unit_id);
    assertD12InstructionalMode(context);
    if(String(context.session.class_session_id)!==String(evaluation.class_session_id)) fail('Evaluation belongs to a different Class session.','TEACHING_D12_EVALUATION_SESSION_MISMATCH',409);
    const recent=await repository.recentPedagogyDecisions(user.id,unit.learning_unit_id,8);
    const failed=controllerSignals?.[TRUSTED_CONTROLLER_SIGNAL]===true?[...new Set((controllerSignals.failedStrategyClasses||[]).map(String))]:[];
    const frame=decisionFrame(context,evaluation,failed,recent);
    const diagnosis=evaluation.evaluation_payload;
    const policy=determineBoundedPedagogyFromEvaluation(diagnosis,{failedStrategyClasses:failed,currentAssistance:frame.current_assistance_level,assistanceCeiling:frame.assistance_ceiling});
    const answerExposed=Boolean(evaluation.exposure_state?.answer_or_method_exposed)||evaluation.evidence_strength==='CONTAMINATED';
    let recommended=policy.recommended_action;
    let strategyClass=policy.strategy_class;
    let reason='Bounded action selected from validated current-response diagnosis.';
    let proposed=frame.current_assistance_level;
    let blocked=false,replan=false;
    if(answerExposed){recommended='evidence_task';strategyClass='verification';reason='Answer/method exposure retired the current item from independent evidence; a fresh equivalent verification is required.';}
    else if(strategyClass==='hint') proposed=nextAssistance(frame.current_assistance_level,frame.assistance_ceiling);
    if(diagnosis.prerequisite?.status==='candidate_failure'&&failed.includes('prerequisite_repair')) {blocked=true;recommended='replan';strategyClass='other';replan=true;reason='Trusted prerequisite blocker remains after a materially failed prerequisite-repair strategy; normal progression requires Controller/replan review.';}
    const deterministic=deterministicPedagogyArtifact({context,evaluation,learningUnit:unit,frame,recommendedAction:recommended,strategyClass,reason,proposedAssistance:proposed,blockedProposal:blocked,replanRecommended:replan,freshVerificationNeeded:answerExposed});
    let payload=validatePedagogyDecision(deterministic,{decisionFrame:frame});
    let executionId=null,state='DETERMINISTIC_BOUND',capabilityId='teaching.lesson.next_pedagogical_action_recommendation',taskMode='next_action_recommendation';
    const needsModel=['misconception_repair','micro_remediation','change_representation','hint','scaffold','worked_example'].includes(recommended);
    if(needsModel&&intelligence){
      if(recommended==='misconception_repair') {capabilityId='teaching.pedagogy.conceptual_conflict_misconception_repair';taskMode='misconception_repair';}
      else if(recommended==='micro_remediation') {capabilityId='teaching.pedagogy.surgical_micro_remediation_design';taskMode='micro_remediation';}
      else if(recommended==='change_representation') {capabilityId='teaching.lesson.representation_change_strategy';taskMode='representation_change';}
      else {capabilityId='teaching.lesson.hint_level_selection';taskMode='hint_level_selection';}
      const modelResult=await intelligence.recommendPedagogy({context,evaluation,learningUnit:unit,decisionFrame:frame,taskMode,capabilityId,requestKey:'d12-pedagogy:'+evaluationId+':'+String(context.session.state_version)});
      if(modelResult?.accepted&&modelResult.validatedResult?.output){payload=validatePedagogyDecision(modelResult.validatedResult.output,{decisionFrame:frame});executionId=modelResult.executionId||null;state=payload.status==='replan_needed'?'REPLAN_NEEDED':'VALIDATED';}
    }
    if(needsModel&&!intelligence){state='ROUTE_HELD';payload={...payload,status:'diagnosis_required',review_required:true,review_reasons:['Model-backed Pedagogy route remains unqualified until D30; deterministic policy recommendation is preserved without generated teaching content.']};}
    if(answerExposed&&!intelligence){state='ROUTE_HELD';payload={...payload,status:'validation_needed',review_required:true,review_reasons:[...(payload.review_reasons||[]),'Fresh-equivalent verification is required but TPF-04 route remains unqualified until D30.']};}
    if(answerExposed&&intelligence){
      const verificationDirective={target_evidence_claim:diagnosis.evidence_claim_contract?.target_evidence_claim||'independent_performance',target_demand_vector:diagnosis.next_evidence_need?.required_demand_vector||defaultDemandVector(),reuse_policy:'fresh_equivalent_required',inference_ceiling:'fresh independent verification only'};
      const vr=await intelligence.selectFreshVerification({context,evaluation,learningUnit:unit,verificationDirective,candidatePool:[],requestKey:'d12-fresh-verification:'+evaluationId});
      if(vr?.accepted&&vr.validatedResult?.output) payload={...payload,fresh_verification:vr.validatedResult.output};
    }
    const saved=await repository.savePedagogyDecision({studentId:user.id,classId,context,learningUnit:unit,evaluation,capabilityId,taskMode,state,payload,assistanceCeiling:frame.assistance_ceiling,assistanceLevel:payload.assistance?.proposed_level||frame.current_assistance_level,strategyClass:payload.strategy?.strategy_class||strategyClass,blockedProposal:Boolean(payload.state_implications?.blocked_proposal),replanRecommended:Boolean(payload.state_implications?.replan_recommended),provenanceRefs:['response-evaluation:'+evaluationId,'learning-unit:'+unit.learning_unit_id],idempotencyKey:'d12-pedagogy:'+evaluationId+':'+String(context.session.state_version),executionId});
    return Object.freeze({pedagogyDecisionId:saved.pedagogy_decision_id,state:saved.decision_state,payload:saved.decision_payload,assistanceCeiling:saved.assistance_ceiling,assistanceLevel:saved.assistance_level,durableStateCommitted:false,controllerOwner:'D11',skmOwner:'D13'});
  }

  async function recommendPedagogyFromController(user,classId,evaluationId,input={},signals={}){
    return recommendPedagogy(user,classId,evaluationId,input,{[TRUSTED_CONTROLLER_SIGNAL]:true,failedStrategyClasses:signals.failedStrategyClasses||[]});
  }

  async function classifyPedagogyProfile(user,classId,learningUnitId){
    const {context,unit}=await contextAndUnit(user.id,classId,learningUnitId);
    const subject=await repository.getSubject(user.id,context.classRow.subject_id);
    const family=inferSubjectFamily(subject?.name);
    const template=subjectTemplateFor(family);
    if(!intelligence) return Object.freeze({state:'ROUTE_HELD',routeQualification:'UNQUALIFIED_UNTIL_D30',learningUnitId,subjectTemplate:template,subjectTemplateAuthoritative:false,profile:null});
    const key='d12-pedagogy-profile:'+learningUnitId+':'+String(context.plan.version_no);
    const result=await intelligence.classifyPedagogyProfile({context,learningUnit:unit,subjectTemplate:template,requestKey:key});
    const output=result?.validatedResult?.output;
    if(!result?.accepted||!output) fail('Pedagogy Profile classification was not accepted.','TEACHING_D12_PEDAGOGY_PROFILE_NOT_ACCEPTED',422);
    const value=validatePedagogyProfile(output,{learningUnitRef:learningUnitId});
    const saved=await repository.savePedagogyProfile({studentId:user.id,learningUnit:unit,profile:value,provenanceRefs:['learning-unit:'+learningUnitId,'course-plan:'+context.plan.course_plan_id],idempotencyKey:key,executionId:result.executionId||null,state:value.review_required?'REVIEW_NEEDED':'VALIDATED'});
    return Object.freeze({state:saved.profile_state,pedagogyProfileId:saved.pedagogy_profile_id,learningUnitId,profile:saved.profile_payload,subjectTemplate:template,subjectTemplateAuthoritative:false});
  }

  async function getPedagogyProfile(user,learningUnitId){
    const row=await repository.latestPedagogyProfile(user.id,learningUnitId);
    if(!row) return null;
    return Object.freeze({pedagogyProfileId:row.pedagogy_profile_id,state:row.profile_state,learningUnitId:row.learning_unit_id,profile:row.profile_payload,subjectTemplateAuthoritative:false});
  }

  async function analyzeProductiveStruggle(user,classId,input={}){
    const context=await repository.getClassContext(user.id,classId);assertContext(context);assertD12InstructionalMode(context);
    return Object.freeze({...productiveStruggleDecision({...input,assistanceCeiling:assistanceCeiling(context)}),assistanceCeiling:assistanceCeiling(context),mindReadingUsed:false,durableStateCommitted:false});
  }

  async function analyzeTeacherCorrection(user,classId,input={}){
    const context=await repository.getClassContext(user.id,classId);assertContext(context);assertD12InstructionalMode(context);
    const claim=String(input.challengedClaim||'').trim();if(!claim) fail('challengedClaim is required.','TEACHING_D12_TEACHER_CLAIM_REQUIRED',400);
    const sourceEvaluation=input.sourceEvaluationId?await repository.getEvaluation(user.id,input.sourceEvaluationId):null;
    const sources=await repository.getCourseSourceItems(user.id,context.classRow.course_id,input.sourceRefs||[]);
    const key=String(input.idempotencyKey||('d12-teacher-correction:'+classId+':'+randomUUID()));
    if(!intelligence){
      const held=await repository.saveTeacherCorrection({studentId:user.id,classId,context,sourceEvaluation,state:'ROUTE_HELD',payload:{challenged_claim:claim,source_refs:sources.map((s)=>s.source_content_item_id),route_qualification:'UNQUALIFIED_UNTIL_D30'},evidenceRecheckRequired:false,provenanceRefs:sources.map((s)=>'source:'+s.source_content_item_id),idempotencyKey:key});
      return Object.freeze({teacherCorrectionId:held.teacher_correction_id,state:held.correction_state,routeQualification:'UNQUALIFIED_UNTIL_D30',evidenceRecheckRequired:false});
    }
    const result=await intelligence.analyzeTeacherCorrection({context,challengedClaim:claim,authoritativeSources:sources.map((s)=>({ref:'source:'+s.source_content_item_id,kind:s.source_kind,summary:s.content_summary,hash:s.content_hash})),sourceEvaluation,requestKey:key});
    const output=result?.validatedResult?.output;if(!result?.accepted||!output) fail('Teacher self-correction analysis was not accepted.','TEACHING_D12_TEACHER_CORRECTION_NOT_ACCEPTED',422);
    const value=validateTeacherCorrection(output);const tc=value.teacher_correction||value;
    const state=tc.result==='teacher_error_confirmed'?'TEACHER_ERROR_CONFIRMED':tc.result==='teacher_correct'?'TEACHER_CORRECT':tc.result==='unresolved'?'UNRESOLVED':'REVIEW_NEEDED';
    const recheck=Boolean(tc.affected_evidence_recheck_needed);
    const saved=await repository.saveTeacherCorrection({studentId:user.id,classId,context,sourceEvaluation,state,payload:value,evidenceRecheckRequired:recheck,provenanceRefs:sources.map((s)=>'source:'+s.source_content_item_id),idempotencyKey:key,executionId:result.executionId||null});
    let handoff=null;
    if(recheck){handoff=await repository.createEvidenceRecheckHandoff({studentId:user.id,classId,context,teacherCorrection:saved,sourceEvaluation,targetOwner:'SKM/Evidence',payload:{requested_action:'INVALIDATE_OR_RECHECK_DEPENDENT_EVIDENCE',affected_evidence_refs:sourceEvaluation?['response-evaluation:'+sourceEvaluation.evaluation_id]:[],teacher_correction_ref:'teacher-correction:'+saved.teacher_correction_id,d12_does_not_mutate_skm:true},provenanceRefs:['teacher-correction:'+saved.teacher_correction_id],idempotencyKey:'d12-evidence-recheck:'+saved.teacher_correction_id});}
    return Object.freeze({teacherCorrectionId:saved.teacher_correction_id,state:saved.correction_state,evidenceRecheckRequired:recheck,evidenceRecheckHandoffId:handoff?.evidence_recheck_handoff_id||null,durableEvidenceInvalidationCommitted:false,targetOwner:recheck?'SKM/Evidence':null});
  }

  return Object.freeze({captureResponse,evaluateCapturedResponse,evaluateResponse,handleResponseSubmittedEvent,getResponseEvaluation,recommendPedagogy,recommendPedagogyFromController,classifyPedagogyProfile,getPedagogyProfile,analyzeProductiveStruggle,analyzeTeacherCorrection,publicEvaluation});
}

module.exports={createD12Service,currentAssistance,assistanceCeiling,evidenceClaimForContext,inferSubjectFamily,misconceptionOwnerHandoff};
