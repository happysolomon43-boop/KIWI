'use strict';

const { getCapability, assertCapabilityBinding } = require('../capability-registry');
const { compareStateSnapshot, comparePreconditions } = require('./state-revalidation');

function normalizeCheckResult(result, id) {
  if (result === true) return Object.freeze({ ok: true });
  if (result === false || result == null) return Object.freeze({ ok: false, reason: `PREFLIGHT_REJECTED:${id}` });
  if (typeof result !== 'object' || Array.isArray(result)) throw new TypeError(`Preflight check ${id} must return boolean or an object.`);
  return Object.freeze({ok:result.ok===true,reason:result.reason==null?`PREFLIGHT_REJECTED:${id}`:String(result.reason),safeMetadata:Object.freeze({...(result.safeMetadata||{})})});
}

function createOrchestratorPreflight({checks=[],resolveRequiredCheckIds=async()=>[],isCapabilityEnabled=async()=>true}={}) {
  if (!Array.isArray(checks)) throw new TypeError('Teaching D05 preflight checks must be an array.');
  if (typeof resolveRequiredCheckIds !== 'function') throw new TypeError('resolveRequiredCheckIds must be a function.');
  if (typeof isCapabilityEnabled !== 'function') throw new TypeError('isCapabilityEnabled must be a function.');
  const checkById=new Map();
  for(const check of checks){if(!check||typeof check.id!=='string'||typeof check.evaluate!=='function')throw new TypeError('Every Teaching D05 preflight check requires id and evaluate().');if(checkById.has(check.id))throw new TypeError(`Duplicate Teaching preflight check: ${check.id}`);checkById.set(check.id,check);}
  async function run({envelope,authoritativeSnapshot,requestContext={}}={}) {
    if(!envelope?.capability?.id)throw new TypeError('Teaching D05 preflight requires an execution envelope.');
    const capability=getCapability(envelope.capability.id);
    assertCapabilityBinding(capability.id,{authorityLevel:envelope.capability.authority_ceiling,authoritativeOwnerBoundary:envelope.capability.authoritative_owner_boundary,promptFamilyId:capability.prompt_family_id});
    if(await isCapabilityEnabled(capability,requestContext)!==true){const error=new Error(`Teaching capability is disabled or unavailable: ${capability.id}`);error.code='TEACHING_D05_CAPABILITY_DISABLED';throw error;}
    if(capability.authority_ceiling!=='T0'){
      const comparison=compareStateSnapshot(envelope.state_reference,authoritativeSnapshot?.stateReference);
      const preconditions=comparePreconditions(envelope.preconditions,authoritativeSnapshot?.preconditions||{});
      const reasons=[...comparison.reasons,...preconditions.reasons];
      if(comparison.stale||preconditions.stale){const error=new Error(`Preflight authoritative state changed: ${reasons.join(', ')}`);error.code='TEACHING_D05_PREFLIGHT_STATE_STALE';error.reasons=Object.freeze(reasons);throw error;}
    }
    const requiredIds=await resolveRequiredCheckIds({capability,envelope,authoritativeSnapshot,requestContext});
    if(!Array.isArray(requiredIds))throw new TypeError('resolveRequiredCheckIds() must return an array.');
    const uniqueRequired=[...new Set(requiredIds.map(v=>String(v).trim()).filter(Boolean))];
    const passed=[];
    for(const id of uniqueRequired){const check=checkById.get(id);if(!check){const error=new Error(`Required Teaching preflight gate is not registered: ${id}`);error.code='TEACHING_D05_REQUIRED_PREFLIGHT_GATE_MISSING';throw error;}const result=normalizeCheckResult(await check.evaluate({envelope,authoritativeSnapshot,requestContext}),check.id);if(!result.ok){const error=new Error(result.reason);error.code='TEACHING_D05_PREFLIGHT_REJECTED';error.checkId=check.id;error.safeMetadata=result.safeMetadata||{};throw error;}passed.push(check.id);}
    return Object.freeze({ok:true,passedChecks:Object.freeze(passed)});
  }
  return Object.freeze({run});
}
module.exports={createOrchestratorPreflight};
