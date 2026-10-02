'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=path.join(root,'public/teaching-d16.js');
let text=fs.readFileSync(file,'utf8');
const prefixes=[
  'function guard(){return window.KIWIIntegritySessionGuard||null;}',
  'async function ensureAssignmentGuard(',
  'function verificationTimer(',
  'async function showVerificationGate(',
  'async function handleSubmissionGate('
];
const sourceLines=text.split('\n');
const candidates=new Map(prefixes.map((prefix)=>[prefix,sourceLines.filter((line)=>line.trimStart().startsWith(prefix))]));
const preferred=new Map();
for(const prefix of prefixes){
  const rows=candidates.get(prefix)||[];
  if(!rows.length)throw new Error(`Missing governed UI helper ${prefix}.`);
  if(prefix==='async function showVerificationGate('){
    const multiStep=rows.find((line)=>line.includes("if(result.status==='ACTIVE')"));
    if(!multiStep)throw new Error('Multi-step verification UI branch is missing.');
    preferred.set(prefix,multiStep);
  }else{
    preferred.set(prefix,rows[0]);
  }
}
const emitted=new Set();
const lines=[];
for(const line of sourceLines){
  const trimmed=line.trimStart();
  const prefix=prefixes.find((value)=>trimmed.startsWith(value));
  if(!prefix){lines.push(line);continue;}
  if(emitted.has(prefix))continue;
  lines.push(preferred.get(prefix));
  emitted.add(prefix);
}
text=lines.join('\n');
for(const prefix of prefixes){
  const count=text.split('\n').filter((line)=>line.trimStart().startsWith(prefix)).length;
  if(count!==1)throw new Error(`Expected exactly one ${prefix}, found ${count}.`);
}
if(!text.includes("if(result.status==='ACTIVE')"))throw new Error('Multi-step verification UI branch is missing after normalization.');
fs.writeFileSync(file,text);
console.log('[integrity-amendment-finalizer] helper duplication removed; exactly one governed multi-step verification UI remains');
