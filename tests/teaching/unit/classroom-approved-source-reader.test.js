'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApprovedClassSourceReader}=require('../../../teaching/d14/approved-source-reader');
const one={sourceRef:'source-book-1',version:'v2',text:'Net force produces acceleration in proportion to mass.',protected:false,contentHash:'a'.repeat(64)};
function fixture(material=[one],rows=[{source_ref:'source-book-1',source_version_ref:'v2',content_hash:'a'.repeat(64)}]){
 const seen=[];
 const reader=createApprovedClassSourceReader({
  d11Repository:{getClassContext:async(sid,cid)=>{seen.push({sid,cid});return {classRow:{course_id:'course-1'},blueprint:{blueprint_state:'VALIDATED'},plan:{course_plan_id:'plan-1'}};}},
  requirementsReader:async()=>({version:'approved-d2-v1',adoptionRef:'independent-review-d2',
    scope:{ref:'scope-1',version:'v1'},sourceMaterial:material}),
  query:async(sql,values)=>{seen.push({sql,values});return {rows:rows.filter(x=>x.source_ref===values[2]&&x.source_version_ref===values[3])};}
 });
 return {reader,seen};
}
const args={studentId:'student-1',classId:'class-1'};
test('TPF-20 D2 source reader pins actual approved textual source and D07 version',async()=>{
 const f=fixture();const a=await f.reader(args),b=await f.reader(args);
 assert.deepEqual(a,b);
 assert.match(a.ref,/^classroom-approved-sources:class-1@[a-f0-9]{64}$/);
 assert.deepEqual(a.spans,[{ref:'source-book-1@v2',sourceRef:'source-book-1',sourceVersion:'v2',
   contentHash:'a'.repeat(64),text:one.text}]);
 assert.deepEqual(f.seen[1].values,['student-1','course-1','source-book-1','v2']);
});
test('TPF-20 source reader rejects missing, protected, duplicate and drifted owner versions',async()=>{
 for(const [material,rows,code] of [
  [[one],[],'TEACHING_D14_NOTE_SOURCE_VERSION_STALE'],
  [[{...one,protected:true}],[{...one,source_ref:one.sourceRef,source_version_ref:one.version,content_hash:one.contentHash}],'TEACHING_D14_NOTE_SOURCE_NOT_APPROVED'],
  [[one,one],[], 'TEACHING_D14_NOTE_SOURCE_DUPLICATE'],
  [[{...one,contentHash:'b'.repeat(64)}],[{source_ref:one.sourceRef,source_version_ref:one.version,content_hash:one.contentHash}],'TEACHING_D14_NOTE_SOURCE_VERSION_STALE'],
  [[{...one,text:''}],[{source_ref:one.sourceRef,source_version_ref:one.version,content_hash:one.contentHash}],'TEACHING_D14_NOTE_SOURCE_TEXT_UNAVAILABLE']
 ])await assert.rejects(fixture(material,rows).reader(args),{code});
});
test('source content changes force a fresh note snapshot even when course scope is unchanged',async()=>{
 const before=await fixture().reader(args);
 const changed=await fixture([{...one,text:one.text+' Verified correction.'}]).reader(args);
 assert.notEqual(before.ref,changed.ref);
});
