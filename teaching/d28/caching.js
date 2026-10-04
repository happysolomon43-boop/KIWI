'use strict';
const { text, integer, freeze } = require('./contracts');

const CACHEABLE_POSTURES = Object.freeze(new Set(['T0_DETERMINISTIC','T1_READ_ONLY','T1_ADVISORY']));
const FORBIDDEN_CACHE_CLASSES = Object.freeze(new Set(['FORMAL_ASSESSMENT_RESPONSE','GRADE_MUTATION','ATTENDANCE_MUTATION','PROGRESSION_MUTATION','PPL_MATURITY_DECISION','PROTECTED_ASSESSMENT_CONTENT']));

function cacheDecision({authorityLevel, executionClass, artifactClass='GENERAL', ttlSeconds=0, containsProtectedContent=false, stateVersionRef=null}={}){
  const authority=text(authorityLevel,'authorityLevel',20).toUpperCase();
  const exec=text(executionClass,'executionClass',100).toUpperCase();
  const cls=text(artifactClass,'artifactClass',100).toUpperCase();
  const ttl=integer(ttlSeconds,'ttlSeconds',{min:0,max:3600});
  const posture=`${authority}_${exec}`;
  const blocked=containsProtectedContent || FORBIDDEN_CACHE_CLASSES.has(cls) || !CACHEABLE_POSTURES.has(posture) || ttl===0;
  return freeze({ cacheable:!blocked, ttlSeconds:blocked?0:ttl, stateVersionRef:stateVersionRef==null?null:String(stateVersionRef), protectedContentCached:false, academicMutationCached:false, reason:blocked?'CACHE_FORBIDDEN_OR_DISABLED':'SAFE_SHORT_LIVED_CACHE' });
}

module.exports={CACHEABLE_POSTURES,FORBIDDEN_CACHE_CLASSES,cacheDecision};
