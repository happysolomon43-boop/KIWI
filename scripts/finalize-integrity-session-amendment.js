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
const seen=new Set();
const lines=text.split('\n').filter((line)=>{
  const trimmed=line.trimStart();
  const prefix=prefixes.find((value)=>trimmed.startsWith(value));
  if(!prefix)return true;
  if(seen.has(prefix))return false;
  seen.add(prefix);
  return true;
});
text=lines.join('\n');
for(const prefix of prefixes){
  const count=text.split('\n').filter((line)=>line.trimStart().startsWith(prefix)).length;
  if(count!==1)throw new Error(`Expected exactly one ${prefix}, found ${count}.`);
}
if(!text.includes("if(result.status==='ACTIVE')"))throw new Error('Multi-step verification UI branch is missing.');
fs.writeFileSync(file,text);
console.log('[integrity-amendment-finalizer] helper duplication removed; exactly one governed verification UI remains');
