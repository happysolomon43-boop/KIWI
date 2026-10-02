(function(global){
  'use strict';
  if(global.KIWIIntegritySessionGuard)return;
  const state={active:null,listeners:[],heartbeat:null,lastHiddenAt:null,deviceRef:null,onState:null,onWarning:null,onLock:null,studyExamWatcher:null,lastStudyExamId:null,endedStudyExamId:null,studyExamActivation:null};
  const uid=(prefix='ig')=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  function apiBase(){
    const configured=global.KIWI_RUNTIME_CONFIG?.apiBaseUrl||global.KIWI_RUNTIME_CONFIG?.apiBase||global.API_BASE_URL||global.KIWI_API_BASE||'';
    return String(configured||'').replace(/\/$/,'');
  }
  function authHeaders(){
    const token=localStorage.getItem('kiwi_auth_token')||localStorage.getItem('kiwi_token')||localStorage.getItem('token')||sessionStorage.getItem('kiwi_token')||'';
    return token?{Authorization:`Bearer ${token}`}:{ };
  }
  async function request(path,{method='GET',body=null,keepalive=false}={}){
    if(global.KIWI_API_CLIENT?.kiwiApiRequest&&!keepalive){
      return global.KIWI_API_CLIENT.kiwiApiRequest(path,{method,body});
    }
    const base=apiBase();
    if(!base)throw new Error('KIWI API base is unavailable for Integrity Session Guard.');
    const res=await fetch(`${base}${path}`,{
      method,
      headers:{'Content-Type':'application/json',Accept:'application/json',...authHeaders()},
      body:body==null?undefined:JSON.stringify(body),
      credentials:'include',
      keepalive,
    });
    const payload=await res.json().catch(()=>({}));
    if(!res.ok){const error=new Error(payload.error||payload.message||`Request failed (${res.status})`);error.code=payload.code;error.status=res.status;throw error;}
    return payload;
  }
  function notify(snapshot){
    state.active=snapshot;
    if(typeof state.onState==='function')state.onState(snapshot);
    if(snapshot?.action==='WARN'&&typeof state.onWarning==='function')state.onWarning(snapshot);
    if((snapshot?.action==='LOCK'||snapshot?.status==='LOCKED')&&typeof state.onLock==='function')state.onLock(snapshot);
    global.dispatchEvent(new CustomEvent('kiwi:integrity-session-state',{detail:snapshot}));
  }
  async function send(kind,metadata={},options={}){
    if(!state.active?.sessionId||state.active.status==='LOCKED'||state.active.status==='CLOSED')return state.active;
    const observedAt=new Date().toISOString();
    const durationMs=kind==='VISIBILITY_VISIBLE'&&state.lastHiddenAt?Math.max(0,Date.now()-state.lastHiddenAt):0;
    try{
      const snapshot=await request(`/teaching/integrity/sessions/${encodeURIComponent(state.active.sessionId)}/events`,{
        method:'POST',
        body:{kind,observedAt,durationMs,clientEventId:uid('evt'),metadata},
        keepalive:Boolean(options.keepalive),
      });
      notify(snapshot);
      return snapshot;
    }catch(error){
      global.dispatchEvent(new CustomEvent('kiwi:integrity-session-error',{detail:{code:error.code||'CLIENT_EVENT_FAILED',message:error.message}}));
      return state.active;
    }
  }
  function bind(target,event,handler,options){target.addEventListener(event,handler,options);state.listeners.push(()=>target.removeEventListener(event,handler,options));}
  function installListeners({requireFullscreen=false}={}){
    const onVisibility=()=>{
      if(document.visibilityState==='hidden'){
        state.lastHiddenAt=Date.now();
        send('VISIBILITY_HIDDEN',{visibilityState:'hidden'});
      }else{
        send('VISIBILITY_VISIBLE',{visibilityState:'visible'});
        state.lastHiddenAt=null;
      }
    };
    const onPageHide=(event)=>send('PAGEHIDE',{persisted:Boolean(event.persisted)},{keepalive:true});
    const onPageShow=(event)=>send('PAGESHOW',{persisted:Boolean(event.persisted)});
    const onOffline=()=>send('NETWORK_LOST',{online:false});
    const onOnline=()=>send('NETWORK_RESTORED',{online:true});
    const onFullscreen=()=>{if(requireFullscreen&&!document.fullscreenElement)send('FULLSCREEN_EXIT',{required:true});};
    bind(document,'visibilitychange',onVisibility,true);
    bind(global,'pagehide',onPageHide,true);
    bind(global,'pageshow',onPageShow,true);
    bind(global,'offline',onOffline,true);
    bind(global,'online',onOnline,true);
    bind(document,'fullscreenchange',onFullscreen,true);
    state.heartbeat=setInterval(()=>send('HEARTBEAT',{visibilityState:document.visibilityState,online:navigator.onLine!==false}),15000);
  }
  function teardown(){for(const off of state.listeners.splice(0))try{off();}catch{}if(state.heartbeat){clearInterval(state.heartbeat);state.heartbeat=null;}state.lastHiddenAt=null;}
  async function activate({ownerType,ownerRef,deviceRef=null,requireFullscreen=false,onState=null,onWarning=null,onLock=null}={}){
    if(!ownerType||!ownerRef)throw new Error('Integrity Session Guard requires ownerType and ownerRef.');
    if(state.active&&state.active.ownerType===ownerType&&state.active.ownerRef===String(ownerRef)&&state.active.status!=='CLOSED'){
      if(typeof onState==='function')state.onState=onState;
      if(typeof onWarning==='function')state.onWarning=onWarning;
      if(typeof onLock==='function')state.onLock=onLock;
      return state.active;
    }
    await deactivate({close:false});
    state.deviceRef=deviceRef||state.deviceRef||uid('device');
    state.onState=onState;state.onWarning=onWarning;state.onLock=onLock;
    const snapshot=await request('/teaching/integrity/sessions',{method:'POST',body:{ownerType,ownerRef:String(ownerRef),deviceRef:state.deviceRef}});
    notify(snapshot);
    installListeners({requireFullscreen});
    return snapshot;
  }
  async function refresh(){if(!state.active?.sessionId)return null;const snapshot=await request(`/teaching/integrity/sessions/${encodeURIComponent(state.active.sessionId)}`);notify(snapshot);return snapshot;}
  async function deactivate({close=true}={}){
    teardown();
    const current=state.active;
    if(close&&current?.sessionId&&!['LOCKED','CLOSED'].includes(current.status)){
      try{const snapshot=await request(`/teaching/integrity/sessions/${encodeURIComponent(current.sessionId)}/close`,{method:'POST'});notify(snapshot);}catch{}
    }
    state.active=null;state.onState=null;state.onWarning=null;state.onLock=null;
    return current;
  }
  function current(){return state.active?Object.freeze({...state.active}):null;}

  function studyExamId(){
    const exam=global.AppState&&global.AppState.tempExam;
    if(!exam)return null;
    return exam.examId||exam.exam_id||exam.id||exam.sessionId||exam.session_id||null;
  }
  function renderDefaultStudyExamLock(snapshot){
    if(typeof document==='undefined')return;
    let overlay=document.getElementById('kiwiIntegrityGlobalExamLock');
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='kiwiIntegrityGlobalExamLock';
      overlay.setAttribute('role','alertdialog');
      overlay.setAttribute('aria-modal','true');
      overlay.style.cssText='position:fixed;inset:0;z-index:10060;background:rgba(3,13,11,.97);display:grid;place-items:center;padding:24px;';
      document.body.appendChild(overlay);
    }
    const invalidated=snapshot?.lockOutcome==='ATTEMPT_INVALIDATED_RULE_BREACH'||snapshot?.outcome==='ATTEMPT_INVALIDATED_RULE_BREACH';
    overlay.innerHTML='<div style="width:min(620px,100%);border:1px solid rgba(248,113,113,.3);border-radius:22px;background:#071812;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.5);"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#fb7185;">Controlled examination</div><h2 style="margin:10px 0;">Attempt locked</h2><p style="line-height:1.7;color:#cbd5e1;">'+(invalidated?'This controlled attempt was invalidated after a second confirmed prohibited departure.':'This controlled attempt was locked after a second confirmed prohibited departure. Your latest server-saved responses have been preserved for the governed next step.')+'</p><p style="margin-top:14px;color:#94a3b8;font-size:12px;line-height:1.6;">KIWI records the rule event itself. This does not declare a cheating probability or misconduct finding.</p></div>';
  }
  function defaultStudyWarning(snapshot){
    if(typeof global.showToast==='function')global.showToast('Warning: you left the controlled examination. Another prohibited departure may lock this attempt.','warning',7000);
    global.dispatchEvent(new CustomEvent('kiwi:exam-integrity-warning',{detail:snapshot}));
  }
  function defaultStudyLock(snapshot){
    renderDefaultStudyExamLock(snapshot);
    global.dispatchEvent(new CustomEvent('kiwi:exam-integrity-lock',{detail:snapshot}));
  }
  async function closeStudyExamGuard(event){
    const detail=event&&event.detail&&typeof event.detail==='object'?event.detail:{};
    const currentId=studyExamId();
    const endedId=detail.examId||detail.ownerRef||currentId||state.active?.ownerRef||null;
    if(endedId)state.endedStudyExamId=String(endedId);
    if(state.active?.ownerType!=='KIWI_EXAM')return state.active;
    if(endedId&&state.active.ownerRef!==String(endedId))return state.active;
    return deactivate({close:true});
  }
  async function ensureStudyExamGuard(){
    const examId=studyExamId();
    if(!examId)return null;
    const id=String(examId);
    if(state.endedStudyExamId===id)return null;
    if(state.endedStudyExamId&&state.endedStudyExamId!==id)state.endedStudyExamId=null;
    if(state.active?.ownerType==='KIWI_EXAM'&&state.active?.ownerRef===id&&state.active?.status!=='CLOSED')return state.active;
    if(state.studyExamActivation?.id===id)return state.studyExamActivation.promise;
    let pending;
    pending=(async()=>{
      try{
        state.lastStudyExamId=id;
        const snapshot=await activate({ownerType:'KIWI_EXAM',ownerRef:id,onWarning:defaultStudyWarning,onLock:defaultStudyLock});
        if(state.endedStudyExamId===id){
          await deactivate({close:true});
          return null;
        }
        return snapshot;
      }catch(error){
        global.dispatchEvent(new CustomEvent('kiwi:integrity-session-error',{detail:{code:error.code||'STUDY_EXAM_AUTO_GUARD_FAILED',message:error.message}}));
        return null;
      }finally{
        if(state.studyExamActivation?.promise===pending)state.studyExamActivation=null;
      }
    })();
    state.studyExamActivation={id,promise:pending};
    return pending;
  }
  function enableStudyExamAutoGuard(){
    if(state.studyExamWatcher)return;
    const tick=()=>{void ensureStudyExamGuard();};
    const restart=()=>{const examId=studyExamId();if(examId)state.endedStudyExamId=null;void ensureStudyExamGuard();};
    tick();
    state.studyExamWatcher=setInterval(tick,750);
    global.addEventListener('kiwi:exam-started',restart);
    global.addEventListener('kiwi:exam-resumed',restart);
    global.addEventListener('kiwi:exam-ended',(event)=>{void closeStudyExamGuard(event);});
  }

  global.KIWIIntegritySessionGuard=Object.freeze({activate,deactivate,refresh,current,sendEvent:send,ensureStudyExamGuard,closeStudyExamGuard,enableStudyExamAutoGuard});
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enableStudyExamAutoGuard,{once:true});
    else enableStudyExamAutoGuard();
  }
})(window);
