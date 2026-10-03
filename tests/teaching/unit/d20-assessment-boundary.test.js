'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  normalizeItemForD20,normalizeBundleForD20,scalarSelectedKey,assessmentBoundaryRepository,
}=require('../../../teaching/d20/assessment-boundary-service');
const {deterministicMarkObjective}=require('../../../teaching/d20/contracts');

function bundle({item,response=null,snapshotResponse=response}={}){
  const responses=response?[response]:[];
  return {
    context:{
      assessment_attempt_id:'attempt-1',assessment_package_id:'package-1',attempt_state:'SUBMITTED',attempt_result_state:'AWAITING_MARKING',
      finalization_version:1,final_snapshot_ref:'attempt:attempt-1:final:1',attempt_invalidation_reason:null,
      final_snapshot:{finalized_by:'SUBMITTED',responses:snapshotResponse?[snapshotResponse]:[]},
    },
    items:[item],responses,responseByItem:new Map(responses.map(row=>[String(row.package_item_id),row])),
  };
}

test('TCH-0395 OBJECTIVE plus frozen TPF-13 key marks the real D18 selected_option_ids payload',()=>{
  const rawItem={
    package_item_id:'item-1',item_state:'ACTIVE',response_family:'OBJECTIVE',intended_marks:2,
    public_item_payload:{response_contract:{selection_mode:'SINGLE'}},
    protected_marking_payload:{provisional_answer_key:'slot-1:opt:2'},
  };
  const rawResponse={package_item_id:'item-1',assessment_response_id:'response-1',response_version:1,renderer_payload:{selected_option_ids:['slot-1:opt:2']}};
  const normalized=normalizeBundleForD20(bundle({item:rawItem,response:rawResponse}));
  const item=normalized.items[0],response=normalized.responseByItem.get('item-1');
  assert.equal(item.response_family,'MCQ');
  assert.equal(item.protected_marking_payload.correct_answer,'slot-1:opt:2');
  assert.equal(response.renderer_payload.answer,'slot-1:opt:2');
  const mark=deterministicMarkObjective(item,response);
  assert.equal(mark.resolved,true);
  assert.equal(mark.earned,2);
  assert.deepEqual(rawResponse.renderer_payload,{selected_option_ids:['slot-1:opt:2']},'raw durable response is not mutated');
});

test('TCH-0395 selected-response stable option key prefers validated distractor key IDs',()=>{
  const item=normalizeItemForD20({
    package_item_id:'item-2',item_state:'ACTIVE',response_family:'MCQ',intended_marks:1,
    protected_marking_payload:{provisional_answer_key:'answer text',distractor_design_trace:{provisional_key_option_ids:['slot-2:opt:4']}},
  });
  assert.equal(item.protected_marking_payload.correct_answer,'slot-2:opt:4');
});

test('TCH-0395 raw D17 final-snapshot integrity is proved before semantic adaptation',()=>{
  const item={package_item_id:'item-1',item_state:'ACTIVE',response_family:'MCQ',intended_marks:1,protected_marking_payload:{correct_answer:'a'}};
  const current={package_item_id:'item-1',assessment_response_id:'r1',response_version:1,renderer_payload:{selected_option_ids:['a']}};
  const frozen={...current,renderer_payload:{selected_option_ids:['b']}};
  assert.throws(()=>normalizeBundleForD20(bundle({item,response:current,snapshotResponse:frozen})),error=>error?.code==='TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED');
});

test('TCH-0395 single-selection ambiguity fails closed instead of guessing a key or answer',()=>{
  assert.throws(()=>scalarSelectedKey(['opt-a','opt-b'],{packageItemId:'item-1'}),error=>error?.code==='TEACHING_D20_SELECTED_RESPONSE_KEY_AMBIGUOUS');
  const item={package_item_id:'item-1',item_state:'ACTIVE',response_family:'MCQ',intended_marks:1,protected_marking_payload:{correct_answer:'opt-a'}};
  const response={package_item_id:'item-1',assessment_response_id:'r1',response_version:1,renderer_payload:{selected_option_ids:['opt-a','opt-b']}};
  assert.throws(()=>normalizeBundleForD20(bundle({item,response})),error=>error?.code==='TEACHING_D20_SELECTED_RESPONSE_CARDINALITY_INVALID');
});

test('TCH-0395 unit-bearing D18 numeric work cannot bypass unit or rubric semantics',()=>{
  const unitBearing=normalizeItemForD20({
    package_item_id:'num-1',item_state:'ACTIVE',response_family:'NUMERIC',intended_marks:2,
    public_item_payload:{response_contract:{unit_required:true}},
    protected_marking_payload:{provisional_answer_key:9.81,tolerance:0.01},
  });
  assert.equal(unitBearing.response_family,'CONSTRUCTED');

  const unitFree=normalizeItemForD20({
    package_item_id:'num-2',item_state:'ACTIVE',response_family:'NUMERIC_UNIT',intended_marks:2,
    public_item_payload:{response_contract:{unit_required:false}},
    protected_marking_payload:{provisional_answer_key:9.81,tolerance:0.01},
  });
  assert.equal(unitFree.response_family,'NUMERIC');
  assert.equal(unitFree.protected_marking_payload.answer,9.81);
  assert.equal(deterministicMarkObjective(unitFree,{renderer_payload:{value:'9.805',unit:''}}).earned,2);
});

test('TCH-0395 D18 multipart STRUCTURED and multiple selection remain interpretive until deterministic semantics are complete',()=>{
  const structured=normalizeItemForD20({package_item_id:'s1',item_state:'ACTIVE',response_family:'STRUCTURED',protected_marking_payload:{}});
  const multi=normalizeItemForD20({package_item_id:'m1',item_state:'ACTIVE',response_family:'MULTI_SELECT',protected_marking_payload:{}});
  const mcqMulti=normalizeItemForD20({package_item_id:'m2',item_state:'ACTIVE',response_family:'MCQ',public_item_payload:{response_contract:{selection_mode:'MULTIPLE'}},protected_marking_payload:{}});
  assert.equal(structured.response_family,'CONSTRUCTED');
  assert.equal(multi.response_family,'CONSTRUCTED');
  assert.equal(mcqMulti.response_family,'CONSTRUCTED');
});

test('production frozen D20 repository can be adapted without Proxy invariant failure',async()=>{
  const rawItem={
    package_item_id:'item-1',item_state:'ACTIVE',response_family:'MCQ',intended_marks:1,
    public_item_payload:{response_contract:{selection_mode:'SINGLE'}},
    protected_marking_payload:{correct_answer:'opt-a'},
  };
  const rawResponse={package_item_id:'item-1',assessment_response_id:'r1',response_version:1,renderer_payload:{selected_option_ids:['opt-a']}};
  const rawBundle=bundle({item:rawItem,response:rawResponse});
  const repository={
    marker:'production-frozen-repository',
    async loadMarkingBundle(){return rawBundle;},
    markerValue(){return this.marker;},
  };
  Object.freeze(repository);

  const adapted=assessmentBoundaryRepository(repository);
  assert.equal(Object.isFrozen(adapted),true);
  assert.equal(adapted.markerValue(),'production-frozen-repository','delegated methods stay bound to the original authority object');
  const normalized=await adapted.loadMarkingBundle('student-1','attempt-1');
  assert.equal(normalized.responseByItem.get('item-1').renderer_payload.answer,'opt-a');
  assert.equal(normalized.items[0].response_family,'MCQ');
});
