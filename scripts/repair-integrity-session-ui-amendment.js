'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const write=(file,text)=>fs.writeFileSync(path.join(root,file),text);
function replace(text,needle,replacement,label){if(text.includes(replacement))return text;if(!text.includes(needle))throw new Error(`Integrity repair could not find ${label}.`);return text.replace(needle,replacement);}

let index=read('index.html');
const orphan=`      // Deliberate user-selected Forfeit remains a separate explicit action.\n            } catch (_) {}\n          }\n        }\n      });`;
const repaired=`      // Deliberate user-selected Forfeit remains a separate explicit action.`;
if(index.includes(orphan))index=index.replace(orphan,repaired);
if(!index.includes('/kiwi-integrity-session-guard.js'))throw new Error('Study root does not load shared Integrity Session Guard.');
if(index.includes("fetch(API_BASE_URL + '/exams/' + examId + '/forfeit',")&&index.includes('pagehide — fires after the user confirms leaving'))throw new Error('Legacy pagehide auto-forfeit remains active.');
write('index.html',index);

let contracts=read('teaching/d16/contracts.js');
contracts=replace(contracts,"const SUBMISSION_KINDS=Object.freeze(['DRAFT','FINAL','CORRECTION','VERIFICATION']);","const SUBMISSION_KINDS=Object.freeze(['DRAFT','PENDING_FINAL','FINAL','PENDING_CORRECTION','CORRECTION','VERIFICATION']);",'D16 pending submission kinds');
write('teaching/d16/contracts.js',contracts);

let work=read('public/teaching-d16.js');
const responseNeedle="function safeResponseText(value){if(!value||typeof value!=='object')return '';return typeof value.text==='string'?value.text:typeof value.answer==='string'?value.answer:JSON.stringify(value,null,2);}";
const responseReplacement=`function safeResponseText(value){if(!value||typeof value!=='object')return '';return typeof value.text==='string'?value.text:typeof value.answer==='string'?value.answer:JSON.stringify(value,null,2);}\nfunction isFinalizedSubmission(item){return ['FINAL','CORRECTION','VERIFICATION'].includes(item?.submission?.kind);}\nfunction isPendingSubmission(item){return ['PENDING_FINAL','PENDING_CORRECTION'].includes(item?.submission?.kind);}\nfunction gateBlocksEditing(item){const value=item?.submissionGate?.state;return Boolean(value&&value!=='NONE'&&value!=='FINALIZED');}`;
work=replace(work,responseNeedle,responseReplacement,'Work submission helpers');
work=work.replace("if(state.filter==='SUBMITTED')return items.filter((item)=>item.submission&&item.submission.kind!=='DRAFT');","if(state.filter==='SUBMITTED')return items.filter(isFinalizedSubmission);");
work=work.replace("submitted:items.filter((item)=>item.submission&&item.submission.kind!=='DRAFT').length","submitted:items.filter(isFinalizedSubmission).length");
work=work.replace("const signal=item.submission?`${text(item.submission.kind)} · v${item.submission.version}`:'No final submission yet';","const signal=isPendingSubmission(item)?`${item.submission.kind==='PENDING_CORRECTION'?'Correction':'Submission'} received · verification pending`:item.submission?`${text(item.submission.kind)} · v${item.submission.version}`:'No final submission yet';");
work=work.replace("if(!['CLOSED','MARKING','VERIFICATION','VERIFIED'].includes(item.lifecycleState))add(actions,save,submit);","if(!['CLOSED','MARKING','VERIFICATION','VERIFIED'].includes(item.lifecycleState)&&!gateBlocksEditing(item))add(actions,save,submit);else if(gateBlocksEditing(item))message(status,'Your response receipt is locked while KIWI completes the governed verification/finalization path.');");
work=work.replace("async function showVerificationGate(item,gate,status){const v=gate?.verification,question=v?.currentItem;","async function showVerificationGate(item,gate,status){document.querySelector('.tw-verification-overlay')?.remove();const v=gate?.verification,question=v?.currentItem;");
work=work.replace("add(detail,head,grid);state.host.append(detail);ensureAssignmentGuard(item).catch(()=>{});}","add(detail,head,grid);state.host.append(detail);if(item.submissionGate?.state==='VERIFICATION_ACTIVE')setTimeout(()=>showVerificationGate(item,item.submissionGate,$('div','tw-message')),0);else ensureAssignmentGuard(item).catch(()=>{});}");
write('public/teaching-d16.js',work);

let css=read('public/teaching-d16.css');
if(!css.includes('.tw-verification-overlay'))css+=`\n\n/* Integrity Verification Gate */\n.tw-verification-overlay{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:clamp(18px,4vw,36px);background:rgba(2,12,9,.94);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}\n.tw-verification-card{width:min(720px,100%);display:grid;gap:16px;padding:clamp(22px,4vw,34px);border:1px solid rgba(98,217,165,.24);border-radius:24px;background:linear-gradient(160deg,rgba(9,35,27,.99),rgba(4,20,15,.99));box-shadow:0 30px 100px rgba(0,0,0,.52)}\n.tw-verification-heading{display:flex;align-items:center;justify-content:space-between;gap:18px}.tw-verification-heading h3{margin:0;font-size:clamp(19px,3vw,26px)}\n.tw-verification-timer{min-width:72px;padding:9px 12px;border:1px solid rgba(98,217,165,.2);border-radius:12px;background:rgba(98,217,165,.07);font-family:var(--font-mono);font-size:18px;text-align:center;color:#9ce9c8}\n.tw-verification-prompt{margin:0;color:#dbece5;font-size:15px;line-height:1.7}.tw-verification-card textarea{width:100%;min-height:150px;resize:vertical;border:1px solid rgba(116,229,180,.14);border-radius:15px;background:rgba(1,12,8,.48);color:#edf8f3;padding:14px;font:inherit;line-height:1.65;outline:none}.tw-verification-card textarea:focus{border-color:rgba(98,217,165,.42);box-shadow:0 0 0 3px rgba(98,217,165,.06)}\n@media(max-width:640px){.tw-verification-heading{align-items:flex-start}.tw-verification-timer{min-width:62px}.tw-verification-card{border-radius:20px}}\n`;
write('public/teaching-d16.css',css);

console.log('[integrity-ui-repair] integrity amendment output repaired and hardened');
