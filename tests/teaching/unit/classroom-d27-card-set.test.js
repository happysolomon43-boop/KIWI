'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createD27ClassStudyCardSetReader}=require('../../../teaching/d14/class-study-card-set');
const base={referenceId:'ref-1',courseId:'course-1',classId:'class-1',
  learningUnitId:'unit-1',subjectId:'subject-1',cardId:'card-1',
  referencedVersion:'v1',currentVersion:'v1',status:'CURRENT',knowledgeType:'CONCEPTUAL'};
const current={id:'card-1',version:'v1',front_content:'What is inertia?',back_content:'Resistance to a change in velocity.'};
function setup(refs=[base],cards=[current]){
 const reads=[];
 const read=createD27ClassStudyCardSetReader({
   d11Repository:{getClassContext:async()=>({classRow:{course_id:'course-1'}})},
   d27ServiceReader:()=>({getClassReviewSet:async (user,params)=>{reads.push({kind:'d27',user,params});return {references:refs};}}),
   subjectReader:{getCorpusForUser:async(studentId,subjectId)=>{reads.push({kind:'corpus',studentId,subjectId});return {cards};}}
 });
 return {read,reads};
}
const owner={studentId:'student-1',classId:'class-1',stage:'POST_CLASS'};
test('TPF-20 sees only version-current cards already referenced by D27 for this Class',async()=>{
 const h=setup();const set=await h.read(owner);
 assert.match(set.ref,/^d27-class-card-set:class-1@[a-f0-9]{64}$/);
 assert.deepEqual(set.cards,[{cardId:'card-1',version:'v1',learningUnitId:'unit-1',knowledgeType:'CONCEPTUAL',
   front:'What is inertia?',back:'Resistance to a change in velocity.',validated:true}]);
 assert.deepEqual(h.reads[0],{kind:'d27',user:{id:'student-1'},params:{courseId:'course-1',classId:'class-1'}});
 assert.deepEqual(h.reads[1],{kind:'corpus',studentId:'student-1',subjectId:'subject-1'});
 const other=setup([base],[{...current,back_content:'A materially changed actual card'}]);assert.notEqual((await other.read(owner)).ref,set.ref);
});
test('unselected cards, empty D27 selection, version drift and foreign context never become Class notes',async()=>{
 for(const [refs,cards,code] of [
   [[],[current],'TEACHING_D27_CLASS_CARD_SET_NOT_ADOPTED'],
   [[{...base,status:'CARD_VERSION_CHANGED'}],[current],'TEACHING_D27_CLASS_CARD_SET_STALE'],
   [[{...base,courseId:'other'}],[current],'TEACHING_D27_CLASS_CARD_SET_STALE'],
   [[base],[{...current,version:'v2'}],'TEACHING_D27_CLASS_CARD_SOURCE_CHANGED'],
   [[base],[], 'TEACHING_D27_CLASS_CARD_SOURCE_CHANGED']
 ])await assert.rejects(setup(refs,cards).read(owner),{code});
});
test('duplicate same-Subject card references are rejected before note generation',async()=>{
 await assert.rejects(setup([base,{...base,referenceId:'ref-2'}]).read(owner),{code:'TEACHING_D27_CLASS_CARD_SET_DUPLICATE'});
});
