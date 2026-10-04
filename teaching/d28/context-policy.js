'use strict';
const { integer, freeze } = require('./contracts');

function boundContext({messages=[],maxItems=24,maxChars=48_000,protectedContent=false}={}){
  const itemLimit=integer(maxItems,'maxItems',{min:1,max:100});
  const charLimit=integer(maxChars,'maxChars',{min:1000,max:200000});
  if (protectedContent) return freeze({items:Object.freeze([]),truncated:Boolean(messages.length),protectedContentExcluded:true,totalChars:0});
  const src=Array.isArray(messages)?messages:[]; const out=[]; let chars=0;
  for(let i=Math.max(0,src.length-itemLimit);i<src.length;i+=1){ const value=String(src[i]?.content ?? src[i] ?? ''); const remaining=charLimit-chars; if(remaining<=0) break; const content=value.slice(0,remaining); out.push(Object.freeze({role:String(src[i]?.role||'context'),content})); chars+=content.length; }
  return freeze({items:Object.freeze(out),truncated:out.length<src.length||chars>=charLimit,protectedContentExcluded:false,totalChars:chars});
}

function compactContext(summary,input){ const bounded=boundContext(input); return freeze({summary:summary==null?null:String(summary).slice(0,8000),...bounded}); }
module.exports={boundContext,compactContext};
