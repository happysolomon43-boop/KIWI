const {kiwiApiRequest}=window.KIWI_API_CLIENT||{};
const courses=window.KIWITeachingCourses;
if(typeof kiwiApiRequest!=='function'||!courses?.registerSection)throw new Error('Teaching Classroom requires the shared KIWI client and Course shell.');

const $=(tag,className='',text=null)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==null)n.textContent=String(text);return n;};
const state={classId:null,snapshot:null,host:null,interval:null,refresh:null,scene:0,tab:'board',busy:false,returnFocus:null,leaveRequestId:null};
const MODE={PRE_CLASS:'Before Class',OPENING:'Teaching',DIAGNOSTIC:'Teaching',INSTRUCTION:'Teaching',GUIDED_PRACTICE:'Guided Practice',INDEPENDENT_PRACTICE:'Independent Practice',CLASSWORK:'Classwork — Graded',ASSESSMENT:'Test / Assessment',BREAK:'Break',REMEDIATION:'Teaching',CLOSURE:'Class Summary',INTERRUPTED:'Interrupted'};
function when(value){return value?new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—';}
function date(value){return value?new Date(value).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';}
function duration(ms){let n=Math.max(0,Math.floor(ms/1000));return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;}
function add(parent,...children){children.forEach((child)=>parent.append(child));return parent;}
function button(label,handler,cls=''){const b=$('button',cls,label);b.type='button';b.addEventListener('click',handler);return b;}
function notice(title,body,kind=''){return add($('div',`tc-notice ${kind}`),$('strong','',title),$('p','',body));}
function serverNow(){const s=state.snapshot;return Date.now()+(s?new Date(s.serverNow).getTime()-s._receivedAt:0);}
function clearRuntime(){if(state.interval)clearInterval(state.interval);if(state.refresh)clearInterval(state.refresh);state.interval=state.refresh=null;}
function close({restore=true}={}){clearRuntime();state.host?.remove();document.body.classList.remove('tc-active');state.host=null;state.classId=null;state.snapshot=null;state.leaveRequestId=null;if(restore)state.returnFocus?.focus?.();state.returnFocus=null;}
async function fetchSnapshot(){
  if(!state.classId||state.busy)return;
  const data=await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(state.classId)}/classroom`);
  data._receivedAt=Date.now();state.snapshot=data;render();
}
async function act(path,body){
  if(state.busy)return;state.busy=true;
  try{await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(state.classId)}/${path}`,{method:'POST',body:{...body,idempotencyKey:crypto.randomUUID()}});await fetchAfterAction();}
  catch(error){state.host?.querySelector('.tc-message')?.replaceChildren($('span','',error.message||'That action could not be completed.'));}
  finally{state.busy=false;}
}
async function controllerAction(path,body={}){
  if(state.busy)return;state.busy=true;
  try{await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(state.classId)}/controller/${path}`,{method:'POST',body});await fetchAfterAction();}
  catch(error){state.host?.querySelector('.tc-message')?.replaceChildren($('span','',error.message||'The Class could not continue.'));}
  finally{state.busy=false;}
}
async function fetchAfterAction(){const data=await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(state.classId)}/classroom`);data._receivedAt=Date.now();state.snapshot=data;render();}
async function open(classId){
  const opener=document.activeElement;close({restore:false});state.returnFocus=opener;state.classId=classId;state.host=$('div','tc-overlay');state.host.setAttribute('role','dialog');state.host.setAttribute('aria-modal','true');state.host.setAttribute('aria-label','KIWI Classroom');
  document.body.append(state.host);document.body.classList.add('tc-active');state.host.append(notice('Opening Classroom','Connecting to the current Class record…'));
  state.host.addEventListener('keydown',trapClassroomFocus);state.host.tabIndex=-1;state.host.focus();
  try{await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(classId)}/classroom/enter`,{method:'POST',body:{}});await fetchSnapshot();state.host.querySelector('h1')?.focus?.({preventScroll:true});state.interval=setInterval(updateClocks,1000);state.refresh=setInterval(()=>fetchSnapshot().catch(()=>{state.host?.querySelector('.tc-connection')?.replaceChildren($('span','','Reconnecting to Class…'));}),12000);}
  catch(error){state.host.replaceChildren(notice('Classroom unavailable',error.message||'Please try again.','tc-error'),button('Return to Course',close,'tc-button tc-button--solid'));}
}
function trapClassroomFocus(event){if(event.key==='Escape'){const controls=state.host?.querySelector('.tc-controls[open]');if(controls){controls.open=false;controls.querySelector('summary')?.focus();}return;}if(event.key!=='Tab')return;const nodes=Array.from(state.host?.querySelectorAll('button:not([disabled]),a[href],textarea:not([disabled]),input:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')||[]).filter((node)=>node.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
function updateClocks(){
  const s=state.snapshot;if(!s||!state.host)return;
  const now=serverNow(), end=new Date(s.class.scheduledEndAt).getTime();
  const overall=state.host.querySelector('[data-clock="class"]');if(overall)overall.textContent=now>end?`+${duration(now-end)} overtime`:`${duration(end-now)} to scheduled end`;
  const breakClock=state.host.querySelector('[data-clock="activity"]');if(breakClock){const target=s.controller?.breakEndsAt||s.controller?.progressState?.activity_ends_at;if(target)breakClock.textContent=`${duration(new Date(target).getTime()-now)} remaining`;}
}
function renderHeader(s){
  const header=$('header','tc-header');const brand=add($('div','tc-brand'),$('span','tc-brand__mark','K'),$('span','','KIWI / TEACHING'));
  const heading=$('h1','',s.identity.course_title);heading.tabIndex=-1;const identity=add($('div','tc-header__identity'),$('div','tc-eyebrow','LIVE CLASSROOM'),heading,$('p','',s.identity.teacher_name||'KIWI Teacher'));
  const mode=$('span','tc-mode',MODE[s.modeKey]||s.mode);mode.dataset.mode=s.modeKey;mode.setAttribute('role','status');mode.setAttribute('aria-live','polite');mode.setAttribute('aria-label',`Current Class mode: ${MODE[s.modeKey]||s.mode}`);
  const clocks=add($('div','tc-header__clocks'),add($('div','tc-clock'),$('small','','CLASS TIME'),$('strong','',`Ends ${when(s.class.scheduledEndAt)}`),$('span','','')));
  clocks.querySelector('span').dataset.clock='class';
  if(s.modeKey==='BREAK'||s.modeKey==='INDEPENDENT_PRACTICE'){const activity=add($('div','tc-clock tc-clock--activity'),$('small','',s.modeKey==='BREAK'?'BREAK':'ACTIVITY'),$('strong','',s.modeKey==='BREAK'?'Teaching paused':'Work independently'),$('span','',''));activity.querySelector('span').dataset.clock='activity';clocks.append(activity);}
  if(s.modeKey==='ASSESSMENT')clocks.prepend(add($('div','tc-clock tc-clock--assessment'),$('small','','ASSESSMENT TIME'),$('strong','','Controlled assessment'),$('span','','The assessment owner controls this timer')));
  const leave=button('Leave Class',async()=>{
    if(!state.leaveRequestId&&!window.confirm('Leave the Classroom? The Class continues according to its scheduled time. Your attendance will be recorded up to this moment.'))return;
    state.leaveRequestId ||= crypto.randomUUID();leave.disabled=true;
    try{
      const result=await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(state.classId)}/interactions`,{method:'POST',body:{kind:'LEAVE',idempotencyKey:state.leaveRequestId}});
      const outcome=result?.attendance?.outcome||result?.attendance?.record?.outcome;
      try{if(outcome)sessionStorage.setItem('kiwi_last_class_attendance',outcome);}catch{}
      close();
    }catch(error){
      leave.disabled=false;
      state.host?.querySelector('.tc-message')?.replaceChildren($('span','',`${error.message||'KIWI could not confirm your departure.'} Retry Leave Class to safely confirm the same attendance record.`));
    }
  },'tc-button tc-button--quiet');
  add(header,brand,identity,mode,clocks,leave);return header;
}
function renderTeacher(s){
  const panel=$('section','tc-teacher');panel.setAttribute('aria-label','Teacher Presence');panel.setAttribute('aria-live','polite');
  const avatar=$('div','tc-teacher__avatar','K');avatar.setAttribute('aria-hidden','true');
  let message='Follow the Board. Your workspace will appear when there is something to do.';
  if(!s.controller)message='Class will open at the scheduled time. Your teacher will lead the session.';
  if(s.modeKey==='INDEPENDENT_PRACTICE')message='Take this time to work independently. I will return when the activity ends.';
  if(s.modeKey==='BREAK')message='We are on a break. Teaching will resume when the timer ends.';
  if(s.modeKey==='INTERRUPTED')message='The Class is interrupted. Your current work remains available when it resumes.';
  if(s.modeKey==='CLOSURE')message='Class has ended. Your Class Summary and permitted lesson artifacts are below.';
  add(panel,avatar,add($('div','tc-teacher__copy'),$('div','tc-eyebrow',s.identity.teacher_name||'YOUR TEACHER'),$('p','',s.teacherMessage||message)));return panel;
}
function blockText(parent,value){parent.append($('p','',String(value||'')));}
function graphBlock(c){
  const wrap=$('div','tc-graph');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 400 220');svg.setAttribute('role','img');const description=c.description||c.alt||'Data graph';svg.setAttribute('aria-label',description);const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=description;svg.append(title);
  const pts=c.points||[];if(!pts.length){wrap.append($('p','','No data points'));return wrap;}
  const xs=pts.map((p)=>p[0]),ys=pts.map((p)=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const coords=pts.map(([x,y])=>[30+340*(x-minX)/(maxX-minX||1),185-145*(y-minY)/(maxY-minY||1)]);
  for(const path of ['M30 20V185H380',`M${coords.map((p)=>p.join(' ')).join('L')}`]){const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',path);line.setAttribute('fill','none');line.setAttribute('stroke',path[0]==='M'&&path.includes('V')?'#637b70':'#92e9be');line.setAttribute('stroke-width','2');svg.append(line);}
  wrap.append(svg);return wrap;
}
function renderBlock(item){
  const c=item.content||{},card=$('article','tc-board-item');card.dataset.type=item.type;
  const label=({text:'NOTE',equation:'EQUATION',worked_solution:'WORKED EXAMPLE',graph:'GRAPH',data:'DATA',image:'IMAGE',diagram:'DIAGRAM',code:'CODE',source_passage:'SOURCE',comparison:'COMPARE',annotation:'ANNOTATION'})[item.type]||'BOARD';
  card.append($('div','tc-board-item__label',label));
  switch(item.type){
    case 'text':case 'source_passage':blockText(card,c.text);break;
    case 'equation':card.append($('div','tc-math',c.text||''));break;
    case 'code':card.append(add($('pre','tc-code'),$('code','',c.text||'')));break;
    case 'worked_solution':(c.steps||[]).forEach((step,i)=>card.append(add($('div','tc-step'),$('span','',String(i+1).padStart(2,'0')),$('p','',step))));break;
    case 'graph':case 'data':card.append(graphBlock(c));break;
    case 'image':case 'diagram':{const img=$('img','tc-visual');img.src=c.src;img.alt=c.alt||`${label.toLowerCase()} shown on the Class Board`;img.loading='lazy';card.append(img);break;}
    case 'comparison':{const pair=$('div','tc-comparison');(c.columns||[]).forEach((col)=>pair.append(add($('div',''),$('strong','',col.title||''),$('p','',col.text))));card.append(pair);break;}
    case 'annotation':card.append($('p','tc-annotation',c.label||''));break;
  }
  const save=button('Save to Notebook',()=>act('notebook',{content:(c.text||c.label||c.alt||(c.steps||[]).join('\n')).slice(0,10000),boardItemId:item.boardItemId}),'tc-mini-action');
  if(state.snapshot?.notebookAllowed&&item.boardItemId)card.append(save);
  return card;
}
function renderBoard(s){
  const panel=$('section','tc-board');panel.setAttribute('aria-label','Class Board');
  const title=add($('div','tc-panel-head'),add($('div',''),$('div','tc-eyebrow','TEACHING SURFACE'),$('h2','','The Board')));
  panel.append(title);
  if(!s.boardHistoryAllowed){panel.append(notice('Board history is unavailable','This activity restricts earlier teaching materials.'));return panel;}
  if(!s.board.length){panel.append(add($('div','tc-board-empty'),$('div','tc-board-empty__glyph','✧'),$('h3','','A clear space to think'),$('p','','The Board will hold the explanation, examples and comparisons for this Class.')));return panel;}
  state.scene=Math.min(state.scene,s.board.length-1);const scene=s.board[state.scene];
  const previous=button('←',()=>{state.scene=Math.max(0,state.scene-1);render();},'tc-icon');previous.setAttribute('aria-label','Previous Board scene');const next=button('→',()=>{state.scene=Math.min(s.board.length-1,state.scene+1);render();},'tc-icon');next.setAttribute('aria-label','Next Board scene');title.append(add($('div','tc-scene-nav'),previous,$('span','',`${state.scene+1} / ${s.board.length}`),next));
  title.querySelectorAll('button')[0].disabled=state.scene===0;title.querySelectorAll('button')[1].disabled=state.scene===s.board.length-1;
  if(scene.title)panel.append($('h3','tc-scene-title',scene.title));
  const blocks=$('div','tc-board-blocks');scene.items.forEach((item)=>blocks.append(renderBlock(item)));panel.append(blocks);return panel;
}
function renderNotebook(s){
  const panel=$('section','tc-notebook');add(panel,add($('div','tc-panel-head'),add($('div',''),$('div','tc-eyebrow','YOUR OWN RECORD'),$('h2','','Notebook'))));
  if(!s.notebookAllowed){panel.append(notice('Notebook unavailable','This controlled activity does not permit your notes.'));return panel;}
  const form=$('form','tc-note-form');const input=$('textarea','');input.placeholder='Write a thought, question or connection…';input.maxLength=10000;input.setAttribute('aria-label','Notebook entry');
  const submit=button('Save note',()=>{},'tc-button tc-button--solid');submit.type='submit';
  form.addEventListener('submit',(event)=>{event.preventDefault();if(input.value.trim())act('notebook',{content:input.value.trim()});});add(form,input,submit);panel.append(form);
  const list=$('div','tc-notes');if(!s.notebook.length)list.append($('p','tc-empty-copy','Your notes are yours. Save an explanation from the Board or write your own.'));
  s.notebook.forEach((entry)=>list.append(add($('article','tc-note'),$('small','',entry.source_kind==='BOARD_REFERENCE'?'SAVED FROM BOARD':'PERSONAL NOTE'),$('p','',entry.content))));panel.append(list);return panel;
}
function renderWorkspace(s){
  const panel=$('section','tc-workspace');add(panel,add($('div','tc-panel-head'),add($('div',''),$('div','tc-eyebrow','YOUR SPACE'),$('h2','',s.modeKey==='INDEPENDENT_PRACTICE'?'Work independently':'Student Workspace'))));
  if(!s.controller){panel.append(notice('Ready when you are',`Scheduled ${date(s.class.scheduledStartAt)} · ${Math.round((new Date(s.class.scheduledEndAt)-new Date(s.class.scheduledStartAt))/60000)} minutes. ${s.requiredMaterials?.length?'Bring: '+s.requiredMaterials.join(', '):'No materials have been specified.'}`));const start=button('Start Class',()=>controllerAction('start'),'tc-button tc-button--solid');panel.append(start);return panel;}
  if(s.modeKey==='BREAK'){panel.append(notice('A proper pause','Teaching is paused. You can step away and return when the break ends.','tc-break'));return panel;}
  if(s.modeKey==='ASSESSMENT'){panel.append(notice('Assessment in progress','Assessment rules and responses are controlled by the formal assessment interface. Classroom resources are restricted.','tc-assessment'));return panel;}
  if(s.modeKey==='CLOSURE'){panel.append(notice('Class is complete','Review the Summary, your Notebook and permitted Board scenes below.'));return panel;}
  if(s.modeKey==='INTERRUPTED'){panel.append(notice('Class paused safely','Your work is preserved. Continue from the saved teaching state when you are ready; a KIWI-caused interruption is never negative academic evidence.','tc-error'));if(s.interruption?.canResume)panel.append(button('Resume Class',()=>controllerAction('transition',{toState:s.interruption.resumeState,expectedVersion:s.controller.stateVersion}),'tc-button tc-button--solid'));return panel;}
  if(s.modeKey==='INDEPENDENT_PRACTICE')panel.append(notice('Productive silence','Take the time you need within the activity. Your teacher does not need a message from you to continue.'));
  if(s.objective)panel.append(add($('div','tc-objective'),$('small','','CURRENT OBJECTIVE'),$('p','',s.objective)));
  if(s.entry?.veryLate)panel.append(notice('A shorter Class today',`${s.entry.lateMinutes} minutes after the scheduled start · ${s.entry.minutesRemaining} minutes remain. The core objective needs a safe replanning decision; completion is not assumed.`, 'tc-error'));
  else if(s.entry?.lateMinutes>0)panel.append(notice('Joining an ongoing Class',`${s.entry.lateMinutes} minutes after the scheduled start · ${s.entry.minutesRemaining} minutes remain. Continue from the current activity.`));
  if(['OPENING','INSTRUCTION','REMEDIATION'].includes(s.modeKey)){
    panel.append($('p','tc-empty-copy','Watch the Board and ask a question when you need one. A response area appears when the activity calls for it.'));
  } else if(s.learningUnitId){
    const form=$('form','tc-response');const answer=$('textarea','');answer.placeholder='Show your thinking here…';answer.setAttribute('aria-label','Academic answer');answer.maxLength=10000;
    form.addEventListener('submit',(e)=>{e.preventDefault();if(answer.value.trim())act('classroom/responses',{learningUnitId:s.learningUnitId,responseKind:'text',responsePayload:{text:answer.value.trim()},expectedControllerVersion:s.controller.stateVersion});});
    add(form,answer,add($('div','tc-response__actions'),button('Submit answer',()=>{},'tc-button tc-button--solid')));form.querySelector('button').type='submit';panel.append(form);
  }
  const actions=$('div','tc-workspace__actions');
  actions.append(button('Ask Teacher',()=>promptInteraction('ASK_TEACHER','What would you like to ask?'),'tc-button tc-button--soft'),button('Need help',()=>promptInteraction('NEED_HELP','Where are you stuck?'),'tc-button tc-button--soft'));
  if(['INDEPENDENT_PRACTICE','GUIDED_PRACTICE'].includes(s.modeKey))actions.append(button("I've finished",()=>act('interactions',{kind:'FINISHED'}),'tc-button tc-button--quiet'));
  if(['GUIDED_PRACTICE','INDEPENDENT_PRACTICE'].includes(s.modeKey))actions.append(button("I'm ready",()=>act('interactions',{kind:'READY'}),'tc-button tc-button--quiet'));
  panel.append(actions);return panel;
}
function promptInteraction(kind,label){const body=window.prompt(label);if(body?.trim())act('interactions',{kind,body:body.trim()});}
function renderControls(s){const details=$('details','tc-controls');details.append($('summary','','Class controls'));
  const items=$('div','tc-controls__items');[['Request short break','BREAK_REQUEST'],['Request early dismissal','EARLY_DISMISSAL_REQUEST'],['Report technical issue','TECHNICAL_ISSUE']].forEach(([label,kind])=>items.append(button(label,()=>act('interactions',{kind}),'tc-button tc-button--quiet')));
  details.append(items);if(!s.controlsEnabled)details.hidden=true;return details;}
function renderSummary(s){const section=$('section','tc-after');add(section,$('div','tc-eyebrow','AFTER CLASS'),$('h2','','What stays with you'));
  if(s.summary?.state==='TRANSLATED'&&s.summary.payload?.student_summary)section.append($('p','tc-summary-text',s.summary.payload.student_summary));
  else if(s.closureFacts){section.append(notice('Class record saved','The academic record is secure. A student-facing narrative is pending its qualified translation route.'));const list=$('ul','tc-fact-list');s.closureFacts.facts.forEach((f)=>{if(f.semantic_key==='completed_objective_refs'||f.semantic_key==='unfinished_core_objective_refs'){list.append(add($('li',''),$('strong','',f.semantic_key==='completed_objective_refs'?'Completed objectives':'Carried forward'),$('span','',Array.isArray(f.effective_state)?f.effective_state.join(', ')||'None':'—')));}});section.append(list);}
  else section.append(notice('Summary pending','The Class will leave an official record when it closes.'));
  const artifacts=add($('div','tc-artifacts'),$('span','','Board history where permitted'),$('span','','Your Notebook'),$('span','','Linked Work when available'));
  if(s.summary?.payload?.transcript_url){const link=document.createElement('a');link.className='tc-artifact-link';link.href=s.summary.payload.transcript_url;link.textContent='Full transcript · secondary record';link.setAttribute('aria-label','Open full transcript as a secondary class artifact');artifacts.append(link);}
  section.append(artifacts);return section;}
function render(){
  const s=state.snapshot;if(!s||!state.host)return;const root=$('div','tc-shell');root.dataset.mode=s.modeKey;
  root.append(renderHeader(s));const body=$('main','tc-layout');
  const left=$('div','tc-layout__main');left.append(renderTeacher(s));
  if(s.modeKey==='PRE_CLASS'){left.append(notice('Class begins soon',`Scheduled for ${date(s.class.scheduledStartAt)}. Expected duration: ${Math.round((new Date(s.class.scheduledEndAt)-new Date(s.class.scheduledStartAt))/60000)} minutes.`,'tc-preclass'));}
  if(s.modeKey==='INTERRUPTED')left.append(notice('Your place is saved',s.interruption?.cause==='SYSTEM'?'KIWI interrupted the Class. This will not count as negative academic evidence.':'Return to this Class when the session resumes. The Controller will reassess the remaining time.','tc-error'));
  const selectTab=(tab)=>{state.tab=tab;render();state.host?.querySelector(`[data-classroom-tab="${tab}"]`)?.focus();};const tabs=['board','workspace','notebook'].map((tab)=>{const b=button(tab[0].toUpperCase()+tab.slice(1),()=>selectTab(tab),state.tab===tab?'is-active':'');b.dataset.classroomTab=tab;b.setAttribute('role','tab');b.setAttribute('aria-selected',state.tab===tab?'true':'false');b.setAttribute('aria-controls',`tc-panel-${tab}`);b.tabIndex=state.tab===tab?0:-1;return b;});
  const mobileNav=add($('div','tc-mobile-tabs'),...tabs);mobileNav.setAttribute('role','tablist');mobileNav.setAttribute('aria-label','Classroom areas');left.append(mobileNav);
  const quickNote=button('✎ Notebook',()=>selectTab('notebook'),'tc-notebook-shortcut');quickNote.setAttribute('aria-label','Open Notebook at any time');left.append(quickNote);
  const board=renderBoard(s);board.id='tc-panel-board';board.setAttribute('role','tabpanel');board.classList.toggle('tc-mobile-hidden',state.tab!=='board');left.append(board);
  const work=renderWorkspace(s);work.id='tc-panel-workspace';work.setAttribute('role','tabpanel');work.classList.toggle('tc-mobile-hidden',state.tab!=='workspace');
  const note=renderNotebook(s);note.id='tc-panel-notebook';note.setAttribute('role','tabpanel');note.classList.toggle('tc-mobile-hidden',state.tab!=='notebook');
  const right=add($('aside','tc-layout__side'),work,note,renderControls(s));
  add(body,left,right);root.append(body);if(s.controller?.lifecycleState==='CLOSED')root.append(renderSummary(s));
  const message=$('div','tc-message');message.setAttribute('role','alert');const connection=$('div','tc-connection');connection.setAttribute('role','status');connection.setAttribute('aria-live','polite');root.append(message,connection);state.host.replaceChildren(root);updateClocks();
}
async function renderCourse({course,container}){
  const page=$('section','tc-course');
  add(page,$('div','tc-eyebrow','COURSE / CLASSROOM'),$('h2','','Enter the classroom'),$('p','','A focused place for the lesson, your work and the record you take away.'));
  const status=$('div','tc-classroom-sync');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const content=$('div','tc-classroom-classes');
  const refreshButton=button('Refresh classes',()=>refresh(),'tc-button tc-button--quiet');
  page.append(refreshButton,status,content);container.append(page);
  let fetching=false,loaded=false;
  async function refresh(){
    if(!page.isConnected||fetching)return;
    fetching=true;
    try{
      const data=await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/classes`);
      if(!page.isConnected)return;
      const upcoming=data.upcoming||data.classes||[],history=data.history||[];
      const body=$('div','tc-classroom-groups');
      if(!upcoming.length&&!history.length)body.append(notice('No scheduled Classes','The Course schedule will place future sessions here.'));
      if(upcoming.length){
        body.append($('h3','tc-list-heading','Upcoming Classes'));
        const list=$('div','tc-class-list');
        upcoming.forEach((item)=>list.append(add($('article','tc-class-card'),add($('div',''),$('small','',date(item.scheduled_start_at)),$('h3','',data.course.course_title),$('p','',`${data.course.teacher_name||'KIWI Teacher'} · ${Math.round((new Date(item.scheduled_end_at)-new Date(item.scheduled_start_at))/60000)} minutes`)),button('Enter Classroom ↗',()=>open(item.class_id),'tc-button tc-button--solid'))));
        body.append(list);
      }
      if(history.length){
        body.append($('h3','tc-list-heading','Class history'));
        const past=$('div','tc-class-history');
        const labels={ON_TIME:'Attended',LATE:'Late',PARTIAL:'Partial attendance',UNEXCUSED_ABSENCE:'Missed',EXCUSED_ABSENCE:'Excused',APPROVED_LEAVE:'Approved leave',SYSTEM_PROTECTED:'System protected',INTERRUPTED:'Interrupted',PENDING:'Pending',RESCHEDULED:'Rescheduled',NO_OBLIGATION:'No obligation'};
        history.forEach((item)=>{
          const key=String(item.attendance_outcome||'PENDING').toUpperCase(),outcome=labels[key]||key.replaceAll('_',' ').toLowerCase();
          const detail=`${outcome}${Number(item.missed_minutes)>0?` · ${item.missed_minutes} min missed`:''}`;
          past.append(add($('article','tc-history-card'),add($('div',''),$('small','',date(item.scheduled_start_at)),$('strong','',data.course.course_title),$('p','',detail)),button('Review Class',()=>open(item.class_id),'tc-button tc-button--quiet')));
        });body.append(past);
      }
      content.replaceChildren(body);loaded=true;status.textContent='Classes updated · '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    }catch(error){if(!page.isConnected)return;status.textContent='Class refresh failed — retry when connected.';if(!loaded)content.replaceChildren(notice('Classes unavailable',error.message||'Please try again.','tc-error'));}
    finally{fetching=false;}
  }
  await refresh();
  const onVisible=()=>{if(page.isConnected&&document.visibilityState==='visible')refresh();};
  document.addEventListener('visibilitychange',onVisible);window.addEventListener('focus',onVisible);
  const timer=window.setInterval(()=>{if(!page.isConnected){window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible);return;}if(document.visibilityState==='visible')refresh();},30000);
}
courses.registerSection({id:'classroom',label:'Classroom',order:45,render:renderCourse,renderSummary:async({course,container})=>{
  const card=add($('div','tc-course-summary'),$('div','tc-eyebrow','CLASSROOM'),$('h3','','The lesson has a place'),$('p','','Enter a scheduled Class to see the Board, your work and your Notebook.'));
  card.append(button('View Classes',()=>courses.openSection?.('classroom'),'tc-button tc-button--soft'));container.append(card);
}});
