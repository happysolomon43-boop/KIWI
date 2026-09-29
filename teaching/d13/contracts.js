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
    representation_demand: enumVal(v.representatio