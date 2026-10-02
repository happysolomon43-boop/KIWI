'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const write=(file,text)=>fs.writeFileSync(path.join(root,file),text);
function replace(text,needle,replacement,label){if(text.includes(replacement))return text;if(!text.includes(needle))throw new Error(`Integrity repair could not find ${label}.`);return text.replace(needle,replacement);}
function replaceInRoute(text,signature,needle,replacement,label){
  const start=text.indexOf(signature);if(start<0)throw new Error(`Integrity repair could not find ${label} route.`);
  const next=text.indexOf('\nexamRouter.',start+signature.length);
  const end=next<0?text.length:next;
  let segment=text.slice(start,end);
  if(segment.includes(replacement))return text;
  if(!segment.includes(needle))throw new Error(`Integrity repair could not find ${label} seam.`);
  segment=segment.replace(needle,replacement);
  return text.slice(0,start)+segment+text.slice(end);
}

// Study shell: remove only the obsolete first-pagehide auto-forfeit residue.
let index=read('index.html');
const orphan=`      // Deliberate user-selected Forfeit remains a separate explicit action.\n            } catch (_) {}\n          }\n        }\n      });`;
const repaired=`      // Deliberate user-selected Forfeit remains a separate explicit action.`;
if(index.includes(orphan))index=index.replace(orphan,repaired);
if(!index.includes('/kiwi-integrity-session-guard.js'))throw new Error('Study root does not load shared Integrity Session Guard.');
if(index.includes("fetch(API_BASE_URL + '/exams/' + examId + '/forfeit',")&&index.includes('pagehide — fires after the user confirms leaving'))throw new Error('Legacy pagehide auto-forfeit remains active.');
write('index.html',index);

// D16 contracts must distinguish receipt states from academically final submissions.
let contracts=read('teaching/d16/contracts.js');
if(!contracts.includes("'PENDING_FINAL'")||!contracts.includes("'PENDING_CORRECTION'")){
  contracts=contracts.replace(/const SUBMISSION_KINDS\s*=\s*Object\.freeze\(\['DRAFT','FINAL','CORRECTION','VERIFICATION'\]\);/,"const SUBMISSION_KINDS = Object.freeze(['DRAFT','PENDING_FINAL','FINAL','PENDING_CORRECTION','CORRECTION','VERIFICATION']);");
}
if(!contracts.includes("'PENDING_FINAL'")||!contracts.includes("'PENDING_CORRECTION'"))throw new Error('D16 pending submission kinds were not installed.');
write('teaching/d16/contracts.js',contracts);

// Server repository: terminal LOCKED state cannot be rewritten to CLOSED by a cleanup call.
let repository=read('services/integrity/repository.js');
const oldClose=`  async function closeSession(userId,sessionId){const {rows}=await query("update public.kiwi_integrity_sessions set status='CLOSED',closed_at=coalesce(closed_at,now()),state_version=state_version+1,updated_at=now() where user_id=$1 and integrity_session_id=$2 returning *",[userId,sessionId]);return rows?.[0]||null;}`;
const newClose=`  async function closeSession(userId,sessionId){
    return withTransaction(async(tx)=>{
      const session=await requireSession(userId,sessionId,tx,true);
      if(['LOCKED','CLOSED'].includes(session.status))return session;
      const {rows}=await q(tx,"update public.kiwi_integrity_sessions set status='CLOSED',closed_at=coalesce(closed_at,now()),state_version=state_version+1,updated_at=now() where user_id=$1 and integrity_session_id=$2 returning *",[userId,sessionId]);
      return rows?.[0]||session;
    });
  }`;
repository=replace(repository,oldClose,newClose,'terminal closeSession implementation');
write('services/integrity/repository.js',repository);

// Service projection: return the event the server actually persisted after authoritative dedup.
let integrityService=read('services/integrity/service.js');
const oldEventProjection=`    return Object.freeze({...studentSafeSessionProjection(session),action:consequence.action,outcome:consequence.outcome,event:Object.freeze({kind:decision.normalizedKind,countsAsDeparture:Boolean(decision.counts)}),idempotent:recorded.idempotent});`;
const newEventProjection=`    return Object.freeze({...studentSafeSessionProjection(session),action:consequence.action,outcome:consequence.outcome,event:Object.freeze({kind:recorded.event?.normalized_kind||recorded.effectiveDecision?.normalizedKind||decision.normalizedKind,countsAsDeparture:Boolean(recorded.event?.counts_as_departure??recorded.effectiveDecision?.counts??decision.counts)}),idempotent:recorded.idempotent});`;
integrityService=replace(integrityService,oldEventProjection,newEventProjection,'persisted event projection');
write('services/integrity/service.js',integrityService);

// Work UI: pending receipt is not Submitted, pending gates freeze editing, and refresh resumes verification.
let work=read('public/teaching-d16.js');
const responseNeedle="function safeResponseText(value){if(!value||typeof value!=='object')return '';return typeof value.text==='string'?value.text:typeof value.answer==='string'?value.answer:JSON.stringify(value,null,2);}";
const responseReplacement=`function safeResponseText(value){if(!value||typeof value!=='object')return '';return typeof value.text==='string'?value.text:typeof value.answer==='string'?value.answer:JSON.stringify(value,null,2);}\nfunction isFinalizedSubmission(item){return ['FINAL','CORRECTION','VERIFICATION'].includes(item?.submission?.kind);}\nfunction isPendingSubmission(item){return ['PENDING_FINAL','PENDING_CORRECTION'].includes(item?.submission?.kind);}\nfunction gateBlocksEditing(item){const value=item?.submissionGate?.state;return Boolean(value&&value!=='NONE'&&value!=='FINALIZED'&&value!=='SYSTEM_DEFERRED'&&value!=='UNRESOLVED');}`;
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

// Legacy Study/CBT remains the Exam owner. The shared guard only sets owner state;
// these existing mutation routes must enforce that state server-side.
let backend=read('index.js');
const examRouterAnchor=`examRouter.use(reckoningLockout);`;
const examIntegrityHelpers=`examRouter.use(reckoningLockout);\n\nfunction respondToLockedExamMutation(exam, res) {\n  if (!exam) return false;\n  const locked = exam.integrity_session_state === 'LOCKED' || exam.status === 'invalidated';\n  if (!locked) return false;\n  const invalidated = exam.status === 'invalidated' || exam.integrity_lock_reason === 'ATTEMPT_INVALIDATED_RULE_BREACH';\n  res.status(423).json({\n    error: invalidated\n      ? 'This controlled attempt was invalidated after a terminal integrity-session rule breach.'\n      : 'This controlled attempt is locked. Server-saved responses are preserved for governed review.',\n    code: invalidated ? 'EXAM_INTEGRITY_ATTEMPT_INVALIDATED' : 'EXAM_INTEGRITY_SESSION_LOCKED',\n    status: exam.status,\n    integrity_session_state: 'LOCKED',\n    integrity_lock_reason: exam.integrity_lock_reason || null,\n    verification_pending: Boolean(exam.verification_pending),\n    misconduct_verdict: null,\n    cheating_probability: null,\n  });\n  return true;\n}\n\nasync function loadMutableExamOrRespond(userId, examId, res) {\n  const exam = await db.examSessions.findByIdWithQuestions(userId, examId);\n  if (!exam) {\n    res.status(404).json({ error: 'Exam not found' });\n    return null;\n  }\n  if (respondToLockedExamMutation(exam, res)) return null;\n  return exam;\n}`;
backend=replace(backend,examRouterAnchor,examIntegrityHelpers,'Exam integrity owner helpers');

backend=replaceInRoute(backend,"examRouter.post('/:id/forfeit'",`  if (!exam) return res.status(404).json({ error: 'Exam not found' });`,`  if (!exam) return res.status(404).json({ error: 'Exam not found' });\n  if (respondToLockedExamMutation(exam, res)) return;`,'manual forfeit lock enforcement');
backend=replaceInRoute(backend,"examRouter.post('/:id/auto-forfeit'",`    const exam = { ...examRows[0], questions: qRows || [] };`,`    const exam = { ...examRows[0], questions: qRows || [] };\n    if (respondToLockedExamMutation(exam, res)) return;`,'auto-forfeit lock enforcement');

for(const route of ["examRouter.post('/:id/reckoning/answer'","examRouter.post('/:id/reckoning/continue'","examRouter.post('/:id/reckoning/finalize'"]){
  backend=replaceInRoute(backend,route,`  try {`,`  try {\n    const integrityExam = await loadMutableExamOrRespond(req.user.id, req.params.id, res);\n    if (!integrityExam) return;`,`${route} lock enforcement`);
}
backend=replaceInRoute(backend,"examRouter.post('/:id/start'",`if (!existing) return res.status(404).json({ error: 'Exam not found' });`,`if (!existing) return res.status(404).json({ error: 'Exam not found' });\nif (respondToLockedExamMutation(existing, res)) return;`,'exam start lock enforcement');
backend=replaceInRoute(backend,"examRouter.post('/:id/start-token'",`  try {`,`  try {\n    const exam = await loadMutableExamOrRespond(req.user.id, req.params.id, res);\n    if (!exam) return;`,'start-token lock enforcement');
backend=replaceInRoute(backend,"examRouter.get('/:id/question/:number'",`try {`,`try {\nconst exam = await loadMutableExamOrRespond(req.user.id, req.params.id, res);\nif (!exam) return;`,'question exposure lock enforcement');
backend=replaceInRoute(backend,"examRouter.post('/:id/pre-mark'",`  if (!exam) return res.status(404).json({ error: 'Exam not found' });`,`  if (!exam) return res.status(404).json({ error: 'Exam not found' });\n  if (respondToLockedExamMutation(exam, res)) return;`,'pre-mark lock enforcement');
backend=replaceInRoute(backend,"examRouter.post('/:id/flag-question'",`  if (!exam) return res.status(404).json({ error: 'Exam not found' });`,`  if (!exam) return res.status(404).json({ error: 'Exam not found' });\n  if (respondToLockedExamMutation(exam, res)) return;`,'question flag lock enforcement');
backend=replaceInRoute(backend,"examRouter.post('/:id/submit'",`if (!exam) return res.status(404).json({ error: 'Exam not found' });`,`if (!exam) return res.status(404).json({ error: 'Exam not found' });\nif (respondToLockedExamMutation(exam, res)) return;`,'exam submit lock enforcement');
write('index.js',backend);

console.log('[integrity-amendment-repair] source state repaired and hardened');
