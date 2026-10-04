'use strict';
const crypto=require('node:crypto');
const D28_CONTRACT_VERSION='d28.operational-hardening.v1';
const ANALYTICS_METHOD_VERSION='kiwi-item-analytics-v1.0';
const SUFFICIENCY=Object.freeze({INSUFFICIENT:'insufficient_data',DESCRIPTIVE:'descriptive_only',REVIEW:'review_signal',SUPPORTED:'analysis_supported',NOT_APPLICABLE:'not_applicable',CONTENT_ONLY:'content_comparable_not_empirically_equated'});
const INTERACTION_SLOS_MS=Object.freeze({LIVE_TEACHER_RESPONSE:8000,CLASSROOM_TRANSITION:1500,ASSESSMENT_AUTOSAVE:1500,ASSESSMENT_SUBMIT:5000,SCHEDULE_RECALCULATION:10000,ASSESSMENT_GENERATION:60000,MARKING:60000,BACKGROUND_PREPARATION:120000});
const RETENTION_CLASSES=Object.freeze({OPERATIONAL_EVENTS:90,OPERATIONAL_METRICS:180,QUALITY_SAMPLES:90,OPERATIONAL_ALERTS:365,AI_EXECUTION_AUDIT:365,ITEM_ANALYTICS:'ACADEMIC_QUALITY_LINEAGE',ACADEMIC_AUDIT:'OWNER_RETENTION_NO_D28_DELETE',STUDENT_CONVENIENCE:'SUPPRESS_NOT_ERASE_TRUTH'});
const COST_SCOPES=Object.freeze(['CURRICULUM_AUDIT','LESSON','STUDENT_RESPONSE','ASSESSMENT_GENERATION','MARKING','COURSE','PPL','OTHER']);
const SAFE_CACHE_CLASSES=Object.freeze({DENY:'DENY_PERSONALIZED_OR_AUTHORITATIVE',REFERENCE:'SAFE_REFERENCE_ONLY'});
function stableHash(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function boundedText(value,max=256){const out=String(value??'').trim();return out.slice(0,max);}
function sourceRef(input={}){const owner=boundedText(input.owner,96),entityType=boundedText(input.entityType||input.entity_type,96),entityId=boundedText(input.entityId||input.entity_id,160),version=boundedText(input.version??input.stateVersion??input.state_version,96);if(!owner||!entityType||!entityId||!version){const e=new TypeError('D28 operational evidence requires owner/entity/version identity.');e.code='TEACHING_D28_SOURCE_REF_REQUIRED';throw e;}return Object.freeze({owner,entityType,entityId,version});}
function correlationRef(input={}){const correlationId=boundedText(input.correlationId||input.correlation_id,160),causationId=boundedText(input.causationId||input.causation_id,160)||null;if(!correlationId){const e=new TypeError('D28 evidence requires correlation identity.');e.code='TEACHING_D28_CORRELATION_REQUIRED';throw e;}return Object.freeze({correlationId,causationId});}
function pseudonymousAdministrationKey(attemptId){return `adm_${stableHash(`d28:${String(attemptId||'')}`).slice(0,32)}`;}
function normalizeOptionOrder(choiceSetContract={},publicItemPayload={}){const candidates=Array.isArray(choiceSetContract.options)?choiceSetContract.options:Array.isArray(publicItemPayload.options)?publicItemPayload.options:[];return Object.freeze(candidates.map((o,i)=>Object.freeze({optionId:boundedText(o?.option_id??o?.optionId??o?.id??`ordinal:${i}`,128),ordinal:i})));}
function selectedOptionId(rendererPayload={}){const p=rendererPayload&&typeof rendererPayload==='object'?rendererPayload:{};const v=p.selectedOptionId??p.selected_option_id??p.optionId??p.option_id??p.choiceId??p.choice_id??(typeof p.selected==='string'?p.selected:null);return v==null?null:boundedText(v,128);}
function explicitBoolean(v){return v===true?true:v===false?false:null;}
module.exports={D28_CONTRACT_VERSION,ANALYTICS_METHOD_VERSION,SUFFICIENCY,INTERACTION_SLOS_MS,RETENTION_CLASSES,COST_SCOPES,SAFE_CACHE_CLASSES,stableHash,boundedText,sourceRef,correlationRef,pseudonymousAdministrationKey,normalizeOptionOrder,selectedOptionId,explicitBoolean};
