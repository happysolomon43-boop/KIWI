'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  TPF08,TPF18,STYLE_FIELDS,SAFE_PROFILE_LIBRARY,profileForPreference,buildStyleEnvelope,validateStyleEnvelope,
  contextualStyle,evidenceSpecificPraise,accountabilityMessage,normalizeInteractionProfile,teacherChangeTransition,
  assertNoAcademicTruthMutation,
}=require('../../../teaching/d22/contracts');

const envelope=(ref='teacher-1',traits=SAFE_PROFILE_LIBRARY.BALANCED,familiarity='new')=>buildStyleEnvelope({teacherIdentityRef:ref,coreTraits:traits,familiarityLevel:familiarity});

test('D22 pins the frozen TPF-08 and TPF-18 contracts',()=>{
  assert.equal(TPF08.version,'1.2');assert.equal(TPF08.sha256,'b6c65e2f152c5260f822a06348de016eb6cfb61e1b8695dd4f936c014a99fb77');
  assert.equal(TPF18.version,'1.0');assert.equal(TPF18.sha256,'1ea28ec7d84ded6092949bd0656f83450178386d5990077f02d033208feec7d5');
});

test('D22 exposes the exact canonical Teacher Style Envelope and rejects drift',()=>{
  const value=envelope();assert.deepEqual(Object.keys(value),STYLE_FIELDS);assert.deepEqual(STYLE_FIELDS,[
    'teacher_identity_ref','warmth','directness','formality','expressiveness','humor_frequency','encouragement_intensity','challenge_style','accountability_style','conversationality','familiarity_level',
  ]);
  assert.throws(()=>validateStyleEnvelope({...value,subject:'physics'}),/exact canonical/i);
  assert.throws(()=>validateStyleEnvelope({...value,warmth:'extreme'}),/invalid/i);
});

test('broad preference mapping is product-configured and has no subject or gender input',()=>{
  const fixed=()=> '00000000-0000-0000-0000-000000000000';
  const direct=profileForPreference('more_direct',{randomUUID:fixed});
  assert.deepEqual(direct.traits,SAFE_PROFILE_LIBRARY.DIRECT);
  assert.equal(direct.traits.directness,'high');assert.equal(direct.traits.accountability_style,'firm');
  const relaxed=profileForPreference('more_relaxed',{randomUUID:fixed});assert.deepEqual(relaxed.traits,SAFE_PROFILE_LIBRARY.RELAXED);
  assert.equal(profileForPreference.length,1,'the public preference mapper accepts no subject/demographic parameter');
});

test('contextual register suppresses humor in failure, integrity, emergency and high-stakes contexts',()=>{
  const lively=envelope('t',SAFE_PROFILE_LIBRARY.RELAXED,'established');assert.equal(lively.humor_frequency,'moderate');
  for(const register of ['FAILURE','INTEGRITY','EMERGENCY','HIGH_STAKES','SERIOUS_WARNING','CONTROLLED_ASSESSMENT','EXAMINATION'])assert.equal(contextualStyle(lively,register).humor_frequency,'none',register);
  assert.equal(contextualStyle(lively,'NORMAL').humor_frequency,'moderate');
});

test('praise is evidence-specific and accountability cannot invent punishment',()=>{
  const e=envelope();assert.equal(evidenceSpecificPraise({evidenceDescription:'you isolated the variable correctly before substituting values',envelope:e}),'Good work: you isolated the variable correctly before substituting values');
  assert.equal(evidenceSpecificPraise({evidenceDescription:'',envelope:e}),null);
  const message=accountabilityMessage({authoritativeFact:'The submitted deadline remains Friday at 17:00.',requiredAction:'Submit the current work or use the formal extension Request.',envelope:e});
  assert.match(message,/deadline remains Friday/);assert.match(message,/formal extension Request/);assert.doesNotMatch(message,/punish|penalty|deduct/i);
});

test('Student Interaction Profile is separate and cannot mutate Teacher Identity or standards',()=>{
  const p=normalizeInteractionProfile({shorter_explanations:true,more_examples:true,less_filler:true,formatting:'stepwise'});
  assert.deepEqual(p,{explanation_density:'compact',examples:'more',filler_tolerance:'minimal',register:'standard',formatting:'stepwise',teacher_identity_mutation:false,academic_standard_mutation:false,pedagogy_override:false});
});

test('Teacher Change transition is truthful about continuity and memory',()=>{
  const t=teacherChangeTransition({displayName:'Teacher Rowan',requestId:'req-1'});
  assert.equal(t.preserves_all_academic_state,true);assert.equal(t.fabricated_shared_memory,false);assert.equal(t.familiarity_inference_forbidden,true);
  assert.match(t.message,/AI Teacher/);assert.match(t.message,/will not pretend/i);assert.match(t.message,/marks, and progression state are preserved/i);
});

test('Teacher-personality artifacts reject academic truth fields at any depth',()=>{
  assert.throws(()=>assertNoAcademicTruthMutation({interaction:{official_mark:75}}),/may not own official_mark/i);
  assert.throws(()=>assertNoAcademicTruthMutation({transition:{progression_outcome:'PASS'}}),/may not own progression_outcome/i);
});

test('TCH-0477: different personalities cannot change the same subject academic decision or marks',()=>{
  const authoritative={subject:'CHEM101',mark:82,grade:'A',decision:'PASS',owner:'D20/D21'};
  const a=contextualStyle(envelope('a',SAFE_PROFILE_LIBRARY.DIRECT),'NORMAL');
  const b=contextualStyle(envelope('b',SAFE_PROFILE_LIBRARY.RELAXED),'NORMAL');
  assert.notDeepEqual(a,b);assert.deepEqual(authoritative,{subject:'CHEM101',mark:82,grade:'A',decision:'PASS',owner:'D20/D21'});
  assert.equal('mark' in a,false);assert.equal('grade' in b,false);assert.equal('decision' in a,false);
});

test('TCH-0478: same personality remains stable while subject-owned pedagogy differs',()=>{
  const identity=envelope('same-teacher',SAFE_PROFILE_LIBRARY.BALANCED,'familiar');
  const mathPedagogy={owner:'D12',knowledge_type:'PROCEDURAL',representation:'worked symbolic example'};
  const historyPedagogy={owner:'D12',knowledge_type:'CONCEPTUAL',representation:'source comparison'};
  assert.deepEqual(contextualStyle(identity,'NORMAL'),contextualStyle(identity,'NORMAL'));
  assert.notDeepEqual(mathPedagogy,historyPedagogy);
  assert.equal(contextualStyle(identity,'NORMAL').teacher_identity_ref,'same-teacher');
});
