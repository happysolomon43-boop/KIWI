'use strict';

const crypto = require('node:crypto');

const D28_CONTRACT_VERSION = 'd28.operational-hardening.v1';
const D28_EVENT_KINDS = Object.freeze(['AI_EXECUTION','OWNER_TRANSITION','FORMAL_ASSESSMENT_SYNC','PPL_STAGE','QUALITY_SIGNAL','SECURITY_EVENT','RETENTION_ACTION','ROLLOUT_ACTION']);
const D28_ALERT_SEVERITIES = Object.freeze(['INFO','WARNING','CRITICAL']);
const D28_ROLLOUT_MODES = Object.freeze(['OFF','SHADOW','CANARY','ON']);

function fail(message, code='TEACHING_D28_CONTRACT_INVALID') { const e = new Error(message); e.code = code; throw e; }
function text(value, field, max=500, required=true) { if (value == null && !required) return null; const v=String(value||'').trim(); if (required && !v) fail(`${field} is required.`); if (Buffer.byteLength(v,'utf8') > max) fail(`${field} exceeds ${max} bytes.`); return v || null; }
function integer(value, field, {min=0,max=Number.MAX_SAFE_INTEGER}={}) { const n=Number(value); if (!Number.isInteger(n)||n<min||n>max) fail(`${field} must be an integer in [${min}, ${max}].`); return n; }
function finite(value, field, {min=-Infinity,max=Infinity}={}) { const n=Number(value); if (!Number.isFinite(n)||n<min||n>max) fail(`${field} must be a finite number in [${min}, ${max}].`); return n; }
function optionalIso(value, field) { if (value == null) return null; const d=value instanceof Date?value:new Date(value); if (Number.isNaN(d.getTime())) fail(`${field} must be ISO-compatible.`); return d.toISOString(); }
function hash(value) { return crypto.createHash('sha256').update(String(value ?? '')).digest('hex'); }
function stableHash(value) { const stable=(x)=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x; return hash(JSON.stringify(stable(value))); }
function freeze(value){ if (value && typeof value==='object'){ if(Array.isArray(value)) return Object.freeze(value.map(freeze)); return Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,freeze(v)]))); } return value; }
function assertEnum(value, allowed, field){ const v=text(value,field,100); if(!allowed.includes(v)) fail(`${field} must be one of ${allowed.join(', ')}.`); return v; }
function boundedMetadata(value={}, {maxBytes=16_384, forbiddenKeys=[]}={}) { if(!value||typeof value!=='object'||Array.isArray(value)) fail('metadata must be an object.'); const forbidden=new Set(forbiddenKeys.map(x=>String(x).toLowerCase())); const out={}; for(const [k,v] of Object.entries(value)){ if(forbidden.has(String(k).toLowerCase())) fail(`metadata field is forbidden: ${k}`,'TEACHING_D28_SENSITIVE_METADATA_FORBIDDEN'); out[k]=v; } if(Buffer.byteLength(JSON.stringify(out),'utf8')>maxBytes) fail(`metadata exceeds ${maxBytes} bytes.`); return freeze(out); }
function normalizeCorrelation(value){ return text(value,'correlationId',200); }
function normalizeOperationalEvent(input={}){ return freeze({
  eventKind: assertEnum(input.eventKind,D28_EVENT_KINDS,'eventKind'),
  source: text(input.source,'source',200),
  correlationId: normalizeCorrelation(input.correlationId),
  causationId: text(input.causationId,'causationId',200,false),
  capabilityId: text(input.capabilityId,'capabilityId',200,false),
  ownerBoundary: text(input.ownerBoundary,'ownerBoundary',200,false),
  status: text(input.status,'status',100),
  latencyMs: input.latencyMs == null ? null : integer(input.latencyMs,'latencyMs',{max:86_400_000}),
  occurredAt: optionalIso(input.occurredAt || new Date(),'occurredAt'),
  metadata: boundedMetadata(input.metadata||{}, { forbiddenKeys:['prompt','raw_prompt','raw_response','chain_of_thought','reasoning_trace','student_response','protected_payload','authorization','cookie','token','api_key','secret'] }),
}); }

module.exports={D28_CONTRACT_VERSION,D28_EVENT_KINDS,D28_ALERT_SEVERITIES,D28_ROLLOUT_MODES,fail,text,integer,finite,optionalIso,hash,stableHash,freeze,assertEnum,boundedMetadata,normalizeCorrelation,normalizeOperationalEvent};
