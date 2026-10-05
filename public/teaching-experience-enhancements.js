(function installTeachingExperienceEnhancements(global){
'use strict';

const api=global.KIWI_API_CLIENT||{};
const request=api.kiwiApiRequest;
if(typeof request!=='function')return;

const OWNER_LABELS=Object.freeze({
  scheduler:'Scheduler',
  attendance:'Attendance',
  teacher_identity:'Teacher Identity',
  work:'Work',
  course_lifecycle:'Course Lifecycle',
});
const requestCache=new Map();
let classroomTimer=null;

function displayTime(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return 'the opening time';
  return date.toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function ownerLabel(owner){return OWNER_LABELS[String(owner||'').toLowerCase()]||String(owner||'KIWI owner').replaceAll('_',' ').replace(/(^|\s)\S/g,(m)=>m.toUpperCase());}
function decisionWindow(item){
  if(item?.requiresFutureOwner)return 'No fixed ETA · waiting for that owner to be available';
  const type=String(item?.type||'').toUpperCase();
  const state=String(item?.state||'').toUpperCase();
  if(['APPLIED','CLOSED','REJECTED','WITHDRAWN'].includes(state))return 'Decision complete';
  if(type==='EMERGENCY_ABSENCE')return 'Priority path · usually immediate–30 sec after review starts';
  return 'Automated owner review · usually within seconds, allow up to 2 min';
}
function authorityNode(item){
  const root=document.createElement('div');root.className='teaching-request-authority';
  const owner=document.createElement('div');owner.className='teaching-request-authority__item';
  const ownerLabelNode=document.createElement('small');ownerLabelNode.textContent='Reviewed by';
  const ownerValue=document.createElement('strong');ownerValue.textContent=ownerLabel(item?.target?.owner);
  owner.append(ownerLabelNode,ownerValue);
  const timing=document.createElement('div');timing.className='teaching-request-authority__item';
  const timingLabel=document.createElement('small');timingLabel.textContent='Decision window';
  const timingValue=document.createElement('strong');timingValue.textContent=decisionWindow(item);
  timing.append(timingLabel,timingValue);root.append(owner,timing);return root;
}
async function decorateRequestCard(card){
  if(card.dataset.authorityDecorated==='loading'||card.dataset.authorityDecorated==='true')return;
  const id=String(card.dataset.requestId||'').trim();if(!id)return;
  card.dataset.authorityDecorated='loading';
  try{
    let item=requestCache.get(id);
    if(!item){item=await request(`/teaching/requests/${encodeURIComponent(id)}`);requestCache.set(id,item);}
    if(!card.isConnected)return;
    const existing=card.querySelector('.teaching-request-authority');existing?.remove();
    const actions=card.querySelector('.teaching-d10-actions');
    const node=authorityNode(item);
    if(actions)card.insertBefore(node,actions);else card.append(node);
    const review=[...card.querySelectorAll('button')].find((button)=>button.textContent.trim()==='Run authoritative review');
    if(review){review.textContent='Get decision now';review.setAttribute('aria-label',`Get decision from ${ownerLabel(item?.target?.owner)}`);}
    card.dataset.authorityDecorated='true';
  }catch{
    card.dataset.authorityDecorated='error';
  }
}

function parseDisplayedClassStart(card){
  const label=card.querySelector('small')?.textContent?.trim();
  if(!label)return null;
  const value=Date.parse(label);
  return Number.isFinite(value)?value:null;
}
function decorateClassCard(card){
  const start=parseDisplayedClassStart(card);if(start==null)return;
  const button=card.querySelector('button.tc-button--solid');if(!button)return;
  const now=Date.now(),opensAt=start-60*60*1000;
  let note=card.querySelector('.tc-entry-lock');
  if(!note){note=document.createElement('div');note.className='tc-entry-lock';card.append(note);}
  if(now<opensAt){
    card.dataset.entryPhase='LOCKED';button.disabled=true;button.textContent=`Opens ${new Date(opensAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`;
    note.textContent=`Classroom unlocks one hour before Class · ${displayTime(opensAt)}.`;
    return;
  }
  button.disabled=false;
  if(now<start){
    card.dataset.entryPhase='PRE_CLASS';button.textContent='Enter pre-class ↗';
    note.textContent=`You can enter now. The lesson still waits for the scheduled start at ${new Date(start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.`;
    return;
  }
  card.dataset.entryPhase='CLASS_TIME';button.textContent='Open Classroom ↗';note.textContent='Classroom is open.';
}
function decorateClassroomCards(){document.querySelectorAll('.tc-class-card').forEach(decorateClassCard);}
function decorateRequests(){document.querySelectorAll('.teaching-d10-request[data-request-id]').forEach((card)=>decorateRequestCard(card));}
function decorate(){decorateRequests();decorateClassroomCards();}

const observer=new MutationObserver(()=>decorate());
observer.observe(document.body,{childList:true,subtree:true});
decorate();
classroomTimer=global.setInterval(decorateClassroomCards,30_000);
global.addEventListener('pagehide',()=>{if(classroomTimer)global.clearInterval(classroomTimer);},{once:true});

// Public only for D24 verification and non-academic UI refreshes.
global.KIWITeachingExperienceEnhancements=Object.freeze({decorate,decisionWindow,ownerLabel});
})(window);
