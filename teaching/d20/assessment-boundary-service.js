'use strict';

const {createD20Service:createCorrectedD20Service}=require('./corrected-authority-service');
const {asArray,asObject,upper,fail}=require('./contracts');

const SINGLE_SELECTED_RESPONSE_FAMILIES=new Set([
  'MCQ','MULTIPLE_CHOICE','SINGLE_CHOICE','OBJECTIVE','SELECTED_RESPONSE','SINGLE_SELECT',
]);
const UNIT_NUMERIC_FAMILIES=new Set(['NUMERIC','NUMBER','NUMERIC_RESPONSE','NUMERIC_UNIT','NUMBER_UNIT']);

function directObjectiveKey(protectedPayload){
  for(const key of ['correct_answer','answer_key','correctAnswer','correct_option','answer']){
    if(Object.prototype.hasOwnProperty.call(protectedPayload,key)&&protectedPayload[key]!=null)return protectedPayload[key];
  }
  if(protectedPayload.provisional_answer_key!=null)return protectedPayload.provisional_answer_key;
  const trace=asObject(protectedPayload.distractor_design_trace||protectedPayload.distractor_trace);
  if(trace.provisional_key_option_ids!=null)return trace.provisional_key_option_ids;
  if(trace.key_option_ids!=null)return trace.key_option_ids;
  return null;
}

function scalarSelectedKey(value,{packageItemId=null}={}){
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    value=value.option_id??value.optionId??value.value??value.answer??value.option_ids??value.optionIds??null;
  }
  if(Array.isArray(value)){
    const ids=value.map(String).filter(Boolean);
    if(ids.length===1)return ids[0];
    if(ids.length>1)fail('Single-selection Assessment item has multiple locked key option IDs.','TEACHING_D20_SELECTED_RESPONSE_KEY_AMBIGUOUS',409,{packageItemId,keyOptionIds:ids});
    return null;
  }
  return value==null?null:String(value);
}

function unitRequired(item){
  const pub=asObject(item?.public_item_payload),contract=asObject(pub.response_contract||pub.responseContract);
  return contract.unit_required!==false&&contract.unitRequired!==false;
}

function normalizeItemForD20(item){
  const family=upper(item?.response_family),protectedPayload={...asObject(item?.protected_marking_payload)},packageItemId=String(item?.package_item_id||'');
  let canonicalFamily=family;

  if(SINGLE_SELECTED_RESPONSE_FAMILIES.has(family)){
    canonicalFamily='MCQ';
    const key=scalarSelectedKey(directObjectiveKey(protectedPayload),{packageItemId});
    if(key!=null&&!Object.prototype.hasOwnProperty.call(protectedPayload,'correct_answer'))protectedPayload.correct_answer=key;
  }else if(family==='MULTI_SELECT'){
    // D18 can render multi-select, but D20 v1 has no locked exact-set scorer.
    // Do not collapse an unordered multi-answer construct into single-key string comparison.
    canonicalFamily='CONSTRUCTED';
  }else if(UNIT_NUMERIC_FAMILIES.has(family)){
    // The accepted D20 numeric scorer validates numeric tolerance only. D18's
    // numeric renderer treats units as required unless the response contract
    // explicitly says otherwise, so unit-bearing work must not bypass rubric marking.
    if(unitRequired(item))canonicalFamily='CONSTRUCTED';
    else {
      canonicalFamily='NUMERIC';
      const key=directObjectiveKey(protectedPayload);
      if(key!=null&&!Object.prototype.hasOwnProperty.call(protectedPayload,'answer'))protectedPayload.answer=key;
    }
  }else if(family==='STRUCTURED'){
    // D18 uses STRUCTURED for multi-part response UI. D20 deterministic structured
    // matching is reserved for the explicit STRUCTURED_OBJECTIVE family so a
    // multipart constructed answer is never mechanically compared as [object Object].
    canonicalFamily='CONSTRUCTED';
  }

  if(canonicalFamily===family&&Object.keys(protectedPayload).length===Object.keys(asObject(item?.protected_marking_payload)).length)return item;
  return {...item,response_family:canonicalFamily,protected_marking_payload:protectedPayload};
}

function assessmentBoundaryRepository(repository){
  return new Proxy(repository,{
    get(target,property,receiver){
      if(property==='loadMarkingBundle')return async(...args)=>{
        const bundle=await target.loadMarkingBundle(...args);
        return {...bundle,items:asArray(bundle?.items).map(normalizeItemForD20)};
      };
      const value=Reflect.get(target,property,receiver);
      return typeof value==='function'?value.bind(target):value;
    },
  });
}

function createD20Service(options={}){
  if(!options.repository||typeof options.repository.loadMarkingBundle!=='function')throw new TypeError('D20 Assessment boundary requires the D20 Gradebook repository.');
  const service=createCorrectedD20Service({...options,repository:assessmentBoundaryRepository(options.repository)});
  return Object.freeze({...service,assessmentBoundary:'D17_D18_TO_D20_CANONICAL_RESPONSE_V1'});
}

module.exports={
  createD20Service,
  createD20AuthorityService:createD20Service,
  normalizeItemForD20,
  assessmentBoundaryRepository,
  directObjectiveKey,
  scalarSelectedKey,
};
