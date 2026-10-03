'use strict';

const {
  createD20Service:createCanonicalD20Service,
  assertAuthoritativeResponseCapture,
}=require('./authority-service');
const {asArray,asObject,upper,fail}=require('./contracts');

const SINGLE_SELECTED_RESPONSE_FAMILIES=new Set([
  'MCQ','MULTIPLE_CHOICE','SINGLE_CHOICE','OBJECTIVE','SELECTED_RESPONSE','SINGLE_SELECT',
]);
const D18_UNIT_NUMERIC_FAMILIES=new Set(['NUMERIC','NUMERIC_UNIT','NUMBER_UNIT']);

function responseContract(item){
  const pub=asObject(item?.public_item_payload);
  return asObject(pub.response_contract||pub.responseContract);
}
function isMultipleSelection(item){
  const contract=responseContract(item),mode=upper(contract.selection_mode||contract.selectionMode);
  return mode==='MULTIPLE'||mode==='MULTI'||contract.multi_select===true||contract.multiSelect===true||upper(item?.response_family)==='MULTI_SELECT';
}
function selectedKeyCandidate(protectedPayload){
  for(const key of ['correct_answer','answer_key','correctAnswer','correct_option']){
    if(Object.prototype.hasOwnProperty.call(protectedPayload,key)&&protectedPayload[key]!=null)return protectedPayload[key];
  }
  const trace=asObject(protectedPayload.distractor_design_trace||protectedPayload.distractor_trace);
  if(trace.provisional_key_option_ids!=null)return trace.provisional_key_option_ids;
  if(trace.key_option_ids!=null)return trace.key_option_ids;
  if(protectedPayload.provisional_answer_key!=null)return protectedPayload.provisional_answer_key;
  if(protectedPayload.answer!=null)return protectedPayload.answer;
  return null;
}
function scalarSelectedKey(value,{packageItemId=null}={}){
  if(value&&typeof value==='object'&&!Array.isArray(value))value=value.option_id??value.optionId??value.value??value.answer??value.option_ids??value.optionIds??null;
  if(Array.isArray(value)){
    const ids=value.map(String).filter(Boolean);
    if(ids.length===1)return ids[0];
    if(ids.length>1)fail('Single-selection Assessment item has multiple locked key option IDs.','TEACHING_D20_SELECTED_RESPONSE_KEY_AMBIGUOUS',409,{packageItemId,keyOptionIds:ids});
    return null;
  }
  return value==null?null:String(value);
}
function unitRequired(item){
  const contract=responseContract(item);
  return contract.unit_required!==false&&contract.unitRequired!==false;
}
function objectiveKeyCandidate(protectedPayload){
  for(const key of ['correct_value','numeric_answer','answer'])if(Object.prototype.hasOwnProperty.call(protectedPayload,key)&&protectedPayload[key]!=null)return protectedPayload[key];
  return protectedPayload.provisional_answer_key??null;
}

function normalizeItemForD20(item){
  const family=upper(item?.response_family),protectedPayload={...asObject(item?.protected_marking_payload)},packageItemId=String(item?.package_item_id||'');
  let canonicalFamily=family;

  if(SINGLE_SELECTED_RESPONSE_FAMILIES.has(family)){
    if(isMultipleSelection(item))canonicalFamily='CONSTRUCTED';
    else {
      canonicalFamily='MCQ';
      const key=scalarSelectedKey(selectedKeyCandidate(protectedPayload),{packageItemId});
      if(key!=null&&!Object.prototype.hasOwnProperty.call(protectedPayload,'correct_answer'))protectedPayload.correct_answer=key;
    }
  }else if(family==='MULTI_SELECT'){
    canonicalFamily='CONSTRUCTED';
  }else if(D18_UNIT_NUMERIC_FAMILIES.has(family)){
    if(unitRequired(item))canonicalFamily='CONSTRUCTED';
    else {
      canonicalFamily='NUMERIC';
      const key=objectiveKeyCandidate(protectedPayload);
      if(key!=null&&!Object.prototype.hasOwnProperty.call(protectedPayload,'answer'))protectedPayload.answer=key;
    }
  }else if(['NUMBER','NUMERIC_RESPONSE'].includes(family)){
    canonicalFamily='NUMERIC';
    const key=objectiveKeyCandidate(protectedPayload);
    if(key!=null&&!Object.prototype.hasOwnProperty.call(protectedPayload,'answer'))protectedPayload.answer=key;
  }else if(family==='STRUCTURED'){
    // D18 uses STRUCTURED for multi-part constructed response. Only the explicit
    // STRUCTURED_OBJECTIVE family is safe for D20's deterministic field matcher.
    canonicalFamily='CONSTRUCTED';
  }

  return {...item,response_family:canonicalFamily,protected_marking_payload:protectedPayload};
}

function normalizeRendererPayload(payload,item){
  const source=asObject(payload),family=upper(item?.response_family);
  if(family!=='MCQ')return source;
  const selected=asArray(source.selected_option_ids||source.selectedOptionIds||source.selected_options).map(String).filter(Boolean);
  if(selected.length>1)fail('Single-selection final response contains multiple selected option IDs.','TEACHING_D20_SELECTED_RESPONSE_CARDINALITY_INVALID',409,{packageItemId:item?.package_item_id||null,selectedOptionIds:selected});
  if(selected.length===1&&!Object.prototype.hasOwnProperty.call(source,'answer'))return {...source,answer:selected[0]};
  return source;
}
function normalizeResponse(response,item){
  if(!response||!item)return response;
  return {...response,renderer_payload:normalizeRendererPayload(response.renderer_payload,item)};
}

function normalizeBundleForD20(rawBundle){
  // First prove the durable D17 response rows exactly match the immutable final
  // snapshot. Semantic adaptation happens only after that raw authority check.
  assertAuthoritativeResponseCapture(rawBundle);
  const items=asArray(rawBundle?.items).map(normalizeItemForD20),itemMap=new Map(items.map(item=>[String(item.package_item_id),item]));
  const responses=asArray(rawBundle?.responses).map(response=>normalizeResponse(response,itemMap.get(String(response.package_item_id))));
  const context={...asObject(rawBundle?.context)},snapshot=asObject(context.final_snapshot);
  if(Array.isArray(snapshot.responses)){
    context.final_snapshot={...snapshot,responses:snapshot.responses.map(response=>normalizeResponse(response,itemMap.get(String(response.package_item_id))))};
  }
  return {...rawBundle,context,items,responses,responseByItem:new Map(responses.map(response=>[String(response.package_item_id),response]))};
}

function assessmentBoundaryRepository(repository){
  return new Proxy(repository,{
    get(target,property,receiver){
      if(property==='loadMarkingBundle')return async(...args)=>normalizeBundleForD20(await target.loadMarkingBundle(...args));
      const value=Reflect.get(target,property,receiver);
      return typeof value==='function'?value.bind(target):value;
    },
  });
}

function createD20Service(options={}){
  if(!options.repository||typeof options.repository.loadMarkingBundle!=='function')throw new TypeError('D20 Assessment boundary requires the D20 Gradebook repository.');
  const service=createCanonicalD20Service({...options,repository:assessmentBoundaryRepository(options.repository)});
  return Object.freeze({...service,assessmentBoundary:'D17_D18_TO_D20_RESPONSE_SEMANTICS_V1'});
}

module.exports={
  createD20Service,
  createD20AuthorityService:createD20Service,
  normalizeItemForD20,
  normalizeRendererPayload,
  normalizeBundleForD20,
  assessmentBoundaryRepository,
  scalarSelectedKey,
};
