'use strict';
const {validatePolicy,capabilityReadiness}=require('./state-policy');
const {fail}=require('./contracts');
function assertPresentationPolicy(policy){validatePolicy(policy);for(const capability of ['presentation','transport']){const check=capabilityReadiness(policy,capability);if(!check.ready)fail('CLASSROOM_PRESENTATION_POLICY_MISSING',check.missing.join(','));}return policy;}
function value(policy,key){return policy.fields[key]?.value;}
function dwell(policy,pace,types=[]){const profile=value(policy,'paceProfiles')[pace];if(!profile)fail('CLASSROOM_PACE_NOT_ADOPTED');const weights=types.map(type=>profile.contentTypeWeights[type]);if(weights.some(w=>w==null))fail('CLASSROOM_CONTENT_TYPE_PACE_NOT_ADOPTED');const weight=weights.length?Math.max(...weights):profile.contentTypeWeights.text;if(!weight)fail('CLASSROOM_CONTENT_TYPE_PACE_NOT_ADOPTED');return Math.min(profile.maximumDwellMs,Math.max(profile.minimumDwellMs,Math.ceil(profile.minimumDwellMs*weight)));}
function failure(code,status=409){return Object.assign(new Error(code),{code,status});}
module.exports={assertPresentationPolicy,value,dwell,failure};
