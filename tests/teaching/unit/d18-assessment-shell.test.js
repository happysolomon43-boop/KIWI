'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../../../public/assessment-shell-core');
const {createD18AssessmentShellService}=require('../../../teaching/d18/service');
const {createKiwiExamInterface}=require('../../../teaching/integrations/kiwi-exam-interface');
const {createD17Service}=require('../../../teaching/d17/service');

function item(family,payload={},extra={}){return {package_item_id:extra.id||`item-${family}`,ordinal:extra.ordinal||1,response_family:family,intended_marks:extra.marks||5,public_item_payload:payload,choice_set_contract:extra.choiceSet||{},item_state:extra.itemState||'ACTIVE',answer_exposed:extra.answerExposed===true};}

test('D18 Exam interface activates the shared shell without rewriting legacy Exam ownership',()=>{
  const exam=createKiwiExamInterface();
  assert.equal(exam.version,'1.2');
  assert.equal(exam.assessmentShell.contractVersion,'d18.v1');
  assert.equal(exam.assessmentShell.compatibility.legacyExamOwnerPreserved,true);
  assert.equal(exam.assessmentShell.compatibility.existingKiwiExamDataRewritten,false);
  assert.equal(exam.assessmentShell.compatibility.d18RendererImplementationDeferred,false);
  const handoff=exam.buildAssessmentShellHandoff({assessmentId:'a1',packageId:'p1',attemptId:'t1'});
  assert.match(handoff.targetAppPath,/^\/assessment-shell\.html\?/);
  assert.match(handoff.targetAppPath,/assessmentId=a1/);
  assert.match(handoff.targetAppPath,/attemptId=t1/);
});

test('D18 MCQ renderer submits deterministic stable option IDs and never correctness',()=>{
  const q=item('MCQ',{prompt:'Pick one',options:['Alpha','Beta','Gamma']},{choiceSet:{stable_option_ids:['s:1','s:2','s:3'],selection_mode:'single'}});
  const d=core.describeRenderer(q,{response_form_architecture:{mode:'mcq_only'}});
  assert.equal(d.kind,'mcq');
  assert.deepEqual(d.options.map(o=>o.id),['s:1','s:2','s:3']);
  assert.deepEqual(core.canonicalPayload(d,{selected_option_ids:['s:2']}),{selected_option_ids:['s:2']});
  assert.equal('correct_answer' in d,false);
});

test('D18 MCQ renderer fails closed when locked stable option IDs are missing',()=>{
  const q=item('MCQ',{options:['A','B']});
  assert.throws(()=>core.describeRenderer(q),e=>e.code==='TEACHING_D18_MCQ_CHOICE_CONTRACT_INVALID');
});

test('D18 short response preserves academic text exactly including whitespace',()=>{
  const d=core.describeRenderer(item('SHORT_CONSTRUCTED',{prompt:'Define x'}));
  const original='  first line\nsecond line  ';
  assert.deepEqual(core.canonicalPayload(d,{text:original}),{text:original});
  assert.deepEqual(core.restoreDraft(d,{text:original}),{text:original});
});

test('D18 extended and essay renderers preserve long-form canonical text',()=>{
  for(const family of ['EXTENDED_RESPONSE','ESSAY']){
    const d=core.describeRenderer(item(family,{prompt:'Explain'}));
    const body='Paragraph one.\n\nParagraph two with  symbols: ∫ x² dx.';
    assert.equal(core.restoreDraft(d,core.canonicalPayload(d,{text:body})).text,body);
    assert.equal(core.completion(d,{text:body}),'ANSWERED');
  }
});

test('D18 multi-part renderer retains per-part state and reports partial completion',()=>{
  const d=core.describeRenderer(item('MULTI_PART',{parts:[
    {part_id:'a',label:'a',prompt:'Select',response_type:'MCQ',options:['Yes','No'],choice_set_contract:{stable_option_ids:['a:y','a:n']}},
    {part_id:'b',label:'b',prompt:'Explain',response_type:'SHORT_CONSTRUCTED'},
  ]}));
  const draft={parts:{a:{selected_option_ids:['a:y']},b:{text:''}}};
  assert.equal(core.completion(d,draft),'PARTIAL');
  assert.deepEqual(core.canonicalPayload(d,draft),draft);
});

test('D18 math-working renderer keeps working separate from final answer',()=>{
  const d=core.describeRenderer(item('MATH_WORKING',{prompt:'Calculate'}));
  assert.equal(core.completion(d,{working:'2x = 8',final_answer:''}),'PARTIAL');
  assert.deepEqual(core.canonicalPayload(d,{working:'2x = 8',final_answer:'x = 4'}),{working:'2x = 8',final_answer:'x = 4'});
});

test('D18 numeric plus unit renderer follows first-release structured final fields',()=>{
  const d=core.describeRenderer(item('NUMERIC_UNIT',{response_contract:{unit_required:true}}));
  assert.equal(core.completion(d,{value:'9.81',unit:''}),'PARTIAL');
  assert.equal(core.completion(d,{value:'9.81',unit:'m/s²'}),'ANSWERED');
});

test('D18 source-based layout pins source while retaining declared response renderer',()=>{
  const d=core.describeRenderer(item('ESSAY',{prompt:'Evaluate the source',source:'Primary source text'}));
  assert.equal(d.kind,'essay');
  assert.equal(d.source,'Primary source text');
  assert.equal(d.sourceLayout,'responsive-pinned');
});

test('D18 code renderer preserves code as text and visual renderer remains an explicit extension point',()=>{
  const code=core.describeRenderer(item('CODE',{prompt:'Write a function'}));
  assert.deepEqual(core.canonicalPayload(code,{text:'function f(x) {\n  return x + 1;\n}'}),{text:'function f(x) {\n  return x + 1;\n}'});
  const visual=core.describeRenderer(item('VISUAL',{prompt:'Draw the graph'}));
  assert.equal(visual.visualExtensionReserved,true);
  assert.deepEqual(core.canonicalPayload(visual,{}),{unsupported_visual_response:true});
});

test('D18 question states and navigation do not infer correctness',()=>{
  const d=core.describeRenderer(item('SHORT_CONSTRUCTED'));
  assert.deepEqual(core.questionState({viewed:false,flagged:false,descriptor:d,draft:{text:''}}),{viewed:false,flagged:false,completion:'UNANSWERED',label:'UNSEEN'});
  assert.equal(core.questionState({viewed:true,flagged:true,descriptor:d,draft:{text:'attempt'}}).label,'FLAGGED');
  assert.deepEqual(core.navigationPolicy({response_form_architecture:{mode:'mixed'}}),{mode:'nonlinear',freeNavigation:true});
  assert.deepEqual(core.navigationPolicy({response_form_architecture:{free_navigation:false}}),{mode:'linear',freeNavigation:false});
});

test('D18 allowed-tools projection follows locked resource policy only',()=>{
  const tools=core.allowedTools({resource_policy:{calculator:true,notes:false,formula_sheet:{allowed:true,label:'Formula sheet'}}});
  assert.deepEqual(tools.map(t=>t.id),['calculator','formula_sheet']);
});

test('D18 protected-content guard rejects marking and candidate internals recursively',()=>{
  assert.throws(()=>core.assertBrowserSafe({item:{protected_marking_payload:{answer:'x'}}}),e=>e.code==='TEACHING_D18_PROTECTED_FIELD_LEAK');
  assert.throws(()=>core.assertBrowserSafe({items:[{hidden_validation_trace:{x:1}}]}),e=>e.code==='TEACHING_D18_PROTECTED_FIELD_LEAK');
  assert.equal(core.assertBrowserSafe({item:{public_item_payload:{prompt:'Safe'}}}),true);
});

test('D18 server projection exposes only public locked package fields and latest response snapshots',async()=>{
  const pack={assessment_package_id:'p1',assessment_id:'a1',version_no:2,package_state:'LOCKED',package_hash:'hash',duration_minutes:60,timer_model:'OVERALL',response_form_architecture:{mode:'mixed'},resource_policy:{calculator:true},accommodation_policy:{extra_time_percent:25},locked_at:'2026-10-02T10:00:00Z'};
  const rawItem={...item('MCQ',{prompt:'Safe?',options:['Yes','No']},{id:'i1',choiceSet:{}}),candidate_version_id:'cv1',protected_marking_payload:{correct_answer:'i1:opt:1'}};
  const candidate={candidate_version_id:'cv1',choice_set_contract:{stable_option_ids:['i1:opt:1','i1:opt:2']},protected_payload:{answer:'secret'},hidden_validation_trace:{secret:true}};
  const attempt={assessment_attempt_id:'t1',assessment_id:'a1',assessment_package_id:'p1',attempt_no:1,attempt_state:'ACTIVE',result_state:'NOT_FINAL',active_device_id:'device-a',started_at:'2026-10-02T10:00:00Z',expires_at:'2026-10-02T11:15:00Z',state_version:3,finalization_version:0,policy_version_at_start:'v1'};
  const repository={
    async packageById(){return pack;},async packageItems(){return [rawItem];},async candidateVersion(){return candidate;},async requireAttempt(){return attempt;},
    async latestResponses(){return [{assessment_response_id:'r1',package_item_id:'i1',response_version:2,renderer_payload:{selected_option_ids:['i1:opt:2']},response_state:'SAVED',accepted_at:'2026-10-02T10:05:00Z',client_occurred_at:'2026-10-02T10:04:59Z',device_id:'device-a',idempotency_key:'secret-ish'}];}
  };
  const service=createD18AssessmentShellService({repository,clock:()=>new Date('2026-10-02T10:06:00Z')});
  const result=await service.getAttemptWorkspace({id:'student-1'},'t1',{deviceId:'device-b'});
  assert.equal(result.contractVersion,'d18.v1');
  assert.equal(result.attempt.device_authority,'MISMATCH');
  assert.equal(result.items[0].renderer.options[0].id,'i1:opt:1');
  assert.equal(result.responses[0].response_version,2);
  assert.equal(result.items[0].protected_marking_payload,undefined);
  assert.equal(result.items[0].candidate_version_id,undefined);
  assert.equal(result.responses[0].device_id,undefined);
  assert.equal(result.responses[0].idempotency_key,undefined);
  assert.doesNotThrow(()=>core.assertBrowserSafe(result));
});

test('D18 terminal Attempt projection is read-only while active device truth remains server-owned',async()=>{
  const repository={
    async packageById(){return {assessment_package_id:'p',assessment_id:'a',package_state:'LOCKED',response_form_architecture:{mode:'constructed_only'},resource_policy:{},accommodation_policy:{}};},
    async packageItems(){return [item('SHORT_CONSTRUCTED',{prompt:'x'},{id:'i'})];},async candidateVersion(){return null;},
    async requireAttempt(){return {assessment_attempt_id:'t',assessment_id:'a',assessment_package_id:'p',attempt_state:'SUBMITTED',result_state:'AWAITING_MARKING',active_device_id:'old',state_version:2,finalization_version:1};},async latestResponses(){return [];}
  };
  const service=createD18AssessmentShellService({repository});
  const result=await service.getAttemptWorkspace({id:'s'},'t',{deviceId:'new'});
  assert.equal(result.attempt.read_only,true);
  assert.equal(result.attempt.device_authority,'MISMATCH');
});

test('D18 acceptance: duplicate manual submit and expiry converge on one authoritative finalization',async()=>{
  let attempt={assessment_attempt_id:'t1',assessment_id:'a1',assessment_package_id:'p1',attempt_state:'ACTIVE',expires_at:'2026-10-02T11:00:00.000Z',finalization_version:0};
  const finals=[];
  const repository={
    createAssessment(){},
    async requireAttempt(){return attempt;},
    async packageItems(){return [{package_item_id:'i1'}];},
    async latestResponses(){return [{package_item_id:'i1'}];},
    async finalizeAttempt(input){if(attempt.attempt_state==='ACTIVE'){attempt={...attempt,attempt_state:input.mode,finalization_version:1};finals.push(input.mode);return {attempt,idempotent:false};}return {attempt,idempotent:true};}
  };
  const service=createD17Service({repository,randomUUID:()=> 'u',clock:()=>new Date('2026-10-02T10:59:59.000Z')});
  const first=await service.submit({id:'s'},'t1',{confirm:true,idempotencyKey:'submit-1'});
  const second=await service.submit({id:'s'},'t1',{confirm:true,idempotencyKey:'submit-1'});
  const expired=await service.expire('s','t1','expiry-1');
  assert.equal(first.attempt.attempt_state,'SUBMITTED');
  assert.equal(second.attempt.finalization_version,1);
  assert.equal(expired.attempt.finalization_version,1);
  assert.deepEqual(finals,['SUBMITTED']);
});
