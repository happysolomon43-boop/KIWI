'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}
function write(file,text){fs.writeFileSync(path.join(root,file),text);}
function replaceRequired(text,needle,replacement,label){if(text.includes(replacement))return text;if(!text.includes(needle))throw new Error(`Integrity UI transform could not find ${label}.`);return text.replace(needle,replacement);}

// Shared script loading: Study root and Teaching both consume the same guard.
let index=read('index.html');
index=replaceRequired(index,'<script src="/kiwi-ui-system.js"></script>\n<script src="/kiwi_product_v3.js"></script>','<script src="/kiwi-ui-system.js"></script>\n<script src="/kiwi-integrity-session-guard.js"></script>\n<script src="/kiwi_product_v3.js"></script>','Study guard script seam');

const oldLock=`      function _lockExamPage(isReckoning) {
        _examPageLocked = true;
        _examIsReckoning = !!isReckoning;
      }
      function _unlockExamPage() {
        _examPageLocked = false;
        _examIsReckoning = false;
      }`;
const newLock=`      function _renderIntegrityExamLock(snapshot) {
        var existing = document.getElementById('kiwiIntegrityExamLock');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'kiwiIntegrityExamLock';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(3,13,11,.97);display:grid;place-items:center;padding:24px;';
        var outcome = snapshot && snapshot.lockOutcome;
        var reason = outcome === 'ATTEMPT_INVALIDATED_RULE_BREACH'
          ? 'This controlled attempt was invalidated after a second confirmed prohibited departure. Your latest server-saved responses have been preserved.'
          : 'This controlled attempt was locked after a second confirmed prohibited departure. Your latest server-saved responses have been preserved for the governed next step.';
        overlay.innerHTML = '<div style="width:min(620px,100%);border:1px solid rgba(248,113,113,.3);border-radius:22px;background:#071812;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.5);"><div style="font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--red-bright);">Controlled assessment</div><h2 style="margin:10px 0 10px;font-family:var(--font-display);">Attempt locked</h2><p style="color:var(--text-2);line-height:1.7;">'+reason+'</p><p style="margin-top:14px;color:var(--text-3);font-size:12px;line-height:1.6;">KIWI records the rule event itself. This screen does not declare a cheating probability or misconduct finding.</p></div>';
        document.body.appendChild(overlay);
      }
      function _startExamIntegrityGuard() {
        var examId = AppState && AppState.tempExam && AppState.tempExam.examId;
        if (!examId || !window.KIWIIntegritySessionGuard) return;
        window.KIWIIntegritySessionGuard.activate({
          ownerType: 'KIWI_EXAM',
          ownerRef: String(examId),
          onWarning: function(snapshot) {
            if (typeof showToast === 'function') showToast('Warning: you left the controlled assessment. Another prohibited departure may lock this attempt.', 'warning', 7000);
            window.dispatchEvent(new CustomEvent('kiwi:exam-integrity-warning', { detail: snapshot }));
          },
          onLock: function(snapshot) {
            _renderIntegrityExamLock(snapshot);
            window.dispatchEvent(new CustomEvent('kiwi:exam-integrity-lock', { detail: snapshot }));
          }
        }).then(function(snapshot) {
          if (snapshot && snapshot.status === 'LOCKED') _renderIntegrityExamLock(snapshot);
        }).catch(function(error) {
          console.warn('[KIWI integrity] exam guard unavailable:', error && error.message);
        });
      }
      function _lockExamPage(isReckoning) {
        _examPageLocked = true;
        _examIsReckoning = !!isReckoning;
        setTimeout(_startExamIntegrityGuard, 0);
      }
      function _unlockExamPage() {
        _examPageLocked = false;
        _examIsReckoning = false;
        document.getElementById('kiwiIntegrityExamLock')?.remove();
        if (window.KIWIIntegritySessionGuard) window.KIWIIntegritySessionGuard.deactivate({ close: true }).catch(function(){});
      }`;
index=replaceRequired(index,oldLock,newLock,'legacy exam lock functions');

const pagehidePattern=/\n\s*\/\/ pagehide — fires after the user confirms leaving \(refresh, tab close, address bar nav\)\.[\s\S]*?window\.addEventListener\('pagehide', function\(\) \{[\s\S]*?\n\s*\}\);/;
if(!index.includes('Integrity Session Guard owns pagehide/background recording')){
  if(!pagehidePattern.test(index))throw new Error('Integrity UI transform could not find legacy pagehide forfeiture block.');
  index=index.replace(pagehidePattern,"\n\n      // Integrity Session Guard owns pagehide/background recording. A first\n      // confirmed prohibited departure warns; policy handles a later lock.\n      // Deliberate user-selected Forfeit remains a separate explicit action.");
}
write('index.html',index);

let teaching=read('public/teaching.html');
teaching=replaceRequired(teaching,'  <script src="/kiwi-api-client.js"></script>\n','  <script src="/kiwi-api-client.js"></script>\n  <script src="/kiwi-integrity-session-guard.js"></script>\n','Teaching guard script seam');
write('public/teaching.html',teaching);

let service=read('services/integrity/service.js');
const oldResolve="    if(ownerType==='TEACHING_ASSIGNMENT')return deriveAssignmentSessionProfile(owner.row);";
const newResolve="    if(ownerType==='TEACHING_ASSIGNMENT'){const gate=await repository.gateByAssignment(userId,ownerRef);if(gate?.state==='VERIFICATION_ACTIVE')return 'CONTROLLED_TAKE_HOME';return deriveAssignmentSessionProfile(owner.row);}";
service=replaceRequired(service,oldResolve,newResolve,'verification-phase controlled profile');
write('services/integrity/service.js',service);

let work=read('public/teaching-d16.js');
const stateNeedle="const state={scope:'GLOBAL',courseId:null,data:null,selected:null,filter:'ALL',host:null,busy:false};";
const stateReplacement=`const state={scope:'GLOBAL',courseId:null,data:null,selected:null,filter:'ALL',host:null,busy:false};
function guard(){return window.KIWIIntegritySessionGuard||null;}
async function ensureAssignmentGuard(item,{force=false}={}){const g=guard();if(!g)return null;if(!force&&item.assistance?.mode!=='CLOSED_BOOK_INDEPENDENT')return null;try{return await g.activate({ownerType:'TEACHING_ASSIGNMENT',ownerRef:item.assignmentId,onWarning:()=>window.alert('You left this controlled work session. Another prohibited departure may lock the controlled verification.'),onLock:()=>window.alert('This controlled session has been locked. Your server-received work is preserved.')});}catch(error){console.warn('[KIWI integrity] Work guard unavailable:',error?.message);return null;}}
function verificationTimer(item,node){let done=false;const tick=()=>{if(done)return;const end=Date.parse(item.expiresAt||'');if(!Number.isFinite(end)){node.textContent='Server timer active';return;}const seconds=Math.max(0,Math.ceil((end-Date.now())/1000));node.textContent=seconds+'s';if(seconds<=0){done=true;clearInterval(handle);node.dispatchEvent(new CustomEvent('kiwi:verification-expired'));}};const handle=setInterval(tick,250);tick();return()=>{done=true;clearInterval(handle);};}
async function showVerificationGate(item,gate,status){const v=gate?.verification,question=v?.currentItem;if(!v||!question){message(status,'Verification is being prepared. Your submission time is already recorded.');return;}await ensureAssignmentGuard(item,{force:true});const overlay=$('div','tw-verification-overlay'),card=$('section','tw-verification-card'),timer=$('strong','tw-verification-timer'),answer=$('textarea');answer.placeholder='Answer this fresh independent check.';const prompt=question.prompt?.prompt||question.prompt?.question||'Briefly demonstrate the requested capability.';const info=$('div','tw-message','Your submission time is recorded. Complete this brief independent check without leaving KIWI.');const controls=$('div','tw-actions');let sending=false,expired=false;const finish=verificationTimer(question,timer);timer.addEventListener('kiwi:verification-expired',async()=>{if(expired||sending)return;expired=true;answer.disabled=true;submitCheck.disabled=true;message(info,'Time ended. KIWI is preserving the submission and resolving the verification state.');try{await kiwiApiRequest(\`/teaching/verification/\${encodeURIComponent(v.verificationSessionId)}/items/\${encodeURIComponent(question.verificationItemId)}/respond\`,{method:'POST',body:{response:{text:answer.value},idempotencyKey:crypto.randomUUID()}});}catch{}finally{finish();}});const submitCheck=button('Submit verification',async()=>{if(sending||expired)return;sending=true;submitCheck.disabled=true;message(info,'Checking your independent response…');try{const result=await kiwiApiRequest(\`/teaching/verification/\${encodeURIComponent(v.verificationSessionId)}/items/\${encodeURIComponent(question.verificationItemId)}/respond\`,{method:'POST',body:{response:{text:answer.value},idempotencyKey:crypto.randomUUID()}});finish();if(result.status==='PASSED'){message(info,'Verified. Finishing submission…','success');await guard()?.deactivate({close:true});overlay.remove();await openAssignment({assignmentId:item.assignmentId});return;}if(result.status==='SYSTEM_DEFERRED'){message(info,'Your response was received. KIWI verification is temporarily deferred; you may leave.');submitCheck.remove();return;}message(info,'Independent capability remains unresolved. Your original submission receipt is preserved; this is not a misconduct finding.');submitCheck.remove();}catch(error){message(info,error.message,'error');submitCheck.disabled=false;sending=false;}},'tw-button tw-button--primary');add(controls,submitCheck);add(card,$('div','tw-eyebrow','Independent verification'),add($('div','tw-verification-heading'),$('h3','',\`Question \${question.sequenceNo} of up to \${v.maxQuestions}\`),timer),$('p','tw-verification-prompt',prompt),answer,controls,info);overlay.append(card);document.body.append(overlay);answer.focus();}
async function handleSubmissionGate(item,gate,status){if(gate.state==='FINALIZED'){message(status,'Submitted. The server-recorded submission time has been preserved.','success');await guard()?.deactivate({close:true});await openAssignment({assignmentId:item.assignmentId});return;}if(gate.state==='VERIFICATION_ACTIVE'){message(status,'Submission received. A brief independent verification is required before it is finalized.');await showVerificationGate(item,gate,status);return;}if(gate.state==='SYSTEM_DEFERRED'){message(status,'Submission received. KIWI could not safely complete verification now; your submission time is preserved and you may leave.','success');await guard()?.deactivate({close:true});return;}if(gate.state==='UNRESOLVED'){message(status,'Submission received. Independent evidence remains unresolved; KIWI will use the governed next verification path.');await guard()?.deactivate({close:true});return;}message(status,'Finishing your submission… Please remain on this page.');}`;
work=replaceRequired(work,stateNeedle,stateReplacement,'D16 integrity UI helpers');

const submitPattern=/const submit=button\(item\.correction\?\.available\?'Submit correction':'Submit final',async\(\)=>\{[\s\S]*?\},'tw-button tw-button--primary'\);/;
if(!work.includes("Finishing your submission… Please remain on this page. Your submission time will be recorded by the server.")){
  if(!submitPattern.test(work))throw new Error('Integrity UI transform could not find D16 submit handler.');
  work=work.replace(submitPattern,`const submit=button(item.correction?.available?'Submit correction':'Submit final',async()=>{if(state.busy)return;if(!window.confirm('Submit this response? KIWI records the authoritative submission time first, then may require a brief independent verification.'))return;state.busy=true;submit.disabled=true;message(status,'Finishing your submission… Please remain on this page. Your submission time will be recorded by the server.');try{const path=item.correction?.available?'correction/submit':'submit';const gate=await kiwiApiRequest(\`/teaching/assignments/\${encodeURIComponent(item.assignmentId)}/\${path}\`,{method:'POST',body:{response:{text:area.value},idempotencyKey:crypto.randomUUID()}});await handleSubmissionGate(item,gate,status);}catch(error){message(status,error.message,'error');submit.disabled=false;}finally{state.busy=false;}},'tw-button tw-button--primary');`);
}
work=replaceRequired(work,"back=button('← Back to Work',()=>renderList(),'tw-back')","back=button('← Back to Work',()=>{guard()?.deactivate({close:true}).catch(()=>{});renderList();},'tw-back')",'D16 guard cleanup on back');
if(!work.includes("ensureAssignmentGuard(item).catch(()=>{});"))work=work.replace("add(detail,head,grid);state.host.append(detail);}","add(detail,head,grid);state.host.append(detail);ensureAssignmentGuard(item).catch(()=>{});}");
write('public/teaching-d16.js',work);

console.log('[integrity-ui-amendment] applied idempotently');
