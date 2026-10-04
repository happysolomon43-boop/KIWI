'use strict';
const {stableHash,SAFE_CACHE_CLASSES}=require('./contracts');
function createSafeResponseCache({maxEntries=200,ttlMs=5*60*1000,clock=()=>Date.now()}={}){const map=new Map();function keyOf(binding={}){if(binding.cacheClass!==SAFE_CACHE_CLASSES.REFERENCE)throw Object.assign(new Error('Only SAFE_REFERENCE_ONLY D28 responses are cacheable.'),{code:'TEACHING_D28_CACHE_CLASS_FORBIDDEN'});if(binding.studentId||binding.userId||binding.authoritativeJudgment===true||binding.personalized===true)throw Object.assign(new Error('Personalized or authoritative Teaching output cannot use the D28 response cache.'),{code:'TEACHING_D28_CACHE_PERSONALIZED_FORBIDDEN'});for(const req of ['capabilityId','promptVersion','schemaVersion','policyVersion','sourceVersion'])if(!String(binding[req]||'').trim())throw Object.assign(new Error(`D28 cache binding requires ${req}.`),{code:'TEACHING_D28_CACHE_BINDING_INCOMPLETE'});return stableHash(binding);}
function get(binding){const k=keyOf(binding),e=map.get(k);if(!e)return null;if(Number(clock())-e.at>ttlMs){map.delete(k);return null;}return e.value;}
function set(binding,value){const k=keyOf(binding);if(map.size>=maxEntries&&!map.has(k))map.delete(map.keys().next().value);map.set(k,{at:Number(clock()),value});return value;}
function clear(){map.clear();}
return Object.freeze({get,set,clear,size:()=>map.size});}
module.exports={createSafeResponseCache};
