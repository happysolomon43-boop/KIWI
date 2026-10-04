'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {D27_INTEGRATION_CONTRACTS,buildD27EventEnvelope}=require('../../../teaching/d27/contracts');
const {selectExistingCardReferences,buildValidatedCardCandidate,findEquivalentCard}=require('../../../teaching/d27/study');

test('D27 freezes owner-preserving gates',()=>{
  assert.equal(D27_INTEGRATION_CONTRACTS.SUBJECT.write,'NONE');
  assert.equal(D27_INTEGRATION_CONTRACTS.EXAM.globalDestination,'NO_DUPLICATE_GLOBAL_EXAM_RECORD_FIRST_RELEASE');
  assert.match(D27_INTEGRATION_CONTRACTS.KS.write,/OWNER_ADAPTER/);
  assert.match(D27_INTEGRATION_CONTRACTS.MASTERY.write,/OWNER_ADAPTER/);
  assert.equal(D27_INTEGRATION_CONTRACTS.BRAIN.write,'NONE');
  assert.equal(D27_INTEGRATION_CONTRACTS.BIOME.write,'NONE');
  assert.equal(D27_INTEGRATION_CONTRACTS.ACHIEVEMENTS.write,'NONE');
});

test('general integration events reject protected assessment material',()=>{
  assert.throws(()=>buildD27EventEnvelope({
    eventId:'e1',studentId:'s1',eventType:'assessment_completed',source:{owner:'D17_ASSESSMENT',entityType:'Assessment',entityId:'a1',version:'2'},
    occurredAt:'2026-10-04T05:00:00Z',idempotencyKey:'k1',privacyClass:'C4',payload:{answer:'secret'},
  }),error=>error.code==='TEACHING_D27_PROTECTED_CONTENT_FORBIDDEN');
});

test('Study selects only relevant existing cards for card-native knowledge',()=>{
  const result=selectExistingCardReferences({
    knowledgeType:'DECLARATIVE',learningUnitTitle:'Cell membrane transport',intendedCompetence:'Explain osmosis and diffusion',
    cards:[
      {id:'c1',front_content:'What is osmosis?',back_content:'Movement of water across a selectively permeable membrane.',updated_at:'2026-10-01T00:00:00Z'},
      {id:'c2',front_content:'French Revolution date',back_content:'1789',updated_at:'2026-10-01T00:00:00Z'},
    ],
  });
  assert.deepEqual(result.references.map(x=>x.cardId),['c1']);
  assert.equal(result.freshPracticeRecommended,false);
});

test('procedural and production knowledge require fresh practice instead of automatic cards',()=>{
  for(const type of ['PROCEDURAL','ANALYTICAL','INTERPRETIVE','PRODUCTION']){
    const result=selectExistingCardReferences({knowledgeType:type,learningUnitTitle:'Solve',intendedCompetence:'Apply',cards:[]});
    assert.equal(result.references.length,0);
    assert.equal(result.freshPracticeRecommended,true);
  }
});

test('validated candidates require independent validation and reject protected provenance',()=>{
  const base={candidateId:'x',studentId:'s',courseId:'co',classId:'cl',learningUnitId:'lu',subjectId:'sub',knowledgeType:'CONCEPTUAL',frontContent:'Define entropy',backContent:'A state function related to multiplicity.',sourceVersion:'v1',createdAt:'2026-10-04T05:00:00Z'};
  assert.throws(()=>buildValidatedCardCandidate({...base,validation:{status:'PASS',independent:false},provenanceRefs:[{contentClass:'C1'}]}),e=>e.code==='TEACHING_D27_CARD_VALIDATION_REQUIRED');
  assert.throws(()=>buildValidatedCardCandidate({...base,validation:{status:'PASS',independent:true},provenanceRefs:[{contentClass:'C4',protectedAssessment:true}]}),e=>e.code==='TEACHING_D27_PROTECTED_CONTENT_FORBIDDEN'||e.code==='TEACHING_D27_ASSESSMENT_TO_CARD_FORBIDDEN');
});

test('candidate dedupe identifies an equivalent existing card without copying it',()=>{
  const cards=[{id:'card-1',front_content:'Define momentum',back_content:'Mass times velocity.',updated_at:'2026-10-01T00:00:00Z'}];
  assert.equal(findEquivalentCard(cards,'Define momentum','Mass times velocity.').id,'card-1');
});
