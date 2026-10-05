(function installKiwiMathRenderer(global){
  'use strict';
  const DELIMITERS=[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false},{left:'$',right:'$',display:false}];
  const pending=new Set();let scheduled=false;
  function eligible(node){return node instanceof Element&&!node.closest('textarea,input,select,option,script,style,code,pre,.katex,[contenteditable="true"]');}
  function render(root){if(typeof global.renderMathInElement!=='function'){pending.add(root);return;}try{global.renderMathInElement(root,{delimiters:DELIMITERS,throwOnError:false,strict:false,trust:false,ignoredTags:['script','noscript','style','textarea','pre','code','option']});}catch(error){console.warn('[KIWI] Global math rendering skipped:',error.message);}}
  function flush(){scheduled=false;const roots=[...pending];pending.clear();roots.forEach(render);}
  function queue(node){const root=node?.nodeType===Node.TEXT_NODE?node.parentElement:node;if(!eligible(root))return;pending.add(root);if(!scheduled){scheduled=true;global.requestAnimationFrame(flush);}}
  const observer=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(queue)));
  function boot(){queue(document.body);observer.observe(document.body,{childList:true,subtree:true});const previous=global._onKatexReady;global._onKatexReady=function(){global._katexReady=true;if(typeof previous==='function')previous();queue(document.body);};if(global.renderMathInElement)queue(document.body);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
