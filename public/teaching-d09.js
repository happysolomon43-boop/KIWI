const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};
if (typeof kiwiApiRequest !== 'function') throw new Error('KIWI shared API client must load before Teaching D09.');
const courseSurface = window.KIWITeachingCourses;
const nav = window.KIWITeachingNavigation;
if (!courseSurface || typeof courseSurface.registerSection !== 'function') throw new Error('KIWI Teaching course surface must load before Teaching D09.');

const STYLE_ID = 'teachingD09Styles';
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function el(tag, cls = '', text = null) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function scheduleActionError(error,fallback){const code=String(error?.code||'').toUpperCase(),message=String(error?.message||'');if(code.includes('SEMESTER_CAPACITY_INFEASIBLE')||code.includes('REQUIRED_INSTRUCTIONAL_LOAD_UNSCHEDULED')||code.includes('RECOVERY_HEADROOM_BELOW_MINIMUM'))return 'There is not enough conflict-free time in the current Semester date range and availability. Extend the Semester, add study windows, or reduce protected time, then rebuild.';if(code.includes('LOAD_ESTIMATION_TRUNCATED')||code.includes('AI_OUTPUT_TRUNCATED')||/MAX_TOKENS|incomplete Teaching artifact/i.test(message))return 'KIWI could not finish workload preparation for this timetable. Nothing was changed; try the timetable action again.';return message||fallback;}
function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = el('style'); style.id = STYLE_ID;
  style.textContent =
    '.teaching-d09-page{display:grid;gap:14px}.teaching-d09-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.72fr);gap:12px}' +
    '.teaching-d09-card{padding:20px;border:1px solid rgba(223,245,235,.075);border-radius:18px;background:var(--teaching-surface-soft)}' +
    '.teaching-d09-card h3{margin:7px 0 0;font-family:var(--font-display);font-size:20px}.teaching-d09-card p{color:#8b9e95;font-size:12px;line-height:1.65}' +
    '.teaching-d09-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.teaching-d09-field{display:grid;gap:6px}' +
    '.teaching-d09-field label{font-size:11px;color:#91a69c}.teaching-d09-field input,.teaching-d09-field select{min-height:42px;padding:0 11px;border:1px solid var(--teaching-border);border-radius:10px;background:#061a14;color:var(--teaching-text)}' +
    '.teaching-d09-field input[type="date"],.teaching-d09-field input[type="time"],.teaching-d09-field input[type="datetime-local"]{color-scheme:dark;cursor:pointer;touch-action:manipulation}' +
    '.teaching-d09-days{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.teaching-d09-day{display:flex;gap:5px;align-items:center;padding:7px 9px;border:1px solid var(--teaching-border);border-radius:10px;font-size:11px}' +
    '.teaching-d09-row{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-top:8px}.teaching-d09-row input,.teaching-d09-row select{min-height:38px;padding:0 8px;border:1px solid var(--teaching-border);border-radius:9px;background:#061a14;color:var(--teaching-text)}' +
    '.teaching-d09-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.teaching-d09-status{padding:8px 10px;border-radius:999px;background:var(--teaching-accent-soft);color:var(--teaching-accent);font-size:10px;font-weight:700;display:inline-flex}' +
    '.teaching-d09-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.teaching-d09-metric{padding:11px;border:1px solid var(--teaching-border);border-radius:11px}' +
    '.teaching-d09-metric strong{display:block;font-size:18px}.teaching-d09-metric span{display:block;color:#74877e;font-size:10px}.teaching-d09-slot{padding:12px;border:1px solid var(--teaching-border);border-radius:12px;margin-top:8px}' +
    '.teaching-d09-slot__top{display:flex;justify-content:space-between;gap:8px}.teaching-d09-slot small{display:block;margin-top:5px;color:#7e9288}.teaching-d09-note{font-size:11px;color:#74877e;line-height:1.55}' +
    '.teaching-d09-calendar-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end;background:linear-gradient(145deg,rgba(11,32,25,.9),rgba(5,20,15,.94))}' +
    '.teaching-d09-calendar-hero__copy{min-width:0}.teaching-d09-calendar-hero__meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.teaching-d09-calendar-zone{display:inline-flex;align-items:center;min-height:30px;padding:6px 10px;border:1px solid rgba(126,226,184,.13);border-radius:999px;background:rgba(126,226,184,.045);color:#9ec9b6;font:600 10px/1.35 var(--font-body)}' +
    '.teaching-d09-calendar-section{display:grid;gap:12px}.teaching-d09-calendar-section__head{display:flex;align-items:end;justify-content:space-between;gap:14px;padding:2px}.teaching-d09-calendar-section__head h3{margin:0;font:700 20px/1.25 var(--font-body);letter-spacing:-.02em}.teaching-d09-calendar-section__head>span{color:#70877c;font:500 11px/1.4 var(--font-body)}' +
    '.teaching-d09-calendar{display:grid;gap:14px}.teaching-d09-calendar-day{overflow:hidden;border:1px solid rgba(223,245,235,.075);border-radius:18px;background:linear-gradient(180deg,rgba(9,29,22,.78),rgba(5,20,15,.76));box-shadow:0 12px 34px rgba(0,0,0,.09)}' +
    '.teaching-d09-calendar-day__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 17px;border-bottom:1px solid rgba(223,245,235,.065);background:rgba(255,255,255,.008)}.teaching-d09-calendar-day__head strong{font:700 14px/1.35 var(--font-body);letter-spacing:-.01em}.teaching-d09-calendar-day__head span{color:#657b71;font:500 10px/1.35 var(--font-body)}' +
    '.teaching-d09-calendar-day__items{display:grid}.teaching-d09-calendar-row{position:relative;display:grid;grid-template-columns:94px minmax(0,1fr);gap:18px;padding:17px;border-top:1px solid rgba(223,245,235,.055)}.teaching-d09-calendar-row:first-child{border-top:0}.teaching-d09-calendar-row:hover{background:rgba(126,226,184,.018)}' +
    '.teaching-d09-calendar-row__time{display:grid;align-content:start;gap:3px;padding-top:2px;color:#92a89e;font:500 11px/1.28 var(--font-mono);font-variant-numeric:tabular-nums}.teaching-d09-calendar-row__time span:last-child{color:#60766c}.teaching-d09-calendar-row__body{min-width:0}.teaching-d09-calendar-row__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.teaching-d09-calendar-row__title{min-width:0}.teaching-d09-calendar-row__title strong{display:block;color:#e9f5ef;font:700 15px/1.35 var(--font-body);letter-spacing:-.01em;overflow-wrap:anywhere}.teaching-d09-calendar-row__meta{margin-top:4px;color:#71877d;font:400 10.5px/1.45 var(--font-body)}' +
    '.teaching-d09-calendar-kind{flex:none;display:inline-flex;align-items:center;min-height:26px;padding:5px 9px;border:1px solid rgba(126,226,184,.12);border-radius:999px;background:rgba(126,226,184,.065);color:#89dfb8;font:700 10px/1.3 var(--font-body);white-space:nowrap}.teaching-d09-calendar-kind[data-kind="ASSESSMENT"]{border-color:rgba(245,180,82,.17);background:rgba(245,180,82,.055);color:#dfc184}.teaching-d09-calendar-kind[data-kind="PROPOSAL"]{border-color:rgba(142,165,218,.16);background:rgba(142,165,218,.05);color:#b3c5ea}' +
    '.teaching-d09-calendar-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:13px}.teaching-d09-calendar-actions button{min-width:0;min-height:38px;padding:0 11px;border-radius:10px;font:600 11px/1.35 var(--font-body);white-space:normal}.teaching-d09-calendar-actions button[data-tone="urgent"]{border-color:rgba(236,102,102,.13);color:#d8b2b2}.teaching-d09-calendar-actions button[data-tone="urgent"]:hover,.teaching-d09-calendar-actions button[data-tone="urgent"]:focus-visible{border-color:rgba(236,102,102,.28);background:rgba(236,102,102,.055);color:#efc2c2}' +
    ' .teaching-d09-calendar-refresh{margin:9px 0 16px;color:#8eb6a6;font-size:11px}.teaching-d09-calendar-history{margin-top:18px}.teaching-d09-calendar-history__summary{padding:16px 18px;cursor:pointer;border:1px solid rgba(126,226,184,.17);border-radius:14px;color:#b6f1d0;font-weight:700;background:rgba(10,39,28,.8)}.teaching-d09-calendar-history[open]>.teaching-d09-calendar-history__summary{margin-bottom:12px}.teaching-d09-calendar-hero-meta button{min-height:38px}' +
    '@media(max-width:760px){.teaching-d09-grid,.teaching-d09-fields{grid-template-columns:1fr}.teaching-d09-row{grid-template-columns:1fr}.teaching-d09-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.teaching-d09-calendar-hero{grid-template-columns:1fr}.teaching-d09-calendar-hero__meta{justify-content:flex-start}}' +
    '@media(max-width:520px){.teaching-d09-calendar-day{border-radius:16px}.teaching-d09-calendar-day__head{padding:13px 14px}.teaching-d09-calendar-row{grid-template-columns:78px minmax(0,1fr);gap:12px;padding:15px 14px}.teaching-d09-calendar-row__time{font-size:10px}.teaching-d09-calendar-row__top{gap:8px}.teaching-d09-calendar-row__title strong{font-size:14px}.teaching-d09-calendar-kind{padding:4px 7px;font-size:9px}.teaching-d09-calendar-actions{gap:7px}.teaching-d09-calendar-actions button{min-height:40px;padding:0 8px;font-size:10.5px}}';
  document.head.append(style);
}
function statusName(value) { return String(value || 'Pending').replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()); }
function localParts(date, zone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
    .formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type,p.value]));
}
function wallToIso(dateKey, time, zone) {
  const ymd = dateKey.split('-').map(Number), hm = time.split(':').map(Number);
  const target = Date.UTC(ymd[0],ymd[1]-1,ymd[2],hm[0],hm[1]); let guess = target;
  for (let i=0;i<5;i+=1) { const p=localParts(new Date(guess),zone); const observed=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute); const delta=target-observed; if (!delta) break; guess+=delta; }
  const matches=[];
  for (let delta=-180;delta<=180;delta+=15) { const ms=guess+delta*60000,p=localParts(new Date(ms),zone); if (p.year+'-'+p.month+'-'+p.day===dateKey && p.hour+':'+p.minute===time) matches.push(ms); }
  if (!matches.length) throw new Error('That local time does not exist in '+zone+' because of a timezone transition.');
  return new Date(Math.min(...matches)).toISOString();
}
function isoToLocalInput(value, zone) { if (!value) return ''; const p=localParts(new Date(value),zone); return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute; }
function dateInputValue(date) { const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return y+'-'+m+'-'+d; }
function useNativePicker(input) {
  input.addEventListener('click',()=>{try{input.showPicker?.();}catch(_){}});
  input.addEventListener('keydown',(event)=>{if((event.key==='Enter'||event.key===' ')&&input.showPicker){event.preventDefault();try{input.showPicker();}catch(_){}}});
  return input;
}
async function fetchReview(courseId) { return kiwiApiRequest('/teaching/courses/'+encodeURIComponent(courseId)+'/schedule-review'); }
function dayPicker(selected) {
  const box=el('div','teaching-d09-days'), set=new Set((selected||[]).map(Number));
  DAYS.forEach((label,index)=>{ const wrap=el('label','teaching-d09-day'), input=el('input'); input.type='checkbox'; input.value=String(index); input.checked=set.has(index); wrap.append(input,document.createTextNode(label)); box.append(wrap); });
  return box;
}
function selectedDays(box) { return [...box.querySelectorAll('input:checked')].map((input)=>Number(input.value)); }
function metric(value,label) { const box=el('div','teaching-d09-metric'); box.append(el('strong','',String(value == null ? '—' : value)),el('span','',label)); return box; }
function showScheduleLoading(page,label='Loading Semester timetable') {
  const skeleton=el('div','teaching-shell-skeleton');skeleton.setAttribute('role','status');skeleton.setAttribute('aria-label',label);
  const card=el('div','teaching-skeleton-card'),title=el('div','teaching-skeleton-line');title.dataset.size='title';
  card.append(title,el('div','teaching-skeleton-line'),el('div','teaching-skeleton-block'));skeleton.append(card);page.replaceChildren(skeleton);
}
function addField(grid,label,input) { const field=el('div','teaching-d09-field'); field.append(el('label','',label),input); grid.append(field); }
function blockRow(block,zoneInput,courseId) {
  const row=el('div','teaching-d09-row'); row.dataset.block='true';
  const kind=el('select');
  ['HARD_UNAVAILABLE','BREAK','HOLIDAY','TRAVEL','PROTECTED_REVISION','PROTECTED_ASSESSMENT'].forEach((value)=>{ const option=el('option','',statusName(value)); option.value=value; option.selected=value===(block?.kind||'HARD_UNAVAILABLE'); kind.append(option); });
  const start=useNativePicker(el('input')); start.type='datetime-local'; start.value=isoToLocalInput(block?.startsAt,zoneInput.value);
  const end=useNativePicker(el('input')); end.type='datetime-local'; end.value=isoToLocalInput(block?.endsAt,zoneInput.value);
  const remove=el('button','teaching-d08-link-button','Remove'); remove.type='button'; remove.addEventListener('click',()=>row.remove());
  row.append(kind,start,end,remove);
  row.readValue=()=>{ if (!start.value || !end.value) return null; const sv=start.value.split('T'), ev=end.value.split('T'),zone=zoneInput.value.trim(); return { kind:kind.value, startsAt:wallToIso(sv[0],sv[1],zone), endsAt:wallToIso(ev[0],ev[1],zone), courseId:kind.value.startsWith('PROTECTED_') ? courseId : null }; };
  return row;
}
function stage4(course,data,container,reload) {
  const card=el('section','teaching-d09-card');
  card.append(el('div','teaching-kicker','Scheduling preferences'),el('h3','','Semester and availability'),el('p','','Your weekly availability is shared across the Semester; it belongs to the Semester, not to one Course. Saving it anywhere creates a new shared scheduling profile and KIWI rebuilds one Semester timetable across every Course whose current Course Plan is ready.'));
  const sem=data.semester||{}, grid=el('div','teaching-d09-fields');
  const name=el('input'); name.value=sem.name||'Semester';
  const today=new Date(),defaultEnd=new Date(today);defaultEnd.setMonth(defaultEnd.getMonth()+4);
  const start=useNativePicker(el('input')); start.type='date'; start.value=(sem.startsAt||'').slice(0,10)||dateInputValue(today);
  const end=useNativePicker(el('input')); end.type='date'; end.value=(sem.endsAt||'').slice(0,10)||dateInputValue(defaultEnd);
  const zone=el('input'); zone.value=sem.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  addField(grid,'Semester name',name); addField(grid,'Start date',start); addField(grid,'End date',end); addField(grid,'Timetable timezone',zone); card.append(grid);
  if(data.inheritedAvailability){
    card.append(el('div','teaching-message','Using your Semester availability for this Course. KIWI will add it to the shared Semester timetable when the Course Plan is ready.'));
  }

  const windows=data.profile?.availability||[], available=windows.filter((x)=>x.kind==='AVAILABLE'), recovery=windows.filter((x)=>x.kind==='RECOVERY_ONLY'), hard=windows.filter((x)=>x.kind==='HARD_UNAVAILABLE');
  const availDays=dayPicker(available.length?available.map((x)=>x.dayOfWeek):[1,2,3,4,5]);
  const recoveryDays=dayPicker(recovery.map((x)=>x.dayOfWeek));
  const hardDays=dayPicker(hard.map((x)=>x.dayOfWeek));
  function windowGroup(title,picker,startValue,endValue) {
    const sub=el('div','teaching-d09-card'); sub.style.marginTop='10px'; sub.append(el('strong','',title),picker);
    const times=el('div','teaching-d09-fields'), a=useNativePicker(el('input')), b=useNativePicker(el('input')); a.type='time'; b.type='time'; a.value=startValue; b.value=endValue; addField(times,'From',a); addField(times,'To',b); sub.append(times); card.append(sub); return {start:a,end:b};
  }
  const availTime=windowGroup('Available days',availDays,available[0]?.startLocal||'09:00',available[0]?.endLocal||'12:00');
  const recoveryTime=windowGroup('Recovery-only days',recoveryDays,recovery[0]?.startLocal||'10:00',recovery[0]?.endLocal||'12:00');
  const hardTime=windowGroup('Recurring hard-unavailable days',hardDays,hard[0]?.startLocal||'13:00',hard[0]?.endLocal||'14:00');

  const blocks=el('div');
  (data.profile?.blocks||[]).filter((b)=>!b.courseId||String(b.courseId)===String(course.course_id)).forEach((b)=>blocks.append(blockRow(b,zone,course.course_id)));
  const addBlock=el('button','teaching-d08-link-button','Add break / hard block'); addBlock.type='button'; addBlock.addEventListener('click',()=>blocks.append(blockRow(null,zone,course.course_id)));
  card.append(el('p','teaching-d09-note','Hard-unavailable periods, breaks, holidays and travel are never violated. Protected periods admit only their intended revision/assessment work.'),blocks,addBlock);

  const academic=el('div','teaching-d09-fields');
  const deadline=useNativePicker(el('input')); deadline.type='datetime-local';
  const currentDeadline=data.profile?.deadlines?.find((d)=>String(d.courseId)===String(course.course_id)); deadline.value=isoToLocalInput(currentDeadline?.deadlineAt,zone.value);
  const deadlineKind=el('select'); ['FLEXIBLE','HARD'].forEach((value)=>{const option=el('option','',statusName(value));option.value=value;option.selected=value===(currentDeadline?.kind||'FLEXIBLE');deadlineKind.append(option);});
  const revision=el('input'); revision.type='number'; revision.min='0'; revision.value=String(data.profile?.reserves?.find((r)=>r.kind==='REVISION'&&String(r.courseId)===String(course.course_id))?.minutes||0);
  const assessment=el('input'); assessment.type='number'; assessment.min='0'; assessment.value=String(data.profile?.reserves?.find((r)=>r.kind==='ASSESSMENT'&&String(r.courseId)===String(course.course_id))?.minutes||0);
  addField(academic,'Target/deadline',deadline); addField(academic,'Deadline type',deadlineKind); addField(academic,'Revision reserve minutes',revision); addField(academic,'Assessment reserve minutes',assessment); card.append(academic);

  const postActivation=data.semesterHasActivatedCourses===true||!['DRAFT','READY','PLANNING','SETUP'].includes(String(course.lifecycle_state||'DRAFT'));
  const backgroundBuild=data.backgroundBuild||null,buildActive=backgroundBuild?.active===true;
  const message=el('div'), actions=el('div','teaching-d09-actions'), save=el('button','teaching-button teaching-button--primary',postActivation?'Request this availability change':'Save availability'); save.type='button'; actions.append(save); card.append(actions,message);
  save.addEventListener('click',async()=>{
    save.disabled=true;
    message.textContent=postActivation?'Preparing the governed availability-change Request…':'Saving shared availability and queueing the Semester timetable rebuild…';message.className='teaching-message';delete message.dataset.kind;
    try {
      const tz=zone.value.trim(); if(!name.value.trim()) throw new Error('Enter a semester name.'); if(!start.value||!end.value) throw new Error('Semester start and end dates are required.');
      const availability=[];
      selectedDays(availDays).forEach((day)=>availability.push({dayOfWeek:day,startLocal:availTime.start.value,endLocal:availTime.end.value,kind:'AVAILABLE'}));
      selectedDays(recoveryDays).forEach((day)=>availability.push({dayOfWeek:day,startLocal:recoveryTime.start.value,endLocal:recoveryTime.end.value,kind:'RECOVERY_ONLY'}));
      selectedDays(hardDays).forEach((day)=>availability.push({dayOfWeek:day,startLocal:hardTime.start.value,endLocal:hardTime.end.value,kind:'HARD_UNAVAILABLE'}));
      if(!availability.some((item)=>item.kind==='AVAILABLE')) throw new Error('Choose at least one available day.');
      const blockValues=[...blocks.children].map((row)=>row.readValue?.()).filter(Boolean), deadlines=[];
      if(deadline.value){const parts=deadline.value.split('T');deadlines.push({kind:deadlineKind.value,deadlineAt:wallToIso(parts[0],parts[1],tz)});}
      const body={semester:{semesterId:sem.semesterId||null,name:name.value,startsAt:wallToIso(start.value,'00:00',tz),endsAt:wallToIso(end.value,'23:59',tz),timezone:tz},availability,blocks:blockValues,deadlines,reserves:[{kind:'REVISION',minutes:Number(revision.value)||0},{kind:'ASSESSMENT',minutes:Number(assessment.value)||0}],preferences:{avoidConsecutiveSameCourseDays:true,preferredStartTimes:[availTime.start.value]}};
      if(postActivation){
        if(!window.KIWITeachingD10?.createScheduleRequest) throw new Error('Formal Request Center is unavailable.');
        await window.KIWITeachingD10.createScheduleRequest(course.course_id,body);
        message.textContent='A formal availability-change Request was created. The current timetable remains authoritative until approval/application.';
      }else{
        try{
          const saved=await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/schedule-inputs',{method:'PUT',body});
          const sync=saved?.automaticRecalculation||null;
          const notice=sync?.recalculated
            ? {text:`Shared availability saved. Semester timetable v${sync.timetableVersion??'new'} was rebuilt across ${sync.affectedCourseCount||sync.affectedCourseIds?.length||1} Course${(sync.affectedCourseCount||sync.affectedCourseIds?.length||1)===1?'':'s'}.`,kind:'success'}
            : sync?.reason==='CURRENT_COURSE_PLAN_REQUIRED'
              ? {text:'Shared availability saved. KIWI will build the Semester timetable automatically as soon as a current Course Plan is ready.',kind:'info'}
              : {text:'Shared availability was saved, but the Semester timetable rebuild needs attention. Older timetable versions are stale and are not treated as current.',kind:'warning'};
          await reload(saved,notice);
        }catch(error){
          if(['TEACHING_D09_ACTIVE_SEMESTER_AVAILABILITY_REQUIRES_REQUEST','TEACHING_D09_ACTIVE_SEMESTER_REQUEST_REQUIRED'].includes(error?.code)&&window.KIWITeachingD10?.createScheduleRequest){
            await window.KIWITeachingD10.createScheduleRequest(course.course_id,body);
            message.textContent='This Semester already has an active Course, so KIWI created a formal availability-change Request. The shared timetable will recalculate when that change is applied.';
            message.className='teaching-message';
            return;
          }
          throw error;
        }
      }
      message.className='teaching-message';
    } catch(error) { message.textContent=scheduleActionError(error,'Availability could not be saved.'); message.className='teaching-message'; message.dataset.kind='error'; }
    finally { save.disabled=false; }
  });
  container.append(card);
}
function stage5(course,data,container,reload,onQueued) {
  const card=el('section','teaching-d09-card');
  card.append(el('div','teaching-kicker','Timetable'),el('h3','','Shared Semester timetable'),el('p','','Proposed timetable and feasibility are Semester-wide. Existing activated Courses keep their approved Class times; a draft Course can request a new expansion proposal without editing those live Classes.'));
  const buildActive=data.backgroundBuild?.active===true;
  const timetableState=String(data.timetable?.state||'').toUpperCase();
  if(['PROPOSED','EDITED_PROPOSAL'].includes(timetableState)){
    card.append(el('div','teaching-message',
      'Draft timetable proposal — not an approved Class obligation. Review its proposed times separately in Calendar. Existing active-Course Classes retain their approved schedule until an authorized change.'));
  }else if(timetableState==='APPROVED'){
    card.append(el('div','teaching-message',
      'Approved Class schedule. Changing its times requires the authorized Scheduling Request process.'));
  }else if(timetableState==='STALE'){
    card.append(el('div','teaching-message',
      'This timetable is outdated. Previous Class records are preserved; review rebuild status before relying on its proposed times.'));
  }
  // Global availability changes are governed once *any* Course activates,
  // but draft-Course timetable proposals are still allowed. D09 enforces
  // COURSE_ADMISSION_EXPANSION_PROPOSAL and freezes approved active Classes.
  const postActivation=!['DRAFT','READY','PLANNING','SETUP'].includes(String(course.lifecycle_state||'DRAFT'));
  const missingInputs=!data.semester||!data.profile;
  const unresolvedSelf=(data.unresolvedSemesterCourses||[]).filter((item)=>String(item.courseId||item.course_id||'')===String(course.course_id));
  const missingAttachment=unresolvedSelf.some((item)=>item.reason==='COURSE_NOT_ATTACHED_TO_DEFAULT_SEMESTER');
  const missingPlan=unresolvedSelf.some((item)=>item.reason==='COURSE_PLAN_NOT_READY');
  const actions=el('div','teaching-d09-actions'), propose=el('button','teaching-button teaching-button--primary',buildActive?'Timetable building in background':postActivation?'Timetable locked after activation':(data.timetable?'Rebuild Semester timetable':'Build Semester timetable')), status=el('span','teaching-d09-status',buildActive?'Running in background':statusName(data.feasibility?.outcome||'Not calculated')); propose.type='button';propose.disabled=buildActive||postActivation||missingInputs||missingPlan; actions.append(propose,status); card.append(actions);
  if(missingInputs){card.append(el('div','teaching-message','Save your semester and availability before creating the timetable.'));}
  else {
    if(missingAttachment) card.append(el('div','teaching-message','This Course is already using your shared Semester availability. When the timetable is proposed, KIWI rebuilds the future Semester schedule as one combined workload: elapsed Classes stay fixed, while existing future Classes may shift so the new Course is integrated naturally instead of being bolted on.'));
    if(missingPlan){const guidance=el('div','teaching-message'),openPlan=el('button','teaching-d08-link-button','Open Course Plan');openPlan.type='button';openPlan.addEventListener('click',()=>courseSurface.openCourse(course.course_id,'course-plan'));guidance.append(document.createTextNode('Create the Course Plan before proposing a timetable. '),openPlan);card.append(guidance);}
  }
  if(buildActive)card.append(el('div','teaching-message','KIWI is building the shared Semester timetable in the background. You can leave this page; the build will continue.'));
  const courseSummary=data.feasibility?.courseSummary||null;const courseSlots=Array.isArray(data.courseSlots)?data.courseSlots:(data.slots||[]).filter((slot)=>String(slot.courseId||slot.course_id||'')===String(course.course_id));const scheduledMinutes=courseSummary?.scheduledMinutes??courseSlots.reduce((sum,slot)=>sum+(Number(slot.plannedMinutes)||Math.max(0,Math.round((Date.parse(slot.endsAt)-Date.parse(slot.startsAt))/60000))),0);const metrics=el('div','teaching-d09-metrics'); metrics.append(metric(scheduledMinutes,'scheduled minutes'),metric(courseSummary?.requiredMinutes??0,'required minutes'),metric(data.feasibility?.metrics?.headroomRatio==null?'—':Math.round(data.feasibility.metrics.headroomRatio*100)+'%','Recovery headroom (Semester)')); card.append(metrics);
  if(data.feasibility?.reasons?.length){const list=el('ul','teaching-d08-list');data.feasibility.reasons.forEach((reason)=>list.append(el('li','',statusName(reason))));card.append(list);}
  if(data.feasibility?.alternatives?.length){card.append(el('p','teaching-d09-note','Feasible alternatives'));const list=el('ul','teaching-d08-list');data.feasibility.alternatives.forEach((item)=>list.append(el('li','',item.message)));card.append(list);}
  card.append(el('p','teaching-d09-note',data.scheduleHealth?.debtState==='SCHEDULE_DEBT_PRESENT'?'Schedule pressure is present. KIWI preserves unmet work internally and surfaces recovery options rather than a raw debt score.':'No current schedule-debt condition is exposed. Ahead time builds buffer or optional enrichment; acceleration still requires trustworthy learning evidence.'));
  const slotList=el('div');
  courseSlots.forEach((slot)=>{
    const item=el('article','teaching-d09-slot'), top=el('div','teaching-d09-slot__top'); top.append(el('strong','',statusName(slot.kind)),el('span','teaching-d09-status',slot.horizonStage)); item.append(top,el('small','',new Date(slot.startsAt).toLocaleString()+' → '+new Date(slot.endsAt).toLocaleString()+' · '+slot.timezone));
    const slotActions=el('div','teaching-d09-actions');
    if(!postActivation){[['Earlier 30m',-30],['Later 30m',30]].forEach((choice)=>{const button=el('button','teaching-d08-link-button',choice[0]);button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{const updated=await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/timetable',{method:'PUT',body:{edits:[{slotId:slot.slotId,startsAt:new Date(Date.parse(slot.startsAt)+choice[1]*60000).toISOString(),endsAt:new Date(Date.parse(slot.endsAt)+choice[1]*60000).toISOString(),exceptionReason:'Student pre-activation direct edit'}]}});await reload(updated,'Timetable updated.');}catch(error){window.alert(error.message||'That edit is not feasible.');}finally{button.disabled=false;}});slotActions.append(button);});}else{slotActions.append(el('span','teaching-d09-note','Use Calendar → Request new time.'));}
    item.append(slotActions); slotList.append(item);
  });
  card.append(slotList);
  const proposalMessage=el('div');proposalMessage.setAttribute('role','status');proposalMessage.setAttribute('aria-live','polite');card.append(proposalMessage);
  propose.addEventListener('click',async()=>{
    propose.disabled=true;
    proposalMessage.textContent='Submitting the Semester timetable rebuild…';
    proposalMessage.className='teaching-message';
    try{
      const accepted=await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/timetable/propose',{method:'POST',body:{}});
      if(!accepted?.accepted&&!accepted?.background)throw Object.assign(new Error('The server did not acknowledge a background rebuild.'),{code:'TEACHING_D09_BUILD_NOT_ACKNOWLEDGED'});
      proposalMessage.textContent=accepted.joinedExisting?'A matching timetable build is already running.':'Build queued. The existing timetable remains visible while KIWI computes the replacement.';
      proposalMessage.dataset.kind='success';
      onQueued?.({jobId:accepted.jobId||null,unknown:false});
    }catch(error){
      // A network timeout cannot tell us whether an idempotent job was accepted.
      // Check the authoritative job status; never automatically submit a
      // duplicate or claim the existing timetable was deleted.
      if(error?.code==='KIWI_API_TIMEOUT'){
        proposalMessage.textContent='Request timed out. Checking KIWI for the rebuild job; the previous timetable has not been deleted.';
        proposalMessage.dataset.kind='warning';
        onQueued?.({unknown:true});
      }else{
        proposalMessage.textContent=scheduleActionError(error,'Semester timetable build could not be started.');
        proposalMessage.dataset.kind='error';
        propose.disabled=false;
      }
    }
  });
  container.append(card);
}
async function renderSchedule({course,container}) {
  installStyles(); const page=el('div','teaching-d09-page'),live=el('div');live.setAttribute('role','status');live.setAttribute('aria-live','polite'); container.replaceChildren(page);
  let buildPollTimer=null,buildGeneration=0,lastRendered=null;
  function queueStatusPoll({jobId=null,unknown=false}={}){
    if(buildPollTimer!=null)window.clearTimeout(buildPollTimer);
    const generation=++buildGeneration;
    let attempt=0;
    const poll=async()=>{
      if(!page.isConnected||generation!==buildGeneration)return;
      try{
        const review=await fetchReview(course.course_id);
        if(!page.isConnected||generation!==buildGeneration)return;
        const build=review.backgroundBuild;
        if(unknown&&!build){
          live.textContent='The request outcome could not be confirmed. The previous timetable is preserved; use Refresh before trying another build.';
          live.dataset.kind='warning';return;
        }
        if(jobId&&build?.eventId!==jobId){
          // Do not mistake a previously published job for this submission.
          // The shared Semester worker may be advancing a different Course.
          if(++attempt>=45){
            live.textContent='This rebuild could not be matched to a current job. Your saved proposal and approved Classes have not been erased. Refresh to verify before trying again.';
            live.dataset.kind='warning';return;
          }
          live.textContent=build?.active?'A different Semester build is running; waiting for confirmation.':'Waiting for the newly queued job to become visible. Previous timetable remains unchanged.';
          live.className='teaching-message';
          buildPollTimer=window.setTimeout(poll,8000);return;
        }else if(build?.active){
          live.textContent='Timetable build running in the background. Existing course and availability details remain editable.';
        }else if(build&&['FAILED','CANCELLED'].includes(String(build.status||'').toUpperCase())){
          live.textContent=scheduleActionError({code:build.lastErrorCode},'The build ended without replacing the timetable. Your previous records are preserved.');
          live.dataset.kind='error';
          return;
        }else if(build&&build.status==='PUBLISHED'){
          const before=lastRendered?.timetable?.timetableVersionId||null;
          const after=review.timetable?.timetableVersionId||null;
          const updated=Boolean(after&&after!==before);
          await refresh(review,{text:updated
            ? 'A new timetable version is available. Review its proposed or approved status before relying on it.'
            : 'The background job completed without replacing the visible timetable. Existing approved Classes and proposals remain authoritative as before.',
            kind:updated?'success':'warning'});
          return;
        }else{
          live.textContent='No current build was found; your previous timetable remains unchanged.';
          live.dataset.kind='warning';return;
        }
        live.className='teaching-message';
        buildPollTimer=window.setTimeout(poll,Math.min(12000,4000+attempt++*1000));
      }catch(error){
        if(!page.isConnected||generation!==buildGeneration)return;
        live.textContent='KIWI could not check the rebuild yet. Retrying without erasing your current schedule.';
        live.className='teaching-message';live.dataset.kind='warning';
        buildPollTimer=window.setTimeout(poll,10000);
      }
    };
    buildPollTimer=window.setTimeout(poll,2500);
  }
  function renderData(data,notice=null){
    if(buildPollTimer!=null){window.clearTimeout(buildPollTimer);buildPollTimer=null;}
    ++buildGeneration;
    lastRendered=data;
    const grid=el('div','teaching-d09-grid'),left=el('div'),right=el('div');
    grid.append(left,right);page.replaceChildren(live,grid);
    stage4(course,data,left,refresh);
    stage5(course,data,right,refresh,queueStatusPoll);
    const text=typeof notice==='string'?notice:notice?.text||'';
    live.textContent=text;live.className=text?'teaching-message':'';delete live.dataset.kind;
    if(text&&notice?.kind)live.dataset.kind=notice.kind;
    // Poll only job status. Do not rebuild the student's availability editor
    // every five seconds: that previously caused blinking and lost input.
    if(data.backgroundBuild?.active)queueStatusPoll({jobId:data.backgroundBuild.eventId});
  }
  async function refresh(prefetched=null,notice=null){
    try{renderData(prefetched||await fetchReview(course.course_id),notice);}
    catch(error){
      if(lastRendered){live.textContent=scheduleActionError(error,'Scheduling refresh failed. Existing information is preserved.');live.className='teaching-message';live.dataset.kind='error';return;}
      page.replaceChildren(el('div','teaching-message',error.message||'Scheduling could not be loaded.'));
      page.firstElementChild.dataset.kind='error';
    }
  }
  showScheduleLoading(page,'Loading Semester availability and timetable');
  await refresh();
}
async function renderSummary({course,container,openSection}) {
  installStyles(); const card=el('article','teaching-course-feature-card'); card.append(el('div','teaching-kicker','Time and pacing'),el('h3','','Semester & Timetable'),el('p','','Set availability, preserve recovery capacity, and check whether the current Course Plan actually fits the academic period.'));
  const actions=el('div','teaching-course-feature-card__actions'), open=el('button','teaching-d08-link-button teaching-d08-link-button--primary','Open scheduling');open.type='button';open.addEventListener('click',openSection);actions.append(open);card.append(actions);container.replaceChildren(card);
  try{const data=await fetchReview(course.course_id);if(data.feasibility){const badge=el('span','teaching-course-feature-card__status',statusName(data.feasibility.outcome));card.insertBefore(badge,card.children[1]);}}catch(_){}
}
function calendarStart(item){return item?.startsAt||item?.starts_at||null;}
function calendarEnd(item){return item?.endsAt||item?.ends_at||null;}
function calendarDayKey(value,zone){
  if(!value)return 'unscheduled';
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'unscheduled';
  try{const p=localParts(date,zone);return `${p.year}-${p.month}-${p.day}`;}catch{return date.toISOString().slice(0,10);}
}
function displayCalendarDay(value,zone){
  if(!value)return 'Time not set';
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Time not set';
  try{return new Intl.DateTimeFormat(undefined,{timeZone:zone,weekday:'long',month:'short',day:'numeric'}).format(date);}catch{return date.toLocaleDateString();}
}
function displayCalendarTime(value,zone){
  if(!value)return '—';
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';
  try{return new Intl.DateTimeFormat(undefined,{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(date);}catch{return date.toLocaleTimeString();}
}
function calendarDuration(item){
  const explicit=Number(item?.plannedMinutes??item?.planned_minutes);
  if(Number.isFinite(explicit)&&explicit>0)return Math.round(explicit);
  const start=Date.parse(calendarStart(item)||''),end=Date.parse(calendarEnd(item)||'');
  return Number.isFinite(start)&&Number.isFinite(end)&&end>start?Math.round((end-start)/60000):null;
}
function groupCalendarItems(items,zone){
  const groups=new Map();
  [...items].sort((a,b)=>Date.parse(calendarStart(a)||0)-Date.parse(calendarStart(b)||0)).forEach((item)=>{
    const start=calendarStart(item),key=calendarDayKey(start,zone);
    if(!groups.has(key))groups.set(key,{key,label:displayCalendarDay(start,zone),items:[]});
    groups.get(key).items.push(item);
  });
  return [...groups.values()];
}
function calendarEventCard(item,data){
  const kind=String(item.kind||'CLASS').toUpperCase(),card=el('article','teaching-d09-calendar-row'),zone=data.currentTimeZone||'UTC';
  const start=calendarStart(item),end=calendarEnd(item),time=el('div','teaching-d09-calendar-row__time');
  time.append(el('span','',displayCalendarTime(start,zone)),el('span','',end?displayCalendarTime(end,zone):'—'));
  const body=el('div','teaching-d09-calendar-row__body'),top=el('div','teaching-d09-calendar-row__top'),title=el('div','teaching-d09-calendar-row__title');
  const kindLabel=kind==='ASSESSMENT'?statusName(item.assessmentType||'Assessment'):'Class',duration=calendarDuration(item),courseName=item.course_title||item.courseTitle||'Course',itemTitle=item.title&&item.title!==courseName?item.title:null;
  title.append(el('strong','',courseName),el('div','teaching-d09-calendar-row__meta',(itemTitle?`${itemTitle} · `:'')+(kind==='ASSESSMENT'?'Announced assessment':'Approved schedule')+(duration?` · ${duration} min`:'')));
  const badge=el('span','teaching-d09-calendar-kind',kindLabel);badge.dataset.kind=kind;top.append(title,badge);body.append(top);
  const isPast=Number.isFinite(Date.parse(end||start||''))&&Date.parse(end||start)<=Date.parse(data.serverNow||new Date().toISOString());
  if(isPast&&kind==='CLASS'){
    const names={ON_TIME:'Attended',LATE:'Late',PARTIAL:'Partially attended',UNEXCUSED_ABSENCE:'Missed',EXCUSED_ABSENCE:'Excused',APPROVED_LEAVE:'Approved leave',PENDING:'Attendance pending',SYSTEM_PROTECTED:'System protected',INTERRUPTED:'Interrupted'};
    const code=String(item.attendanceOutcome||'PENDING').toUpperCase();
    const status=names[code]||code.toLowerCase().replaceAll('_',' ');
    body.append(el('div','teaching-d09-calendar-row__meta',status+(Number(item.missedMinutes)>0?' · '+item.missedMinutes+' min missed':'')));
  }
  if(kind==='CLASS'&&!isPast&&window.KIWITeachingD10){
    const actions=el('div','teaching-d09-calendar-actions'),move=el('button','teaching-d08-link-button','Request new time'),absence=el('button','teaching-d08-link-button','Emergency absence');
    move.type=absence.type='button';absence.dataset.tone='urgent';
    move.setAttribute('aria-label',`Request a new time for ${displayCalendarDay(start,zone)} at ${displayCalendarTime(start,zone)}`);
    absence.setAttribute('aria-label',`Report emergency absence for ${displayCalendarDay(start,zone)} at ${displayCalendarTime(start,zone)}`);
    move.addEventListener('click',()=>window.KIWITeachingD10.requestClassReschedule(item));absence.addEventListener('click',()=>window.KIWITeachingD10.emergencyAbsence(item));actions.append(move,absence);body.append(actions);
  }
  card.append(time,body);return card;
}
function proposalCard(item,data){
  const card=el('article','teaching-d09-calendar-row'),zone=data.currentTimeZone||'UTC',start=calendarStart(item),end=calendarEnd(item),time=el('div','teaching-d09-calendar-row__time');
  time.append(el('span','',start?displayCalendarTime(start,zone):(item.displayStart||'—')),el('span','',end?displayCalendarTime(end,zone):(item.displayEnd||'—')));
  const body=el('div','teaching-d09-calendar-row__body'),top=el('div','teaching-d09-calendar-row__top'),title=el('div','teaching-d09-calendar-row__title'),duration=calendarDuration(item);
  title.append(el('strong','',item.course_title||item.title||'Proposed Class'),el('div','teaching-d09-calendar-row__meta','Pre-activation proposal'+(duration?` · ${duration} min`:'')));
  const badge=el('span','teaching-d09-calendar-kind','Proposed');badge.dataset.kind='PROPOSAL';top.append(title,badge);body.append(top);card.append(time,body);return card;
}
function calendarGroupedList(items,data,renderer){
  const list=el('div','teaching-d09-calendar'),zone=data.currentTimeZone||'UTC';
  groupCalendarItems(items,zone).forEach((group)=>{
    const day=el('section','teaching-d09-calendar-day'),head=el('div','teaching-d09-calendar-day__head'),body=el('div','teaching-d09-calendar-day__items');
    head.append(el('strong','',group.label),el('span','',group.items.length+' item'+(group.items.length===1?'':'s')));
    group.items.forEach((item)=>body.append(renderer(item,data)));day.append(head,body);list.append(day);
  });
  return list;
}
async function renderCalendar() {
  installStyles();
  const main=document.getElementById('teachingApp');if(!main)return;
  const page=el('section','teaching-view teaching-d09-page'),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  const head=el('div','teaching-d09-card teaching-d09-calendar-hero'),copy=el('div','teaching-d09-calendar-hero__copy'),meta=el('div','teaching-d09-calendar-hero__meta');
  copy.append(el('div','teaching-kicker','Calendar'),el('h2','','Teaching Calendar'),el('p','','Classes and announced assessments share one timetable. Upcoming obligations stay separate from Class history; earlier Class attendance is preserved below.'));
  const back=el('button','teaching-d08-link-button','Back to courses');back.type='button';back.addEventListener('click',()=>courseSurface.openOverview?courseSurface.openOverview():window.location.reload());
  const refreshButton=el('button','teaching-d08-link-button','Refresh Calendar');refreshButton.type='button';
  meta.append(el('span','teaching-d09-calendar-zone',`Times shown in ${zone}`),refreshButton,back);head.append(copy,meta);
  const updated=el('div','teaching-d09-calendar-refresh');updated.setAttribute('role','status');updated.setAttribute('aria-live','polite');
  const content=el('div','teaching-d09-calendar-content');page.append(head,updated,content);main.replaceChildren(page);
  let loading=false,hasData=false,historyOpen=false,lastCalendarSignature=null;
  async function refresh(){
    if(!page.isConnected||loading)return;
    loading=true;refreshButton.disabled=true;
    try{
      const data=await kiwiApiRequest('/teaching/information/calendar?currentTimeZone='+encodeURIComponent(zone));
      if(!page.isConnected)return;
      const events=Array.isArray(data.events)?data.events:[],proposals=Array.isArray(data.preactivationProposals)?data.preactivationProposals:[];
      const now=Date.parse(data.serverNow)||Date.now();
      const past=events.filter((item)=>item.kind==='CLASS'&&Number.isFinite(Date.parse(calendarEnd(item)||calendarStart(item)||''))&&Date.parse(calendarEnd(item)||calendarStart(item))<=now);
      const upcoming=events.filter((item)=>!past.includes(item));
      const body=el('div','teaching-d09-calendar-sections');
      if(upcoming.length){const section=el('section','teaching-d09-calendar-section'),sectionHead=el('div','teaching-d09-calendar-section__head');sectionHead.append(el('h3','','Upcoming & active'),el('span','',upcoming.length+' item'+(upcoming.length===1?'':'s')));section.append(sectionHead,calendarGroupedList(upcoming,data,calendarEventCard));body.append(section);}
      if(proposals.length){const section=el('section','teaching-d09-calendar-section'),sectionHead=el('div','teaching-d09-calendar-section__head');sectionHead.append(el('h3','','Proposed course times'),el('span','',proposals.length+' item'+(proposals.length===1?'':'s')));section.append(sectionHead,calendarGroupedList(proposals,data,proposalCard));body.append(section);}
      if(past.length){
        const detail=el('details','teaching-d09-calendar-section teaching-d09-calendar-history');detail.open=historyOpen;
        detail.addEventListener('toggle',()=>{historyOpen=detail.open;});
        detail.append(el('summary','teaching-d09-calendar-history__summary',`Past Class history (${past.length}) · attendance and missed time`),calendarGroupedList(past,data,calendarEventCard));body.append(detail);
      }
      if(!events.length&&!proposals.length)body.append(el('div','teaching-empty','No Teaching timetable items yet.'));
      if(data.issues?.length)body.append(el('div','teaching-message','Some calendar information is temporarily unavailable. The displayed items are still sourced from authoritative records.'));
      const signature=JSON.stringify({events,proposals,issues:data.issues||[]});
      if(signature!==lastCalendarSignature){content.replaceChildren(body);lastCalendarSignature=signature;}
      hasData=true;updated.textContent='Calendar updated · '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    }catch(error){if(!page.isConnected)return;updated.textContent='Calendar refresh failed. You can retry without leaving this page.';if(!hasData)content.replaceChildren(el('div','teaching-message',error.message||'Calendar could not be loaded.'));}
    finally{loading=false;refreshButton.disabled=false;}
  }
  refreshButton.addEventListener('click',refresh);
  await refresh();
  const onVisible=()=>{if(page.isConnected&&document.visibilityState==='visible')refresh();};
  document.addEventListener('visibilitychange',onVisible);window.addEventListener('focus',onVisible);
  const timer=window.setInterval(()=>{if(!page.isConnected){window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible);return;}if(document.visibilityState==='visible')refresh();},90000);
}
courseSurface.registerSection({id:'schedule',label:'Schedule',order:30,render:renderSchedule,renderSummary});
if(nav&&typeof nav.register==='function')nav.register({id:'calendar',label:'Calendar',description:'Classes and assessments in one timetable',icon:'◷',menuIcon:'calendar',onSelect:renderCalendar});
window.KIWITeachingD09=Object.freeze({openSchedule:(courseId)=>courseSurface.openCourse(courseId,'schedule'),openCalendar:renderCalendar});
