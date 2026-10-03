(function initAssessmentShell(window) {
'use strict';

const api=window.KIWI_API_CLIENT?.kiwiApiRequest;
const core=window.KIWI_ASSESSMENT_SHELL_CORE;
if(typeof api!=='function'||!core)throw new Error('KIWI Assessment Shell requires the shared API client and D18 renderer contract.');

const qs=new URLSearchParams(window.location.search);
const params={
  assessmentId:qs.get('assessmentId'),
  packageId:qs.get('packageId'),
  attemptId:qs.get('attemptId'),
  returnPath:qs.get('returnPath')||'/teaching.html',
};
const uid=()=>window.crypto?.randomUUID?.()||`d18-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const encode=(v)=>encodeURIComponent(String(v));
const byId=(id)=>document.getElementById(id);
const els={
  app:byId('assessmentApp'),loading:byId('loadingView'),launch:byId('launchView'),workspace:byId('workspaceView'),returnLink:byId('returnLink'),launchReturn:byId('launchReturn'),deviceReturn:byId('deviceReturn'),
  launchMeta:byId('launchMeta'),launchTools:byId('launchTools'),start:byId('startAttemptButton'),mode:byId('assessmentModePill'),save:byId('saveState'),timer:byId('timer'),timerValue:byId('timerValue'),
  questionGrid:byId('questionGrid'),questionPosition:byId('questionPosition'),questionMarks:byId('questionMarks'),flag:byId('flagButton'),prompt:byId('questionPrompt'),source:byId('sourcePanel'),response:byId('responseLayer'),inlineSave:byId('inlineSaveState'),itemBanner:byId('itemStateBanner'),
  previous:byId('previousButton'),next:byId('nextButton'),review:byId('reviewButton'),navigatorOpen:byId('navigatorOpen'),navigatorClose:byId('navigatorClose'),
  toolsButton:byId('toolsButton'),toolsPanel:byId('toolsPanel'),toolsList:byId('toolsList'),reviewDialog:byId('reviewDialog'),reviewClose:byId('reviewClose'),reviewSummary:byId('reviewSummary'),reviewItems:byId('reviewItems'),submitWarning:byId('submitWarning'),returnQuestions:byId('returnToQuestionsButton'),submit:byId('submitAttemptButton'),
  deviceDialog:byId('deviceDialog'),transfer:byId('transferDeviceButton'),report:byId('reportButton'),reportDialog:byId('reportDialog'),reportForm:byId('reportForm'),reportText:byId('reportText'),reportClose:byId('reportClose'),reportCancel:byId('reportCancel'),network:byId('networkBanner'),toasts:byId('toastRegion'),a11yStatus:byId('assessmentA11yStatus'),
};

const DEVICE_KEY='kiwi_assessment_device_id';
const getDevice=()=>{let value=localStorage.getItem(DEVICE_KEY);if(!value){value=uid();localStorage.setItem(DEVICE_KEY,value);}return value;};
const state={
  deviceId:getDevice(), package:null, items:[], attempt:null, responses:new Map(), drafts:new Map(), saveStates:new Map(), viewed:new Set(), flagged:new Set(), activeIndex:0,
  serverOffsetMs:0, timerHandle:null, saveTimers:new Map(), queued:new Map(), replaying:false, submitting:false, readOnly:false, maxUnlocked:0, timerAnnouncements:new Set(),
};

function toast(message){const n=document.createElement('div');n.className='toast';n.textContent=String(message);els.toasts.append(n);window.setTimeout(()=>n.remove(),3600);}
function announce(message){if(!els.a11yStatus)return;els.a11yStatus.textContent='';window.requestAnimationFrame(()=>{els.a11yStatus.textContent=String(message||'');});}
function showDialog(dialog){if(!dialog.open)dialog.showModal();}
function closeDialog(dialog){if(dialog.open)dialog.close();}
function setSaveState(kind,label){els.save.dataset.state=kind;els.save.textContent=label;}
function setNetwork(message=null){els.network.hidden=!message;els.network.textContent=message||'';}
function show(view){els.loading.hidden=view!=='loading';els.launch.hidden=view!=='launch';els.workspace.hidden=view!=='workspace';els.app.setAttribute('aria-busy',view==='loading'?'true':'false');}
function safeJson(value){try{return JSON.stringify(value);}catch{return '{}';}}
function returnLinks(){for(const a of [els.returnLink,els.launchReturn,els.deviceReturn])a.href=params.returnPath;}
function attemptKey(suffix){return `kiwi:d18:${params.attemptId||'pending'}:${suffix}`;}
function draftKey(itemId){return attemptKey(`draft:${itemId}`);}
function queueKey(){return attemptKey('queue');}
function flagsKey(){return attemptKey('flags');}
function readLocal(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch{return fallback;}}
function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function removeLocal(key){try{localStorage.removeItem(key);}catch{}}
function serverVersion(itemId){return Number(state.responses.get(itemId)?.response_version||0);}
function currentItem(){return state.items[state.activeIndex]||null;}
function currentDraft(item=currentItem()){return item?state.drafts.get(item.package_item_id)||core.emptyDraft(item.renderer):null;}
function savePosture(itemId){return state.saveStates.get(itemId)||{kind:serverVersion(itemId)>0?'saved':'idle',label:serverVersion(itemId)>0?`Saved · v${serverVersion(itemId)}`:'Not answered'};}
function isItemUnavailable(item){return item?.renderer?.invalid||item?.renderer?.retired;}

function persistFlags(){writeLocal(flagsKey(),Array.from(state.flagged));}
function restoreFlags(){state.flagged=new Set(readLocal(flagsKey(),[]).map(String).filter((id)=>state.items.some((i)=>i.package_item_id===id)));}
function loadQueue(){const rows=readLocal(queueKey(),[]);state.queued=new Map(rows.map((row)=>[String(row.packageItemId),row]));}
function persistQueue(){writeLocal(queueKey(),Array.from(state.queued.values()));}

function packageModeLabel(){const mode=String(state.package?.response_form_architecture?.mode||'mixed').replaceAll('_',' ');return mode.replace(/^./,(m)=>m.toUpperCase());}
function renderTools(target=els.toolsList){target.replaceChildren();const tools=state.package?.allowed_tools||[];if(!tools.length){const p=document.createElement('div');p.className='tools-list__item';p.textContent='No additional tools are permitted by this package.';target.append(p);return;}for(const tool of tools){const n=document.createElement('div');n.className=target===els.toolsList?'tools-list__item':'tool-chip';n.textContent=tool.label;target.append(n);}}

async function loadPackage(){
  if(!params.packageId)throw new Error('Assessment Package ID is missing from the handoff.');
  const data=await api(`/teaching/assessment-shell/packages/${encode(params.packageId)}`);
  state.package=data.package;state.items=data.items||[];state.serverOffsetMs=Date.parse(data.serverNow)-Date.now();
  core.assertBrowserSafe(data);
  els.mode.textContent=packageModeLabel();
  els.launchMeta.replaceChildren();
  const adjusted=Number(state.package?.accommodation_policy?.extra_time_percent||0)>0;
  const facts=[['Questions',state.items.length],['Duration',adjusted?'Approved timer setting':`${state.package.duration_minutes} min`],['Navigation',state.package.navigation?.freeNavigation?'Free navigation':'Sequential']];
  for(const [label,value] of facts){const box=document.createElement('div');box.className='launch-meta__item';const s=document.createElement('span');s.textContent=label;const b=document.createElement('strong');b.textContent=String(value);box.append(s,b);els.launchMeta.append(box);}
  renderTools(els.launchTools);renderTools();
  show('launch');setSaveState('loading','Not started');
}

async function startAttempt(){
  if(!params.assessmentId||!params.packageId)return toast('Assessment handoff is incomplete.');
  els.start.disabled=true;els.start.textContent='Starting…';
  try{
    const result=await api(`/teaching/assessments/${encode(params.assessmentId)}/attempts`,{method:'POST',body:{packageId:params.packageId,deviceId:state.deviceId,deviceSessionNonce:uid(),idempotencyKey:`d18-start:${params.assessmentId}:${params.packageId}:${state.deviceId}`}});
    params.attemptId=result.attempt?.assessment_attempt_id;
    if(!params.attemptId)throw new Error('Server did not return an Assessment Attempt.');
    const url=new URL(window.location.href);url.searchParams.set('attemptId',params.attemptId);history.replaceState(null,'',url);
    await loadWorkspace({activateIntegrity:true});
  }catch(error){toast(error.message||'Could not start the assessment.');els.start.disabled=false;els.start.textContent='Begin assessment';}
}

function protectedError(error){return ['TEACHING_D17_DEVICE_MISMATCH','TEACHING_D17_ATTEMPT_NOT_ACTIVE','TEACHING_D17_ATTEMPT_EXPIRED'].includes(error?.code);}

async function loadWorkspace({activateIntegrity=false,replay=true}={}){
  if(!params.attemptId)throw new Error('Assessment Attempt ID is missing.');
  const data=await api(`/teaching/assessment-shell/attempts/${encode(params.attemptId)}?deviceId=${encode(state.deviceId)}`);
  core.assertBrowserSafe(data);
  state.attempt=data.attempt;state.package=data.package;state.items=data.items||[];state.responses=new Map((data.responses||[]).map((r)=>[String(r.package_item_id),r]));state.serverOffsetMs=Date.parse(data.serverNow)-Date.now();state.readOnly=Boolean(data.attempt.read_only);
  restoreFlags();loadQueue();reconcileDrafts();deriveUnlocked();
  els.mode.textContent=state.readOnly?'Review mode':packageModeLabel();renderTools();show('workspace');
  if(state.attempt.device_authority==='MISMATCH'&&!state.readOnly){setSaveState('conflict','Another device is active');showDialog(els.deviceDialog);}else closeDialog(els.deviceDialog);
  renderAll();startTimer();
  if(activateIntegrity&&!state.readOnly)activateIntegrityGuard();
  if(replay&&navigator.onLine&&state.attempt.device_authority==='MATCH'&&!state.readOnly)await replayQueue();
  return data;
}

function reconcileDrafts(){
  state.drafts=new Map();state.saveStates=new Map();
  for(const item of state.items){
    const id=String(item.package_item_id),server=state.responses.get(id),serverPayload=server?.renderer_payload||{},base=Number(server?.response_version||0);
    let draft=core.restoreDraft(item.renderer,serverPayload);
    const local=readLocal(draftKey(id),null);
    const queued=state.queued.get(id);
    if(local&&Number(local.baseVersion)===base&&!state.readOnly){draft=core.restoreDraft(item.renderer,local.payload);state.saveStates.set(id,{kind:queued?'offline':'dirty',label:queued?'Saved locally · waiting to sync':'Unsaved changes'});}
    else if(local&&Number(local.baseVersion)!==base){removeLocal(draftKey(id));state.queued.delete(id);}
    else if(server)state.saveStates.set(id,{kind:'saved',label:`Saved · v${base}`});
    state.drafts.set(id,draft);
  }
  persistQueue();
}

function deriveUnlocked(){
  if(state.package?.navigation?.freeNavigation){state.maxUnlocked=Math.max(0,state.items.length-1);return;}
  let firstOpen=0;
  for(let i=0;i<state.items.length;i++){
    const item=state.items[i];const c=isItemUnavailable(item)?'ANSWERED':core.completion(item.renderer,state.drafts.get(item.package_item_id));
    if(c==='UNANSWERED'||c==='PARTIAL'){firstOpen=i;break;}firstOpen=Math.min(i+1,state.items.length-1);
  }
  state.maxUnlocked=firstOpen;
}

function canNavigate(index){return Boolean(state.package?.navigation?.freeNavigation)||index<=state.maxUnlocked;}
function navigate(index){
  index=Math.max(0,Math.min(state.items.length-1,index));if(!canNavigate(index))return toast('This package uses sequential navigation. Complete the current required response before moving ahead.');
  state.activeIndex=index;const item=currentItem();if(item)state.viewed.add(item.package_item_id);renderAll();els.prompt.focus({preventScroll:true});announce(`Question ${index+1} of ${state.items.length}`);
}

function navState(item){return core.questionState({viewed:state.viewed.has(item.package_item_id),flagged:state.flagged.has(item.package_item_id),descriptor:item.renderer,draft:state.drafts.get(item.package_item_id)});}
function renderNavigator(){
  els.questionGrid.replaceChildren();
  state.items.forEach((item,index)=>{const s=navState(item),b=document.createElement('button');b.type='button';b.className='question-nav-button';b.textContent=String(index+1);b.dataset.active=index===state.activeIndex?'true':'false';b.dataset.state=s.completion.toLowerCase();b.dataset.flagged=s.flagged?'true':'false';b.disabled=!canNavigate(index);b.setAttribute('aria-label',`Question ${index+1}: ${s.label.toLowerCase()}`);if(index===state.activeIndex)b.setAttribute('aria-current','step');b.addEventListener('click',()=>{navigate(index);document.body.dataset.navigatorOpen='false';els.navigatorOpen.setAttribute('aria-expanded','false');});els.questionGrid.append(b);});
}

function writingPolicy(input){
  const policy=state.package?.resource_policy||{};input.autocomplete='off';input.setAttribute('autocapitalize','off');
  input.spellcheck=policy.spellcheck!==false;input.setAttribute('spellcheck',policy.spellcheck===false?'false':'true');
  if(policy.autocorrect===false)input.setAttribute('autocorrect','off');
  if(policy.paste===false)input.addEventListener('paste',(event)=>{event.preventDefault();toast('Paste is disabled by this Assessment Package.');});
}
function label(textValue,forId=null){const n=document.createElement('label');n.className='response-label';n.textContent=textValue;if(forId)n.htmlFor=forId;return n;}
function inputText(className,value,readOnly,onInput,{rows=null,placeholder=''}={}){const el=rows?document.createElement('textarea'):document.createElement('input');el.className=className;el.value=value??'';el.placeholder=placeholder;el.readOnly=readOnly;writingPolicy(el);el.addEventListener('input',()=>onInput(el.value));return el;}

function renderRenderer(descriptor,draft,host,onChange,readOnly){
  host.replaceChildren();
  const disabled=readOnly||descriptor.invalid||descriptor.retired;
  if(disabled&&readOnly&&descriptor.kind!=='mcq'&&descriptor.kind!=='multi_part'&&descriptor.kind!=='math_working'&&descriptor.kind!=='numeric_unit'){
    const value=core.restoreDraft(descriptor,draft);const box=document.createElement('div');box.className='read-only-response';box.textContent=value.text||'No response saved.';host.append(box);return;
  }
  if(descriptor.kind==='mcq'){
    const box=document.createElement('div');box.className='mcq-list';const restored=core.restoreDraft(descriptor,draft);const selected=new Set(restored.selected_option_ids);
    for(const option of descriptor.options){const b=document.createElement('button');b.type='button';b.className='mcq-option';b.dataset.selected=selected.has(option.id)?'true':'false';b.dataset.multiple=descriptor.selectionMode==='multiple'?'true':'false';b.disabled=disabled;const mark=document.createElement('span');mark.className='mcq-option__marker';mark.textContent=selected.has(option.id)?'✓':'';const textNode=document.createElement('span');textNode.textContent=option.text;b.append(mark,textNode);b.addEventListener('click',()=>{if(disabled)return;const next=new Set(selected);if(descriptor.selectionMode==='single'){next.clear();next.add(option.id);}else if(next.has(option.id))next.delete(option.id);else next.add(option.id);onChange({selected_option_ids:Array.from(next)});});box.append(b);}host.append(box);return;
  }
  if(descriptor.kind==='short'){
    const restored=core.restoreDraft(descriptor,draft);host.append(inputText('response-field',restored.text,disabled,(v)=>onChange({text:v}),{placeholder:'Type your response'}));return;
  }
  if(descriptor.kind==='extended'||descriptor.kind==='essay'){
    const restored=core.restoreDraft(descriptor,draft),wrap=document.createElement('div');const area=inputText(`response-textarea${descriptor.kind==='essay'?' response-textarea--essay':''}`,restored.text,disabled,(v)=>{onChange({text:v});count.textContent=`${wordCount(v)} words`;},{rows:8,placeholder:descriptor.kind==='essay'?'Write your essay response':'Write your response'});const count=document.createElement('div');count.className='word-count';count.textContent=`${wordCount(restored.text)} words`;wrap.append(area,count);host.append(wrap);return;
  }
  if(descriptor.kind==='math_working'){
    const restored=core.restoreDraft(descriptor,draft),wrap=document.createElement('div');wrap.className='math-working';const workId=`work-${descriptor.id}`,finalId=`final-${descriptor.id}`;const work=inputText('math-field',restored.working,disabled,(v)=>onChange({working:v,final_answer:restored.final_answer}),{rows:7,placeholder:'Show your working'});work.id=workId;const final=inputText('response-field math-final',restored.final_answer,disabled,(v)=>onChange({working:restored.working,final_answer:v}),{placeholder:'Final answer'});final.id=finalId;wrap.append(label('Working',workId),work,label('Final answer',finalId),final);host.append(wrap);return;
  }
  if(descriptor.kind==='numeric_unit'){
    const restored=core.restoreDraft(descriptor,draft),wrap=document.createElement('div');wrap.className='numeric-row';const a=document.createElement('div'),b=document.createElement('div');const value=inputText('numeric-input',restored.value,disabled,(v)=>onChange({value:v,unit:restored.unit}),{placeholder:'Value'});const unit=inputText('unit-input',restored.unit,disabled,(v)=>onChange({value:restored.value,unit:v}),{placeholder:'Unit'});a.append(label('Value'),value);b.append(label('Unit'),unit);wrap.append(a,b);host.append(wrap);return;
  }
  if(descriptor.kind==='code'){
    const restored=core.restoreDraft(descriptor,draft),wrap=document.createElement('div');const area=inputText('code-editor',restored.text,disabled,(v)=>onChange({text:v}),{rows:12,placeholder:'Write code here'});area.spellcheck=false;wrap.append(area);const hint=document.createElement('p');hint.className='field-hint';hint.textContent='Code is preserved exactly as typed. KIWI does not invent execution support when the package has not provided it.';wrap.append(hint);host.append(wrap);return;
  }
  if(descriptor.kind==='multi_part'){
    const restored=core.restoreDraft(descriptor,draft),wrap=document.createElement('div');wrap.className='multi-part';for(const part of descriptor.parts){const card=document.createElement('section');card.className='part-card';const head=document.createElement('div');head.className='part-card__header';const badge=document.createElement('span');badge.className='part-label';badge.textContent=part.label;const p=document.createElement('div');p.className='part-prompt';p.textContent=part.prompt;head.append(badge,p);const body=document.createElement('div');renderRenderer(part.renderer,restored.parts[part.partId],body,(next)=>{const current=core.restoreDraft(descriptor,state.drafts.get(currentItem().package_item_id));current.parts[part.partId]=next;onChange(current);},disabled);card.append(head,body);wrap.append(card);}host.append(wrap);return;
  }
  if(descriptor.kind==='visual_reserved'){
    const box=document.createElement('div');box.className='visual-reserved';box.textContent='This locked item requests a visual response type reserved by the Assessment contract. This release will not fake a drawing or OCR capability. The item must be repaired or delivered only when its supported renderer exists.';host.append(box);return;
  }
  const restored=core.restoreDraft(descriptor,draft);host.append(inputText('response-field',restored.text,disabled,(v)=>onChange({text:v}),{placeholder:'Type your response'}));
}
function wordCount(value){const s=String(value||'').trim();return s?s.split(/\s+/).length:0;}

function renderQuestion(){
  const item=currentItem();if(!item)return;
  const descriptor=item.renderer,draft=currentDraft(item),index=state.activeIndex;state.viewed.add(item.package_item_id);
  els.prompt.tabIndex=-1;
  els.questionPosition.textContent=`Question ${index+1} of ${state.items.length}`;els.questionMarks.textContent=`${descriptor.marks} ${descriptor.marks===1?'mark':'marks'}`;els.prompt.textContent=descriptor.prompt||'Question prompt';
  els.flag.setAttribute('aria-pressed',state.flagged.has(item.package_item_id)?'true':'false');els.flag.querySelector('span').textContent=state.flagged.has(item.package_item_id)?'Flagged':'Flag';
  const source=descriptor.source;els.source.hidden=source==null;if(source!=null)els.source.textContent=typeof source==='string'?source:JSON.stringify(source,null,2);
  const unavailable=descriptor.invalid||descriptor.retired;els.itemBanner.hidden=!unavailable;if(unavailable)els.itemBanner.textContent=descriptor.invalid?'This item has been invalidated by the authoritative Assessment owner. Your saved response is preserved; this screen will not invent replacement marking rules.':'This item has been retired as clean future evidence. Your existing response remains visible, but the item is read-only.';
  renderRenderer(descriptor,draft,els.response,(next)=>updateDraft(item,next),state.readOnly||state.attempt?.device_authority==='MISMATCH'||unavailable);
  const posture=savePosture(item.package_item_id);els.inlineSave.textContent=state.readOnly?'Final response snapshot · read only':posture.label;
  els.previous.disabled=index===0;els.next.disabled=index===state.items.length-1||(!state.package.navigation.freeNavigation&&core.completion(descriptor,draft)==='UNANSWERED'&&!unavailable);
  els.flag.disabled=state.readOnly;els.report.disabled=state.readOnly;
}

function renderAll(){renderNavigator();renderQuestion();renderGlobalSave();}
function renderGlobalSave(){
  if(state.readOnly){setSaveState('saved','Final snapshot');return;}
  const values=Array.from(state.saveStates.values());
  if(state.attempt?.device_authority==='MISMATCH'){setSaveState('conflict','Device conflict');return;}
  if(values.some((s)=>s.kind==='conflict')){setSaveState('conflict','Save conflict');return;}
  if(values.some((s)=>s.kind==='offline')){setSaveState('offline','Waiting to sync');return;}
  if(values.some((s)=>s.kind==='saving')){setSaveState('saving','Saving…');return;}
  if(values.some((s)=>s.kind==='dirty')){setSaveState('dirty','Unsaved changes');return;}
  setSaveState('saved','Saved');
}

function updateDraft(item,next){
  if(state.readOnly||state.attempt?.device_authority==='MISMATCH')return;
  const id=String(item.package_item_id),payload=core.canonicalPayload(item.renderer,next),baseVersion=serverVersion(id);state.drafts.set(id,core.restoreDraft(item.renderer,payload));state.saveStates.set(id,{kind:'dirty',label:'Unsaved changes'});
  writeLocal(draftKey(id),{payload,baseVersion,updatedAt:new Date().toISOString()});
  deriveUnlocked();renderNavigator();renderGlobalSave();els.inlineSave.textContent='Unsaved changes';scheduleSave(item);
}

function scheduleSave(item){const id=String(item.package_item_id);clearTimeout(state.saveTimers.get(id));state.saveTimers.set(id,setTimeout(()=>saveItem(item),700));}
function queueSave(item,payload,baseVersion,idempotencyKey=uid()){
  const row={packageItemId:String(item.package_item_id),payload,baseVersion:Number(baseVersion||0),idempotencyKey,clientOccurredAt:new Date().toISOString()};state.queued.set(row.packageItemId,row);persistQueue();state.saveStates.set(row.packageItemId,{kind:'offline',label:'Saved locally · waiting to sync'});setNetwork('Connection interrupted. Your local recovery draft is preserved, but it is not server-saved yet.');renderGlobalSave();return row;
}

async function saveItem(item,{queuedRow=null}={}){
  if(state.readOnly||state.attempt?.attempt_state!=='ACTIVE'||state.attempt?.device_authority!=='MATCH'||isItemUnavailable(item))return;
  const id=String(item.package_item_id),payload=queuedRow?.payload||core.canonicalPayload(item.renderer,state.drafts.get(id)),payloadFingerprint=safeJson(payload),baseVersion=queuedRow?.baseVersion??serverVersion(id),idempotencyKey=queuedRow?.idempotencyKey||uid(),clientOccurredAt=queuedRow?.clientOccurredAt||new Date().toISOString();
  if(!navigator.onLine){queueSave(item,payload,baseVersion,idempotencyKey);renderQuestion();return;}
  state.saveStates.set(id,{kind:'saving',label:'Saving…'});renderGlobalSave();if(currentItem()?.package_item_id===id)els.inlineSave.textContent='Saving…';
  try{
    const result=await api(`/teaching/assessments/attempts/${encode(params.attemptId)}/responses`,{method:'POST',body:{packageItemId:id,response:payload,clientOccurredAt,deviceId:state.deviceId,idempotencyKey}});
    const response=result.response;if(!response)throw new Error('Server did not acknowledge the response.');state.responses.set(id,response);state.queued.delete(id);persistQueue();
    const currentPayload=core.canonicalPayload(item.renderer,state.drafts.get(id));
    if(safeJson(currentPayload)===payloadFingerprint){removeLocal(draftKey(id));state.saveStates.set(id,{kind:'saved',label:`Saved · v${response.response_version}`});}
    else {writeLocal(draftKey(id),{payload:currentPayload,baseVersion:Number(response.response_version||0),updatedAt:new Date().toISOString()});state.saveStates.set(id,{kind:'dirty',label:'New changes not saved'});scheduleSave(item);}
    setNetwork(null);
  }catch(error){
    if(protectedError(error)){state.saveStates.set(id,{kind:'conflict',label:error.code==='TEACHING_D17_DEVICE_MISMATCH'?'Another device is active':'Attempt no longer accepts changes'});if(error.code==='TEACHING_D17_DEVICE_MISMATCH')showDialog(els.deviceDialog);else await loadWorkspace({replay:false});}
    else queueSave(item,payload,baseVersion,idempotencyKey);
  }
  renderGlobalSave();if(currentItem()?.package_item_id===id)renderQuestion();
}

async function replayQueue(){
  if(state.replaying||!state.queued.size||state.readOnly||state.attempt?.device_authority!=='MATCH')return;state.replaying=true;setNetwork('Connection restored. Revalidating server state before syncing local drafts…');
  try{
    const fresh=await api(`/teaching/assessment-shell/attempts/${encode(params.attemptId)}?deviceId=${encode(state.deviceId)}`);state.attempt=fresh.attempt;state.responses=new Map((fresh.responses||[]).map((r)=>[String(r.package_item_id),r]));
    if(state.attempt.attempt_state!=='ACTIVE'||state.attempt.device_authority!=='MATCH'){setNetwork('The server state changed. Local drafts were not forced into the attempt.');return;}
    for(const row of Array.from(state.queued.values())){
      const item=state.items.find((i)=>String(i.package_item_id)===String(row.packageItemId));if(!item)continue;
      if(serverVersion(row.packageItemId)!==Number(row.baseVersion)){state.saveStates.set(row.packageItemId,{kind:'conflict',label:'Server version changed · review required'});continue;}
      await saveItem(item,{queuedRow:row});
    }
    if(!Array.from(state.saveStates.values()).some((s)=>s.kind==='conflict'))setNetwork(null);
  }catch{setNetwork('Reconnect check failed. Local recovery drafts remain on this device and are not yet server-saved.');}
  finally{state.replaying=false;renderAll();}
}

async function flushAll(){
  for(const timer of state.saveTimers.values())clearTimeout(timer);state.saveTimers.clear();
  for(const item of state.items){const posture=savePosture(item.package_item_id);if(['dirty','offline'].includes(posture.kind))await saveItem(item);}
  if(navigator.onLine)await replayQueue();
}

function reviewData(){let answered=0,partial=0,unanswered=0;const rows=state.items.map((item,index)=>{const c=isItemUnavailable(item)?'ANSWERED':core.completion(item.renderer,state.drafts.get(item.package_item_id));if(c==='ANSWERED')answered++;else if(c==='PARTIAL')partial++;else unanswered++;return {item,index,completion:c,flagged:state.flagged.has(item.package_item_id),save:savePosture(item.package_item_id)};});return {rows,answered,partial,unanswered,flagged:rows.filter((r)=>r.flagged).length,uncertain:rows.filter((r)=>['dirty','offline','saving','conflict'].includes(r.save.kind)).length};}
function openReview(){
  const r=reviewData();els.reviewSummary.replaceChildren();for(const [label,value] of [['Answered',r.answered],['Partial',r.partial],['Unanswered',r.unanswered],['Flagged',r.flagged]]){const n=document.createElement('div');n.className='review-stat';const s=document.createElement('span');s.textContent=label;const b=document.createElement('strong');b.textContent=String(value);n.append(s,b);els.reviewSummary.append(n);}
  els.reviewItems.replaceChildren();for(const row of r.rows){const n=document.createElement('button');n.type='button';n.className='review-item';const q=document.createElement('span');q.className='review-item__number';q.textContent=`Q${row.index+1}`;const status=document.createElement('span');status.className='review-item__state';status.textContent=`${row.completion.replace('_',' ')}${row.flagged?' · Flagged':''}`;const save=document.createElement('span');save.className='review-item__save';save.textContent=row.save.label;n.append(q,status,save);n.addEventListener('click',()=>{closeDialog(els.reviewDialog);navigate(row.index);});els.reviewItems.append(n);}
  const warnings=[];if(r.unanswered)warnings.push(`${r.unanswered} unanswered`);if(r.partial)warnings.push(`${r.partial} partially answered`);if(r.uncertain)warnings.push(`${r.uncertain} not fully server-acknowledged`);els.submitWarning.textContent=warnings.length?`Check before final submission: ${warnings.join(', ')}. KIWI grades only the authoritative final response snapshot, never the local draft alone.`:'All current responses are server-acknowledged. Final submission will make the attempt read-only.';
  els.submit.disabled=state.readOnly||state.submitting;els.submit.textContent=state.readOnly?'Already finalized':'Submit final answers';showDialog(els.reviewDialog);
}

async function submitAttempt(){
  if(state.submitting||state.readOnly)return;state.submitting=true;els.submit.disabled=true;els.submit.textContent='Checking saves…';
  try{
    await flushAll();const r=reviewData();
    if(r.uncertain&&!window.confirm('Some work is not confirmed by the server. Submit the latest server-accepted responses anyway?'))return;
    els.submit.textContent='Submitting…';const result=await api(`/teaching/assessments/attempts/${encode(params.attemptId)}/submit`,{method:'POST',body:{confirm:true,idempotencyKey:`d18-submit:${params.attemptId}`}});
    toast(result?.attempt?.attempt_state==='SUBMITTED'?'Assessment submitted.':'Assessment finalization confirmed by the server.');closeDialog(els.reviewDialog);await deactivateIntegrityGuard();await loadWorkspace({replay:false});
  }catch(error){toast(error.message||'Submission could not be confirmed. Your accepted responses remain preserved.');}
  finally{state.submitting=false;els.submit.disabled=false;els.submit.textContent='Submit final answers';}
}

function startTimer(){
  clearInterval(state.timerHandle);const expiry=Date.parse(state.attempt?.expires_at||'');if(!Number.isFinite(expiry)){els.timerValue.textContent='Server';return;}
  state.timerAnnouncements.clear();
  const tick=()=>{const remaining=Math.max(0,expiry-(Date.now()+state.serverOffsetMs)),seconds=Math.ceil(remaining/1000),m=Math.floor(seconds/60),s=seconds%60;els.timerValue.textContent=`${m}:${String(s).padStart(2,'0')}`;els.timer.dataset.state=seconds<=60?'critical':seconds<=300?'warning':'normal';for(const [threshold,message] of [[300,'Five minutes remaining'],[60,'One minute remaining'],[0,'Time has ended']])if(seconds<=threshold&&!state.timerAnnouncements.has(threshold)){state.timerAnnouncements.add(threshold);announce(message);}if(seconds<=0){clearInterval(state.timerHandle);if(!state.readOnly)onProjectedExpiry();}};tick();state.timerHandle=setInterval(tick,1000);
}
async function onProjectedExpiry(){state.readOnly=true;setSaveState('saving','Server finalizing…');renderAll();setNetwork('Time has ended according to the server-synchronized timer. KIWI is finalizing the latest server-accepted response snapshot; this browser does not decide the finalization winner.');await deactivateIntegrityGuard();let checks=0;const poll=async()=>{checks++;try{await loadWorkspace({replay:false});if(state.attempt?.attempt_state!=='ACTIVE'){setNetwork(null);return;}}catch{}if(checks<12)setTimeout(poll,1500);};poll();}

async function transferDevice(){
  els.transfer.disabled=true;els.transfer.textContent='Transferring…';
  try{await api(`/teaching/assessments/attempts/${encode(params.attemptId)}/device-transfer`,{method:'POST',body:{deviceId:state.deviceId,deviceSessionNonce:uid(),idempotencyKey:`d18-transfer:${params.attemptId}:${state.deviceId}`}});closeDialog(els.deviceDialog);toast('This device is now authoritative for the attempt.');await loadWorkspace({activateIntegrity:true});}
  catch(error){toast(error.message||'Device transfer failed.');}
  finally{els.transfer.disabled=false;els.transfer.textContent='Transfer attempt here';}
}

async function activateIntegrityGuard(){const guard=window.KIWIIntegritySessionGuard;if(!guard?.activate)return;try{await guard.activate({ownerType:'TEACHING_ASSESSMENT_ATTEMPT',ownerRef:params.attemptId,onWarning:()=>toast('This is a controlled assessment session. Return to KIWI to continue.'),onLock:()=>toast('This controlled session has been locked. Server-accepted responses remain preserved.')});}catch(error){console.warn('[KIWI D18 integrity] guard activation unavailable:',error?.message);}}
async function deactivateIntegrityGuard(){const guard=window.KIWIIntegritySessionGuard;if(!guard?.deactivate)return;try{await guard.deactivate({close:true});}catch{}}

function toggleFlag(){const item=currentItem();if(!item||state.readOnly)return;const id=item.package_item_id;if(state.flagged.has(id))state.flagged.delete(id);else state.flagged.add(id);persistFlags();renderAll();}
async function reportIssue(event){event.preventDefault();const item=currentItem();const value=els.reportText.value;if(!item||!value.trim())return;const submit=els.reportForm.querySelector('button[type="submit"]');submit.disabled=true;try{await api(`/teaching/assessments/attempts/${encode(params.attemptId)}/challenges`,{method:'POST',body:{packageItemId:item.package_item_id,text:value,idempotencyKey:uid()}});els.reportText.value='';closeDialog(els.reportDialog);toast('Question report recorded for review. No answer information was revealed.');}catch(error){toast(error.message||'Could not record the question report.');}finally{submit.disabled=false;}}

function bind(){
  returnLinks();els.start.addEventListener('click',startAttempt);els.previous.addEventListener('click',()=>navigate(state.activeIndex-1));els.next.addEventListener('click',()=>navigate(state.activeIndex+1));els.flag.addEventListener('click',toggleFlag);els.review.addEventListener('click',openReview);els.reviewClose.addEventListener('click',()=>closeDialog(els.reviewDialog));els.returnQuestions.addEventListener('click',()=>closeDialog(els.reviewDialog));els.submit.addEventListener('click',submitAttempt);els.transfer.addEventListener('click',transferDevice);
  els.navigatorOpen.addEventListener('click',()=>{document.body.dataset.navigatorOpen='true';els.navigatorOpen.setAttribute('aria-expanded','true');els.navigatorClose.focus();});els.navigatorClose.addEventListener('click',()=>{document.body.dataset.navigatorOpen='false';els.navigatorOpen.setAttribute('aria-expanded','false');els.navigatorOpen.focus();});
  els.toolsButton.addEventListener('click',()=>showDialog(els.toolsPanel));els.report.addEventListener('click',()=>showDialog(els.reportDialog));els.reportClose.addEventListener('click',()=>closeDialog(els.reportDialog));els.reportCancel.addEventListener('click',()=>closeDialog(els.reportDialog));els.reportForm.addEventListener('submit',reportIssue);
  window.addEventListener('online',()=>{setNetwork('Connection restored. Revalidating your attempt before sync…');replayQueue();});window.addEventListener('offline',()=>setNetwork('You are offline. Local recovery drafts can continue, but “Saved” will not appear until the server acknowledges them.'));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&params.attemptId&&!state.readOnly)loadWorkspace({replay:true}).catch(()=>{});});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&document.body.dataset.navigatorOpen==='true'){document.body.dataset.navigatorOpen='false';els.navigatorOpen.setAttribute('aria-expanded','false');els.navigatorOpen.focus();return;}if(event.altKey&&event.key==='ArrowLeft'){event.preventDefault();navigate(state.activeIndex-1);}if(event.altKey&&event.key==='ArrowRight'){event.preventDefault();navigate(state.activeIndex+1);}if(event.target.closest?.('#questionGrid')&&event.key==='Home'){event.preventDefault();navigate(0);}if(event.target.closest?.('#questionGrid')&&event.key==='End'){event.preventDefault();navigate(state.items.length-1);}});
}

async function boot(){
  bind();show('loading');
  try{
    if(!window.KIWI_API_CLIENT.hasKiwiSession()){window.location.assign(`/?returnTo=${encode(window.location.pathname+window.location.search)}`);return;}
    if(params.attemptId)await loadWorkspace({activateIntegrity:true});else await loadPackage();
  }catch(error){show('launch');els.start.disabled=true;els.start.textContent='Unavailable';els.launchMeta.replaceChildren();const n=document.createElement('div');n.className='item-state-banner';n.textContent=error.message||'Assessment workspace could not be loaded.';n.hidden=false;els.launchMeta.append(n);setSaveState('conflict','Unavailable');}
}

boot();
})(window);
