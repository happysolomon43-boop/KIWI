const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};
const courseSurface = window.KIWITeachingCourses;
const nav = window.KIWITeachingNavigation;
if (typeof kiwiApiRequest !== 'function' || !courseSurface?.registerSection) {
  throw new Error('Teaching D15 requires the shared KIWI client and Course shell.');
}

const STYLE_ID = 'teachingD15Styles';
const OUTCOME = Object.freeze({
  PENDING: { label:'Pending', tone:'quiet', detail:'This scheduled obligation has started but its final attendance outcome is not yet settled.' },
  ON_TIME: { label:'On time', tone:'good', detail:'Arrival was within the configured grace policy and meaningful presence was established.' },
  LATE: { label:'Late', tone:'warn', detail:'Arrival was outside the configured grace policy. Lost teaching time remains an academic scheduling fact, not a mark deduction.' },
  PARTIAL: { label:'Partial attendance', tone:'warn', detail:'Only part of the scheduled teaching obligation was attended or meaningful participation was incomplete.' },
  UNEXCUSED_ABSENCE: { label:'Unexcused absence', tone:'bad', detail:'The scheduled obligation existed and no approved/excused or system-protected reason currently applies.' },
  EXCUSED_ABSENCE: { label:'Excused absence', tone:'soft', detail:'The attendance behavior is excused. Missed learning can still require recovery.' },
  APPROVED_LEAVE: { label:'Approved leave', tone:'soft', detail:'This absence is approved and is not treated as attendance misconduct.' },
  INTERRUPTED: { label:'Interrupted', tone:'soft', detail:'Presence became uncertain because the session was interrupted. Interruption is not automatically absence.' },
  SYSTEM_PROTECTED: { label:'System protected', tone:'good', detail:'A verified KIWI/platform interruption protects the student from attendance, mark, and avoidable recovery penalties.' },
  NO_OBLIGATION: { label:'No obligation', tone:'quiet', detail:'The authoritative timetable did not require attendance for this slot.' },
  RESCHEDULED: { label:'Rescheduled', tone:'quiet', detail:'The old timetable slot no longer creates an attendance obligation.' },
});

function el(tag, cls='', text=null) {
  const node=document.createElement(tag);
  if(cls) node.className=cls;
  if(text!==null && text!==undefined) node.textContent=String(text);
  return node;
}
function add(parent,...children){ children.filter(Boolean).forEach((child)=>parent.append(child)); return parent; }
function human(value){ return String(value||'').replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,(m)=>m.toUpperCase()); }
function dateTime(value){ if(!value)return '—'; try{return new Date(value).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}catch{return String(value);} }
function time(value){ if(!value)return '—'; try{return new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch{return String(value);} }
function minutes(value){ const n=Math.max(0,Number(value)||0); return `${Math.round(n)} min`; }
function courseName(courseId){
  const course=(courseSurface.all?.()||[]).find((item)=>String(item.course_id)===String(courseId));
  return course?.title||course?.name||course?.course_title||'Teaching Course';
}
function outcomeInfo(value){ return OUTCOME[value]||{label:human(value||'Pending'),tone:'quiet',detail:'Attendance is recorded by the authoritative Attendance Ledger.'}; }

function installStyles(){
  if(document.getElementById(STYLE_ID)) return;
  const style=el('style'); style.id=STYLE_ID; style.textContent=`
    .td15{display:grid;gap:16px;min-width:0}
    .td15-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:end;padding:clamp(24px,4vw,36px);border:1px solid rgba(223,245,235,.09);border-radius:24px;background:radial-gradient(circle at 86% 8%,rgba(126,226,184,.12),transparent 31%),linear-gradient(145deg,rgba(15,34,27,.96),rgba(8,20,16,.96));box-shadow:0 18px 50px rgba(0,0,0,.17)}
    .td15-hero::after{content:"";position:absolute;right:-120px;top:-160px;width:330px;height:330px;border:1px solid rgba(126,226,184,.09);border-radius:50%;pointer-events:none}
    .td15-kicker{font-size:10px;font-weight:750;letter-spacing:.15em;text-transform:uppercase;color:#82d7b2}
    .td15-hero h2{position:relative;z-index:1;margin:8px 0 9px;font-family:var(--font-display);font-size:clamp(29px,4.4vw,43px);line-height:1.04;letter-spacing:-.045em;font-weight:740}
    .td15-hero p{position:relative;z-index:1;max-width:670px;margin:0;color:#94a79e;font-size:13px;line-height:1.65}
    .td15-authority{position:relative;z-index:1;display:grid;gap:7px;min-width:210px;padding:15px;border:1px solid rgba(223,245,235,.07);border-radius:16px;background:rgba(3,14,11,.36)}
    .td15-authority span{display:flex;align-items:center;gap:8px;color:#8fa89d;font-size:10px}.td15-authority span::before{content:"";width:6px;height:6px;border-radius:50%;background:#7ee2b8;box-shadow:0 0 0 4px rgba(126,226,184,.07)}
    .td15-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
    .td15-stat{padding:16px;border:1px solid rgba(223,245,235,.07);border-radius:15px;background:rgba(255,255,255,.018)}
    .td15-stat strong{display:block;font-family:var(--font-display);font-size:26px;letter-spacing:-.04em}.td15-stat span{display:block;margin-top:4px;color:#71857b;font-size:10px;line-height:1.35}
    .td15-note{padding:12px 14px;border:1px solid rgba(126,226,184,.10);border-radius:13px;background:rgba(126,226,184,.035);color:#91aa9f;font-size:11px;line-height:1.55}
    .td15-concern{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:17px;align-items:center;padding:19px;border:1px solid rgba(245,180,82,.18);border-radius:18px;background:linear-gradient(145deg,rgba(55,39,15,.26),rgba(16,24,19,.65))}
    .td15-concern[data-state="RESOLVED"]{border-color:rgba(126,226,184,.10);background:rgba(126,226,184,.025)}
    .td15-concern h3{margin:5px 0 6px;font-size:18px}.td15-concern p{margin:0;color:#a6a18d;font-size:12px;line-height:1.6}.td15-concern[data-state="RESOLVED"] p{color:#8aa096}
    .td15-actions{display:flex;gap:7px;flex-wrap:wrap}.td15-action{min-height:39px;padding:0 13px;border:1px solid rgba(223,245,235,.10);border-radius:10px;background:rgba(255,255,255,.02);color:#dce9e3;cursor:pointer;font-size:11px;font-weight:700}.td15-action:hover,.td15-action:focus-visible{outline:none;border-color:rgba(126,226,184,.32);background:rgba(126,226,184,.07)}
    .td15-section{display:grid;gap:10px}.td15-section-head{display:flex;justify-content:space-between;align-items:end;gap:12px;padding:5px 2px}.td15-section-head h3{margin:5px 0 0;font-size:20px;letter-spacing:-.025em}.td15-section-head span{color:#71857b;font-size:10px}
    .td15-list{display:grid;gap:9px}.td15-record{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;padding:16px;border:1px solid rgba(223,245,235,.07);border-radius:16px;background:linear-gradient(180deg,rgba(15,28,23,.66),rgba(8,20,16,.68))}
    .td15-record__top{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.td15-record h4{margin:0;font-size:14px}.td15-record__time{margin-top:6px;color:#72877d;font-size:10px}.td15-record__detail{margin-top:8px;max-width:720px;color:#95a79f;font-size:11px;line-height:1.55}
    .td15-badge{display:inline-flex;align-items:center;min-height:25px;padding:4px 8px;border-radius:999px;border:1px solid rgba(223,245,235,.09);background:rgba(255,255,255,.02);font-size:9px;font-weight:800;letter-spacing:.055em;text-transform:uppercase;white-space:nowrap}
    .td15-badge[data-tone="good"]{border-color:rgba(126,226,184,.20);background:rgba(126,226,184,.075);color:#97e6c4}.td15-badge[data-tone="warn"]{border-color:rgba(245,180,82,.22);background:rgba(245,180,82,.07);color:#e9c47d}.td15-badge[data-tone="bad"]{border-color:rgba(236,102,102,.22);background:rgba(236,102,102,.065);color:#efaaaa}.td15-badge[data-tone="soft"]{border-color:rgba(128,165,218,.18);background:rgba(128,165,218,.055);color:#acc5e8}.td15-badge[data-tone="quiet"]{color:#8b9d94}
    .td15-record__facts{display:grid;grid-template-columns:repeat(2,minmax(82px,1fr));gap:6px;align-content:start;min-width:205px}.td15-fact{padding:8px 9px;border:1px solid rgba(223,245,235,.055);border-radius:10px;background:rgba(0,0,0,.08)}.td15-fact strong{display:block;font-size:11px}.td15-fact span{display:block;margin-top:2px;color:#6f8379;font-size:9px}
    .td15-correction{display:inline-flex;margin-top:8px;padding:5px 8px;border-radius:8px;background:rgba(126,226,184,.055);color:#91bca9;font-size:9px}
    .td15-empty{padding:28px;border:1px dashed rgba(223,245,235,.10);border-radius:16px;text-align:center;color:#71857b;font-size:12px;line-height:1.6}
    .td15-course-group{display:grid;gap:9px;padding:17px;border:1px solid rgba(223,245,235,.07);border-radius:18px;background:rgba(255,255,255,.012)}.td15-course-group__head{display:flex;justify-content:space-between;align-items:center;gap:12px}.td15-course-group__head h3{margin:0;font-size:17px}.td15-course-group__head button{min-height:34px}
    .td15-error{padding:16px;border:1px solid rgba(236,102,102,.17);border-radius:14px;background:rgba(236,102,102,.05);color:#efb0b0;font-size:12px}
    @media(max-width:760px){.td15-hero{grid-template-columns:1fr}.td15-authority{min-width:0}.td15-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.td15-concern,.td15-record{grid-template-columns:1fr}.td15-record__facts{min-width:0;grid-template-columns:repeat(4,minmax(0,1fr))}}
    @media(max-width:520px){.td15-hero{padding:20px 17px;border-radius:19px}.td15-strip{grid-template-columns:1fr 1fr}.td15-stat{padding:13px}.td15-record{padding:14px}.td15-record__facts{grid-template-columns:1fr 1fr}.td15-concern{padding:15px}.td15-actions{display:grid;grid-template-columns:1fr}.td15-action{width:100%}}
  `; document.head.append(style);
}

function badge(outcome){ const info=outcomeInfo(outcome); const node=el('span','td15-badge',info.label); node.dataset.tone=info.tone; return node; }
function fact(value,label){ return add(el('div','td15-fact'),el('strong','',value),el('span','',label)); }
function recordCard(record,{showCourse=false}={}){
  const info=outcomeInfo(record.outcome);
  const card=el('article','td15-record');
  const copy=el('div');
  const top=el('div','td15-record__top');
  top.append(badge(record.outcome),el('h4','',showCourse?courseName(record.courseId):'Scheduled Class'));
  const timing=el('div','td15-record__time',`${dateTime(record.scheduledStartAt)} · ${time(record.scheduledStartAt)}–${time(record.scheduledEndAt)}`);
  const detail=el('div','td15-record__detail',info.detail);
  copy.append(top,timing,detail);
  if(record.correction){
    copy.append(el('div','td15-correction',`Corrected · ${human(record.correction.kind)}${record.correction.reason?' · '+record.correction.reason:''}`));
  }
  const facts=el('div','td15-record__facts');
  facts.append(
    fact(record.arrivedAt?time(record.arrivedAt):'—','Arrival'),
    fact(record.exitedAt?time(record.exitedAt):'—','Exit'),
    fact(record.lateMinutes==null?'—':minutes(record.lateMinutes),'Late time'),
    fact(minutes(record.missedMinutes),'Missed teaching')
  );
  card.append(copy,facts);
  return card;
}
function stat(value,label){return add(el('div','td15-stat'),el('strong','',value),el('span','',label));}
function renderConcern(courseId,concern){
  if(!concern) return null;
  const box=el('section','td15-concern'); box.dataset.state=concern.state||'OPEN';
  const copy=el('div');
  copy.append(el('div','td15-kicker',concern.state==='OPEN'?'Attendance concern':'Attendance concern resolved'));
  copy.append(el('h3','',concern.state==='OPEN'?'Your timetable needs a reality check':'The recent pattern no longer meets the concern trigger'));
  const missed=Number(concern.explanationFacts?.missed_instruction_minutes)||0;
  const repeated=Boolean(concern.explanationFacts?.repeated_lateness);
  const fragments=[];
  if(repeated) fragments.push('Repeated lateness is present in the recent obligation window.');
  if(missed>0) fragments.push(`${Math.round(missed)} minutes of instructional time are currently recorded as missed.`);
  fragments.push('This does not reduce subject marks. The next step is schedule/recovery review, not punishment.');
  copy.append(el('p','',fragments.join(' ')));
  box.append(copy);
  if(concern.state==='OPEN'){
    const actions=el('div','td15-actions');
    if(concern.actions?.includes('TIMETABLE_REVIEW_REQUIRED')){
      const schedule=el('button','td15-action','Review schedule'); schedule.type='button'; schedule.addEventListener('click',()=>courseSurface.openCourse?.(courseId,'schedule')); actions.append(schedule);
    }
    const requests=el('button','td15-action','Open Requests'); requests.type='button'; requests.addEventListener('click',()=>window.KIWITeachingD10?.openRequests?.()); actions.append(requests);
    box.append(actions);
  }
  return box;
}
function empty(message){ return el('div','td15-empty',message); }
function hero(title,lead){
  const section=el('section','td15-hero');
  const copy=el('div'); copy.append(el('div','td15-kicker','Attendance ledger'),el('h2','',title),el('p','',lead));
  const authority=el('div','td15-authority');
  authority.append(el('span','','Server time is authoritative'),el('span','','Schedule determines obligation'),el('span','','No attendance mark deductions'),el('span','','No gamified attendance score'));
  section.append(copy,authority); return section;
}

async function renderCourseResults({course,container}){
  installStyles(); const page=el('div','td15');
  page.append(hero('Course Results','Attendance here describes schedule compliance and actual instructional presence. It stays separate from marks, classwork completion, mastery, and assessment-attempt truth.'));
  container.append(page);
  try{
    const data=await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/attendance`);
    const s=data.summary||{};
    page.append(add(el('div','td15-strip'),
      stat(s.obligations??0,'Scheduled obligations'),
      stat((s.onTime??0)+(s.late??0),'Classes attended'),
      stat(s.partial??0,'Partial attendance'),
      stat((s.excusedAbsence??0)+(s.approvedLeave??0)+(s.systemProtected??0),'Protected / approved outcomes')
    ));
    page.append(el('div','td15-note','KIWI intentionally does not turn these records into a single attendance percentage. Approved breaks, rescheduled slots and no-obligation events must not be counted as absences.'));
    const concern=renderConcern(course.course_id,data.concern); if(concern) page.append(concern);
    const section=el('section','td15-section');
    const head=el('div','td15-section-head'); head.append(add(el('div'),el('div','td15-kicker','Punctuality & presence'),el('h3','','Attendance record')),el('span','',`${data.records?.length||0} ledger entr${data.records?.length===1?'y':'ies'}`)); section.append(head);
    const list=el('div','td15-list');
    (data.records||[]).forEach((record)=>list.append(recordCard(record)));
    if(!list.children.length) list.append(empty('No attendance record exists yet. Records appear only when authoritative scheduled obligations begin.'));
    section.append(list); page.append(section);
  }catch(error){page.append(el('div','td15-error',error.message||'Course attendance record could not be loaded.'));}
}

async function renderCourseSummary({course,container}){
  installStyles();
  const card=el('div','td15-course-group');
  const head=el('div','td15-course-group__head'); head.append(add(el('div'),el('div','td15-kicker','COURSE RESULTS'),el('h3','','Attendance & punctuality')));
  const open=el('button','td15-action','View Results'); open.type='button'; open.addEventListener('click',()=>courseSurface.openSection?.('results')); head.append(open); card.append(head);
  try{
    const data=await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/attendance`),s=data.summary||{};
    card.append(el('div','td15-note',`${s.obligations||0} scheduled obligations · ${s.late||0} late · ${s.partial||0} partial · ${s.unexcusedAbsence||0} unexcused. Attendance remains separate from subject marks.`));
  }catch{card.append(el('div','td15-note','Attendance will appear here when the authoritative ledger is available.'));}
  container.append(card);
}

async function renderGlobalRecord(){
  installStyles(); const main=document.getElementById('teachingApp'); if(!main)return;
  const page=el('section','td15');
  page.append(hero('Record','A durable view of attendance obligations across Teaching Courses. Corrections remain visible through ledger history; approved and system-protected situations stay distinct from non-compliance.'));
  main.replaceChildren(page);
  try{
    const data=await kiwiApiRequest('/teaching/record/attendance');
    page.append(el('div','td15-note','This Record is obligation-aware. It does not calculate a rank, streak, score, or naïve attendance percentage.'));
    for(const group of data.courses||[]){
      const section=el('section','td15-course-group');
      const head=el('div','td15-course-group__head'); head.append(add(el('div'),el('div','td15-kicker','COURSE'),el('h3','',courseName(group.courseId))));
      const open=el('button','td15-action','Open Course Results'); open.type='button'; open.addEventListener('click',()=>courseSurface.openCourse?.(group.courseId,'results')); head.append(open); section.append(head);
      const list=el('div','td15-list'); (group.records||[]).forEach((record)=>list.append(recordCard(record,{showCourse:false}))); if(!list.children.length)list.append(empty('No attendance obligations recorded for this Course.')); section.append(list); page.append(section);
    }
    if(!(data.courses||[]).length) page.append(empty('Your Teaching Record has no attendance obligations yet.'));
  }catch(error){page.append(el('div','td15-error',error.message||'Global Teaching Record could not be loaded.'));}
}

courseSurface.registerSection({id:'results',label:'Results',order:60,render:renderCourseResults,renderSummary:renderCourseSummary});
if(nav?.register) nav.register({id:'record',label:'Record',description:'Results and attendance record',icon:'◎',menuIcon:'overview',onSelect:renderGlobalRecord});

window.KIWITeachingD15=Object.freeze({openRecord:()=>nav?.open?.('record'),openCourseResults:(courseId)=>courseSurface.openCourse?.(courseId,'results')});
