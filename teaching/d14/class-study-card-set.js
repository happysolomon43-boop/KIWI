'use strict';
// D14 consumes only D27-owned, already-linked Study card references.
// A raw subject card corpus must never become an implicit approved Class set.
const {createHash}=require('node:crypto');
function fail(code){throw Object.assign(new Error(code),{code,status:409});}
function createD27ClassStudyCardSetReader({d27ServiceReader,subjectReader,d11Repository}={}){
 if(typeof d27ServiceReader!=='function'||typeof subjectReader?.getCorpusForUser!=='function'||
  typeof d11Repository?.getClassContext!=='function')throw new TypeError('D27 card set requires authorized owner readers');
 return async function readCardSet({studentId,classId}={}){
  if(!studentId||!classId)fail('TEACHING_D14_CARD_SET_OWNER_REQUIRED');
  const context=await d11Repository.getClassContext(studentId,classId);
  if(!context?.classRow?.course_id)fail('TEACHING_D14_CARD_SET_CLASS_NOT_OWNED');
  const service=d27ServiceReader();
  if(typeof service?.getClassReviewSet!=='function')fail('TEACHING_D27_CLASS_CARD_OWNER_UNAVAILABLE');
  const courseId=context.classRow.course_id;
  const data=await service.getClassReviewSet({id:studentId},{courseId,classId});
  const refs=data?.references;
  if(!Array.isArray(refs)||!refs.length)fail('TEACHING_D27_CLASS_CARD_SET_NOT_ADOPTED');
  const cardSets=new Map(),cards=[],identities=new Set();
  for(const ref of refs){
   if(ref.status!=='CURRENT'||ref.courseId!==courseId||ref.classId!==classId||
    !ref.subjectId||!ref.cardId||!ref.learningUnitId||!ref.referencedVersion||
    String(ref.currentVersion)!==String(ref.referencedVersion))
    fail('TEACHING_D27_CLASS_CARD_SET_STALE');
   const identity=ref.subjectId+':'+ref.cardId;
   if(identities.has(identity))fail('TEACHING_D27_CLASS_CARD_SET_DUPLICATE');
   identities.add(identity);
   if(!cardSets.has(ref.subjectId))cardSets.set(ref.subjectId,await subjectReader.getCorpusForUser(studentId,ref.subjectId));
   const card=cardSets.get(ref.subjectId)?.cards?.find(v=>String(v.id)===String(ref.cardId));
   const version=card&&(card.updated_at||card.updatedAt||card.version||card.created_at||card.createdAt);
   if(!card||String(version)!==String(ref.referencedVersion)||!card.front_content&&!card.front||
    !card.back_content&&!card.back)fail('TEACHING_D27_CLASS_CARD_SOURCE_CHANGED');
   cards.push({cardId:String(ref.cardId),version:String(ref.referencedVersion),
    learningUnitId:String(ref.learningUnitId),knowledgeType:ref.knowledgeType||null,
    front:String(card.front_content||card.front),back:String(card.back_content||card.back),
    validated:true});
  }
  cards.sort((a,b)=>a.cardId.localeCompare(b.cardId));
  const digest=createHash('sha256').update(JSON.stringify({studentId,courseId,classId,cards})).digest('hex');
  return Object.freeze({ref:'d27-class-card-set:'+classId+'@'+digest,cards:Object.freeze(cards)});
 };
}
module.exports={createD27ClassStudyCardSetReader};
