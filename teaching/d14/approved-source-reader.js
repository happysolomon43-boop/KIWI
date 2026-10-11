'use strict';
// Reuse the reviewed D2 preparation source scope; independently pin every
// item to the student's owned D07 source inventory at the current Class.
const {createHash}=require('node:crypto');
function deny(code){throw Object.assign(new Error(code),{code,status:409});}
function createApprovedClassSourceReader({d11Repository,requirementsReader,query}={}){
 if(typeof d11Repository?.getClassContext!=='function'||typeof requirementsReader!=='function'||typeof query!=='function')
  throw new TypeError('Class Note source reader requires owned D11 context, adopted D2 requirements and D07 source inventory');
 return async function readApprovedSource({studentId,classId}={}){
  if(!studentId||!classId)deny('TEACHING_D14_NOTE_SOURCE_OWNER_REQUIRED');
  const ctx=await d11Repository.getClassContext(studentId,classId);
  if(!ctx?.blueprint||ctx.blueprint.blueprint_state!=='VALIDATED'||!ctx.classRow?.course_id||!ctx.plan)
   deny('TEACHING_D14_NOTE_APPROVED_SCOPE_UNAVAILABLE');
  const approved=await requirementsReader(ctx);
  if(!approved?.version||!approved.adoptionRef||!approved.scope?.version||!approved.scope?.ref||
    !Array.isArray(approved.sourceMaterial)||!approved.sourceMaterial.length)
   deny('TEACHING_D14_NOTE_APPROVED_SCOPE_UNAVAILABLE');
  const spans=[],seen=new Set();
  for(const raw of approved.sourceMaterial){
   if(!raw||raw.protected===true||typeof raw.sourceRef!=='string'||!raw.sourceRef||
    typeof raw.version!=='string'||!raw.version)
    deny('TEACHING_D14_NOTE_SOURCE_NOT_APPROVED');
   const key=raw.sourceRef+'@'+raw.version;
   if(seen.has(key))deny('TEACHING_D14_NOTE_SOURCE_DUPLICATE');
   seen.add(key);
   const row=(await query(
    'select source_ref,source_version_ref,content_hash from public.teaching_source_content_items where student_id=$1 and course_id=$2 and source_ref=$3 and source_version_ref=$4 order by source_content_item_id limit 1',
    [studentId,ctx.classRow.course_id,raw.sourceRef,raw.version])).rows?.[0];
   if(!row||!row.content_hash||raw.contentHash&&raw.contentHash!==row.content_hash)
    deny('TEACHING_D14_NOTE_SOURCE_VERSION_STALE');
   const text=typeof raw.text==='string'?raw.text:typeof raw.content==='string'?raw.content:null;
   if(!text||!text.trim())deny('TEACHING_D14_NOTE_SOURCE_TEXT_UNAVAILABLE');
   spans.push({ref:key,sourceRef:raw.sourceRef,sourceVersion:raw.version,contentHash:row.content_hash,text});
  }
  spans.sort((a,b)=>a.ref.localeCompare(b.ref));
  const digest=createHash('sha256').update(JSON.stringify({studentId,classId,courseId:ctx.classRow.course_id,
    scope:approved.scope,requirementsVersion:approved.version,adoptionRef:approved.adoptionRef,spans})).digest('hex');
  return Object.freeze({ref:'classroom-approved-sources:'+classId+'@'+digest,spans:Object.freeze(spans)});
 };
}
module.exports={createApprovedClassSourceReader};
