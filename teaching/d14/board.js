'use strict';
const TYPES = Object.freeze(['text','equation','worked_solution','graph','data','image','diagram','code','source_passage','comparison','annotation']);
const OPERATIONS = Object.freeze(['add','highlight','reveal','annotate','compare','clear','restore']);
function bad(){throw Object.assign(new Error('TEACHING_D14_BOARD_BLOCK_INVALID: unsafe or unsupported Board block.'),{code:'TEACHING_D14_BOARD_BLOCK_INVALID',status:422});}
function text(value,max=5000){if(typeof value!=='string'||value.length>max||/<\s*\/?\s*(script|iframe|object|embed|style|svg)/i.test(value))bad();return value;}
function validateBlock(block){
  if(!block||typeof block!=='object'||Array.isArray(block)||!TYPES.includes(block.type))bad();
  const c=block.content;if(!c||typeof c!=='object'||Array.isArray(c))bad();
  const forbidden=new Set(['html','innerHTML','srcdoc','javascript','onload','onclick','answerKey','protectedContent']);
  if(Object.keys(c).some((key)=>forbidden.has(key)))bad();
  switch(block.type){
    case 'text':case 'equation':case 'code':case 'source_passage': text(c.text);break;
    case 'worked_solution':if(!Array.isArray(c.steps)||c.steps.length>30||c.steps.some((s)=>typeof s!=='string'))bad();c.steps.forEach((s)=>text(s));break;
    case 'graph':case 'data':if(!Array.isArray(c.points)||c.points.length>300||c.points.some((p)=>!Array.isArray(p)||p.length!==2||p.some((n)=>typeof n!=='number'||!Number.isFinite(n))))bad();break;
    case 'image':case 'diagram':if(!/^\/(?!\/)[a-zA-Z0-9/_ .%-]+$/.test(c.src||'')||!c.assetId||!c.alt)bad();text(c.alt,300);break;
    case 'comparison':if(!Array.isArray(c.columns)||c.columns.length!==2)bad();c.columns.forEach((col)=>text(col.text));break;
    case 'annotation':if(!c.targetItemId||!c.label)bad();text(c.label,500);break;
  }
  return Object.freeze({type:block.type,content:Object.freeze(structuredClone(c))});
}
function validateBoardAction(action){if(!action||!OPERATIONS.includes(action.operation))bad();if(action.block)return Object.freeze({...action,block:validateBlock(action.block)});return Object.freeze({...action});}
function validateTeacherTurnBlocks(message,blocks=[]){
 if(typeof message!=='string'||!message.trim()||message.length>5000||!Array.isArray(blocks)||blocks.length>30)throw Object.assign(new Error('Teacher turn invalid.'),{code:'TEACHING_D14_TEACHER_TURN_INVALID',status:422});
 const safe=blocks.map(validateBlock);
 if(!safe.some(block=>!['image','diagram'].includes(block.type))){if(safe.length>=30)throw Object.assign(new Error('Teacher Board block limit exceeded.'),{code:'TEACHING_D14_TEACHER_TURN_INVALID',status:422});safe.unshift(validateBlock({type:'text',content:{text:message.trim()}}));}
 return safe;
}
const PUBLIC_BLOCK_VERSION='d14.board-public.v1';
// Candidate delivery projection: only renderable public fields leave private buffers.
// Legacy validateBlock/readers retain their existing compatible behavior.
function projectPublicBlock(block){const b=validateBlock(block),c=b.content;let content;
 switch(b.type){
  case 'text':case 'equation':case 'code':case 'source_passage':content={text:c.text};break;
  case 'worked_solution':content={steps:[...c.steps]};break;
  case 'graph':case 'data':content={points:c.points.map(p=>[...p]),...(typeof c.description==='string'?{description:c.description}:{}),...(typeof c.alt==='string'?{alt:c.alt}:{})};break;
  case 'image':case 'diagram':content={src:c.src,assetId:c.assetId,alt:c.alt,...(['ILLUSTRATIVE','STRUCTURED_EXACT'].includes(c.visualAuthority)?{visualAuthority:c.visualAuthority}:{}),...(['SUPPLEMENTARY_ONLY','STRUCTURED_VISUAL'].includes(c.academicAuthority)?{academicAuthority:c.academicAuthority}:{}),...(c.provenance?{provenance:{generated:c.provenance.generated===true,deterministic:c.provenance.deterministic===true,sanitized:c.provenance.sanitized===true,...(/^[a-f0-9]{64}$/.test(c.provenance.sourceHash||'')?{sourceHash:c.provenance.sourceHash}:{})}}:{}),...(typeof c.fallback?.text==='string'?{fallback:{text:c.fallback.text}}:{})};break;
  case 'comparison':content={columns:c.columns.map(col=>({text:col.text,...(typeof col.title==='string'?{title:col.title}:{})}))};break;
  case 'annotation':content={targetItemId:c.targetItemId,label:c.label};break;
 }
 return validateBlock({type:b.type,content});
}
module.exports={TYPES,OPERATIONS,validateBlock,validateBoardAction,validateTeacherTurnBlocks,projectPublicBlock,PUBLIC_BLOCK_VERSION};
