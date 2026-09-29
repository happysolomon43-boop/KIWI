'use strict';

const {
  SKM_ALGORITHM_ID,
  SKM_ALGORITHM_VERSION,
  BASE_STATES,
  OVERLAYS,
} = require('./state-engine');

const EVIDENCE_CLAIMS=new Set(['recall','reproduce','independent_performance','adapt_to_variation','select_method','retain_after_delay','integrate_or_transfer','other']);
const VALIDITY=new Set(['VALID','LIMITED','CONTAMINATED','INVALID','UNKNOWN']);
const STRENGTH=new Set(['STRONG','MODERATE','WEAK','UNUSABLE','INDETERMINATE']);
const INFORMATION_GAIN=new Set(['LOW','MODERATE','HIGH','UNKNOWN']);
const REDUNDANCY=new Set(['NEW_INFORMATION','PARTLY_REDUNDANT','HIGHLY_REDUNDANT','UNKNOWN']);
const CONTROL=new Set(['CONTROLLED','PARTIALLY_CONTROLLED','UNCONTROLLED','UNKNOWN']);
const ASSISTANCE=new Set(['none','attention','directional','conceptual','partial_step','strong_scaffold','worked_example','full_instruction','unknown']);

function fail(message,code,status=422,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;throw e;}
function obj(value,code){if(!value||typeof value!=='object'||Array.isArray(value))fail('Expected structured object.',code);return value;}
function arr(value,code){if(!Array.isArray(value))fail('Expected array.',code);return value;}
function str(value,code){const out=String(value??'').trim();if(!out)fail('Expected non-empty string.',code);return out;}
function boolOrNull(value,code){if(value!==true&&value!==false&&value!==null&&value!==undefined)fail('Expected boolean or null.',code);return value==null?null:value;}
function enumValue(value,set,code,{upper=false}={}){const out=upper?String(value??'').trim().toUpperCase():String(value??'').trim().toLowerCase();if(!set.has(out))fail('Unsupported enum value.',code,422,{value:out});return out;}

function forbiddenAuthorityPath(value,path=''){
  if(Array.isArray(value)){for(let i=0;i<value.length;i+=1){const found=forbiddenAuthorityPath(value[i],path+'['+i+']');if(found)return found;}return null;}
  if(!value||typeof value!=='object')return null;
  const forbidden=new Set([
    'official_mark','official_marks','official_grade','official_percentage','grade','grades',
    'gradebook_write','gradebook_mark','gradebook_percentage',
    'progression_outcome','progression_decision','pass_fail',
    'mastery_state','knowledge_state','student_knowledge_state','skm_state','durable_state',
    'mastery_probability','mastery_percentage','mastery_score','knowledge_probability','knowledge_score',
    'durable_mastery','ability_label','intelligence_label','personality_label',
  ]);
  for(const [key,child] of Object.entries(value)){
    const here=path?path+'.'+key:key;
    if(forbidden.has(key))return here;
    if(['gradebook_changed','progression_decided','skm_state_committed','durable_state_committed'].includes(key) && child!==false)return here;
    const found=forbiddenAuthorityPath(child,here);if(found)return found;
  }
  return null;
}

function validateDemandVector(value){
  const v=obj(value,'TEACHING_D13_DEMAND_VECTOR_INVALID');
  const sets={
    familiarity:new Set(['exact_reuse','near_reuse','familiar_family','fresh_equivalent','new_representation','new_context_same_construct','integrated','unknown']),
    method_cueing:new Set(['explicit','partial','none','not_applicable']),
    representation_demand:new Set(['same_representation','alternate_familiar_representation','new_legitimate_representation','cross_representation_connection','not_applicable']),
    integration_demand:new Set(['isolated_construct','multi_step_same_construct','combine_eligible_constructs','embedded_in_broader_problem','not_applicable']),
    retention_timing:new Set(['immediate','same_session_later','spaced','delayed','not_applicable']),
  };
  return Object.freeze(Object.fromEntries(Object.entries(sets).map(([key,set])=>[key,enumValue(v[key],set,'TEACHING_D13_DEMAND_VECTOR_INVALID')])));
}

function validateNormalizedEvidence(input){
  const v=obj(input,'TEACHING_D13_EVIDENCE_SCHEMA_INVALID');
  const forbidden=forbiddenAuthorityPath(v);if(forbidden)fail('Evidence ingress exceeded D13 authority.','TEACHING_D13_EVIDENCE_AUTHORITY_EXCEEDED',422,{field:forbidden});
  const learningUnitRefs=arr(v.learningUnitRefs,'TEACHING_D13_EVIDENCE_LEARNING_UNITS_INVALID').map(String).filter(Boolean);
  if(!learningUnitRefs.length)fail('At least one Learning Unit is required.','TEACHING_D13_EVIDENCE_LEARNING_UNIT_REQUIRED');
  const claim=enumValue(v.evidenceClaim,EVIDENCE_CLAIMS,'TEACHING_D13_EVIDENCE_CLAIM_INVALID');
  const demand=validateDemandVector(v.demandVector);
  const validity=enumValue(v.evidenceValidity,VALIDITY,'TEACHING_D13_EVIDENCE_VALIDITY_INVALID',{upper:true});
  const strength=enumValue(v.evidentialStrength,STRENGTH,'TEACHING_D13_EVIDENCE_STRENGTH_INVALID',{upper:true});
  const info=enumValue(v.informationGain,INFORMATION_GAIN,'TEACHING_D13_EVIDENCE_INFO_GAIN_INVALID',{upper:true});
  const redundancy=enumValue(v.redundancy,REDUNDANCY,'TEACHING_D13_EVIDENCE_REDUNDANCY_INVALID',{upper:true});
  const control=enumValue(v.controlContext,CONTROL,'TEACHING_D13_EVIDENCE_CONTROL_INVALID',{upper:true});
  const assistance=enumValue(v.assistanceLevel||'unknown',ASSISTANCE,'TEACHING_D13_EVIDENCE_ASSISTANCE_INVALID');
  const occurred=new Date(v.occurredAt);if(!Number.isFinite(occurred.getTime()))fail('Evidence occurredAt must be authoritative server-compatible time.','TEACHING_D13_EVIDENCE_TIME_INVALID');
  const sourceOwner=str(v.sourceOwner,'TEACHING_D13_EVIDENCE_SOURCE_OWNER_REQUIRED');
  const blockCondition=String(v.pathContext?.block_condition||'').trim().toUpperCase();
  if(blockCondition && !['BLOCKED','CLEAR'].includes(blockCondition))fail('Unsupported authoritative block condition.','TEACHING_D13_BLOCK_CONDITION_INVALID');
  if(blockCondition && !['TEACHING_CONTROLLER','LESSON_PLANNER','TEACHING CONTROLLER / LESSON PLANNER'].includes(sourceOwner.toUpperCase())){
    fail('Only Teaching Controller/Lesson Planner authority may set or clear BLOCKED.','TEACHING_D13_BLOCK_OWNER_INVALID',403);
  }
  if(validity==='INVALID' && strength!=='UNUSABLE')fail('Invalid evidence must be unusable for state inference.','TEACHING_D13_INVALID_EVIDENCE_MUST_BE_UNUSABLE');
  if(v.answerOrMethodExposed===true && strength!=='UNUSABLE')fail('Answer/method exposure cannot remain clean independent evidence.','TEACHING_D13_EXPOSED_EVIDENCE_MUST_BE_UNUSABLE');
  return Object.freeze({
    sourceOwner,
    sourceRef:str(v.sourceRef,'TEACHING_D13_EVIDENCE_SOURCE_REF_REQUIRED'),
    courseId:str(v.courseId,'TEACHING_D13_EVIDENCE_COURSE_REQUIRED'),
    classSessionId:v.classSessionId==null?null:String(v.classSessionId),
    sourceResponseId:v.sourceResponseId==null?null:String(v.sourceResponseId),
    learningUnitRefs:Object.freeze([...new Set(learningUnitRefs)]),
    evidenceKind:str(v.evidenceKind||'LEARNING_RESPONSE','TEACHING_D13_EVIDENCE_KIND_REQUIRED'),
    evidencePurpose:str(v.evidencePurpose||'LEARNING','TEACHING_D13_EVIDENCE_PURPOSE_REQUIRED'),
    formalAssessment:Boolean(v.formalAssessment),
    independentPerformance:boolOrNull(v.independentPerformance,'TEACHING_D13_EVIDENCE_INDEPENDENCE_INVALID'),
    assistanceLevel:assistance,
    responseQuality:Object.freeze({...obj(v.responseQuality||{},'TEACHING_D13_RESPONSE_QUALITY_INVALID')}),
    difficultyContext:Object.freeze({...obj(v.difficultyContext||{},'TEACHING_D13_DIFFICULTY_CONTEXT_INVALID')}),
    noveltyContext:Object.freeze({...obj(v.noveltyContext||{},'TEACHING_D13_NOVELTY_CONTEXT_INVALID')}),
    observedErrors:Object.freeze(arr(v.observedErrors||[],'TEACHING_D13_OBSERVED_ERRORS_INVALID').map((x)=>Object.freeze({...x}))),
    occurredAt:occurred.toISOString(),
    taskRef:v.taskRef==null?null:String(v.taskRef),
    evidenceClaim:claim,
    demandVector:demand,
    instructionalLineageRefs:Object.freeze(arr(v.instructionalLineageRefs||[],'TEACHING_D13_LINEAGE_INVALID').map(String)),
    supportContext:Object.freeze(arr(v.supportContext||[],'TEACHING_D13_SUPPORT_CONTEXT_INVALID').map((x)=>Object.freeze({...x}))),
    answerOrMethodExposed:Boolean(v.answerOrMethodExposed),
    permittedTools:Object.freeze(arr(v.permittedTools||[],'TEACHING_D13_PERMITTED_TOOLS_INVALID').map(String)),
    accessibilitySupport:Object.freeze({...obj(v.accessibilitySupport||{},'TEACHING_D13_ACCESSIBILITY_SUPPORT_INVALID')}),
    controlContext:control,
    confidenceSample:Object.freeze({...obj(v.confidenceSample||{},'TEACHING_D13_CONFIDENCE_SAMPLE_INVALID')}),
    misconceptionContext:Object.freeze({...obj(v.misconceptionContext||{},'TEACHING_D13_MISCONCEPTION_CONTEXT_INVALID')}),
    prerequisiteContext:Object.freeze({...obj(v.prerequisiteContext||{},'TEACHING_D13_PREREQUISITE_CONTEXT_INVALID')}),
    pathContext:Object.freeze({...obj(v.pathContext||{},'TEACHING_D13_PATH_CONTEXT_INVALID')}),
    evidenceValidity:validity,
    evidentialStrength:strength,
    informationGain:info,
    comparabilityGroup:v.comparabilityGroup==null?null:String(v.comparabilityGroup),
    redundancy,
    provenanceRefs:Object.freeze(arr(v.provenanceRefs||[],'TEACHING_D13_PROVENANCE_INVALID').map(String)),
    normalizationVersion:String(v.normalizationVersion||'d13.evidence-normalization.v1'),
  });
}

function confidenceBand(input){
  if(!input||input.provided!==true)return {provided:false,band:null};
  const raw=String(input.band??input.value_or_band??input.value??'').trim().toLowerCase();
  if(/high|very confident|certain/.test(raw))return {provided:true,band:'high'};
  if(/medium|moderate/.test(raw))return {provided:true,band:'medium'};
  if(/low|unsure|not confident/.test(raw))return {provided:true,band:'low'};
  return {provided:true,band:'unknown'};
}
function evidenceValidityFromEvaluation(payload){
  const item=payload.item_validity||{};
  const status=String(item.status||'unknown').toLowerCase();
  const use=String(item.evidence_use_limit||'none').toLowerCase();
  const correctness=String(payload.response_assessment?.final_result_correctness||'').toLowerCase();
  const systemFailure=payload.attempt_context?.known_system_or_network_interruption===true;
  if(systemFailure)return 'INVALID';
  if(status==='invalid'||use==='cannot_evaluate')return 'INVALID';
  if(item.student_penalty_protection_required===true||use==='do_not_use_negative_evidence'){
    return ['incorrect','partially_correct'].includes(correctness)?'INVALID':'LIMITED';
  }
  if(status==='concern')return 'LIMITED';
  return status==='valid'?'VALID':'UNKNOWN';
}
function informationGainFromContract(contract,exposed){
  if(exposed)return 'LOW';
  const d=contract.demand_vector||{};
  if(['delayed','spaced'].includes(String(d.retention_timing||'')))return 'HIGH';
  if(['integrated','new_representation','new_context_same_construct'].includes(String(d.familiarity||'')))return 'HIGH';
  if(['combine_eligible_constructs','embedded_in_broader_problem'].includes(String(d.integration_demand||'')))return 'HIGH';
  if(['exact_reuse','near_reuse'].includes(String(d.familiarity||'')))return 'LOW';
  return 'MODERATE';
}
function strengthFromEvaluation(bundle,validity,info,exposed){
  if(validity==='INVALID'||exposed||String(bundle.evaluation.evidence_strength||'').toUpperCase()==='CONTAMINATED')return 'UNUSABLE';
  const upstream=String(bundle.evaluation.evidence_strength||'UNKNOWN').toUpperCase();
  const suff=String(bundle.evaluation.evaluation_payload?.response_assessment?.evidence_sufficiency||'').toLowerCase();
  if(upstream==='FULL' && suff==='sufficient_for_requested_inference' && info==='HIGH')return 'STRONG';
  if(upstream==='FULL' && suff==='sufficient_for_requested_inference')return 'MODERATE';
  if(upstream==='LIMITED')return 'MODERATE';
  if(upstream==='ASSISTED')return 'WEAK';
  return 'INDETERMINATE';
}
function normalizeD12EvaluationBundle(bundle){
  const evaluation=bundle?.evaluation;const response=bundle?.response;const unit=bundle?.learningUnit;const classRow=bundle?.classRow;
  if(!evaluation||!response||!unit||!classRow)fail('D12 evaluation bundle is incomplete.','TEACHING_D13_D12_BUNDLE_INCOMPLETE',409);
  if(String(evaluation.evaluation_state)!=='VALIDATED')fail('Only validated D12 evaluations may become D13 evidence.','TEACHING_D13_D12_EVALUATION_NOT_VALIDATED',409);
  const payload=evaluation.evaluation_payload||{};
  const claim=payload.evidence_claim_contract||{};
  const assistance=payload.assistance_and_independence||{};
  const exposure=evaluation.exposure_state||{};
  const exposed=Boolean(exposure.answer_or_method_exposed || exposure.fresh_verification_needed || response.assistance_context?.answer_or_method_exposed);
  const systemFailure=payload.attempt_context?.known_system_or_network_interruption===true;
  const validity=evidenceValidityFromEvaluation(payload);
  const info=informationGainFromContract(claim,exposed);
  const upstreamIndependence=String(assistance.independence_interpretation||'').toLowerCase();
  const independent=evaluation.evidence_strength==='FULL' && upstreamIndependence==='independent_supported' && !exposed ? true :
    evaluation.evidence_strength==='CONTAMINATED' || exposed ? false : null;
  const d=validateDemandVector(claim.demand_vector||{
    familiarity:'unknown',method_cueing:'not_applicable',representation_demand:'not_applicable',integration_demand:'not_applicable',retention_timing:'not_applicable',
  });
  const redundancy=d.familiarity==='exact_reuse'?'HIGHLY_REDUNDANT':['near_reuse','familiar_family'].includes(d.familiarity)?'PARTLY_REDUNDANT':'NEW_INFORMATION';
  const prior=bundle.priorPedagogy||[];
  const path={
    prior_pedagogy_refs:prior.map((row)=>'pedagogy-decision:'+row.pedagogy_decision_id),
    prior_strategy_classes:[...new Set(prior.map((row)=>row.strategy_class).filter(Boolean).map(String))],
    representation:null,
    blocked_proposal_confirmed:prior.some((row)=>row.blocked_proposal===true) && String(payload.prerequisite?.status||'')==='investigation_needed',
  };
  const responseQuality=payload.response_assessment||{};
  return validateNormalizedEvidence({
    sourceOwner:'D12_RESPONSE_EVALUATOR',
    sourceRef:'response-evaluation:'+evaluation.evaluation_id,
    courseId:classRow.course_id,
    classSessionId:evaluation.class_session_id,
    sourceResponseId:evaluation.response_id,
    learningUnitRefs:[evaluation.learning_unit_id],
    evidenceKind:'CLASS_RESPONSE',
    evidencePurpose:'LEARNING',
    formalAssessment:false,
    independentPerformance:independent,
    assistanceLevel:String(response.assistance_context?.assistance_level||assistance.assistance_level||'unknown'),
    responseQuality,
    difficultyContext:{
      task_mode:'class_response',
      learning_stage_supported:responseQuality.learning_stage_supported||null,
      kiwi_or_network_failure_protected:systemFailure,
      student_penalty_protection_required:payload.item_validity?.student_penalty_protection_required===true,
    },
    noveltyContext:{familiarity:d.familiarity,reuse_policy:claim.reuse_policy||null},
    observedErrors:payload.error_analysis||[],
    occurredAt:response.server_received_at||response.submitted_at||evaluation.created_at,
    taskRef:payload.task_ref||('response:'+evaluation.response_id),
    evidenceClaim:claim.target_evidence_claim||'other',
    demandVector:d,
    instructionalLineageRefs:claim.instructional_lineage_refs||[],
    supportContext:assistance.support_context||[],
    answerOrMethodExposed:exposed,
    permittedTools:response.assistance_context?.permitted_tools||[],
    accessibilitySupport:response.assistance_context?.accessibility_support||{},
    controlContext:'PARTIALLY_CONTROLLED',
    confidenceSample:confidenceBand(payload.student_reported_confidence||{}),
    misconceptionContext:evaluation.candidate_misconception||payload.misconception||{},
    prerequisiteContext:evaluation.prerequisite_hypothesis||payload.prerequisite||{},
    pathContext:path,
    evidenceValidity:validity,
    evidentialStrength:strengthFromEvaluation(bundle,validity,info,exposed),
    informationGain:info,
    comparabilityGroup:redundancy==='HIGHLY_REDUNDANT' ? [evaluation.learning_unit_id,claim.target_evidence_claim,d.familiarity,d.method_cueing].join(':') : null,
    redundancy,
    provenanceRefs:['response:'+evaluation.response_id,'response-evaluation:'+evaluation.evaluation_id,'learning-unit:'+evaluation.learning_unit_id,...(evaluation.provenance_refs||[])],
  });
}

function validateTPF09Output(output,{expectedStateReference=null,taskMode=null,learningUnitRefs=[]}={}){
  const v=obj(output,'TEACHING_D13_TPF09_SCHEMA_INVALID');
  const forbidden=forbiddenAuthorityPath(v);if(forbidden)fail('TPF-09 output attempted an authoritative mutation.','TEACHING_D13_TPF09_AUTHORITY_EXCEEDED',422,{field:forbidden});
  const statuses=new Set(['ok','insufficient_context','contradictory_evidence','evidence_invalid_or_contaminated','modality_limit','policy_block','further_evidence_needed']);
  enumValue(v.status,statuses,'TEACHING_D13_TPF09_STATUS_INVALID');
  if(expectedStateReference!=null&&String(v.input_state_reference)!==String(expectedStateReference))fail('TPF-09 state reference is stale/mismatched.','TEACHING_D13_TPF09_STATE_REF_MISMATCH',409);
  const scope=obj(v.analysis_scope,'TEACHING_D13_TPF09_SCOPE_INVALID');
  if(taskMode&&String(scope.task_mode)!==String(taskMode))fail('TPF-09 task mode mismatch.','TEACHING_D13_TPF09_TASK_MODE_MISMATCH');
  const outputRefs=arr(scope.learning_unit_refs||[],'TEACHING_D13_TPF09_LU_REFS_INVALID').map(String);
  if(learningUnitRefs.some((ref)=>!outputRefs.includes(String(ref))))fail('TPF-09 analysis omitted requested Learning Unit scope.','TEACHING_D13_TPF09_SCOPE_MISMATCH');
  const boundaries=obj(v.official_record_boundaries||{},'TEACHING_D13_TPF09_BOUNDARIES_INVALID');
  for(const key of ['gradebook_changed','skm_state_committed','vpk_certified','assessment_eligibility_changed','progression_decided']){
    if(boundaries[key]!==false)fail('TPF-09 must leave official record mutations to owners.','TEACHING_D13_TPF09_AUTHORITY_EXCEEDED',422,{field:key});
  }
  for(const signal of arr(v.learning_findings?.state_signals||[],'TEACHING_D13_TPF09_STATE_SIGNALS_INVALID')){
    if(signal?.candidate && signal.candidate!=='none' && !BASE_STATES.includes(String(signal.candidate)) && !OVERLAYS.includes(String(signal.candidate)))fail('TPF-09 emitted unsupported state signal.','TEACHING_D13_TPF09_STATE_SIGNAL_INVALID');
  }
  return Object.freeze(v);
}

module.exports={
  SKM_ALGORITHM_ID,SKM_ALGORITHM_VERSION,
  validateDemandVector,validateNormalizedEvidence,normalizeD12EvaluationBundle,validateTPF09Output,
  forbiddenAuthorityPath,
};
