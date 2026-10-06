(function initTeachingInteractionSystem(global){
  'use strict';

  const LOCATION_KEY='kiwi.teaching.location.v1';
  const originalLocation=(()=>{try{return JSON.parse(global.sessionStorage.getItem(LOCATION_KEY)||'null');}catch{return null;}})();
  const LIFECYCLE_PRIORITY=Object.freeze({ACTIVE:90,PAUSED:80,READY:70,FINALIZING:60,TEACHING_ENDED:50,DRAFT:40,INCOMPLETE:30,COMPLETED:20,ARCHIVED:10});
  let lastPressedButton=null;
  let lastPressedAt=0;
  let restored=false;

  function ensureFonts(){
    if(document.querySelector('link[data-teaching-type-system]'))return;
    const link=document.createElement('link');link.rel='stylesheet';link.dataset.teachingTypeSystem='true';
    link.href='https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap';
    document.head.append(link);
  }

  function ensureStyles(){
    if(document.getElementById('teachingInteractionStyles'))return;
    const style=document.createElement('style');style.id='teachingInteractionStyles';style.textContent=`
      html[data-app="kiwi-teaching"] body{font-family:var(--font-body,"DM Sans"),sans-serif;letter-spacing:-.012em}
      html[data-app="kiwi-teaching"] h1,html[data-app="kiwi-teaching"] h2,html[data-app="kiwi-teaching"] h3,
      html[data-app="kiwi-teaching"] h4,html[data-app="kiwi-teaching"] .teaching-title,
      html[data-app="kiwi-teaching"] .teaching-brand__kiwi{
        font-family:var(--font-display,"Syne"),sans-serif;letter-spacing:-.025em
      }
      html[data-app="kiwi-teaching"] p,html[data-app="kiwi-teaching"] .teaching-message,
      html[data-app="kiwi-teaching"] .teaching-course-card__meta{line-height:1.62;letter-spacing:-.008em}
      html[data-app="kiwi-teaching"] .teaching-eyebrow,html[data-app="kiwi-teaching"] [class*="__eyebrow"],
      html[data-app="kiwi-teaching"] [class*="__badge"],html[data-app="kiwi-teaching"] .teaching-status{
        font-family:var(--font-mono,"JetBrains Mono",monospace);letter-spacing:.11em;text-transform:uppercase
      }
      html[data-app="kiwi-teaching"] button{position:relative;isolation:isolate;overflow:hidden;transform:translateZ(0)}
      html[data-app="kiwi-teaching"] button:not(:disabled):active{transform:translateY(1px) scale(.985)!important;filter:brightness(1.08)}
      html[data-app="kiwi-teaching"] button[data-kiwi-pressed="true"]{box-shadow:0 0 0 3px rgba(115,229,178,.12),0 12px 34px rgba(0,0,0,.2)!important}
      html[data-app="kiwi-teaching"] button[data-kiwi-busy="true"]{padding-inline-end:48px!important;cursor:progress!important}
      html[data-app="kiwi-teaching"] button[data-kiwi-busy="true"]::after{
        content:"";position:absolute;right:17px;top:50%;width:16px;height:16px;margin-top:-9px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:kiwiTeachingSpin .68s linear infinite;opacity:.72
      }
      @keyframes kiwiTeachingSpin{to{transform:rotate(360deg)}}
      .kiwi-teaching-action-result{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom,0px));z-index:85;max-width:min(430px,calc(100vw - 30px));padding:11px 15px;border:1px solid rgba(120,229,182,.2);border-radius:14px;background:rgba(4,29,21,.96);box-shadow:0 18px 48px rgba(0,0,0,.35);color:#d9f2e7;font:600 12px/1.45 "DM Sans",sans-serif;transform:translate(-50%,12px);opacity:0;transition:.18s ease;pointer-events:none}
      .kiwi-teaching-action-result[data-show="true"]{transform:translate(-50%,0);opacity:1}
      .kiwi-teaching-action-result[data-kind="error"]{border-color:rgba(244,137,137,.26);color:#ffc0c0;background:rgba(41,18,18,.96)}
      @media(prefers-reduced-motion:reduce){.kiwi-teaching-action-result{transition:none}html[data-app="kiwi-teaching"] button[data-kiwi-busy="true"]::after{animation:none}}
      @media(forced-colors:active){.kiwi-teaching-action-result{border:1px solid CanvasText;background:Canvas;color:CanvasText}html[data-app="kiwi-teaching"] button[data-kiwi-pressed="true"]{outline:3px solid Highlight}}
    `;document.head.append(style);
  }

  function toast(message,kind='success'){
    let node=document.querySelector('.kiwi-teaching-action-result');if(!node){node=document.createElement('div');node.className='kiwi-teaching-action-result';node.setAttribute('role','status');node.setAttribute('aria-live','polite');document.body.append(node);}
    node.textContent=message;node.dataset.kind=kind;node.dataset.show='true';clearTimeout(node._hideTimer);node._hideTimer=setTimeout(()=>{node.dataset.show='false';},2800);
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
        if(visibleWork&&method!=='GET')toast('Action completed.','success');
        return result;
      }catch(error){if(visibleWork)toast(error?.message||'Teaching action failed.','error');throw error;}
      finally{endForButton(triggerButton);}
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

  function init(){ensureFonts();ensureStyles();installApiFeedback();installPressFeedback();installDeferredRestore();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  global.KIWITeachingInteraction=Object.freeze({dedupeCourses,toast});
})(window);
