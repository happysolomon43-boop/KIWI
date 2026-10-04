'use strict';

const path = require('node:path');
const { text, integer, freeze } = require('./contracts');

const SENSITIVE_KEY_PATTERNS = Object.freeze([/authorization/i,/cookie/i,/api[_-]?key/i,/secret/i,/token/i,/password/i,/chain[_-]?of[_-]?thought/i,/reasoning[_-]?trace/i,/raw[_-]?prompt/i,/raw[_-]?response/i]);
const ALLOWED_UPLOAD_MIME = Object.freeze(new Set(['application/pdf','text/plain','text/markdown','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg','image/webp']));
const DENIED_EXTENSIONS = Object.freeze(new Set(['.exe','.dll','.so','.dylib','.js','.mjs','.cjs','.sh','.bat','.cmd','.ps1','.jar','.com','.scr','.html','.htm','.svg']));
const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function redactSensitive(value, depth=0){
  if(depth>8) return '[TRUNCATED_DEPTH]';
  if(Array.isArray(value)) return value.slice(0,100).map(v=>redactSensitive(v,depth+1));
  if(value&&typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(SENSITIVE_KEY_PATTERNS.some(rx=>rx.test(k))) out[k]='[REDACTED]';
      else out[k]=redactSensitive(v,depth+1);
    }
    return freeze(out);
  }
  if(typeof value==='string'){
    let result=value.replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi,'$1[REDACTED]');
    result=result.replace(/([A-Za-z0-9_]*(?:api[_-]?key|secret|token|password)[A-Za-z0-9_]*\s*[=:]\s*)[^\s,;]+/gi,'$1[REDACTED]');
    return result.length>16000 ? `${result.slice(0,16000)}…[TRUNCATED]` : result;
  }
  return value;
}

function assertNoHiddenReasoning(value){
  const visit=(v,p='root')=>{ if(Array.isArray(v)) return v.forEach((x,i)=>visit(x,`${p}[${i}]`)); if(v&&typeof v==='object') for(const [k,x] of Object.entries(v)){ if(/chain[_-]?of[_-]?thought|reasoning[_-]?trace|hidden[_-]?reasoning|private[_-]?scratchpad/i.test(k)){ const e=new Error(`Hidden reasoning persistence is forbidden at ${p}.${k}`);e.code='TEACHING_HIDDEN_REASONING_PERSISTENCE_FORBIDDEN';throw e;} visit(x,`${p}.${k}`); } };
  visit(value); return true;
}

function validateUploadMetadata(input={}, {maxBytes=DEFAULT_MAX_UPLOAD_BYTES}={}){
  const filename=text(input.filename,'filename',255); const mime=text(input.mimeType,'mimeType',200).toLowerCase(); const size=integer(input.sizeBytes,'sizeBytes',{min:1,max:maxBytes});
  const ext=path.extname(filename).toLowerCase();
  if(DENIED_EXTENSIONS.has(ext)) { const e=new Error(`Upload extension ${ext} is forbidden.`); e.code='TEACHING_D28_UPLOAD_TYPE_FORBIDDEN'; throw e; }
  if(!ALLOWED_UPLOAD_MIME.has(mime)) { const e=new Error(`Upload MIME ${mime} is not allowed.`); e.code='TEACHING_D28_UPLOAD_MIME_FORBIDDEN'; throw e; }
  if(/[\0\r\n]/.test(filename) || filename.includes('..') || path.basename(filename)!==filename){ const e=new Error('Unsafe filename.'); e.code='TEACHING_D28_UPLOAD_FILENAME_UNSAFE'; throw e; }
  return freeze({filename,mimeType:mime,sizeBytes:size,extension:ext,contentDisposition:'attachment',activeContentAllowed:false,serverSideScanRequired:true});
}

function securityHeaders({assessment=false}={}){ return freeze({
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control':assessment?'no-store, private':'private, max-age=0, must-revalidate',
  'Content-Security-Policy':"default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
}); }

module.exports={SENSITIVE_KEY_PATTERNS,ALLOWED_UPLOAD_MIME,DENIED_EXTENSIONS,DEFAULT_MAX_UPLOAD_BYTES,redactSensitive,assertNoHiddenReasoning,validateUploadMetadata,securityHeaders};
