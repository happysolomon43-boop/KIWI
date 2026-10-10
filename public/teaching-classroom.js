const {kiwiApiRequest,kiwiApiBlobRequest}=window.KIWI_API_CLIENT||{};
const courses=window.KIWITeachingCourses;
const classroomTestMode=window.KIWI_CLASSROOM_TEST_MODE==='LIVE_COURSE';
if(typeof kiwiApiRequest!=='function'||!courses?.registerSection)throw new Error('Teaching Classroom requires the shared KIWI client and Course shell.');

const $=(tag,className='',text=null)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==null)n.textContent=String(text);return n;};
const visualLoads=new Map();
function clearVisualLoads(){for(const {controller,url} of visualLoads.values()){controller.abort();if(url)URL.revokeObjectURL(url);}visualLoads.clear();}
const TEXT_SCALES=Object.freeze([0.82,0.9,1,1.12]);
function savedTextScale(){
  try{const n=Number(window.localStorage.getItem('kiwi_classroom_text_scale'));return TEXT_SCALES.includes(n)?n:1;}catch{return 1;}
}
const state={classId:null,snapshot:null,host:null,interval:null,refresh:null,scene:0,tab:'board',busy:false,returnFocus:null,leaveRequestId:null,reviewOnly:false,onReviewComplete:null,sheet:null,sheetKind:null,sheetFocus:null,sheetKey:null,sheetBusy:false,expanded:null,
  textScale:savedTextScale(),requestAbort:null,snapshotFlight:null,connectFlight:null,joinFlight:null,joinNeedsConfirmation:false,connectionMessage:''};
function changeTextSize(delta){
  const index=TEXT_SCALES.indexOf(state.textScale);
  state.textScale=TEXT_SCALES[Math.max(0,Math.min(TEXT_SCALES.length-1,index+delta))];
  state.host?.style.setProperty('--tc-reading-scale',String(state.textScale));
  try{window.localStorage.setItem('kiwi_classroom_text_scale',String(state.textScale));}catch{}
  const smaller=state.host?.querySelector('[data-text-size="smaller"]'),larger=state.host?.querySelector('[data-text-size="larger"]');
  if(smaller)smaller.disabled=state.textScale===TEXT_SCALES[0];
  if(larger)larger.disabled=state.textScale===TEXT_SCALES.at(-1);
}
function readingControls(){
  const group=$('div','tc-reading-controls');group.setAttribute('role','group');group.setAttribute('aria-label','Classroom reading text size');
  const small=button('A−',()=>changeTextSize(-1),'tc-reading-control');
  small.dataset.textSize='smaller';small.title='Make lesson text smaller';small.setAttribute('aria-label',small.title);small.disabled=state.textScale===TEXT_SCALES[0];
  const large=button('A+',()=>changeTextSize(1),'tc-reading-control');
  large.dataset.textSize='larger';large.title='Make lesson text larger';large.setAttribute('aria-label',large.title);large.disabled=state.textScale===TEXT_SCALES.at(-1);
  group.append(small,large);return group;
}
function connectionFeedback(message){
  state.connectionMessage=message;
  const region=state.host?.querySelector('.tc-connection');
  if(region)region.replaceChildren(...(message?[$('span','',message)]:[]));
}
const MODE={PRE_CLASS:'Before Class',START_DELAYED:'Start pending',UNSTARTED_PAST:'Did not start',OPENING:'Teaching',DIAGNOSTIC:'Teaching',INSTRUCTION:'Teaching',GUIDED_PRACTICE:'Guided Practice',INDEPENDENT_PRACTICE:'Independent Practice',CLASSWORK:'Classwork — Graded',ASSESSMENT:'Test / Assessment',BREAK:'Break',REMEDIATION:'Teaching',CLOSURE:'Class Summary',INTERRUPTED:'Interrupted'};
function when(value){return value?new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—';}
function date(value){return value?new Date(value).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';}
function duration(ms){let n=Math.max(0,Math.floor(ms/1000));return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;}
function add(parent,...children){children.forEach((child)=>parent.append(child));return parent;}
function button(label,handler,cls=''){const b=$('button',cls,label);b.type='button';b.addEventListener('click',handler);return b;}
function notice(title,body,kind=''){return add($('div',`tc-notice ${kind}`),$('strong','',title),$('p','',body));}
function serverNow(){const s=state.snapshot;return Date.now()+(s?new Date(s.serverNow).getTime()-s._receivedAt:0);}
function clearRuntime(){if(state.interval)clearInterval(state.interval);if(state.refresh)clearInterval(state.refresh);state.interval=state.refresh=null;}
let selectionNote=null,selectionFrame=null;
function clearSelectionNote(){selectionNote?.button.remove();selectionNote=null;}
function updateSelectionNote(){
  if(selectionNote?.busy||document.activeElement===selectionNote?.button)return;
  const selection=window.getSelection();
  if(!state.host||state.sheet||state.reviewOnly||!state.snapshot?.notebookAllowed||!selection?.rangeCount||selection.isCollapsed){clearSelectionNote();return;}
  const range=selection.getRangeAt(0),element=node=>node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
  const start=element(range.startContainer),end=element(range.endContainer);
  const surface=start?.closest('.tc-board,.tc-workspace,.cr-event,.cr-source');
  const content=selection.toString().trim();
  if(!content||!surface||!state.host.contains(surface)||!surface.contains(end)||start.closest('input,textarea,button,[contenteditable]')||end?.closest('input,textarea,button,[contenteditable]')){clearSelectionNote();return;}
  const classId=state.classId,rect=range.getBoundingClientRect();
  if(selectionNote?.content===content&&selectionNote.classId===classId)return;
  clearSelectionNote();
  const control=button('Add to note',async()=>{
    const saved=selectionNote;if(!saved||saved.busy||saved.classId!==state.classId||!state.snapshot?.notebookAllowed||state.reviewOnly)return;
    saved.busy=true;control.disabled=true;control.textContent='Saving…';
    try{
      await kiwiApiRequest('/teaching/classes/'+encodeURIComponent(classId)+'/notebook',{method:'POST',body:{content:saved.content,idempotencyKey:saved.key,...(saved.boardItemId?{boardItemId:saved.boardItemId}:{}),...(saved.sourceRef?{sourceRef:saved.sourceRef}:{})}});
      control.textContent='Added to Notebook';control.setAttribute('role','status');
      window.getSelection()?.removeAllRanges();
      await fetchSnapshot().catch(()=>{});
      setTimeout(()=>{if(selectionNote===saved)clearSelectionNote();},1400);
    }catch(error){saved.busy=false;control.disabled=false;control.textContent='Retry Add to note';control.title=error.message||'Could not confirm saving. Retry safely.';}
  },'tc-selection-note');
  control.addEventListener('pointerdown',event=>event.preventDefault());
  control.setAttribute('aria-label','Add selected classroom text to Notebook');
  if(content.length>10000){control.disabled=true;control.textContent='Select less text';control.title='Notes can contain up to 10,000 characters.';}
  selectionNote={button:control,content,classId,key:crypto.randomUUID(),boardItemId:start.closest('[data-board-item-id]')?.dataset.boardItemId||null,sourceRef:remodeledView?.referenceFor(start)||null,busy:false};
  (state.expanded?.dialog||state.host).append(control);
  const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||window.innerWidth,height=viewport?.height||window.innerHeight;
  control.style.left=Math.max(left+8,Math.min(rect.left,left+width-control.offsetWidth-8))+'px';
  control.style.top=Math.max(top+8,Math.min(rect.bottom+8,top+height-control.offsetHeight-8))+'px';
}
document.addEventListener('selectionchange',()=>{if(selectionFrame)return;selectionFrame=requestAnimationFrame(()=>{selectionFrame=null;updateSelectionNote();});});
document.addEventListener('scroll',()=>{if(!selectionNote?.busy)clearSelectionNote();},true);
let remodeledView=null,remodeledLoading=null;
function close({restore=true}={}){
  remodeledView?.close();remodeledView=null;
  state.requestAbort?.abort();
  state.requestAbort=null;state.snapshotFlight=null;state.connectFlight=null;state.joinFlight=null;
  clearSelectionNote();collapsePanel({restore:false});clearVisualLoads();state.scene=0;closeSheet({restore:false,force:true});clearRuntime();
  state.host?.remove();document.body.classList.remove('tc-active');
  state.host=null;state.classId=null;state.snapshot=null;state.leaveRequestId=null;state.reviewOnly=false;state.onReviewComplete=null;
  state.joinNeedsConfirmation=false;state.connectionMessage='';
  if(restore)state.returnFocus?.focus?.();state.returnFocus=null;
}
async function fetchSnapshot(){
  if(!state.classId||!state.host||state.busy)return null;
  if(state.snapshotFlight)return state.snapshotFlight;
  const classId=state.classId,host=state.host;
  const task=(async()=>{
    const data=await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(classId)}/classroom`,{signal:state.requestAbort?.signal});
    if(state.classId!==classId||state.host!==host)return null;
    data._receivedAt=Date.now();const previous=state.snapshot;
    if(!state.reviewOnly&&(!previous||state.scene>=Math.max(0,(previous.board?.length||0)-1)))state.scene=Math.max(0,(data.board?.length||0)-1);
    state.snapshot=data;
    if(data.hasEntered)state.joinNeedsConfirmation=false;
    if(!state.joinNeedsConfirmation)state.connectionMessage='';
    // Refreshes that only change server clocks must not re-create the reading UI.
    const comparable=(v)=>JSON.stringify({...v,serverNow:null,_receivedAt:null,entry:v?.entry?{...v.entry,minutesRemaining:null}:null});
    if(previous&&comparable(previous)===comparable(data)){
      updateClocks();
      // Do not discard the explicit retry JOIN action on clock-only polls.
      if(!state.joinNeedsConfirmation)connectionFeedback('');
      return data;
    }
    render();return data;
  })();
  state.snapshotFlight=task;
  try{return await task;}finally{if(state.snapshotFlight===task)state.snapshotFlight=null;}
}

async function act(path,body){
  if(state.busy)return;state.busy=true;
  try{await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(state.classId)}/${path}`,{method:'POST',body:{...body,idempotencyKey:crypto.randomUUID()}});await fetchAfterAction();}
  catch(error){classroomFeedback(error.message||'That action could not be completed. Retry to check the saved state.');}
  finally{state.busy=false;}
}
function classroomFeedback(message) {
  const region=state.host?.querySelector('.tc-message,.cr-status');
  if(region)region.replaceChildren($('span','',message));
}
function isUntouchedRouteHeldController(controller) {
  if(controller?.lifecycleState!=='INTERRUPTED'
    ||controller?.instructionalSubstate!=='INTERRUPTED'
    ||controller?.lessonBlueprintId||controller?.resumeInstructionalSubstate)return false;
  const progress=controller.progressState||{};
  return ['completed_segment_refs','completed_objective_refs','evidence_event_refs',
    'independent_evidence_objective_refs'].every(k=>Array.isArray(progress[k])&&progress[k].length===0);
}
async function recoverPreparedLesson(classId) {
  const base='/teaching/classes/'+encodeURIComponent(classId);
  let current=await kiwiApiRequest(base+'/controller');
  const ready=()=>current?.blueprint?.currentForAuthoritativeContext===true
    // Handed-off PPL workspaces are intentionally absent from D11's active
    // workspace projection. Absence alongside a current validated Blueprint
    // is the normal post-handoff state, not a missing preparation.
    && (!current?.preparation || ['FINALIZED','HANDED_OFF'].includes(current.preparation.lifecycleState));
  if(ready())return;
  if(current?.controller&&!isUntouchedRouteHeldController(current.controller))
    throw new Error('This Class has already started academic work. It cannot use late Blueprint recovery.');
  for(let step=1;step<=3;step++){
    if(state.classId!==classId||!state.host)throw new Error('Classroom was closed during preparation.');
    classroomFeedback('Preparing your real KIWI lesson · '+step+' of 3. The AI Teacher is validating the Lesson Blueprint…');
    const result=await kiwiApiRequest(base+'/lesson-blueprint/prepare',{
      method:'POST',body:{allowLateStartRecovery:true,maxSteps:1},timeoutMs:130000
    });
    current=result?.context||await kiwiApiRequest(base+'/controller');
    if(ready())return;
    if(result?.done)break;
  }
  current=await kiwiApiRequest(base+'/controller');
  if(!ready())throw new Error('KIWI has not validated a current Lesson Blueprint. Your lesson is safe; retry preparation while this Class remains open.');
}
async function controllerAction(path,body={}){
  if(state.busy)return;state.busy=true;
  const classId=state.classId;
  try{
    if(path==='recover-and-resume'){
      await recoverPreparedLesson(classId);
      const current=await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(classId)}/controller`);
      const controller=current?.controller;
      if(!current?.blueprint?.currentForAuthoritativeContext
        ||!controller?.lessonBlueprintId
        ||controller?.lifecycleState!=='INTERRUPTED'
        ||controller?.instructionalSubstate!=='INTERRUPTED'
        ||controller?.resumeInstructionalSubstate!=='OPENING')
        throw new Error('KIWI could not verify a ready interrupted session for safe recovery.');
      classroomFeedback('Resuming the validated KIWI lesson…');
      await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(classId)}/controller/transition`,{
        method:'POST',body:{toState:'OPENING',expectedVersion:controller.stateVersion}
      });
      await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(classId)}/classroom/enter`,{method:'POST',body:{}});
      await fetchAfterAction();return;
    }
    if(path==='start')await recoverPreparedLesson(classId);
    classroomFeedback(path==='start'?'Starting the validated live Class…':'Updating the Class…');
    await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(classId)}/controller/${path}`,{method:'POST',body});
    if(path==='start')await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(classId)}/classroom/enter`,{method:'POST',body:{}});
    await fetchAfterAction();
  }
  catch(error){
    const code=error?.code||'';
    const hint=code==='TEACHING_D11_MODEL_ROUTE_UNQUALIFIED'
      ?'The KIWI teaching-model route is not currently qualified. The Class cannot be fabricated or force-started.'
      :error?.message||'The Class could not continue. Retry before its scheduled end.';
    classroomFeedback(hint);
  }
  finally{state.busy=false;}
}
async function fetchAfterAction(){const data=await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(state.classId)}/classroom`);data._receivedAt=Date.now();if(!state.reviewOnly&&state.scene>=Math.max(0,(state.snapshot?.board?.length||0)-1))state.scene=Math.max(0,(data.board?.length||0)-1);state.snapshot=data;render();}
// Network failures cannot destroy a previously rendered lesson or invent a
// session interruption. Attendance JOIN is idempotent and is never attempted
// without an authoritative active Controller.
async function joinCurrentClass(classId,host){
  if(state.joinFlight)return state.joinFlight;
  if(state.classId!==classId||state.host!==host||state.reviewOnly
    ||state.snapshot?.controller?.lifecycleState!=='ACTIVE'||state.snapshot?.hasEntered)return;
  const task=(async()=>{
    try{
      await kiwiApiRequest(`/teaching/classes/${encodeURIComponent(classId)}/classroom/enter`,{method:'POST',body:{},signal:state.requestAbort?.signal});
      if(state.host!==host||state.classId!==classId)return;
      state.joinNeedsConfirmation=false;
      try{await fetchSnapshot();}catch(error){
        if(state.host===host)connectionFeedback('Classroom is open. Reconnecting to update your attendance confirmation…');
      }
    }catch(error){
      if(state.host!==host||state.classId!==classId)return;
      const transient=error?.code==='KIWI_API_TIMEOUT'||error?.status==null||error.status>=500;
      state.joinNeedsConfirmation=transient;
      connectionFeedback(transient
        ?'Your lesson is still available. KIWI could not confirm JOIN yet; use Check / Retry Join when the connection improves.'
        :'KIWI could not confirm entry: '+(error?.message||'The current Class no longer permits JOIN.'));
      render();
    }
  })();
  state.joinFlight=task;
  try{await task;}finally{if(state.joinFlight===task)state.joinFlight=null;}
}
function showConnectionRetry(host,classId,error){
  if(state.host!==host||state.classId!==classId)return;
  // A timed-out GET is a transport uncertainty, not a D11 Controller failure.
  // Keep the same Classroom open and allow scheduled or manual GET retries.
  if(state.snapshot){connectionFeedback('Reconnecting to the Classroom… Your current Board remains available.');return;}
  const transient=error?.code==='KIWI_API_TIMEOUT'||error?.status==null||error.status>=500;
  const panel=notice(transient?'Connecting to your Class':'Classroom access needs attention',
    transient
      ?'KIWI is taking longer to respond. A timeout does not itself end or interrupt a Class. KIWI will keep trying.'
      :'KIWI could not confirm that this Class is available. This screen has not changed your academic record.','tc-connection-wait');
  const actions=add($('div','tc-reconnect-actions'),
    button('Try again',()=>connectClassroom(classId,host),'tc-button tc-button--solid'),
    button('Return to Course',()=>close(),'tc-button tc-button--quiet'));
  const detail=$('p','tc-reconnect-detail',error?.code==='KIWI_API_TIMEOUT'
    ?'The server did not answer in time. You can retry without leaving this Class.'
    :'The Classroom could not be reached. Check your connection or retry.');
  host.replaceChildren(panel,detail,actions);
}
async function connectClassroom(classId,host){
  if(state.host!==host||state.classId!==classId)return;
  if(state.connectFlight)return state.connectFlight;
  const task=(async()=>{
    try{
      const data=await fetchSnapshot();
      if(state.host!==host||state.classId!==classId||!data)return;
      if(!state.reviewOnly&&data.controller?.lifecycleState==='ACTIVE'&&!data.hasEntered){
        await joinCurrentClass(classId,host);
      }
      if(state.host===host)state.host.querySelector('h1')?.focus?.({preventScroll:true});
    }catch(error){if(state.host===host&&state.classId===classId)showConnectionRetry(host,classId,error);}
  })();
  state.connectFlight=task;
  try{await task;}finally{if(state.connectFlight===task)state.connectFlight=null;}
}
async function open(classId,{reviewOnly=false,onReviewComplete=null}={}){
  const opener=document.activeElement;close({restore:false});
  state.returnFocus=opener;state.classId=classId;state.reviewOnly=reviewOnly;
  state.onReviewComplete=classroomTestMode&&reviewOnly&&typeof onReviewComplete==='function'?onReviewComplete:null;
  state.requestAbort=new AbortController();
  const host=$('div','tc-overlay');state.host=host;host.style.setProperty('--tc-reading-scale',String(state.textScale));
  host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');
  host.setAttribute('aria-label',classroomTestMode?'KIWI existing Classroom — admin review':'KIWI Classroom');
  document.body.append(host);document.body.classList.add('tc-active');
  host.append(notice('Opening Classroom','Connecting to the current Class record…'));
  host.addEventListener('keydown',trapClassroomFocus);host.tabIndex=-1;host.focus();
  // The refresh loop exists even when the initial read times out. There is
  // only one in-flight snapshot per Class, never overlapping 12-second GETs.
  state.interval=setInterval(updateClocks,1000);
  state.refresh=setInterval(()=>{
    if(state.host!==host||state.classId!==classId)return;
    if(!state.snapshot)connectClassroom(classId,host);
    else fetchSnapshot().catch(()=>connectionFeedback('Connection interrupted. Your Board remains available; KIWI is retrying.'));
  },12000);
  await connectClassroom(classId,host);
}

function trapClassroomFocus(event){
  if(event.target.closest?.('.cr-expanded-board'))return;
  if(event.key==='Escape'){
    if(state.sheet){event.preventDefault();event.stopPropagation();closeSheet();return;}
    if(state.expanded){event.preventDefault();collapsePanel();}
    return;
  }
  if(event.key!=='Tab')return;
  const scope=state.sheet||state.expanded?.dialog||state.host;
  const nodes=Array.from(scope?.querySelectorAll('button:not([disabled]),a[href],textarea:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')||[]).filter(node=>node.getClientRects().length);
  if(!nodes.length)return;
  const first=nodes[0],last=nodes[nodes.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
function updateClocks(){
  const s=state.snapshot;if(!s||!state.host)return;
  const now=serverNow(), end=new Date(s.class.scheduledEndAt).getTime();
  const overall=state.host.querySelector('[data-clock="class"]');if(overall)overall.textContent=['CLOSURE','UNSTARTED_PAST'].includes(s.modeKey)||s.controller?.lifecycleState==='CLOSED'?'Class ended':now>end?`+${duration(now-end)} overtime`:`${duration(end-now)} to scheduled end`;
  const breakClock=state.host.querySelector('[data-clock="activity"]');if(breakClock){const target=s.controller?.breakEndsAt||s.controller?.progressState?.activity_ends_at;if(target)breakClock.textContent=`${duration(new Date(target).getTime()-now)} remaining`;}
}
function renderHeader(s){
  const header=$('header','tc-header');const brand=add($('div','tc-brand'),$('span','tc-brand__mark','K'),$('span','',classroomTestMode?'KIWI / ADMIN CLASSROOM':'KIWI / TEACHING'));
  const heading=$('h1','',s.identity.course_title);heading.tabIndex=-1;const identity=add($('div','tc-header__identity'),$('div','tc-eyebrow',classroomTestMode?(state.reviewOnly?'READ-ONLY CLASSROOM PREVIEW':'LIVE CLASSROOM · REAL ATTENDANCE'):'LIVE CLASSROOM'),heading,$('p','',s.identity.teacher_name||'KIWI Teacher'));
  const mode=$('span','tc-mode',MODE[s.modeKey]||s.mode);mode.dataset.mode=s.modeKey;mode.setAttribute('role','status');mode.setAttribute('aria-live','polite');mode.setAttribute('aria-label',`Current Class mode: ${MODE[s.modeKey]||s.mode}`);
  const clocks=add($('div','tc-header__clocks'),add($('div','tc-clock'),$('small','','CLASS TIME'),$('strong','',`Ends ${when(s.class.scheduledEndAt)}`),$('span','','')));
  clocks.querySelector('span').dataset.clock='class';
  if(s.modeKey==='BREAK'||s.modeKey==='INDEPENDENT_PRACTICE'){const activity=add($('div','tc-clock tc-clock--activity'),$('small','',s.modeKey==='BREAK'?'BREAK':'ACTIVITY'),$('strong','',s.modeKey==='BREAK'?'Teaching paused':'Work independently'),$('span','',''));activity.querySelector('span').dataset.clock='activity';clocks.append(activity);}
  if(s.modeKey==='ASSESSMENT')clocks.prepend(add($('div','tc-clock tc-clock--assessment'),$('small','','ASSESSMENT TIME'),$('strong','','Controlled assessment'),$('span','','The assessment owner controls this timer')));
  if(state.reviewOnly){
    const closeReview=button('Close Review',()=>close(),'tc-button tc-button--quiet');
    add(header,brand,identity,mode,clocks,closeReview);
    if(classroomTestMode&&state.onReviewComplete) {
      const finish=button('Complete test review →',async()=>{
        if(finish.disabled)return;
        const handler=state.onReviewComplete;
        const classId=state.classId;
        finish.disabled=true;
        finish.textContent='Saving review…';
        try{
          const nextClassId=await handler(classId);
          close();
          if(typeof nextClassId==='string'&&nextClassId)
            await open(nextClassId,{reviewOnly:true,onReviewComplete:handler});
        }catch(error){
          finish.disabled=false;
          finish.textContent='Retry completion';
          state.host?.querySelector('.tc-message')?.replaceChildren($('span','',error.message||'Could not save test review.'));
        }
      },'tc-button tc-button--solid');
      finish.setAttribute('aria-label','Complete this non-academic Classroom review and move to next');
      const reviewActions=$('div','tc-review-actions');
      closeReview.replaceWith(reviewActions);
      reviewActions.append(closeReview,finish);
    }
    return header;
  }
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
      classroomFeedback(`${error.message||'KIWI could not confirm your departure.'} Retry Leave Class to safely confirm the same attendance record.`);
    }
  },'tc-button tc-button--quiet');
  leave.dataset.leaveClass='true';
  add(header,brand,identity,mode,clocks,leave);return header;
}
function renderTeacher(s){
  const panel=$('section','tc-teacher');panel.setAttribute('aria-label','Teacher Presence');panel.setAttribute('aria-live','polite');
  const avatar=$('div','tc-teacher__avatar','K');avatar.setAttribute('aria-hidden','true');
  let message='Follow the Board. Your workspace will appear when there is something to do.';
  if(!s.controller)message=s.modeKey==='UNSTARTED_PAST'
    ?'This scheduled lesson has passed without a started Class session. Its attendance record is preserved for review.'
    :s.modeKey==='START_DELAYED'
      ?'Your Class start is pending. You can start it here if the scheduled start event was delayed.'
      :'Your AI Teacher will lead the lesson when its scheduled time arrives.';
  if(s.modeKey==='INDEPENDENT_PRACTICE')message='Take this time to work independently. I will return when the activity ends.';
  if(s.modeKey==='BREAK')message='We are on a break. Teaching will resume when the timer ends.';
  if(s.modeKey==='INTERRUPTED')message='The Class is interrupted. Your current work remains available when it resumes.';
  if(s.modeKey==='CLOSURE')message='Class has ended. Your Class Summary and permitted lesson artifacts are below.';
  add(panel,avatar,add($('div','tc-teacher__copy'),$('div','tc-eyebrow',s.identity.teacher_name||'YOUR TEACHER'),$('p','',s.teacherMessage||message)));return panel;
}
function blockText(parent,value){parent.append($('p','',String(value||'')));}
function syncExpandButton(panel,kind,expanded){
  const control=panel.querySelector('[data-expand-panel]');if(!control)return;
  const name=kind==='board'?'Board':'Workspace';
  control.textContent=expanded?'↙':'⛶';control.title=(expanded?'Restore ':'Expand ')+name;
  control.setAttribute('aria-label',control.title);control.setAttribute('aria-expanded',String(expanded));
}
function expandControl(kind){
  const control=button('⛶',()=>state.expanded?.kind===kind?collapsePanel():expandPanel(kind),'tc-expand-button');
  control.dataset.expandPanel=kind;control.setAttribute('aria-controls','tc-panel-'+kind);
  control.title='Expand '+(kind==='board'?'Board':'Workspace');control.setAttribute('aria-label',control.title);control.setAttribute('aria-expanded','false');return control;
}
function collapsePanel({restore=true}={}){
  const expanded=state.expanded;if(!expanded)return;state.expanded=null;
  const {panel,placeholder,dialog,kind}=expanded;
  placeholder.replaceWith(panel);panel.scrollTop=expanded.originalScroll;
  state.host?.classList.remove('tc-panel-expanded');
  syncExpandButton(panel,kind,false);if(dialog.open)dialog.close();dialog.remove();
  if(restore)panel.querySelector('[data-expand-panel]')?.focus({preventScroll:true});
}
function expandPanel(kind){
  if(!['board','workspace'].includes(kind)||!state.host)return;
  collapsePanel({restore:false});
  const panel=state.host.querySelector('#tc-panel-'+kind);if(!panel)return;
  const dialog=$('dialog','tc-expanded-panel');dialog.setAttribute('aria-label',(kind==='board'?'Board':'Workspace')+' expanded view');
  const placeholder=$('div','tc-panel-placeholder');placeholder.style.height=panel.getBoundingClientRect().height+'px';
  const originalScroll=panel.scrollTop;panel.replaceWith(placeholder);dialog.append(panel);state.host.append(dialog);
  state.expanded={kind,panel,placeholder,dialog,originalScroll};syncExpandButton(panel,kind,true);
  state.host.classList.add('tc-panel-expanded');
  dialog.addEventListener('cancel',event=>{event.preventDefault();collapsePanel();});
  dialog.addEventListener('close',()=>{if(state.expanded?.dialog===dialog)collapsePanel();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)collapsePanel();});
  dialog.showModal();panel.querySelector('[data-expand-panel]')?.focus({preventScroll:true});
}
function graphBlock(c){
  const wrap=$('div','tc-graph');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 400 220');svg.setAttribute('role','img');const description=c.description||c.alt||'Data graph';svg.setAttribute('aria-label',description);const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=description;svg.append(title);
  const pts=c.points||[];if(!pts.length){wrap.append($('p','','No data points'));return wrap;}
  const xs=pts.map((p)=>p[0]),ys=pts.map((p)=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const coords=pts.map(([x,y])=>[30+340*(x-minX)/(maxX-minX||1),185-145*(y-minY)/(maxY-minY||1)]);
  for(const path of ['M30 20V185H380',`M${coords.map((p)=>p.join(' ')).join('L')}`]){const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',path);line.setAttribute('fill','none');line.setAttribute('stroke',path[0]==='M'&&path.includes('V')?'#637b70':'#92e9be');line.setAttribute('stroke-width','2');svg.append(line);}
  wrap.append(svg);const alternative=$('details','tc-graph-alternative');alternative.append($('summary','','Graph data and description'),$('p','',description),$('p','',pts.map(([x,y])=>'('+x+', '+y+')').join('; ')));wrap.append(alternative);return wrap;
}
function renderBlock(item){
  const c=item.content||{},card=$('article','tc-board-item');card.dataset.type=item.type;if(item.boardItemId)card.dataset.boardItemId=item.boardItemId;
  const label=({text:'NOTE',equation:'EQUATION',worked_solution:'WORKED EXAMPLE',graph:'GRAPH',data:'DATA',image:'IMAGE',diagram:'DIAGRAM',code:'CODE',source_passage:'SOURCE',comparison:'COMPARE',annotation:'ANNOTATION'})[item.type]||'BOARD';
  card.append($('div','tc-board-item__label',label));
  switch(item.type){
    case 'text':case 'source_passage':blockText(card,c.text);break;
    case 'equation':card.append($('div','tc-math',c.text||''));break;
    case 'code':card.append(add($('pre','tc-code'),$('code','',c.text||'')));break;
    case 'worked_solution':(c.steps||[]).forEach((step,i)=>card.append(add($('div','tc-step'),$('span','',String(i+1).padStart(2,'0')),$('p','',step))));break;
    case 'graph':case 'data':card.append(graphBlock(c));break;
    case 'image':case 'diagram':{const img=$('img','tc-visual');img.alt=c.alt||`${label.toLowerCase()} shown on the Class Board`;img.loading='lazy';img.addEventListener('error',()=>{img.remove();card.append($('p','tc-empty-copy',c.fallback?.text||c.alt||'This visual could not be loaded.'));},{once:true});card.append(img);
      const fallback=()=>{if(!card.contains(img))return;img.remove();card.append($('p','tc-empty-copy',c.fallback?.text||c.alt||'This visual could not be loaded.'));};
      if(typeof kiwiApiBlobRequest!=='function'||!/^\/api\/teaching\/classes\/[^/]+\/classroom\/assets\/[^/]+$/.test(c.src||'')){fallback();break;}
      const load={controller:new AbortController(),url:null};visualLoads.set(img,load);
      kiwiApiBlobRequest(c.src.slice(4),{signal:load.controller.signal}).then(blob=>{if(!img.isConnected||load.controller.signal.aborted)return;load.url=URL.createObjectURL(blob);img.src=load.url;}).catch(()=>fallback());
      if(c.visualAuthority==='ILLUSTRATIVE')card.append($('small','tc-empty-copy','Illustration — use the Teacher’s explanation for exact facts.'));break;}
    case 'comparison':{const pair=$('div','tc-comparison');(c.columns||[]).forEach((col)=>pair.append(add($('div',''),$('strong','',col.title||''),$('p','',col.text))));card.append(pair);break;}
    case 'annotation':card.append($('p','tc-annotation',c.label||''));break;
  }
  const save=button('Save to Notebook',()=>act('notebook',{content:(c.text||c.label||c.alt||(c.steps||[]).join('\n')).slice(0,10000),boardItemId:item.boardItemId}),'tc-mini-action');
  if(!state.reviewOnly&&state.snapshot?.notebookAllowed&&item.boardItemId)card.append(save);
  return card;
}
function renderBoard(s){
  const panel=$('section','tc-board');panel.setAttribute('aria-label','Class Board');
  const title=add($('div','tc-panel-head'),add($('div',''),$('div','tc-eyebrow','TEACHING SURFACE'),$('h2','','The Board')));
  panel.append(title);const tools=add($('div','tc-panel-tools'),readingControls(),expandControl('board'));title.append(tools);
  if(!s.boardHistoryAllowed){panel.append(notice('Board history is unavailable','This activity restricts earlier teaching materials.'));return panel;}
  if(!s.board.length){if(['CLOSURE','UNSTARTED_PAST'].includes(s.modeKey)||s.controller?.lifecycleState==='CLOSED')panel.append(notice('No Board scenes published','There is no recorded lesson Board for this Class. Review attendance and any saved notes in Past Classes.'));else panel.append(add($('div','tc-board-empty'),$('div','tc-board-empty__glyph','✧'),$('h3','','A clear space to think'),$('p','','The Board will hold the explanation, examples and comparisons for this Class.')));return panel;}
  // On phones the Board is one continuous vertical lesson, not a sequence
  // that forces the learner to tap left/right arrows between explanations.
  // D14's existing permission check still gates every historical scene.
  if(window.matchMedia?.('(max-width: 699px)').matches){
    const list=$('div','tc-board-scene-list');
    s.board.forEach((scene,index)=>{
      const section=$('section','tc-board-scene');
      const label=$('div','tc-board-scene__number','BOARD SCENE '+(index+1)+' / '+s.board.length);
      section.append(label);
      if(scene.title)section.append($('h3','tc-scene-title',scene.title));
      const blocks=$('div','tc-board-blocks');
      scene.items.forEach(item=>blocks.append(renderBlock(item)));
      section.append(blocks);list.append(section);
    });
    panel.append(list);return panel;
  }
  state.scene=Math.min(state.scene,s.board.length-1);const scene=s.board[state.scene];
  const previous=button('←',()=>{state.scene=Math.max(0,state.scene-1);render();},'tc-icon');previous.setAttribute('aria-label','Previous Board scene');const next=button('→',()=>{state.scene=Math.min(s.board.length-1,state.scene+1);render();},'tc-icon');next.setAttribute('aria-label','Next Board scene');tools.prepend(add($('div','tc-scene-nav'),previous,$('span','',`${state.scene+1} / ${s.board.length}`),next));
  previous.disabled=state.scene===0;next.disabled=state.scene===s.board.length-1;
  if(scene.title)panel.append($('h3','tc-scene-title',scene.title));
  const blocks=$('div','tc-board-blocks');scene.items.forEach((item)=>blocks.append(renderBlock(item)));panel.append(blocks);return panel;
}
function renderWorkspace(s){
  const panel=$('section','tc-workspace');add(panel,add($('div','tc-panel-head'),add($('div',''),$('div','tc-eyebrow','YOUR SPACE'),$('h2','',s.modeKey==='INDEPENDENT_PRACTICE'?'Work independently':'Student Workspace'))));
  panel.querySelector('.tc-panel-head').append(expandControl('workspace'));
  if(state.reviewOnly){panel.append(notice(classroomTestMode?'Read-only preview':'Past Class record','Review the Board, summary and Notebook without joining the Class or changing attendance.'));return panel;}
  if(!s.controller){
    const schedule='Scheduled '+date(s.class.scheduledStartAt)+' · '+Math.round((new Date(s.class.scheduledEndAt)-new Date(s.class.scheduledStartAt))/60000)+' minutes.';
    if(s.modeKey==='UNSTARTED_PAST'){
      panel.append(notice('Historical Class','This Class has passed without an active lesson Controller. It cannot be restarted or joined as a live Class.'));
    }else if(s.canStartClass){
      panel.append(notice('Start available',schedule+' KIWI will validate or recover the Lesson Blueprint before starting. Preparation may take a few minutes.'));
      panel.append(button('Prepare & Start Class',()=>controllerAction('start'),'tc-button tc-button--solid'));
    }else{
      panel.append(notice('Scheduled Class',schedule+' Start Class will become available at the authoritative start time.'));
    }
    return panel;
  }
  if(s.modeKey==='BREAK'){panel.append(notice('A proper pause','Teaching is paused. You can step away and return when the break ends.','tc-break'));return panel;}
  if(s.modeKey==='ASSESSMENT'){panel.append(notice('Assessment in progress','Assessment rules and responses are controlled by the formal assessment interface. Classroom resources are restricted.','tc-assessment'));return panel;}
  if(s.modeKey==='CLOSURE'){panel.append(notice('Class is complete','Review the Summary, your Notebook and permitted Board scenes below.'));return panel;}
  if(s.modeKey==='INTERRUPTED'){panel.append(notice('Class paused safely','Your work is preserved. Continue from the saved teaching state when you are ready; a KIWI-caused interruption is never negative academic evidence.','tc-error'));if(isUntouchedRouteHeldController(s.controller))panel.append(button('Prepare & Resume Lesson',()=>controllerAction('recover-and-resume'),'tc-button tc-button--solid'));else if(s.interruption?.canResume)panel.append(button('Resume Class',()=>controllerAction('transition',{toState:s.interruption.resumeState,expectedVersion:s.controller.stateVersion}),'tc-button tc-button--solid'));return panel;}
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
  if(['INDEPENDENT_PRACTICE','GUIDED_PRACTICE'].includes(s.modeKey))actions.append(button("I've finished",()=>act('interactions',{kind:'FINISHED'}),'tc-button tc-button--quiet'));
  if(['GUIDED_PRACTICE','INDEPENDENT_PRACTICE'].includes(s.modeKey))actions.append(button("I'm ready",()=>act('interactions',{kind:'READY'}),'tc-button tc-button--quiet'));
  panel.append(actions);return panel;
}

function closeSheet({restore=true,force=false}={}){
  if(!state.sheet||state.sheetBusy&&!force)return;
  const focus=state.sheetFocus;
  const kind=state.sheetKind;
  state.sheet.remove();
  state.sheet=null;state.sheetKind=null;state.sheetFocus=null;state.sheetKey=null;state.sheetBusy=false;
  const root=state.host?.querySelector('.tc-shell');
  if(root)root.inert=false;
  const fallback=state.host?.querySelector(kind==='notebook'?'[aria-label="Open Notebook"]':'[aria-label="Raise your hand to request help"]');
  if(restore)(focus?.isConnected?focus:fallback)?.focus({preventScroll:true});
}
function syncSheet(){
  if(!state.sheet||!state.snapshot)return;
  if(state.sheetKind==='notebook'){
    const editable=Boolean(state.snapshot.notebookAllowed)&&!state.reviewOnly;
    const input=state.sheet.querySelector('.tc-sheet-form textarea');
    const save=state.sheet.querySelector('.tc-sheet-form button[type="submit"]');
    const status=state.sheet.querySelector('.tc-sheet-status');
    if(!editable){
      if(input){input.readOnly=true;input.dataset.restricted='true';}
      if(save)save.disabled=true;
      if(status)status.textContent='Notebook editing is paused while the current activity is protected.';
    }else if(input?.dataset.restricted==='true'){
      input.readOnly=false;delete input.dataset.restricted;
      if(save)save.disabled=false;
      if(status)status.textContent='';
    }
    return;
  }
  if(state.sheetKind!=='teacher')return;
  const log=state.sheet.querySelector('.tc-conversation');
  if(!log)return;
  const stick=log.scrollHeight-log.scrollTop-log.clientHeight<65;
  const entries=Array.isArray(state.snapshot.teacherConversation)?state.snapshot.teacherConversation:[];
  const requestByInteraction=new Map((state.snapshot.helpRequests||[]).map(item=>[item.interactionId,item]));
  const messages=entries.map(item=>{
    const row=$('article','tc-turn');row.dataset.role=item.role||'STUDENT';
    const who=item.role==='TEACHER'?(state.snapshot.identity?.teacher_name||'AI Teacher'):'You';
    const stamp=item.sentAt?new Date(item.sentAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
    row.append($('span','tc-turn-meta',who+(stamp?' · '+stamp:'')),$('p','',item.message||''));
    const raised=requestByInteraction.get(item.id);
    if(raised){const states={RAISED:'Hand raised · waiting for Teacher',PROCESSING:'Teacher is reviewing',DEFERRED:'Teacher will return to this question',ANSWERED:'Answered',DECLINED:'Not answered in this activity',CANCELLED:'Class activity changed',UNAVAILABLE:'Teacher reply unavailable'};
      row.append($('small','tc-help-status',states[raised.status]||'Question recorded'));
      if(raised.reason)row.append($('p','tc-help-reason',raised.reason));
    }
    return row;
  });
  if(!messages.length)log.replaceChildren($('p','tc-sheet-help','Your raised-hand questions and confirmed Teacher replies will appear here.'));
  else log.replaceChildren(...messages);
  if(stick)log.scrollTop=log.scrollHeight;
  const outstanding=(state.snapshot.helpRequests||[]).some(item=>['RAISED','PROCESSING','DEFERRED'].includes(item.status));
  const allowed=Boolean(state.snapshot.teacherMessagingAllowed)&&!state.reviewOnly&&!outstanding;
  const form=state.sheet.querySelector('.tc-teacher-form');
  if(form)form.hidden=!allowed;
  const help=state.sheet.querySelector('.tc-teacher-limits');
  if(help)help.textContent=outstanding
    ?'Your hand is raised. The Teacher is processing your question; wait for the decision before asking another.'
    :allowed?'The Teacher will decide whether to answer now, briefly defer, or explain why a question cannot be answered.':'You can review earlier questions, but cannot raise your hand during this protected or inactive activity.';
}
function openSheet(kind){
  collapsePanel({restore:false});
  if(!state.snapshot||!state.host||!['notebook','teacher'].includes(kind))return;
  if(state.sheet){if(state.sheetKind===kind)return;closeSheet({restore:false});}
  const trigger=document.activeElement;
  const shade=$('div','tc-sheet');
  const backdrop=button('',()=>closeSheet(),'tc-sheet-backdrop');backdrop.setAttribute('aria-label','Close this panel');
  const dialog=$('section','tc-sheet-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-labelledby','tc-sheet-title');
  const top=$('div','tc-sheet-heading');
  const title=kind==='notebook'?'Notebook':'Raise your hand';
  const label=kind==='notebook'?'YOUR PRIVATE NOTES':'ASK THE TEACHER';
  const headline=$('h2','',title);headline.id='tc-sheet-title';
  const headingText=add($('div','tc-sheet-heading-copy'),$('div','tc-eyebrow',label),headline);
  const mark=$('span','tc-sheet-emblem',kind==='notebook'?'✎':'✋');mark.setAttribute('aria-hidden','true');
  const sheetClose=button('×',()=>closeSheet(),'tc-sheet-close');sheetClose.setAttribute('aria-label','Close '+title);top.append(mark,headingText,sheetClose);
  dialog.append($('div','tc-sheet-handle'));
  dialog.append(top);
  dialog.append($('p','tc-sheet-description',kind==='notebook'
    ?state.reviewOnly?'These notes belong to a previous lesson.':'Jot down the ideas worth remembering. Notes are saved privately to this Class.'
    :state.reviewOnly?'Browse questions and published Teacher replies from this Class.':'Like raising your hand in a real Class: ask one question and return to the lesson. Your request will not interrupt protected activities.'));
  if(kind==='notebook'){
    const list=$('div','tc-sheet-notes');
    const items=state.snapshot.notebook||[];
    if(!items.length)list.append($('p','tc-sheet-help','You have not saved notes for this Class yet.'));
    items.forEach(item=>{const note=add($('article','tc-sheet-note'),$('small','',item.source_ref?'Linked classroom note':item.source_kind==='BOARD_REFERENCE'?'Saved from Board':'Personal note'),$('p','',item.content||''));if(item.source_ref&&remodeledView)note.append(button('Open linked passage',()=>{closeSheet();remodeledView?.navigateReference(item.source_ref);},'tc-mini-action'));list.append(note);});
    dialog.append(list);
    if(state.snapshot.notebookAllowed&&!state.reviewOnly){
      const form=$('form','tc-sheet-form');
      const input=$('textarea');input.rows=5;input.maxLength=10000;input.placeholder='Write what you want to remember…';input.setAttribute('aria-label','Notebook entry');
      const status=$('p','tc-sheet-status');status.setAttribute('role','status');
      const save=button('Save note',()=>{},'tc-button tc-button--solid');save.type='submit';
      const cancel=button('Cancel',()=>closeSheet(),'tc-button tc-button--quiet');
      form.addEventListener('submit',async(event)=>{
        event.preventDefault();
        const content=input.value.trim();
        if(!content){status.textContent='Write something before saving.';return;}
        if(save.disabled)return;
        const classId=state.classId;state.sheetKey ||= crypto.randomUUID();
        const key=state.sheetKey;
        state.sheetBusy=true;save.disabled=cancel.disabled=true;input.readOnly=true;status.textContent='Saving note…';
        try{
          await kiwiApiRequest('/teaching/classes/'+encodeURIComponent(classId)+'/notebook',{method:'POST',body:{content,idempotencyKey:key}});
          if(classId===state.classId){state.sheetBusy=false;closeSheet();await fetchSnapshot().catch(()=>{});}
        }catch(error){status.textContent=error.message||'Could not confirm saving. Retry safely with the same note.';}
        finally{state.sheetBusy=false;save.disabled=cancel.disabled=false;input.readOnly=false;syncSheet();}
      });
      form.append(input,status,add($('div','tc-sheet-footer'),cancel,save));dialog.insertBefore(form,list);
      window.queueMicrotask(()=>{if(state.sheet===shade)input.focus({preventScroll:true});});
    }else dialog.append($('p','tc-sheet-help',state.reviewOnly?'This is a past Class record. You can review notes here, but you cannot change the historical record.':'Notes are read-only during this protected activity.'));
  }else{
    const log=$('div','tc-conversation');log.setAttribute('role','log');log.setAttribute('aria-label','Teacher message history');
    const limits=$('p','tc-sheet-help tc-teacher-limits');
    const form=$('form','tc-sheet-form tc-teacher-form');
    const input=$('textarea');input.rows=4;input.maxLength=2000;input.placeholder='What part of the lesson do you need help with?';input.setAttribute('aria-label','Your question for the Teacher');
    const status=$('p','tc-sheet-status');status.setAttribute('role','status');
    const send=button('Raise hand',()=>{},'tc-button tc-button--solid');send.type='submit';
    const cancel=button('Cancel',()=>closeSheet(),'tc-button tc-button--quiet');
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const body=input.value.trim(),kind='NEED_HELP';
      if(!body){status.textContent='Write a message before sending.';return;}
      if(!state.snapshot?.teacherMessagingAllowed||state.reviewOnly){status.textContent='Messaging is not permitted in this Class state.';return;}
      if(send.disabled)return;
      const classId=state.classId;state.sheetKey ||= crypto.randomUUID();
      const key=state.sheetKey;
      state.sheetBusy=true;send.disabled=cancel.disabled=true;input.readOnly=true;status.textContent='Raising hand…';
      try{
        const result=await kiwiApiRequest('/teaching/classes/'+encodeURIComponent(classId)+'/interactions',{method:'POST',body:{kind,body,idempotencyKey:key}});
        if(classId===state.classId){
          input.value='';state.sheetKey=null;
          status.textContent=result.status==='HELP_RAISED'?'Your hand is raised. KIWI will decide whether to answer, defer, or redirect without interrupting the lesson.':'Question recorded. Replies are only published after Teacher validation.';
          await fetchSnapshot();
        }
      }catch(error){status.textContent=error.message||'Delivery unconfirmed. Retry to send the same message safely.';}
      finally{state.sheetBusy=false;send.disabled=cancel.disabled=false;input.readOnly=false;syncSheet();}
    });
    form.append(input,status,add($('div','tc-sheet-footer'),cancel,send));
    dialog.append(log,limits,form);
    window.queueMicrotask(()=>{if(state.sheet===shade)(form.hidden?dialog.querySelector('.tc-sheet-close'):input).focus({preventScroll:true});});
  }
  shade.append(backdrop,dialog);
  state.sheet=shade;state.sheetKind=kind;state.sheetFocus=trigger;
  const root=state.host.querySelector('.tc-shell');if(root)root.inert=true;
  state.host.append(shade);
  syncSheet();
}
function renderSummary(s){const section=$('section','tc-after');add(section,$('div','tc-eyebrow','AFTER CLASS'),$('h2','','What stays with you'));
  if(s.summary?.state==='TRANSLATED'&&s.summary.payload?.student_summary)section.append($('p','tc-summary-text',s.summary.payload.student_summary));
  else if(s.closureFacts){section.append(notice('Class record saved','The academic record is secure. A student-facing narrative is pending its qualified translation route.'));const list=$('ul','tc-fact-list');s.closureFacts.facts.forEach((f)=>{if(f.semantic_key==='completed_objective_refs'||f.semantic_key==='unfinished_core_objective_refs'){list.append(add($('li',''),$('strong','',f.semantic_key==='completed_objective_refs'?'Completed objectives':'Carried forward'),$('span','',Array.isArray(f.effective_state)?f.effective_state.join(', ')||'None':'—')));}});section.append(list);}
  else section.append(notice('Summary pending','The Class will leave an official record when it closes.'));
  const artifacts=add($('div','tc-artifacts'),$('span','','Board history where permitted'),$('span','','Your Notebook'),$('span','','Linked Work when available'));
  if(Array.isArray(s.teacherConversation)&&s.teacherConversation.length)section.append(button('Review raised-hand questions',()=>openSheet('teacher'),'tc-button tc-button--soft'));
  if(s.summary?.payload?.transcript_url){const link=document.createElement('a');link.className='tc-artifact-link';link.href=s.summary.payload.transcript_url;link.textContent='Full transcript · secondary record';link.setAttribute('aria-label','Open full transcript as a secondary class artifact');artifacts.append(link);}
  section.append(artifacts);return section;}
function render(){
  const expandedKind=state.expanded?.kind,expandedScroll=state.expanded?.panel.scrollTop,readingScroll=state.host?.scrollTop||0;
  const previousWorkspace=state.host?.querySelector('#tc-panel-workspace textarea');
  const draft=previousWorkspace?{value:previousWorkspace.value,authority:previousWorkspace.dataset.authority,focused:document.activeElement===previousWorkspace,start:previousWorkspace.selectionStart,end:previousWorkspace.selectionEnd}:null;
  const s=state.snapshot;if(!s||!state.host)return;
  // A protected activity cannot inherit an already-open Notebook or Teacher sheet.
  // Close it before the refreshed Class DOM is made visible.
  if(['ASSESSMENT','CLASSWORK'].includes(s.modeKey)&&state.sheet)closeSheet({restore:false,force:true});
  if(s.classroomEngine==='CLASSROOM_V1'&&!['ASSESSMENT','CLASSWORK'].includes(s.modeKey)){
    if(remodeledView){remodeledView.update(s);return;}
    if(!remodeledLoading){const host=state.host,classId=state.classId;
      remodeledLoading=import('./classroom/classroom-view.js').then(({mountClassroomView})=>{
        if(state.host!==host||state.classId!==classId||state.snapshot?.classroomEngine!=='CLASSROOM_V1'||['ASSESSMENT','CLASSWORK'].includes(state.snapshot.modeKey))return;
        remodeledView=mountClassroomView({host,classId,legacy:state.snapshot,reviewOnly:state.reviewOnly,api:kiwiApiRequest,transport:window.KIWI_API_CLIENT.classroomTransport,renderBoard:renderBlock,openNotebook:()=>openSheet('notebook'),onClose:()=>close(),onTechnical:()=>act('interactions',{kind:'TECHNICAL_ISSUE'}),onLeave:()=>renderHeader(state.snapshot).querySelector('[data-leave-class]')?.click(),onProtected:()=>{remodeledView?.close();remodeledView=null;clearVisualLoads();clearSelectionNote();closeSheet({restore:false,force:true});fetchAfterAction().catch(()=>{});}});
      }).catch(()=>connectionFeedback('Classroom view could not load. Reconnect to retry.')).finally(()=>{remodeledLoading=null;});
    }return;
  }
  if(remodeledView){remodeledView.close();remodeledView=null;}
  collapsePanel({restore:false});clearVisualLoads();
  const root=$('div','tc-shell');root.dataset.mode=s.modeKey;
  root.append(renderHeader(s));const body=$('main','tc-layout');
  const left=$('div','tc-layout__main');left.append(renderTeacher(s));
  if(s.modeKey==='PRE_CLASS'){left.append(notice('Upcoming Class',`Scheduled for ${date(s.class.scheduledStartAt)}. Expected duration: ${Math.round((new Date(s.class.scheduledEndAt)-new Date(s.class.scheduledStartAt))/60000)} minutes.`,'tc-preclass'));}
  if(s.modeKey==='UNSTARTED_PAST')left.append(notice('Past Class — no live lesson','This timetable slot ended without a started Class. Review it in Past Classes rather than treating it as an upcoming lesson.'));
  if(s.modeKey==='INTERRUPTED')left.append(notice('Your place is saved',s.interruption?.cause==='SYSTEM'?'KIWI interrupted the Class. This will not count as negative academic evidence.':'Return to this Class when the session resumes. The Controller will reassess the remaining time.','tc-error'));
  const selectTab=(tab)=>{state.tab=tab;render();state.host?.querySelector(`[data-classroom-tab="${tab}"]`)?.focus();};const tabs=['board','workspace'].map((tab)=>{const b=button(tab[0].toUpperCase()+tab.slice(1),()=>selectTab(tab),state.tab===tab?'is-active':'');b.dataset.classroomTab=tab;b.setAttribute('role','tab');b.setAttribute('aria-selected',state.tab===tab?'true':'false');b.setAttribute('aria-controls',`tc-panel-${tab}`);b.tabIndex=state.tab===tab?0:-1;return b;});
  const mobileNav=add($('div','tc-mobile-tabs'),...tabs);mobileNav.setAttribute('role','tablist');mobileNav.setAttribute('aria-label','Classroom areas');left.append(mobileNav);
  const board=renderBoard(s);board.id='tc-panel-board';board.setAttribute('role','tabpanel');board.classList.toggle('tc-mobile-hidden',state.tab!=='board');left.append(board);
  const work=renderWorkspace(s);work.id='tc-panel-workspace';work.setAttribute('role','tabpanel');work.classList.toggle('tc-mobile-hidden',state.tab!=='workspace');
  if(!state.reviewOnly&&s.controlsEnabled){const actions=work.querySelector('.tc-workspace__actions')||$('div','tc-workspace__actions');[['Request short break','BREAK_REQUEST'],['Request early dismissal','EARLY_DISMISSAL_REQUEST'],['Report technical issue','TECHNICAL_ISSUE']].forEach(([label,kind])=>actions.append(button(label,()=>act('interactions',{kind}),'tc-button tc-button--quiet')));if(!actions.parentNode)work.append(actions);}
  const answer=work.querySelector('textarea');if(answer){answer.dataset.authority=JSON.stringify([state.classId,s.modeKey,s.learningUnitId,s.controller?.stateVersion]);if(draft?.authority===answer.dataset.authority)answer.value=draft.value;}
  const right=add($('aside','tc-layout__side'),work);
  add(body,left,right);root.append(body);if(s.controller?.lifecycleState==='CLOSED')root.append(renderSummary(s));
  const corner=$('div','tc-corner-actions');
  if(s.teacherMessagingAllowed&&['OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','REMEDIATION'].includes(s.modeKey)&&!state.reviewOnly){
    const raised=(s.helpRequests||[])[0];
    const hand=button('✋ NEED HELP?',()=>openSheet('teacher'),'tc-raise-hand');
    // Narrow edge tab by default; the full label is available on hover or
    // keyboard focus. Touch users can tap the narrow tab directly.
    hand.innerText='';
    const icon=$('span','tc-raise-hand__icon','✋'),label=$('span','tc-raise-hand__label','NEED HELP?');
    icon.setAttribute('aria-hidden','true');label.setAttribute('aria-hidden','true');
    hand.append(icon,label);
    if(raised){hand.dataset.helpStatus=raised.status;hand.title='Latest raised hand: '+raised.status.toLowerCase();}
    hand.title='Raise your hand to ask the Teacher a question';
    hand.setAttribute('aria-label','Raise your hand to request help');
    root.append(hand);
  }
  if(s.modeKey!=='ASSESSMENT'&&s.modeKey!=='CLASSWORK'){
    const note=button('✎',()=>openSheet('notebook'),'tc-corner-button');note.title='Notebook';note.setAttribute('aria-label','Open Notebook');
    corner.append(note);
  }
  root.append(corner);
  const message=$('div','tc-message');message.setAttribute('role','alert');const connection=$('div','tc-connection');
  connection.setAttribute('role','status');connection.setAttribute('aria-live','polite');
  if(state.connectionMessage)connection.append($('span','',state.connectionMessage));
  if(state.joinNeedsConfirmation&&!s.hasEntered&&!state.reviewOnly&&s.controller?.lifecycleState==='ACTIVE'){
    const retry=button('Check / Retry Join',()=>joinCurrentClass(state.classId,state.host),'tc-button tc-button--soft');
    retry.setAttribute('aria-label','Safely retry the idempotent classroom JOIN confirmation');
    connection.append(retry);
  }
  root.append(message,connection);
  if(state.sheet){
    // Replace only the Class subtree. Detaching an active sheet would blur the
    // student's focused textarea every time the 12-second snapshot refreshes.
    const previous=state.host.querySelector('.tc-shell');
    if(previous)previous.replaceWith(root);else state.host.prepend(root);
    root.inert=true;syncSheet();
  }else state.host.replaceChildren(root);
  // Replacing the DOM must not bounce mobile readers to the start of a long
  // Board or reset the manually selected scene during live polling.
  state.host.scrollTop=readingScroll;
  if(expandedKind&&!state.sheet){expandPanel(expandedKind);if(state.expanded)state.expanded.panel.scrollTop=expandedScroll;}
  if(answer&&draft?.focused&&draft.authority===answer.dataset.authority){answer.focus({preventScroll:true});answer.setSelectionRange(draft.start,draft.end);}
  updateClocks();
}
async function renderCourse({course,container,adminPreview=false}){
  const page=$('section','tc-course');
  add(page,$('div','tc-eyebrow',adminPreview?'ADMIN / EXISTING CLASSROOM':'COURSE / CLASSROOM'),$('h2','',adminPreview?((course.title||'KIWI')+' classroom'):'Enter the classroom'),$('p','',adminPreview?'Preview scheduled Classes without joining. Enter a live Class only when it opens; entering records real attendance.':'Upcoming lessons are here. Past attendance stays in a separate history panel.'));
  const status=$('div','tc-classroom-sync');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const content=$('div','tc-classroom-classes');
  const refreshButton=button('↻ Refresh',()=>refresh(),'tc-button tc-button--quiet');
  const historyButton=button('Past Classes',()=>showHistory(),'tc-button tc-button--quiet tc-history-tab');
  const actions=add($('div','tc-course-actions'),refreshButton,historyButton);
  page.append(actions,status,content);container.append(page);
  historyButton.setAttribute('aria-label','Open past Classes');historyButton.title='Review past classes';
  const historyCount=$('span','tc-history-tab-count','0');historyButton.append(historyCount);
  const historyDialog=$('dialog','tc-history-dialog');
  const historyHead=add($('div','tc-history-heading'),add($('div',''),$('div','tc-eyebrow','CLASS HISTORY'),$('h2','','Past Classes')),button('×',()=>historyDialog.close(),'tc-sheet-close'));
  const historyContent=$('div','tc-history-content');
  historyDialog.append(historyHead,historyContent);page.append(historyDialog);
  historyDialog.addEventListener('close',()=>{if(historyButton.isConnected&&!document.body.classList.contains('tc-active'))historyButton.focus({preventScroll:true});});
  historyDialog.addEventListener('click',event=>{if(event.target===historyDialog)historyDialog.close();});
  let fetching=false,loaded=false,pastRows=[],identity={};
  const labels={ON_TIME:'Attended',LATE:'Late',PARTIAL:'Partially attended',UNEXCUSED_ABSENCE:'Missed',EXCUSED_ABSENCE:'Excused',APPROVED_LEAVE:'Approved leave',SYSTEM_PROTECTED:'System protected',INTERRUPTED:'Interrupted',PENDING:'Attendance pending',RESCHEDULED:'Rescheduled',NO_OBLIGATION:'No obligation'};
  function drawHistory(){
    const body=$('div','tc-history-list');
    if(!pastRows.length)body.append(notice('No past Classes','Completed lessons and attendance records will appear here.'));
    pastRows.forEach(item=>{
      const code=String(item.attendance_outcome||'PENDING').toUpperCase();
      const name=labels[code]||code.toLowerCase().replaceAll('_',' ');
      const details=(item.historical_unstarted?'No lesson or attendance record':name)+(Number(item.missed_minutes)>0?' · '+item.missed_minutes+' min missed':'');
      const review=button('Review Class',()=>{
        historyDialog.close();
        open(item.class_id,{reviewOnly:true});
      },'tc-button tc-button--quiet');
      body.append(add($('article','tc-history-card'),add($('div',''),$('small','',date(item.scheduled_start_at)),$('strong','',identity.course_title||course.title||'Course'),$('p','',details)),review));
    });
    historyContent.replaceChildren(body);
  }
  function showHistory(){
    drawHistory();if(!historyDialog.open)historyDialog.showModal();
    historyDialog.querySelector('.tc-sheet-close')?.focus({preventScroll:true});
  }
  async function refresh(){
    if(!page.isConnected||fetching)return;
    fetching=true;refreshButton.disabled=true;
    try{
      const data=await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/classes');
      if(!page.isConnected)return;
      identity=data.course||{};
      const upcoming=Array.isArray(data.upcoming)?data.upcoming:(data.classes||[]);
      pastRows=Array.isArray(data.history)?data.history:[];
      historyCount.textContent=String(pastRows.length);
      historyButton.setAttribute('aria-label','Open past Classes ('+pastRows.length+')');
      const list=$('div','tc-classroom-groups');
      if(upcoming.length){
        list.append($('h3','tc-list-heading','Upcoming Classes'));
        const cards=$('div','tc-class-list');
        upcoming.forEach(item=>{
          const minutes=Math.round((Date.parse(item.scheduled_end_at)-Date.parse(item.scheduled_start_at))/60000);
          const enter=button(item.can_enter?'Enter Classroom ↗':'Not started yet',()=>open(item.class_id),'tc-button tc-button--solid');
          enter.disabled=!item.can_enter;
          if(!item.can_enter){
            enter.title='Classroom opens at the scheduled start time';
            enter.setAttribute('aria-label','Classroom available from '+date(item.entry_opens_at||item.scheduled_start_at));
          }
          const statusLine=item.can_enter?'You can enter now':'Opens '+date(item.entry_opens_at||item.scheduled_start_at);
          const controls=adminPreview?add($('div','tc-class-actions'),button('Preview · Read only',()=>open(item.class_id,{reviewOnly:true}),'tc-button tc-button--quiet'),enter):enter;
          cards.append(add($('article','tc-class-card'),
            add($('div',''),$('small','',date(item.scheduled_start_at)),$('h3','',identity.course_title||course.title||'Course'),$('p','',(identity.teacher_name||'KIWI Teacher')+' · '+minutes+' min'),$('span','tc-class-availability',statusLine)),
            controls));
        });
        list.append(cards);
      }else list.append(notice('No upcoming Classes','Your future lessons will appear here when scheduled.'));
      content.replaceChildren(list);loaded=true;
      if(historyDialog.open)drawHistory();
      status.textContent='Classes updated · '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    }catch(error){
      if(!page.isConnected)return;
      status.textContent='Could not refresh Classes. Try again when connected.';
      if(!loaded)content.replaceChildren(notice('Classes unavailable',error.message||'Try again.','tc-error'));
    }finally{fetching=false;refreshButton.disabled=false;}
  }
  await refresh();
  const onVisible=()=>{if(page.isConnected&&document.visibilityState==='visible')refresh();};
  document.addEventListener('visibilitychange',onVisible);window.addEventListener('focus',onVisible);
  const timer=window.setInterval(()=>{
    if(!page.isConnected){window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible);if(historyDialog.open)historyDialog.close();return;}
    if(document.visibilityState==='visible'&&!historyDialog.open)refresh();
  },30000);
}
courses.registerSection({id:'classroom',label:'Classroom',order:45,render:renderCourse,openClassroom:open,renderSummary:async({course,container})=>{
  const card=add($('div','tc-course-summary'),$('div','tc-eyebrow','CLASSROOM'),$('h3','','The lesson has a place'),$('p','','Enter a scheduled Class to see the Board, your work and your Notebook.'));
  card.append(button('View Classes',()=>courses.openSection?.('classroom'),'tc-button tc-button--soft'));container.append(card);
}});
