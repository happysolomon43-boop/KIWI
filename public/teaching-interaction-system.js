(function initTeachingInteractionSystem(global){
  'use strict';

  const LOCATION_KEY='kiwi.teaching.location.v1';
  const originalLocation=(()=>{try{return JSON.parse(global.sessionStorage.getItem(LOCATION_KEY)||'null');}catch{return null;}})();
  const LIFECYCLE_PRIORITY=Object.freeze({ACTIVE:90,PAUSED:80,READY:70,FINALIZING:60,TEACHING_ENDED:50,DRAFT:40,INCOMPLETE:30,COMPLETED:20,ARCHIVED:10});
  let lastPressedButton=null;
  let lastPressedAt=0;
  let restored=false;

  function ensureStyles(){
    if(document.getElementById('teachingInteractionStyles'))return;
    const style=document.createElement('style');style.id='teachingInteractionStyles';style.textContent=`
      html[data-app="kiwi-teaching"] button{isolation:isolate;overflow:hidden}
      html[data-app="kiwi-teaching"] button:not(.teaching-overlay):not(.tc-sheet-backdrop):not(:disabled):active{transform:translateY(1px) scale(.985)!important;filter:brightness(1.08)}
      html[data-app="kiwi-teaching"] button[data-kiwi-pressed="true"]{box-shadow:0 0 0 3px rgba(115,229,178,.12),0 12px 34px rgba(0,0,0,.2)!important}
      html[data-app="kiwi-teaching"] button[data-kiwi-busy="true"]{padding-inline-end:48px!important;cursor:progress!important}
      html[data-app="kiwi-teaching"] button[data-kiwi-busy="true"]::after{
        content:"";position:absolute;right:17px;top:50%;width:16px;height:16px;margin-top:-9px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:kiwiTeachingSpin .68s linear infinite;opacity:.72
      }
      @keyframes kiwiTeachingSpin{to{transform:rotate(360deg)}}
      html[data-app="kiwi-teaching"] .teaching-message[data-kind="error"]{
        position:relative;display:block;margin:16px 0 0;padding:15px 16px 15px 48px;border:1px solid rgba(236,139,139,.20);border-radius:16px;
        background:linear-gradient(145deg,rgba(87,34,34,.22),rgba(40,25,24,.28));box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
        color:#e7d9d7;font-family:var(--teaching-font-body);font-size:var(--teaching-type-body-small-size);font-weight:var(--teaching-weight-medium);line-height:1.65;letter-spacing:normal;overflow-wrap:anywhere
      }
      html[data-app="kiwi-teaching"] .teaching-message[data-kind="error"]::before{
        content:"!";position:absolute;left:15px;top:15px;display:grid;place-items:center;width:22px;height:22px;border:1px solid rgba(240,156,156,.26);border-radius:999px;
        background:rgba(236,128,128,.10);color:#f0b0aa;font-family:var(--teaching-font-display);font-size:13px;font-weight:var(--teaching-weight-bold);line-height:1
      }
      @media(prefers-reduced-motion:reduce){html[data-app="kiwi-teaching"] button[data-kiwi-busy="true"]::after{animation:none}}
      @media(forced-colors:active){html[data-app="kiwi-teaching"] .teaching-message[data-kind="error"]{border:1px solid CanvasText;background:Canvas;color:CanvasText}html[data-app="kiwi-teaching"] button[data-kiwi-pressed="true"]{outline:3px solid Highlight}}
    `;document.head.append(style);
  }

  function beginForButton(button){
    if(!(button instanceof HTMLButtonElement))return null;
    button.dataset.kiwiBusy='true';button.setAttribute('aria-busy','true');return button;
  }
  function endForButton(button){if(!button)return;delete button.dataset.kiwiBusy;button.removeAttribute('aria-busy');}

  function canonicalCourseKey(course){return String(course?.subject_id||course?.subjectId||course?.source_subject_id||course?.title||course?.course_id||course?.courseId||'').trim().toLowerCase();}
  function chooseCourse(left,right){
    const lp=LIFECYCLE_PRIORITY[String(left?.lifecycle_state||left?.lifecycleState||'DRAFT').toUpperCase()]||0;
    const rp=LIFECYCLE_PRIORITY[String(right?.lifecycle_state||right?.lifecycleState||'DRAFT').toUpperCase()]||0;
    if(lp!==rp)return rp>lp?right:left;
    const lt=Date.parse(left?.updated_at||left?.updatedAt||left?.created_at||left?.createdAt||0)||0;
    const rt=Date.parse(right?.updated_at||right?.updatedAt||right?.created_at||right?.createdAt||0)||0;
    return rt>lt?right:left;
  }
  function dedupeCourses(payload){
    const rows=Array.isArray(payload)?payload:(Array.isArray(payload?.courses)?payload.courses:null);if(!rows)return payload;
    const byKey=new Map();for(const row of rows){const key=canonicalCourseKey(row);if(!key){byKey.set(Symbol(),row);continue;}byKey.set(key,byKey.has(key)?chooseCourse(byKey.get(key),row):row);}
    const deduped=[...byKey.values()];return Array.isArray(payload)?deduped:{...payload,courses:deduped};
  }

  function installApiFeedback(){
    const client=global.KIWI_API_CLIENT;if(!client||typeof client.kiwiApiRequest!=='function'||client.__teachingInteractionWrapped)return;
    const original=client.kiwiApiRequest.bind(client);
    const wrapped=async(endpoint,options={})=>{
      const isTeaching=typeof endpoint==='string'&&endpoint.startsWith('/teaching/');
      const method=String(options.method||'GET').toUpperCase();
      const visibleWork=isTeaching&&(method!=='GET'||/(course-plan|timetable|review|activate|prepare|generate|repair)/i.test(endpoint));
      const triggerButton=visibleWork&&Date.now()-lastPressedAt<900
        ? beginForButton(lastPressedButton)
        : null;
      try{
        let result=await original(endpoint,options);
        if(isTeaching&&method==='GET'&&/\/teaching\/courses(?:\?|$)/.test(endpoint))result=dedupeCourses(result);
        return result;
      }finally{endForButton(triggerButton);}
    };
    global.KIWI_API_CLIENT=Object.freeze({...client,kiwiApiRequest:wrapped,__teachingInteractionWrapped:true});
  }

  function installPressFeedback(){
    document.addEventListener('pointerdown',(event)=>{const button=event.target.closest?.('button');if(!button)return;lastPressedButton=button;lastPressedAt=Date.now();button.dataset.kiwiPressed='true';setTimeout(()=>{delete button.dataset.kiwiPressed;},320);},{capture:true,passive:true});
    const observer=new MutationObserver((records)=>{for(const record of records){const button=record.target;if(!(button instanceof HTMLButtonElement)||record.attributeName!=='disabled')continue;if(!button.disabled)endForButton(button);else if(Date.now()-lastPressedAt<800&&button===lastPressedButton)beginForButton(button);}});
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['disabled']});
  }

  function installDeferredRestore(){
    if(!originalLocation||originalLocation.view!=='course'||!originalLocation.courseId||restored)return;
    const attempt=()=>{
      const api=global.KIWITeachingCourses;if(!api||typeof api.openCourse!=='function'||typeof api.openSection!=='function')return false;
      try{api.openCourse(String(originalLocation.courseId));}catch{return false;}
      const section=String(originalLocation.sectionId||'overview');
      if(section!=='overview')setTimeout(()=>{try{api.openSection(section);}catch{}},120);
      restored=true;return true;
    };
    if(attempt())return;
    let tries=0;const timer=setInterval(()=>{tries+=1;if(attempt()||tries>80)clearInterval(timer);},75);
  }

  function init(){ensureStyles();installApiFeedback();installPressFeedback();installDeferredRestore();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  global.KIWITeachingInteraction=Object.freeze({dedupeCourses});
})(window);
