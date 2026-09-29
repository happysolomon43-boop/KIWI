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
module.exports={TYPES,OPERATIONS,validateBlock,validateBoardAction};
