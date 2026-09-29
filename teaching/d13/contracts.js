'use strict';

const KNOWLEDGE_STATES = Object.freeze(['UNSEEN','INTRODUCED','ASSISTED','EMERGING','INDEPENDENT','SECURE','TRANSFERABLE']);
const KNOWLEDGE_STATE_SET = Object.freeze(new Set(KNOWLEDGE_STATES));
const OVERLAYS = Object.freeze(['FRAGILE','BLOCKED','REGRESSED']);
const OVERLAY_SET = Object.freeze(new Set(OVERLAYS));
const EVIDENCE_VALIDITY = Object.freeze(new Set(['VALID','REVIEW_NEEDED','INVALID','SYSTEM_PROTECTED']));
const EVIDENCE_OUTCOMES = Object.freeze(new Set(['SUCCESS','PARTIAL','FAILURE','NO_EVIDENCE','INDETERMINATE','EXPOSURE_ONLY']));
const EVIDENCE_QUALITY = Object.freeze(new Set(['STRONG','MODERATE','WEAK','UNUSABLE']));
const CERTAINTY_STATES = Object.freeze(new Set(['UNKNOWN','LIMITED','MODERATE','HIGH','REVIEW_DUE']));
const CONFIDENCE_BANDS = Object.freeze(new Set(['LOW','MEDIUM','HIGH','UNKNOWN']));
const CONTROL_CONTEXTS = Object.freeze(new Set(['INSTRUCTIONAL','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','CONTROLLED_ASSESSMENT','DIAGNOSTIC','HOMEWORK','UNKNOWN']));
const ANSWER_EXPOSURE = Object.freeze(new Set(['NONE','PARTIAL','ESSENTIAL_METHOD','ANSWER','UNKNOWN']));
const ASSISTANCE_LEVELS = Object.freeze(['none','attention','directional','conceptual','partial_step','strong_scaffold','worked_example','full_instruction','unknown']);
const ASSISTANCE_RANK = Object.freeze(Object.fromEntries(ASSISTANCE_LEVELS.map((v,i)=>[v,i])));
const DIMENSION_STATUSES = Object.freeze(new Set(['NOT_APPLICABLE','INSUFFICIENT_EVIDENCE','DEVELOPING','SUPPORTED','STRONG','CONTRADICTORY','REVIEW_NEEDED']));
const LEARNING_ANALYSIS_LABELS = Object.freeze(new Set(['strong','improving','fragile','needs reinforcement','needs verification','not enough evidence']));
const ALGORITHM_VERSION = 'skm-evidence-state-machine.v1';
const EVIDENCE_SCHEMA_VERSION = 'd13.evidence-event.v1';
const STATE_CONTRACT_VERSION = 'd13.skm-state.v1';

function fail(message, code, status=422, details=null){
  const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;throw e;
}
function isObject(v){return Boolean(v)&&typeof v==='object'&&!Array.isArray(v);}
function str(v,code,{optional=false}={}){const s=String(v??'').trim();if(!s&&!optional)fail('Expected non-empty string.',code,400);return s||null;}
function arr(v,code){if(!Array.isArray(v))fail('Expected array.',code,400);return v;}
function obj(v,code){if(!isObject(v))fail('Expected object.',code,400);return v;}
function enumVal(v,set,code,{optional=false}={}){if((v===null||v===undefined||v==='')&&optional)return null;const s=String(v).trim();if(!set.has(s))fail('Unsupported enum value.',code,422,{value:s});return s;}
function bool(v,code,{optional=false}={}){if((v===null||v===undefined)&&optional)return null;if(typeof v!=='boolean')fail('Expected boolean.',code,400);return v;}
function freezeDeep(value){
  if(Array.isArray(value)){for(const item of value)freezeDeep(item);return Object.freeze(value);}
  if(isObject(value)){for(const item of Object.values(value))freezeDeep(item);return Object.freeze(value);}
  return value;
}
function uniqueStrings(values){return Object.freeze([...new Set((values||[]).map(v=>String(v).trim()).filter(Boolean))]);}
function time(v,code,{optional=false}={}){if((v===null||v===undefined||v==='')&&optional)return null;const d=new Date(v);if(Number.isNaN(d.getTime()))fail('Invalid timestamp.',code,400);return d.toISOString();}

function normalizeDemandContext(input={}){
  const v=obj(input,'TEACHING_D13_DEMAND_CONTEXT_INVALID');
  const familiarity=new Set(['exact_reuse','near_reuse','familiar_family','fresh_equivalent','new_representation','new_context_same_construct','integrated','unknown','not_applicable']);
  const methodCueing=new Set(['explicit','partial','none','not_applicable','unknown']);
  const representation=new Set(['same_representation','alternate_familiar_representation','new_legitimate_representation','cross_representation_connection','not_applicable','unknown']);
  const integration=new Set(['isolated_construct','multi_step_same_construct','combine_eligible_constructs','embedded_in_broader_problem','not_applicable','unknown']);
  const retention=new Set(['immediate','same_session_later','spaced','delayed','not_applicable','unknown']);
  return freezeDeep({
    familiarity: enumVal(v.familiarity??'unknown',familiarity,'TEACHING_D13_DEMAND_FAMILIARITY_INVALID'),
    method_cueing: enumVal(v.method_cueing??'unknown',methodCueing,'TEACHING_D13_DEMAND_CUEING_INVALID'),
    representation_demand: enumVal(v.representation_demand??'unknown',representation,'TEACHING_D13_DEMAND_REPRESENTATION_INVALID'),
    integration_demand: enumVal(v.integration_demand??'unknown',integration,'TEACHING_D13_DEMAND_INTEGRATION_INVALID'),
    retention_timing: enumVal(v.retention_timing??'unknown',retention,'TEACHING_D13_DEMAND_RETENTION_INVALID'),
    transfer_eligible: v.transfer_eligible===true,
    same_eligible_construct: v.same_eligible_construct!==false,
    prerequisite_boundary_validated: v.prerequisite_boundary_validated!==false,
  });
}

function normalizeSupportContext(input={}){
  const v=isObject(input)?input:{};
  const level=String(v.assistance_level??'unknown').trim().toLowerCase();
  if(!(level in ASSISTANCE_RANK))fail('Invalid instructional assistance level.','TEACHING_D13_ASSISTANCE_INVALID');
  return freezeDeep({
    assistance_level:level,
    instructional_support_refs:uniqueStrings(v.instructional_support_refs||[]),
    answer_method_exposure:enumVal(String(v.answer_method_exposure??'UNKNOWN').toUpperCase(),ANSWER_EXPOSURE,'TEACHING_D13_EXPOSURE_INVALID'),
    permitted_tools:uniqueStrings(v.permitted_tools||[]),
    accessibility_support:uniqueStrings(v.accessibility_support||[]),
    accessibility_support_is_instructional_assistance:false,
  });
}

function validateNormalizedEvidenceEvent(input={}){
  const v=obj(input,'TEACHING_D13_EVIDENCE_INVALID');
  const demand=normalizeDemandContext(v.demand_context||{});
  const support=normalizeSupportContext(v.support_context||{});
  const validity=enumVal(String(v.evidence_validity??'VALID').toUpperCase(),EVIDENCE_VALIDITY,'TEACHING_D13_EVIDENCE_VALIDITY_INVALID');
  const outcome=enumVal(String(v.outcome??'INDETERMINATE').toUpperCase(),EVIDENCE_OUTCOMES,'TEACHING_D13_EVIDENCE_OUTCOME_INVALID');
  const confidenceSampled=v.confidence_sampled===true;
  const studentConfidence=confidenceSampled
    ? enumVal(String(v.student_confidence??'UNKNOWN').toUpperCase(),CONFIDENCE_BANDS,'TEACHING_D13_STUDENT_CONFIDENCE_INVALID')
    : null;
  if(!confidenceSampled && v.student_confidence!=null) fail('Student confidence may only be stored when explicitly sampled.','TEACHING_D13_CONFIDENCE_NOT_SAMPLED');
  const normalized={
    evidence_event_id:str(v.evidence_event_id,'TEACHING_D13_EVIDENCE_ID_REQUIRED'),
    student_id:str(v.student_id,'TEACHING_D13_STUDENT_ID_REQUIRED'),
    course_id:str(v.course_id,'TEACHING_D13_COURSE_ID_REQUIRED'),
    learning_unit_id:str(v.learning_unit_id,'TEACHING_D13_LEARNING_UNIT_REQUIRED'),
    source_response_id:str(v.source_response_id,'TEACHING_D13_SOURCE_RESPONSE_INVALID',{optional:true}),
    source_evaluation_id:str(v.source_evaluation_id,'TEACHING_D13_SOURCE_EVALUATION_INVALID',{optional:true}),
    source_owner:str(v.source_owner??'SKM/Evidence','TEACHING_D13_SOURCE_OWNER_REQUIRED'),
    evidence_kind:str(v.evidence_kind,'TEACHING_D13_EVIDENCE_KIND_REQUIRED'),
    evidence_purpose:str(v.evidence_purpose,'TEACHING_D13_EVIDENCE_PURPOSE_REQUIRED'),
    formal_assessment:v.formal_assessment===true,
    diagnostic:v.diagnostic===true,
    task_ref:str(v.task_ref,'TEACHING_D13_TASK_REF_INVALID',{optional:true}),
    construct_ref:str(v.construct_ref??v.learning_unit_id,'TEACHING_D13_CONSTRUCT_REF_REQUIRED'),
    outcome,
    response_quality:isObject(v.response_quality)?v.response_quality:{},
    instructional_lineage_refs:uniqueStrings(v.instructional_lineage_refs||[]),
    demand_context:demand,
    support_context:support,
    independent_performance:v.independent_performance===true,
    control_context:enumVal(String(v.control_context??'UNKNOWN').toUpperCase(),CONTROL_CONTEXTS,'TEACHING_D13_CONTROL_CONTEXT_INVALID'),
    observed_errors:Array.isArray(v.observed_errors)?v.observed_errors:[],
    confidence_sampled:confidenceSampled,
    student_confidence:studentConfidence,
    comparability_group:str(v.comparability_group,'TEACHING_D13_COMPARABILITY_GROUP_INVALID',{optional:true}),
    redundancy_key:str(v.redundancy_key,'TEACHING_D13_REDUNDANCY_KEY_INVALID',{optional:true}),
    misconception_signal:isObject(v.misconception_signal)?v.misconception_signal:null,
    path_signal:isObject(v.path_signal)?v.path_signal:null,
    retention_review_due_at:time(v.retention_review_due_at,'TEACHING_D13_RETENTION_DUE_INVALID',{optional:true}),
    system_failure_protected:v.system_failure_protected===true,
    evidence_validity:validity,
    occurred_at:time(v.occurred_at,'TEACHING_D13_EVIDENCE_OCCURRED_AT_REQUIRED'),
    provenance_refs:uniqueStrings(v.provenance_refs||[]),
    evidence_schema_version:str(v.evidence_schema_version??EVIDENCE_SCHEMA_VERSION,'TEACHING_D13_EVIDENCE_SCHEMA_VERSION_REQUIRED'),
  };
  if(normalized.system_failure_protected && normalized.evidence_validity==='VALID') normalized.evidence_validity='SYSTEM_PROTECTED';
  if(normalized.diagnostic && normalized.formal_assessment) fail('Diagnostic evidence cannot simultaneously be formal graded assessment evidence.','TEACHING_D13_EVIDENCE_PURPOSE_CONFLICT');
  return freezeDeep(normalized);
}

function assistanceIsMaterial(level){
  const rank=ASSISTANCE_RANK[String(level||'unknown').toLowerCase()] ?? ASSISTANCE_RANK.unknown;
  return rank>=ASSISTANCE_RANK.conceptual;
}
function answerOrMethodExposed(event){return ['ESSENTIAL_METHOD','ANSWER'].includes(event.support_context.answer_method_exposure);}
function usableForState(event){return event.evidence_validity==='VALID'&&!event.system_failure_protected&&!answerOrMethodExposed(event);}
function isSuccess(event){return event.outcome==='SUCCESS';}
function isFailure(event){return event.outcome==='FAILURE';}
function isIndependent(event){
  return event.independent_performance===true && !assistanceIsMaterial(event.support_context.assistance_level) && !answerOrMethodExposed(event);
}
function isDelayed(event){return event.demand_context.retention_timing==='delayed';}
function isTransferDemand(event){
  const d=event.demand_context;
  const varied=['new_representation','new_context_same_construct','integrated'].includes(d.familiarity)
    || ['new_legitimate_representation','cross_representation_connection'].includes(d.representation_demand)
    || ['combine_eligible_constructs','embedded_in_broader_problem'].includes(d.integration_demand);
  return d.transfer_eligible===true && d.same_eligible_construct===true && d.prerequisite_boundary_validated===true && d.method_cueing==='none' && varied;
}

function classifyEvidenceQuality(input){
  const event=validateNormalizedEvidenceEvent(input);
  if(!usableForState(event)) return freezeDeep({quality:'UNUSABLE',reason:'INVALID_REVIEW_SYSTEM_PROTECTED_OR_EXPOSED',independent:false,information_gain:'NONE'});
  const independent=isIndependent(event);
  if(event.outcome==='NO_EVIDENCE'||event.outcome==='INDETERMINATE') return freezeDeep({quality:'UNUSABLE',reason:'NO_INTERPRETABLE_EVIDENCE',independent,information_gain:'NONE'});
  const delayed=isDelayed(event);
  const transfer=isTransferDemand(event);
  const controlled=event.control_context==='CONTROLLED_ASSESSMENT';
  const weakReuse=['exact_reuse','near_reuse'].includes(event.demand_context.familiarity);
  let quality='WEAK';
  if(independent && (controlled||delayed||transfer)) quality='STRONG';
  else if(independent && !weakReuse) quality='MODERATE';
  else if(independent) quality='WEAK';
  else if(isSuccess(event) && !assistanceIsMaterial(event.support_context.assistance_level)) quality='WEAK';
  else quality='WEAK';
  const information_gain=quality==='STRONG'?'HIGH':quality==='MODERATE'?'MODERATE':'LOW';
  return freezeDeep({quality,reason:'DETERMINISTIC_EVIDENCE_QUALITY_V1',independent,delayed,transfer,controlled,information_gain});
}

function evidenceContribution(input){
  const event=validateNormalizedEvidenceEvent(input);
  const quality=classifyEvidenceQuality(event);
  const success=isSuccess(event);
  const failure=isFailure(event);
  const independent=quality.independent;
  const materialSupport=assistanceIsMaterial(event.support_context.assistance_level);
  const contribution= !usableForState(event) ? 'NO_STATE_EFFECT'
    : event.outcome==='EXPOSURE_ONLY' ? 'INTRODUCTION_ONLY'
    : success && independent && quality.transfer ? 'TRANSFER_SUCCESS'
    : success && independent && quality.delayed ? 'DELAYED_INDEPENDENT_SUCCESS'
    : success && independent ? 'INDEPENDENT_SUCCESS'
    : success && materialSupport ? 'ASSISTED_SUCCESS'
    : failure && independent && quality.delayed ? 'DELAYED_INDEPENDENT_FAILURE'
    : failure && independent ? 'INDEPENDENT_FAILURE'
    : failure ? 'ASSISTED_OR_UNCONTROLLED_FAILURE'
    : 'NO_STATE_EFFECT';
  const highConfidenceWrong=event.confidence_sampled&&event.student_confidence==='HIGH'&&failure;
  const lowConfidenceCorrect=event.confidence_sampled&&event.student_confidence==='LOW'&&success;
  return freezeDeep({event,quality,...quality,contribution,success,failure,materialSupport,highConfidenceWrong,lowConfidenceCorrect});
}

function strengthRank(q){return {UNUSABLE:0,WEAK:1,MODERATE:2,STRONG:3}[q]||0;}
function deduplicateE