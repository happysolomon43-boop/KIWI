(function(global){
  'use strict';
  if(global.KIWIIntegritySessionGuard)return;
  const state={active:null,listeners:[],heartbeat:null,lastHiddenAt:null,deviceRef:null,onState:null,onWarning:null,onLock:null};
  const uid=(prefix='ig')=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  function apiBase(){const configured=global.KIWI_RUNTIME_CONFIG?.apiBase||global.KIWI_API_BASE||global.API_BASE_URL||'';return String(configured||'').replace(/\/$/,'');}
  function authHeaders(){const token=localStorage.getItem('kiwi_auth_token')||localStorage.getItem('kiwi_token')||localStorage.getItem('token')||sessionStorage.getItem('kiwi_token')||'';return token?{Authorization:`Bearer ${token}`}:{ };}
  async function request(path,{method='GET',body=null,keepalive=false}={}){
    if(global.KIWI_API_CLIENT?.kiwiApiRequest&&!keepalive)return global.KIWI_API_CLIENT.kiwiApiRequest(path,{method,body});
    const res=await fetch(`${apiBase()}${path}`,{method,headers:{'Content-Type':'application/json',...authHeaders()},body:body==null?undefined:JSON.stringify(body),credentials:'include',keepalive});
    const payload=await res.json().catch(()=>({}));if(!res.ok){const error=new Error(payload.error||`Request failed (${res.status})`);error.code=payload.code;throw error;}return payload;
  }
  function notify(snapshot){state.active=snapshot;if(typeof state.onState==='function')state.onState(snapshot);if(snapshot?.action==='WARN'&&typeof state.onWarning==='function')state.onWarning(snapshot);if((snapshot?.action==='LOCK'||snapshot?.status==='LOCKED')&&typeof state.onLock==='function')state.onLock(snapshot);global.dispatchEvent(new CustomEvent('kiwi:integrity-session-state',{detail:snapshot}));}
  async function send(kind,metadata={}){if(!state.active?.sessionId||state.active.status==='LOCKED'||state.active.status==='CLOSED')return state.active;const observedAt=new Date().toISOString();const durationMs=kind==='VISIBILITY_VISIBLE'&&state.lastHiddenAt?Math.max(0,Date.now()-state.lastHiddenAt):0,keepalive=kind==='PAGEHIDE'||kind==='NAVIGATION_AWAY';try{const snapshot=await request(`/api/teaching/integrity/sessions/${encodeURIComponent(state.active.sessionId)}/events`,{method:'POST',body:{kind,observedAt,durationMs,clientEventId:uid('evt'),metadata},keepalive});notify(snapshot);return snapshot;}catch(error){global.dispatchEvent(new CustomEvent('kiwi:integrity-session-error',{detail:{code:error.code||'CLIENT_EVENT_FAILED',message:error.message}}));return state.active;}}
  function bind(target,event,handler,options){target.addEventListener(event,handler,options);state.listeners.push(()=>target.removeEventListener(event,handler,options));}
  function installListeners({requireFullscreen=false}={}){
    const onVisibility=()=>{if(document.visibilityState==='hidden'){state.lastHiddenAt=Date.now();send('VISIBILITY_HIDDEN',{visibilityState:'hidden'});}else{send('VISIBILITY_VISIBLE',{visibilityState:'visible'});state.lastHiddenAt=null;}};
    const onPageHide=(event)=>send('PAGEHIDE',{persisted:Boolean(event.persisted)});
    const onPageShow=(event)=>send('PAGESHOW',{persisted:Boolean(event.persisted)});
    const onOffline=()=>send('NETWORK_LOST',{online:false});
    const onOnline=()=>send('NETWORK_RESTORED',{online:true});
    const onFullscreen=()=>{if(requireFullscreen&&!document.fullscreenElement)send('FULLSCREEN_EXIT',{required:true});};
    bind(document,'visibilitychange',onVisibility,true);bind(global,'pagehide',onPageHide,true);bind(global,'pageshow',onPageShow,true);bind(global,'offline',onOffline,true);bind(global,'online',onOnline,true);bind(document,'fullscreenchange',onFullscreen,true);
    state.heartbeat=setInterval(()=>send('HEARTBEAT',{visibilityState:document.visibilityState,online:navigator.onLine!==false}),15000);
  }
  function teardown(){for(const off of state.listeners.splice(0))try{off();}catch{}if(state.heartbeat){clearInterval(state.heartbeat);state.heartbeat=null;}state.lastHiddenAt=null;}
  async function activate({ownerType,ownerRef,deviceRef=null,requireFullscreen=false,onState=null,onWarning=null,onLock=null}={}){
    if(!ownerType||!ownerRef)throw new Error('Integrity Session Guard requires ownerType and ownerRef.');
    if(state.active&&state.active.ownerType===ownerType&&state.active.ownerRef===String(ownerRef)&&state.active.status!=='CLOSED')return state.active;
    await deactivate({close:false});state.deviceRef=deviceRef||state.deviceRef||uid('device');state.onState=onState;state.onWarning=onWarning;state.onLock=onLock;
    const snapshot=await request('/api/teaching/integrity/sessions',{method:'POST',body:{ownerType,ownerRef:String(ownerRef),deviceRef:state.deviceRef}});notify(snapshot);installListeners({requireFullscreen});return snapshot;
  }
  async function refresh(){if(!state.active?.sessionId)return null;const snapshot=await request(`/api/teaching/integrity/sessions/${encodeURIComponent(state.active.sessionId)}`);notify(snapshot);return snapshot;}
  async function deactivate({close=true}={}){teardown();const current=state.active;if(close&&current?.sessionId&&current.status!=='CLOSED'){try{const snapshot=await request(`/api/teaching/integrity/sessions/${encodeURIComponent(current.sessionId)}/close`,{method:'POST'});notify(snapshot);}catch{}}state.active=null;state.onState=null;state.onWarning=null;state.onLock=null;return current;}
  function current(){return state.active?Object.freeze({...state.active}):null;}
  global.KIWIIntegritySessionGuard=Object.freeze({activate,deactivate,refresh,current,sendEvent:send});
})(window);
