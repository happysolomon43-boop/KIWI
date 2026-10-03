'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeItemForD20,scalarSelectedKey}=require('../../../teaching/d20/assessment-boundary-service');
const {normalizeBundleForMarking}=require('../../../teaching/d20/corrected-authority-service');
const {deterministicMarkObjective}=require('../../../teaching/d20/contracts');

test('TCH-0395 D17 OBJECTIVE plus frozen TPF-13 provisional key marks real D18 selected_option_ids deterministically',()=>{
  const rawItem={
    package_item_id:'item-objective',response_family:'OBJECTIVE',intended_marks:2,
    public_item_payload:{response_contract:{selection_mode:'SINGLE'}},
    protected_marking_payload:{provisional_answer_key:'slot-1:opt:2'},
  };
  const item=normalizeItemForD20(rawItem);
  assert.equal(item.response_family,'MCQ');
  assert.equal(item.protected_marking_payload.correct_answer,'slot-1:opt:2');
  const rawResponse={package_item_id:'item-objective',renderer_payload:{selected_option_ids:['slot-1:opt:2']}};
  const bundle=normalizeBundleForMarking({responses:[rawResponse]});
  const response=bundle.responseByItem.get('item-objective');
  const mark=deterministicMarkObjective(item,response);
  assert.equal(mark.resolved,true);
  assert.equal(mark.earned,2);
  assert.deepEqual(rawResponse.renderer_payload,{selected_option_ids:['slot-1:opt:2']},'authoritative D18 payload remains immutable');
});

test('TCH-0395 MCQ key can be recovered from validated distractor trace without changing frozen prompt bytes',()=>{
  const item=normalizeItemForD20({
    package_item_id:'item-mcq',response_family:'MCQ',intended_marks:1,
    protected_marking_payload:{distractor_design_trace:{provisional_key_option_ids:['slot-2:opt:4']}},
  });
  assert.equal(item.protected_marking_payload.correct_answer,'slot-2:opt:4');
});

test('TCH-0395 single-select key ambiguity fails closed instead of guessing',()=>{
  assert.throws(()=>scalarSelectedKey(['opt-a','opt-b'],{packageItemId:'item-1'}),error=>error?.code==='TEACHING_D20_SELECTED_RESPONSE_KEY_AMBIGUOUS');
});

test('TCH-0395 unit-bearing numeric response does not bypass unit/rubric semantics',()=>{
  const unitBearing=normalizeItemForD20({
    package_item_id:'item-num-unit',response_family:'NUMERIC',intended_marks:2,
    public_item_payload:{response_contract:{unit_required:true}},
    protected_marking_payload:{provisional_answer_key:9.81,tolerance:0.01},
  });
  assert.equal(unitBearing.response_family,'CONSTRUCTED');

  const unitFree=normalizeItemForD20({
    package_item_id:'item-num-free',response_family:'NUMERIC_UNIT',intended_marks:2,
    public_item_payload:{response_contract:{unit_required:false}},
    protected_marking_payload:{provisional_answer_key:9.81,tolerance:0.01},
  });
  assert.equal(unitFree.response_family,'NUMERIC');
  assert.equal(unitFree.protected_marking_payload.answer,9.81);
  const mark=deterministicMarkObjective(unitFree,{renderer_payload:{value:'9.805',unit:''}});
  assert.equal(mark.earned,2);
});

test('TCH-0395 D18 multipart STRUCTURED and MULTI_SELECT stay interpretive until a complete deterministic contract exists',()=>{
  const structured=normalizeItemForD20({package_item_id:'item-structured',response_family:'STRUCTURED',protected_marking_payload:{}});
  const multi=normalizeItemForD20({package_item_id:'item-multi',response_family:'MULTI_SELECT',protected_marking_payload:{}});
  assert.equal(structured.response_family,'CONSTRUCTED');
  assert.equal(multi.response_family,'CONSTRUCTED');
});
