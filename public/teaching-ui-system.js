const STYLE_HREF='/teaching-ui-system.css?v=20261005-1';
const OWNER_LABELS=Object.freeze({scheduler:'Scheduler',attendance:'Attendance',teacher_identity:'Teacher Identity',work:'Work',course_lifecycle:'Course Lifecycle',request:'Request'});

function ensureStyles(){
  if(document.querySelector(`link[href^="/teaching-ui-system.css"]`))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href=STYLE_HREF;document.head.append(link);
}

function skeleton(label='Loading'){
  const root=document.createElement('div');root.className='teaching-shell-skeleton';root.setAttribute('role','status');root.setAttribute('aria-label',label);
  const top=document.createElement('div');top.className='teaching-skeleton-card';
  for(const [cls,size] of [['teaching-skeleton-chip',''],['teaching-skeleton-line','title'],['teaching-skeleton-line',''],['teaching-skeleton-line','short']]){const node=document.createElement('div');node.className=cls;if(size)node.dataset.size=size;top.append(node);}
  const grid=document.createElement('div');grid.style.display='grid';grid.style.gridTemplateColumns='repeat(auto-fit,minmax(240px,1fr))';grid.style.gap='14px';
  for(let i=0;i<2;i+=1){const card=document.createElement('div');card.className='teaching-skeleton-card';const title=document.createElement('div');title.className='teaching-skeleton-line';title.dataset.size='title';const body=document.createElement('div');body.className='teaching-skeleton-block';const line=document.createElement('div');line.className='teaching-skeleton-line';card.append(title,body,line);grid.append(card);}
  root.append(top,grid);return root;
}

function installInitialSkeleton(){
  const app=document.getElementById('teachingApp');
  if(app&&!app.childElementCount)app.append(skeleton('Loading KIWI Teaching'));
}

function installLoadingSkeletonObserver(){
  const enhance=(root=document)=>{
    const nodes=[];
    if(root instanceof Element&&root.matches('.teaching-message'))nodes.push(root);
    if(root.querySelectorAll)nodes.push(...root.querySelectorAll('.teaching-message'));
    for(const node of nodes){
      if(node.dataset.skeletonized==='true')continue;
      const text=String(node.textContent||'').trim();
      if(!/^Loading\b/i.test(text))continue;
      node.dataset.skeletonized='true';node.replaceChildren(skeleton(text));node.style.padding='0';node.style.background='transparent';node.style.border='0';
    }
  };
  enhance(document);
  const observer=new MutationObserver((records)=>records.forEach((record)=>record.addedNodes.forEach((node)=>{if(node.nodeType===1)enhance(node);})));observer.observe(document.body,{childList:true,subtree:true});
}

function ownerLabel(value){return OWNER_LABELS[String(value||'').toLowerCase()]||String(value||'KIWI owner').replaceAll('_',' ');}
function requestTiming(item){
  const state=String(item.state||'').toUpperCase();
  if(state==='DRAFT')return 'Decision window: same submission after you press Submit.';
  if(state==='REVIEWING')return 'Decision window: authoritative review is due now.';
  if(state==='ALTERNATIVE_PROPOSED')return 'Decision paused until you accept or decline the proposed alternative.';
  if(['APPROVED','APPROVED_WITH_ADJUSTMENT'].includes(state)&&item.effectiveAt)return `Approved; application is not earlier than ${new Date(item.effectiveAt).toLocaleString()}.`;
  if(['APPLIED','CLOSED','REJECTED','WITHDRAWN'].includes(state))return 'Decision complete.';
  return 'KIWI evaluates this request against its authoritative owner.';
}

let requestRefreshTimer=null;
async function decorateRequestCards(){
  const cards=[...document.querySelectorAll('.teaching-d10-request[data-request-id]')];
  if(!cards.length||typeof window.KIWI_API_CLIENT?.kiwiApiRequest!=='function')return;
  try{
    const items=await window.KIWI_API_CLIENT.kiwiApiRequest('/teaching/requests');
    const byId=new Map((items||[]).map((item)=>[String(item.requestId),item]));
    cards.forEach((card)=>{
      const item=byId.get(String(card.dataset.requestId));if(!item)return;
      card.querySelector('.teaching-request-authority')?.remove();
      const authority=document.createElement('div');authority.className='teaching-request-authority';
      const badge=document.createElement('span');badge.className='teaching-request-authority__badge';badge.textContent=`Reviewed by ${ownerLabel(item.target?.owner)}`;
      const copy=document.createElement('div');copy.className='teaching-request-authority__copy';const strong=document.createElement('strong');strong.textContent=requestTiming(item);copy.append(strong);
      if(item.target?.owner){const detail=document.createElement('div');detail.textContent='The Request workflow records the history; the named academic owner decides whether the requested change is valid.';copy.append(detail);}
      authority.append(badge,copy);card.querySelector('.teaching-d10-request__top')?.after(authority);
    });
  }catch(_){/* Request Center remains usable when this presentation enrichment is unavailable. */}
}
function scheduleRequestDecoration(){clearTimeout(requestRefreshTimer);requestRefreshTimer=setTimeout(decorateRequestCards,80);}
function installRequestObserver(){
  const observer=new MutationObserver((records)=>{if(records.some((record)=>[...record.addedNodes].some((node)=>node.nodeType===1&&(node.matches?.('.teaching-d10-request')||node.querySelector?.('.teaching-d10-request')))))scheduleRequestDecoration();});
  observer.observe(document.body,{childList:true,subtree:true});scheduleRequestDecoration();
}

function formatEntryTime(value){try{return new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch{return'—';}}
function decorateClassroomCards(container,classes){
  const cards=[...container.querySelectorAll('.tc-class-card')];
  cards.forEach((card,index)=>{
    const item=classes[index];if(!item)return;
    const button=card.querySelector('.tc-button');if(!button)return;
    card.querySelector('.tc-class-entry-note')?.remove();
    const serverNow=Date.parse(item.server_now||item.serverNow||new Date().toISOString());
    const skew=Number.isFinite(serverNow)?serverNow-Date.now():0;
    const opens=Date.parse(item.entry_opens_at||item.entryOpensAt||item.scheduled_start_at)-60*60*1000;
    const starts=Date.parse(item.scheduled_start_at);
    const ends=Date.parse(item.scheduled_end_at);
    const note=document.createElement('div');note.className='tc-class-entry-note';button.after(note);
    const update=()=>{
      if(!card.isConnected)return;
      const now=Date.now()+skew;
      if(now<opens){button.disabled=true;button.dataset.entryState='locked';button.textContent=`Opens ${formatEntryTime(opens)}`;note.dataset.state='locked';note.textContent='Classroom unlocks one hour before Class. Entering early is not permitted.';return;}
      button.disabled=false;
      if(now<starts){button.dataset.entryState='waiting';button.textContent='Enter waiting room ↗';note.dataset.state='waiting';note.textContent=`You may enter now. Teaching begins at ${formatEntryTime(starts)}; entering does not start the Class.`;return;}
      if(now>=ends){button.dataset.entryState='ended';button.textContent='Review Classroom ↗';note.dataset.state='ended';note.textContent='Scheduled Class time has ended. Available post-Class materials remain governed by the Classroom record.';return;}
      button.dataset.entryState='live';button.textContent='Open Classroom ↗';note.dataset.state='live';note.textContent=`Class is in its scheduled window until ${formatEntryTime(ends)}.`;
    };
    update();const timer=setInterval(()=>{if(!card.isConnected){clearInterval(timer);return;}update();},30000);
  });
}

function wrapClassroomSection(item){
  if(!item||item.id!=='classroom'||typeof item.render!=='function'||item.__kiwiUiWrapped)return item;
  const original=item.render;
  return {...item,__kiwiUiWrapped:true,render:async(ctx)=>{
    await original(ctx);
    try{
      const data=await window.KIWI_API_CLIENT?.kiwiApiRequest?.(`/teaching/courses/${encodeURIComponent(ctx.course.course_id)}/classes`);
      if(data?.classes)decorateClassroomCards(ctx.container,data.classes);
    }catch(_){/* Core Classroom renderer already owns its own error state. */}
  }};
}

function wrapCourseSurface(surface){
  if(!surface||surface.__kiwiUiWrapped)return surface;
  const wrapped={...surface,__kiwiUiWrapped:true,registerSection(item){return surface.registerSection(wrapClassroomSection(item));}};
  return Object.freeze(wrapped);
}

function installCourseSurfaceInterceptor(){
  let value=window.KIWITeachingCourses?wrapCourseSurface(window.KIWITeachingCourses):null;
  try{
    Object.defineProperty(window,'KIWITeachingCourses',{configurable:true,enumerable:true,get(){return value;},set(next){value=wrapCourseSurface(next);}});
  }catch(_){if(window.KIWITeachingCourses)window.KIWITeachingCourses=wrapCourseSurface(window.KIWITeachingCourses);}
}

async function loadScheduleExperience(){
  try{await import('/teaching-schedule-experience.js?v=20261005-1');}catch(error){console.warn('[KIWI Teaching UI] enhanced Schedule surface unavailable',error);}
}

ensureStyles();
installCourseSurfaceInterceptor();
window.KIWITeachingUI=Object.freeze({skeleton,ownerLabel,requestTiming});
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>{installInitialSkeleton();installLoadingSkeletonObserver();installRequestObserver();loadScheduleExperience();},{once:true});
}else{
  installInitialSkeleton();installLoadingSkeletonObserver();installRequestObserver();loadScheduleExperience();
}
