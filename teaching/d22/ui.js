'use strict';

function esc(value){return String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function json(value){return JSON.stringify(value).replace(/</g,'\\u003c');}
function teacherInitial(name){return String(name||'K').split(/\s+/).filter(Boolean).slice(-1)[0]?.[0]?.toUpperCase()||'K';}
function preferenceChecked(profile,key,value){return profile?.[key]===value?'checked':'';}

function renderTeacherSurface(model={}){
  const teacher=model.teacher||null;const profile=model.interactionProfile||{};const pending=model.pendingTeacherChanges||[];
  const title=teacher?`${teacher.displayName} · KIWI Teaching`:'Teacher setup · KIWI Teaching';
  const teacherName=teacher?.displayName||'Your Course Teacher';const style=teacher?.styleDescription||'A stable AI Teacher identity will be created for this Course.';
  const envelope=teacher?.styleEnvelope||{};
  const root=`/teaching/courses/${encodeURIComponent(model.courseId||'')}/teacher`;
  const body=`
  <main class="teacher-shell">
    <section class="hero" aria-labelledby="teacher-title">
      <div class="hero-orbit" aria-hidden="true"></div>
      <div class="identity-mark" aria-hidden="true"><span>${esc(teacherInitial(teacherName))}</span></div>
      <div class="hero-copy">
        <div class="eyebrow"><span class="pulse"></span> AI Teacher · ${esc(model.courseTitle||'Course')}</div>
        <h1 id="teacher-title">${esc(teacherName)}</h1>
        <p class="style-line">${esc(style)}</p>
        <p class="disclosure">${esc(teacher?.aiDisclosure||'Your Course Teacher is an AI teacher in KIWI Teaching.')}</p>
      </div>
      ${teacher?`<div class="identity-meta"><span>Identity v${esc(teacher.identityVersion)}</span><span>Assignment v${esc(teacher.assignmentVersion)}</span><span>${esc(envelope.familiarity_level||'new')} familiarity</span></div>`:''}
    </section>

    ${!teacher?`<section class="setup-panel panel"><div><p class="kicker">Course continuity</p><h2>Set up your persistent Teacher</h2><p>KIWI will create a safe, multidimensional Teacher identity. Subject, grades and demographic assumptions are never personality inputs.</p></div><button class="primary" data-action="ensure">Create Course Teacher</button></section>`:''}

    ${teacher?`<section class="split">
      <article class="panel identity-card">
        <p class="kicker">How this Teacher communicates</p>
        <h2>A recognizable voice, not an academic authority</h2>
        <div class="traits" aria-label="Teacher communication traits">
          ${[['Warmth',envelope.warmth],['Directness',envelope.directness],['Formality',envelope.formality],['Expressiveness',envelope.expressiveness],['Humor',envelope.humor_frequency],['Encouragement',envelope.encouragement_intensity],['Challenge',envelope.challenge_style],['Accountability',envelope.accountability_style],['Conversation',envelope.conversationality]].map(([k,v])=>`<span><small>${esc(k)}</small>${esc(v)}</span>`).join('')}
        </div>
        <div class="truth-rule"><strong>Academic truth stays outside personality.</strong><span>Marks, pedagogy decisions, attendance, scheduling, assessment conditions and progression keep their existing authoritative owners.</span></div>
      </article>

      <article class="panel preference-card">
        <p class="kicker">Your interaction profile</p>
        <h2>Change delivery, not the Teacher</h2>
        <p class="subtle">These preferences tune explanation density and formatting. They do not rewrite ${esc(teacherName)}’s identity.</p>
        <form id="preferences-form" class="preference-grid">
          <label><span>Explanation length</span><select name="explanation_density"><option value="compact" ${profile.explanation_density==='compact'?'selected':''}>Shorter</option><option value="standard" ${profile.explanation_density==='standard'?'selected':''}>Standard</option><option value="extended" ${profile.explanation_density==='extended'?'selected':''}>More detailed</option></select></label>
          <label><span>Examples</span><select name="examples"><option value="fewer" ${profile.examples==='fewer'?'selected':''}>Fewer</option><option value="standard" ${profile.examples==='standard'?'selected':''}>Standard</option><option value="more" ${profile.examples==='more'?'selected':''}>More examples</option></select></label>
          <label><span>Filler</span><select name="filler_tolerance"><option value="minimal" ${profile.filler_tolerance==='minimal'?'selected':''}>Minimal</option><option value="standard" ${profile.filler_tolerance==='standard'?'selected':''}>Standard</option></select></label>
          <label><span>Formatting</span><select name="formatting"><option value="standard" ${profile.formatting==='standard'?'selected':''}>Standard</option><option value="stepwise" ${profile.formatting==='stepwise'?'selected':''}>Step by step</option><option value="concise_blocks" ${profile.formatting==='concise_blocks'?'selected':''}>Concise blocks</option></select></label>
          <button class="secondary" type="submit">Save interaction preferences</button>
          <div id="preferences-result" class="result form-result" aria-live="polite"></div>
        </form>
      </article>
    </section>

    <section class="split lower">
      <article class="panel question-card">
        <div class="section-icon" aria-hidden="true">?</div><p class="kicker">Outside Class</p><h2>Ask your Course Teacher</h2>
        <p class="subtle">Use this for previous lessons, Homework, Course organization and difficult concepts. It never silently starts an unscheduled Class or changes assessment conditions.</p>
        <form id="question-form"><label class="sr-only" for="teacher-question">Question</label><textarea id="teacher-question" name="question" maxlength="4000" placeholder="What do you want to clarify?"></textarea><div class="action-row"><span class="route-note">${model.outsideClassQuestions?.available?'Teacher Q&A route available':'Model route held until D30 qualification'}</span><button class="primary" type="submit" ${model.outsideClassQuestions?.available?'':'disabled'}>Ask Teacher</button></div></form>
        <div id="question-result" class="result" aria-live="polite"></div>
      </article>

      <article class="panel change-card">
        <div class="section-icon" aria-hidden="true">↻</div><p class="kicker">Teacher change</p><h2>Request a different Teacher</h2>
        <p class="subtle">A change is a formal Request. Your Course Plan, schedule, attendance, Work, Assessment history, marks and progression record are preserved.</p>
        <form id="change-form"><label><span>Style direction</span><select name="broadStylePreference"><option value="surprise_me">Surprise me</option><option value="more_direct">More direct</option><option value="more_relaxed">More relaxed</option><option value="more_formal">More formal</option><option value="more_energetic">More energetic</option></select></label><label><span>Optional note</span><textarea name="explanation" maxlength="1500" placeholder="What would you like to feel different about the interaction?"></textarea></label><button class="secondary" type="submit">Create Teacher Change Request</button><div id="change-result" class="result form-result" aria-live="polite"></div></form>
        ${pending.length?`<div class="pending"><strong>${pending.length} Teacher Change Request${pending.length===1?'':'s'} in progress</strong><span>Approval and application remain owned by the formal Request workflow.</span></div>`:''}
      </article>
    </section>`:''}

    <footer><span>Teacher Code active</span><span>AI disclosure visible</span><span>No fabricated shared memory</span></footer>
  </main>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(title)}</title><style>
  :root{color-scheme:dark;--bg:#090b10;--ink:#f4f4f0;--muted:#a9adb7;--line:rgba(255,255,255,.1);--panel:rgba(19,22,30,.74);--glow:rgba(184,255,104,.13);--accent:#d8ffad;--accent2:#b9d8ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(900px 500px at 15% -10%,rgba(109,156,255,.12),transparent 58%),radial-gradient(800px 480px at 90% 10%,var(--glow),transparent 55%),var(--bg);color:var(--ink);font:15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.teacher-shell{width:min(1180px,calc(100% - 34px));margin:0 auto;padding:34px 0 28px}.hero{position:relative;overflow:hidden;min-height:330px;padding:clamp(28px,5vw,58px);border:1px solid var(--line);border-radius:36px;background:linear-gradient(135deg,rgba(28,32,43,.96),rgba(13,15,21,.92));display:grid;grid-template-columns:auto 1fr;align-items:center;gap:clamp(22px,4vw,48px);box-shadow:0 34px 100px rgba(0,0,0,.35)}.hero-orbit{position:absolute;width:480px;height:480px;border-radius:50%;border:1px solid rgba(216,255,173,.13);right:-170px;top:-210px;box-shadow:0 0 0 55px rgba(216,255,173,.025),0 0 0 110px rgba(185,216,255,.018)}.identity-mark{position:relative;width:clamp(106px,16vw,176px);aspect-ratio:1;border-radius:38%;display:grid;place-items:center;background:linear-gradient(145deg,rgba(216,255,173,.18),rgba(185,216,255,.08));border:1px solid rgba(216,255,173,.2);box-shadow:inset 0 0 60px rgba(216,255,173,.06)}.identity-mark span{font:600 clamp(44px,8vw,78px)/1 Georgia,serif;color:var(--accent)}.eyebrow,.kicker{text-transform:uppercase;letter-spacing:.16em;font-size:.72rem;font-weight:750;color:#c6cbd5}.pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 18px var(--accent);margin-right:9px}.hero h1{font:500 clamp(2.8rem,7vw,6.3rem)/.95 Georgia,"Times New Roman",serif;letter-spacing:-.05em;margin:.16em 0}.style-line{font-size:clamp(1.05rem,2vw,1.3rem);color:#dfe3e9;margin:.6rem 0}.disclosure,.subtle{color:var(--muted)}.identity-meta{position:absolute;right:30px;bottom:26px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.identity-meta span,.traits span{border:1px solid var(--line);background:rgba(255,255,255,.035);border-radius:999px;padding:7px 11px;color:#d9dde4;font-size:.78rem}.split{display:grid;grid-template-columns:1.12fr .88fr;gap:18px;margin-top:18px}.lower{grid-template-columns:1fr 1fr}.panel{border:1px solid var(--line);border-radius:28px;background:var(--panel);backdrop-filter:blur(18px);padding:clamp(24px,4vw,38px)}.panel h2{font:500 clamp(1.7rem,3.2vw,2.55rem)/1.1 Georgia,serif;letter-spacing:-.03em;margin:.25em 0 .55em}.traits{display:flex;gap:8px;flex-wrap:wrap;margin:26px 0}.traits span{display:grid;gap:1px;border-radius:14px;padding:10px 13px}.traits small{color:#969ca8;text-transform:uppercase;letter-spacing:.08em;font-size:.62rem}.truth-rule{display:grid;gap:7px;border-left:2px solid var(--accent);padding:8px 0 8px 18px}.truth-rule span{color:var(--muted)}.preference-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}label{display:grid;gap:7px;color:#cfd3db;font-size:.82rem}select,textarea{width:100%;border:1px solid var(--line);border-radius:14px;background:#0d1016;color:var(--ink);padding:12px 13px;font:inherit;outline:none}select:focus,textarea:focus{border-color:rgba(216,255,173,.5);box-shadow:0 0 0 3px rgba(216,255,173,.08)}textarea{min-height:105px;resize:vertical}.preference-grid button{grid-column:1/-1}.primary,.secondary{border:0;border-radius:999px;padding:12px 18px;font:750 .84rem/1 inherit;cursor:pointer}.primary{background:var(--accent);color:#11160d}.secondary{background:#e8ecf4;color:#101217}.primary:disabled{opacity:.42;cursor:not-allowed}.section-icon{float:right;width:46px;height:46px;border-radius:16px;display:grid;place-items:center;border:1px solid var(--line);color:var(--accent2);font-size:1.25rem}.action-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px}.route-note{font-size:.75rem;color:#8f95a1}.result{margin-top:14px;color:#d9e5ca}.form-result{grid-column:1/-1;min-height:1.35em;font-size:.8rem}.is-busy{opacity:.68;pointer-events:none}.pending{display:grid;gap:3px;margin-top:18px;padding:14px;border-radius:16px;background:rgba(185,216,255,.07);border:1px solid rgba(185,216,255,.12)}.pending span{color:var(--muted);font-size:.82rem}.setup-panel{margin-top:18px;display:flex;align-items:center;justify-content:space-between;gap:30px}.setup-panel p{max-width:680px;color:var(--muted)}footer{display:flex;gap:12px;flex-wrap:wrap;padding:18px 8px 0;color:#777e8b;font-size:.72rem;text-transform:uppercase;letter-spacing:.1em}footer span+span:before{content:"·";margin-right:12px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:820px){.hero{grid-template-columns:1fr;align-items:start}.identity-mark{width:104px}.identity-meta{position:relative;right:auto;bottom:auto;grid-column:1/-1;justify-content:flex-start}.split,.lower{grid-template-columns:1fr}.preference-grid{grid-template-columns:1fr}.setup-panel{align-items:flex-start;flex-direction:column}}@media(max-width:520px){.teacher-shell{width:min(100% - 18px,1180px);padding-top:9px}.hero,.panel{border-radius:22px;padding:22px}.hero h1{font-size:2.65rem}.action-row{align-items:stretch;flex-direction:column}.action-row button{width:100%}}
  </style></head><body>${body}<script>
  const ROOT=${json(root)};
  async function call(path,options={}){const res=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Request failed');return data;}
  document.querySelector('[data-action="ensure"]')?.addEventListener('click',async(e)=>{e.currentTarget.disabled=true;try{await call(ROOT+'/ensure',{method:'POST',body:'{}'});location.reload();}catch(err){alert(err.message);e.currentTarget.disabled=false;}});
  document.querySelector('#preferences-form')?.addEventListener('submit',async(e)=>{e.preventDefault();const form=e.currentTarget;const button=form.querySelector('button[type="submit"]');const out=document.querySelector('#preferences-result');const body=Object.fromEntries(new FormData(form));button?.classList.add('is-busy');if(button)button.disabled=true;if(out)out.textContent='Saving your interaction preferences…';try{await call(ROOT+'/interaction-profile',{method:'PUT',body:JSON.stringify(body)});if(out)out.textContent='Saved. Your Teacher identity and academic standards are unchanged.';setTimeout(()=>location.reload(),350);}catch(err){if(out)out.textContent=err.message;if(button)button.disabled=false;button?.classList.remove('is-busy');}});
  document.querySelector('#question-form')?.addEventListener('submit',async(e)=>{e.preventDefault();const out=document.querySelector('#question-result');out.textContent='';try{const body=Object.fromEntries(new FormData(e.currentTarget));const data=await call(ROOT+'/questions',{method:'POST',body:JSON.stringify(body)});out.textContent=data.answer?.interaction?.text||data.answer?.text||data.reason||'Question accepted.';}catch(err){out.textContent=err.message;}});
  document.querySelector('#change-form')?.addEventListener('submit',async(e)=>{e.preventDefault();const form=e.currentTarget;const button=form.querySelector('button[type="submit"]');const out=document.querySelector('#change-result');const body=Object.fromEntries(new FormData(form));body.idempotencyKey='teacher-surface:'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36));button?.classList.add('is-busy');if(button)button.disabled=true;if(out)out.textContent='Creating a formal Teacher Change Request…';try{const data=await call(ROOT+'/change-request',{method:'POST',body:JSON.stringify(body)});if(out)out.textContent='Request '+(data.request?.requestId||'created')+' is now in the formal Request workflow. Your academic record has not changed.';setTimeout(()=>location.reload(),700);}catch(err){if(out)out.textContent=err.message;if(button)button.disabled=false;button?.classList.remove('is-busy');}});
  </script></body></html>`;
}

module.exports={renderTeacherSurface};
