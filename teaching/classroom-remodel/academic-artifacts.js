'use strict';
const crypto=require('node:crypto');
const c=require('./contracts');
const {validatePresenter}=require('./mode-schemas');
const VERSION='classroom-academic-artifacts.v1';
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function unitHashes(chapter){return Object.fromEntries(c.list(chapter.units,'chapter.units').map(u=>[u.anchor,hash(u)]));}
function validateContinuation(previous,next){
 c.validateChapter(previous);c.validateChapter(next);
 if(previous.completeness!=='partial'||previous.id!==next.id||previous.version!==next.version)c.fail('CLASSROOM_CONTINUATION_IDENTITY_CHANGED');
 const hashes=unitHashes(previous);
 for(const unit of previous.units){if(previous.continuation.preserved_hashes[unit.anchor]!==hashes[unit.anchor])c.fail('CLASSROOM_CONTINUATION_BASE_HASH_INVALID');const preserved=next.units.find(u=>u.anchor===unit.anchor);if(!preserved||hash(preserved)!==hashes[unit.anchor])c.fail('CLASSROOM_CONTINUATION_CHANGED_COMPLETED_UNIT');}
 const expected=new Set(previous.continuation.remaining_units);if(expected.size!==previous.continuation.remaining_units.length)c.fail('CLASSROOM_CONTINUATION_DUPLICATE_REMAINDER');
 for(const unit of next.units.slice(previous.units.length))if(!expected.has(unit.anchor))c.fail('CLASSROOM_CONTINUATION_UNREQUESTED_UNIT');
 if(next.units.slice(0,previous.units.length).some((u,i)=>u.anchor!==previous.units[i].anchor))c.fail('CLASSROOM_CONTINUATION_REORDERED_UNIT');
 if(next.completeness==='complete'&&next.units.length!==previous.units.length+expected.size)c.fail('CLASSROOM_CONTINUATION_INCOMPLETE');
 if(next.completeness==='partial'){const done=new Set(next.units.map(u=>u.anchor));if(JSON.stringify(next.continuation.remaining_units)!==JSON.stringify(previous.continuation.remaining_units.filter(a=>!done.has(a))))c.fail('CLASSROOM_CONTINUATION_REMAINDER_CHANGED');}
 return next;
}
function validateDepth(chapter,{requiredUnits,requiredElements=[]}={}){
 c.validateChapter(chapter);if(!Array.isArray(requiredUnits)||!requiredUnits.length)c.fail('CLASSROOM_APPROVED_SCOPE_REQUIRED');
 const present=new Set(chapter.units.map(u=>u.anchor));if(chapter.completeness==='complete'&&requiredUnits.some(a=>!present.has(a)))c.fail('CLASSROOM_CHAPTER_SCOPE_INCOMPLETE');
 if(chapter.units.some(u=>!requiredUnits.includes(u.anchor)))c.fail('CLASSROOM_CHAPTER_OUTSIDE_SCOPE');
 for(const requirement of requiredElements){c.exact(requirement,['unit','type','purpose'],'depth_requirement');c.string(requirement.purpose,'purpose');if(present.has(requirement.unit)&&!chapter.units.find(u=>u.anchor===requirement.unit).elements.some(e=>e.type===requirement.type))c.fail('CLASSROOM_SUBJECT_DEPTH_MISSING');}
 // This is a structural check. Substantial subject correctness/depth requires
 // the separate independent review receipt, never word/paragraph counts.
 return chapter;
}
function validateGuide(guide,{chapter,essentialAnchors}={}){
 c.validateCoordinator({request_ref:'guide-validation',task_mode:'prepare_guidance',input_state_reference:null,status:'complete',review_required:false,artifacts:{explanation_guides:guide},next_action:null,runtime_requests:[],issues:[]},{mode:'prepare_guidance',chapter});
 const all=new Set(chapter.units.flatMap(u=>u.elements.map(e=>e.anchor)));
 const covered=new Set();for(const ref of guide.covered_refs){c.resolveAnchor(ref,chapter);if(ref.kind!=='source_element'||!all.has(ref.anchor)||covered.has(ref.anchor))c.fail('CLASSROOM_GUIDE_COVERAGE_INVALID');covered.add(ref.anchor);}
 const uncovered=new Set();for(const ref of guide.uncovered_refs){c.resolveAnchor(ref,chapter);if(!all.has(ref.anchor)||covered.has(ref.anchor)||uncovered.has(ref.anchor))c.fail('CLASSROOM_GUIDE_COVERAGE_OVERLAP');uncovered.add(ref.anchor);}
 if([...all].some(a=>!covered.has(a)&&!uncovered.has(a)))c.fail('CLASSROOM_GUIDE_COVERAGE_UNACCOUNTED');
 const passages=new Set();for(const unit of guide.teaching_units){const owner=chapter.units.find(u=>u.anchor===unit.unit_ref);if(!owner)c.fail('CLASSROOM_GUIDE_AUTHOR_UNIT_CHANGED');for(const anchor of unit.source_elements)if(!owner.elements.some(e=>e.anchor===anchor))c.fail('CLASSROOM_GUIDE_SOURCE_OUTSIDE_UNIT');for(const passage of unit.passages){if(!owner.elements.some(e=>e.anchor===passage.passage_ref)||!unit.source_elements.includes(passage.passage_ref)||passages.has(passage.passage_ref))c.fail('CLASSROOM_GUIDE_PASSAGE_INVALID');passages.add(passage.passage_ref);}}
 for(const anchor of covered)if(!passages.has(anchor))c.fail('CLASSROOM_GUIDE_COVERAGE_WITHOUT_PASSAGE');
 for(const anchor of essentialAnchors||[])if(!covered.has(anchor)||!passages.has(anchor))c.fail('CLASSROOM_ESSENTIAL_GUIDE_MISSING');return guide;
}
function prepareArtifact({kind,payload,context={}}){
 let publicPayload={};let components=[];let guideCompleteness='complete';
 if(kind==='chapter'){validateDepth(payload,context);if(payload.completeness==='complete')publicPayload=c.projectChapter({...payload,validation:'validated'});components=payload.units.flatMap((u,i)=>[{anchor:u.anchor,parent:null,kind:'chapter_unit',sequence:i,hash:hash(u),publicPayload:{anchor:u.anchor,title:u.title}},...u.elements.map((e,j)=>({anchor:e.anchor,parent:u.anchor,kind:'source_element',sequence:j,hash:hash(e),publicPayload:{anchor:e.anchor,type:e.type,text:e.text,asset_ref:e.asset_ref,alt_text:e.alt_text,source_refs:e.source_refs}}))]);}
 else if(kind==='plan')c.validatePlan(payload,context.chapter);
 else if(kind==='guide'){validateGuide(payload,{...context,essentialAnchors:[]});const covered=new Set(payload.covered_refs.map(r=>r.anchor));guideCompleteness=context.declaredCompleteness||((context.essentialAnchors||[]).some(a=>!covered.has(a))?'partial':'complete');c.enumeration(guideCompleteness,['complete','partial','blocked'],'guide.completeness');if(guideCompleteness==='complete'&&(context.essentialAnchors||[]).some(a=>!covered.has(a)))c.fail('CLASSROOM_ESSENTIAL_GUIDE_MISSING');}
 else if(kind==='opening')validatePresenter(payload,context);
 else c.fail('CLASSROOM_ARTIFACT_KIND_INVALID');
 return {kind,payload,publicPayload,components,contentHash:hash(payload),completeness:kind==='chapter'?payload.completeness:kind==='opening'?payload.interaction.preparation_completion:kind==='guide'?guideCompleteness:'complete'};
}
module.exports={VERSION,canonical,hash,unitHashes,validateContinuation,validateDepth,validateGuide,prepareArtifact};
