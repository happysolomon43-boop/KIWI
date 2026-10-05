const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};
if (typeof kiwiApiRequest !== 'function') throw new Error('KIWI shared API client must load before Teaching D09.');
const courseSurface = window.KIWITeachingCourses;
const nav = window.KIWITeachingNavigation;
if (!courseSurface || typeof courseSurface.registerSection !== 'function') throw new Error('KIWI Teaching course surface must load before Teaching D09.');

const STYLE_ID = 'teachingD09Styles';
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function el(tag, cls = '', text = null) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = el('style'); style.id = STYLE_ID;
  style.textContent =
    '.teaching-d09-page{display:grid;gap:16px}.teaching-d09-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.72fr);gap:14px}' +
    '.teaching-d09-card{padding:20px;border:1px solid rgba(223,245,235,.09);border-radius:20px;background:linear-gradient(155deg,rgba(11,34,26,.94),rgba(6,23,18,.92));box-shadow:0 18px 45px rgba(0,0,0,.12)}' +
    '.teaching-d09-card h3{margin:7px 0 0;font-family:var(--font-display);font-size:21px;letter-spacing:-.025em}.teaching-d09-card p{color:#8b9e95;font-size:12px;line-height:1.65}' +
    '.teaching-d09-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.teaching-d09-field{display:grid;gap:7px}' +
    '.teaching-d09-field label{font-size:10px;font-weight:760;letter-spacing:.035em;color:#9fb9ad}.teaching-d09-field input,.teaching-d09-field select{min-height:46px;padding:0 12px;border:1px solid rgba(223,245,235,.11);border-radius:12px;background:#061a14;color:var(--teaching-text);font:inherit}' +
    '.teaching-d09-field input[type="date"],.teaching-d09-field input[type="time"],.teaching-d09-field input[type="datetime-local"]{color-scheme:dark;cursor:pointer;touch-action:manipulation}' +
    '.teaching-d09-window-card{margin-top:12px;padding:16px;border:1px solid rgba(126,226,184,.12);border-radius:16px;background:rgba(126,226,184,.025)}' +
    '.teaching-d09-window-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.teaching-d09-window-head strong{font-family:var(--font-display);font-size:16px}.teaching-d09-window-head span{display:block;margin-top:4px;color:#789087;font-size:10px;line-height:1.45}' +
    '.teaching-d09-days{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.teaching-d09-day{display:flex;gap:7px;align-items:center;padding:8px 10px;border:1px solid rgba(223,245,235,.1);border-radius:11px;background:rgba(255,255,255,.018);font-size:11px;font-weight:650}.teaching-d09-day:has(input:checked){border-color:rgba(126,226,184,.34);background:rgba(126,226,184,.08);color:#d7f4e6}' +
    '.teaching-d09-ranges{display:grid;gap:9px;margin-top:12px}.teaching-d09-range{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end;padding:10px;border:1px solid rgba(223,245,235,.075);border-radius:13px;background:rgba(2,16,12,.38)}.teaching-d09-range__num{align-self:center;width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:rgba(126,226,184,.08);color:#87dfb8;font-family:var(--font-mono);font-size:9px;font-weight:800}.teaching-d09-range .teaching-d09-field{min-width:0}.teaching-d09-range .teaching-d08-link-button{min-height:46px}' +
    '.teaching-d09-window-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.teaching-d09-window-hint{color:#789087;font-size:10px;line-height:1.45}' +
    '.teaching-d09-row{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-top:8px}.teaching-d09-row input,.teaching-d09-row select{min-height:42px;padding:0 9px;border:1px solid var(--teaching-border);border-radius:10px;background:#061a14;color:var(--teaching-text)}' +
    '.teaching-d09-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.teaching-d09-status{padding:8px 10px;border-radius:999px;background:var(--teaching-accent-soft);color:var(--teaching-accent);font-size:10px;font-weight:760;display:inline-flex}' +
    '.teaching-d09-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.teaching-d09-metric{padding:11px;border:1px solid var(--teaching-border);border-radius:11px}' +
    '.teaching-d09-metric strong{display:block;font-family:var(--font-display);font-size:18px}.teaching-d09-metric span{display:block;color:#74877e;font-size:10px}.teaching-d09-slot{padding:12px;border:1px solid var(--teaching-border);border-radius:12px;margin-top:8px}' +
    '.teaching-d09-slot__top{display:flex;justify-content:space-between;gap:8px}.teaching-d09-slot small{display:block;margin-top:5px;color:#7e9288}.teaching-d09-note{font-size:11px;color:#74877e;line-height:1.55}' +
    '.teaching-d09-calendar{display:grid;gap:10px}.teaching-d09-calendar-item{padding:14px;border:1px solid var(--teaching-border);border-radius:12px;background:var(--teaching-surface-soft)}' +
    '@media(max-width:760px){.teaching-d09-grid,.teaching-d09-fields{grid-template-columns:1fr}.teaching-d09-row{grid-template-columns:1fr}.teaching-d09-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.teaching-d09-range{grid-template-columns:32px minmax(0,1fr) minmax(0,1fr)}.teaching-d09-range .teaching-d08-link-button{grid-column:2/4;width:100%}}';
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
function addField(grid,label,input) { const field=el('div','teaching-d09-field'); field.append(el('label','',label),input); grid.append(field); return field; }
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
function uniqueRanges(rows){
  const seen=new Set(),out=[];
  for(const row of rows){const key=`${row.startLocal}-${row.endLocal}`;if(!seen.has(key)){seen.add(key);out.push(row);}}
  return out;
}
function availabilityWindowGroup({title,description,picker,existing=[],defaults=[],multiple=false}){
  const sub=el('section','teaching-d09-window-card'),head=el('div','teaching-d09-window-head'),copy=el('div');
  copy.append(el('strong','',title),el('span','',description));head.append(copy);sub.append(head,picker);
  const list=el('div','teaching-d09-ranges');sub.append(list);
  const source=uniqueRanges(existing.map((row)=>({startLocal:row.startLocal,endLocal:row.endLocal})).filter((row)=>row.startLocal&&row.endLocal));
  const initial=source.length?source:defaults;
  function addRange(range={startLocal:'09:00',endLocal:'12:00'}){
    const row=el('div','teaching-d09-range'),num=el('span','teaching-d09-range__num',String(list.children.length+1).padStart(2,'0'));
    const a=useNativePicker(el('input')),b=useNativePicker(el('input'));a.type='time';b.type='time';a.value=range.startLocal;b.value=range.endLocal;
    const from=addField(el('div'),'From',a),to=addField(el('div'),'To',b),remove=el('button','teaching-d08-link-button','Remove');remove.type='button';
    remove.addEventListener('click',()=>{if(list.children.length<=1)return;row.remove();[...list.children].forEach((item,index)=>item.querySelector('.teaching-d09-range__num').textContent=String(index+1).padStart(2,'0'));});
    row.append(num,from,to,remove);row.readValue=()=>({startLocal:a.value,endLocal:b.value});list.append(row);
  }
  (initial.length?initial:[{startLocal:'09:00',endLocal:'12:00'}]).forEach(addRange);
  if(multiple&&list.children.length===1)addRange(defaults[1]||{startLocal:'16:00',endLocal:'19:00'});
  const actions=el('div','teaching-d09-window-actions');
  if(multiple){const addRangeButton=el('button','teaching-d08-link-button','+ Add another time window');addRangeButton.type='button';addRangeButton.addEventListener('click',()=>addRange());actions.append(addRangeButton);}
  actions.append(el('span','teaching-d09-window-hint',multiple?'Use separate windows when your day has a large break. KIWI will prefer spacing Classes instead of packing them back-to-back.':'This range repeats on each selected day.'));
  sub.append(actions);
  return {element:sub,readRanges(){return [...list.children].map((row)=>row.readValue()).filter((row)=>row.startLocal&&row.endLocal);}};
}
function stage4(course,data,container,reload) {
  const card=el('section','teaching-d09-card');
  card.append(el('div','teaching-kicker','Scheduling preferences'),el('h3','','Semester and availability'),el('p','','Tell KIWI when you are genuinely available. Multiple daily windows let the timetable preserve real breaks instead of treating your whole day as one continuous block.'));
  const sem=data.semester||{}, grid=el('div','teaching-d09-fields');
  const name=el('input'); name.value=sem.name||'Semester';
  const today=new Date(),defaultEnd=new Date(today);defaultEnd.setMonth(defaultEnd.getMonth()+4);
  const start=useNativePicker(el('input')); start.type='date'; start.value=(sem.startsAt||'').slice(0,10)||dateInputValue(today);
  const end=useNativePicker(el('input')); end.type='date'; end.value=(sem.endsAt||'').slice(0,10)||dateInputValue(defaultEnd);
  const zone=el('input'); zone.value=sem.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  addField(grid,'Semester name',name); addField(grid,'Start date',start); addField(grid,'End date',end); addField(grid,'Timetable timezone',zone); card.append(grid);

  const windows=data.profile?.availability||[], available=windows.filter((x)=>x.kind==='AVAILABLE'), recovery=windows.filter((x)=>x.kind==='RECOVERY_ONLY'), hard=windows.filter((x)=>x.kind==='HARD_UNAVAILABLE');
  const availDays=dayPicker(available.length?available.map((x)=>x.dayOfWeek):[1,2,3,4,5]);
  const recoveryDays=dayPicker(recovery.map((x)=>x.dayOfWeek));
  const hardDays=dayPicker(hard.map((x)=>x.dayOfWeek));
  const availWindows=availabilityWindowGroup({title:'Available days',description:'Choose the weekdays, then give KIWI one or more time windows that are normally usable.',picker:availDays,existing:available,defaults:[{startLocal:'09:00',endLocal:'12:00'},{startLocal:'16:00',endLocal:'19:00'}],multiple:true});
  const recoveryWindows=availabilityWindowGroup({title:'Recovery-only days',description:'Protected catch-up capacity. Normal Classes will not consume these windows.',picker:recoveryDays,existing:recovery,defaults:[{startLocal:'10:00',endLocal:'12:00'}]});
  const hardWindows=availabilityWindowGroup({title:'Recurring hard-unavailable days',description:'A repeating period KIWI must never schedule through.',picker:hardDays,existing:hard,defaults:[{startLocal:'13:00',endLocal:'14:00'}]});
  card.append(availWindows.element,recoveryWindows.element,hardWindows.element);

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

  const postActivation=!['DRAFT','READY','PLANNING','SETUP'].includes(String(course.lifecycle_state||'DRAFT'));
  const message=el('div'), actions=el('div','teaching-d09-actions'), save=el('button','teaching-button teaching-button--primary',postActivation?'Request this availability change':'Save availability'); save.type='button'; actions.append(save); card.append(actions,message);
  save.addEventListener('click',async()=>{
    save.disabled=true;
    try {
      const tz=zone.value.trim(); if(!name.value.trim()) throw new Error('Enter a semester name.'); if(!start.value||!end.value) throw new Error('Semester start and end dates are required.');
      const availability=[],availableRanges=availWindows.readRanges(),recoveryRanges=recoveryWindows.readRanges(),hardRanges=hardWindows.readRanges();
      const validateRange=(range,label)=>{if(range.endLocal<=range.startLocal)throw new Error(`${label} end time must be after its start time.`);};
      availableRanges.forEach((range)=>validateRange(range,'Available window'));recoveryRanges.forEach((range)=>validateRange(range,'Recovery window'));hardRanges.forEach((range)=>validateRange(range,'Hard-unavailable window'));
      selectedDays(availDays).forEach((day)=>availableRanges.forEach((range)=>availability.push({dayOfWeek:day,...range,kind:'AVAILABLE'})));
      selectedDays(recoveryDays).forEach((day)=>recoveryRanges.forEach((range)=>availability.push({dayOfWeek:day,...range,kind:'RECOVERY_ONLY'})));
      selectedDays(hardDays).forEach((day)=>hardRanges.forEach((range)=>availability.push({dayOfWeek:day,...range,kind:'HARD_UNAVAILABLE'})));
      if(!availability.some((item)=>item.kind==='AVAILABLE')) throw new Error('Choose at least one available day and time window.');
      const blockValues=[...blocks.children].map((row)=>row.readValue?.()).filter(Boolean), deadlines=[];
      if(deadline.value){const parts=deadline.value.split('T');deadlines.push({kind:deadlineKind.value,deadlineAt:wallToIso(parts[0],parts[1],tz)});}
      const body={semester:{semesterId:sem.semesterId||null,name:name.value,startsAt:wallToIso(start.value,'00:00',tz),endsAt:wallToIso(end.value,'23:59',tz),timezone:tz},availability,blocks:blockValues,deadlines,reserves:[{kind:'REVISION',minutes:Number(revision.value)||0},{kind:'ASSESSMENT',minutes:Number(assessment.value)||0}],preferences:{avoidConsecutiveSameCourseDays:true,preferredStartTimes:availableRanges.map((range)=>range.startLocal)}};
      if(postActivation){
        if(!window.KIWITeachingD10?.createScheduleRequest) throw new Error('Formal Request Center is unavailable.');
        await window.KIWITeachingD10.createScheduleRequest(course.course_id,body);
        message.textContent='A formal availability-change Request was created. The current timetable remains authoritative until approval/application.';
      }else{
        const saved=await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/schedule-inputs',{method:'PUT',body});
        await reload(saved,'Availability saved. KIWI will use the separate windows and natural spacing preferences when it builds the timetable.');
      }
      message.className='teaching-message';
    } catch(error) { message.textContent=error.message||'Availability could not be saved.'; message.className='teaching-message'; message.dataset.kind='error'; }
    finally { save.disabled=false; }
  });
  container.append(card);
}
function stage5(course,data,container,reload) {
  const card=el('section','teaching-d09-card');
  card.append(el('div','teaching-kicker','Timetable'),el('h3','','Proposed timetable and feasibility'),el('p','','KIWI uses the Course Plan, your availability, protected time, retention spacing and workload pressure to build a stable but natural timetable. One Course does not automatically fill every available day.'));
  const postActivation=!['DRAFT','READY','PLANNING','SETUP'].includes(String(course.lifecycle_state||'DRAFT'));
  const missingInputs=!data.semester||!data.profile;
  const missingPlan=(data.unresolvedSemesterCourses||[]).some((item)=>String(item.courseId||item.course_id||'')===String(course.course_id));
  const actions=el('div','teaching-d09-actions'), propose=el('button','teaching-button teaching-button--primary',postActivation?'Timetable locked after activation':(data.timetable?'Recalculate timetable':'Propose timetable')), status=el('span','teaching-d09-status',statusName(data.feasibility?.outcome||'Not calculated')); propose.type='button';propose.disabled=postActivation||missingInputs||missingPlan; actions.append(propose,status); card.append(actions);
  if(missingInputs){card.append(el('div','teaching-message','Save your semester and availability before creating the timetable.'));}
  else if(missingPlan){const guidance=el('div','teaching-message'),openPlan=el('button','teaching-d08-link-button','Open Course Plan');openPlan.type='button';openPlan.addEventListener('click',()=>courseSurface.openCourse(course.course_id,'course-plan'));guidance.append(document.createTextNode('Create the Course Plan before proposing a timetable. '),openPlan);card.append(guidance);}
  const metrics=el('div','teaching-d09-metrics'); metrics.append(metric(data.feasibility?.metrics?.scheduledMinutes??0,'scheduled minutes'),metric(data.feasibility?.metrics?.requiredMinutes??0,'required minutes'),metric(data.feasibility?.metrics?.headroomRatio==null?'—':Math.round(data.feasibility.metrics.headroomRatio*100)+'%','Recovery headroom')); card.append(metrics);
  if(data.feasibility?.reasons?.length){const list=el('ul','teaching-d08-list');data.feasibility.reasons.forEach((reason)=>list.append(el('li','',statusName(reason))));card.append(list);}
  if(data.feasibility?.alternatives?.length){card.append(el('p','teaching-d09-note','Feasible alternatives'));const list=el('ul','teaching-d08-list');data.feasibility.alternatives.forEach((item)=>list.append(el('li','',item.message)));card.append(list);}
  card.append(el('p','teaching-d09-note',data.scheduleHealth?.debtState==='SCHEDULE_DEBT_PRESENT'?'Schedule pressure is present. KIWI preserves unmet work internally and surfaces recovery options rather than a raw debt score.':'No current schedule-debt condition is exposed. Ahead time builds buffer or optional enrichment; acceleration still requires trustworthy learning evidence.'));
  const slotList=el('div');
  (data.slots||[]).forEach((slot)=>{
    const item=el('article','teaching-d09-slot'), top=el('div','teaching-d09-slot__top'); top.append(el('strong','',statusName(slot.kind)),el('span','teaching-d09-status',slot.horizonStage)); item.append(top,el('small','',new Date(slot.startsAt).toLocaleString()+' → '+new Date(slot.endsAt).toLocaleString()+' · '+slot.timezone));
    const slotActions=el('div','teaching-d09-actions');
    if(!postActivation){[['Earlier 30m',-30],['Later 30m',30]].forEach((choice)=>{const button=el('button','teaching-d08-link-button',choice[0]);button.type='button';button.addEventListener('click',async()=>{button.disabled=true;try{const updated=await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/timetable',{method:'PUT',body:{edits:[{slotId:slot.slotId,startsAt:new Date(Date.parse(slot.startsAt)+choice[1]*60000).toISOString(),endsAt:new Date(Date.parse(slot.endsAt)+choice[1]*60000).toISOString(),exceptionReason:'Student pre-activation direct edit'}]}});await reload(updated,'Timetable updated.');}catch(error){window.alert(error.message||'That edit is not feasible.');}finally{button.disabled=false;}});slotActions.append(button);});}else{slotActions.append(el('span','teaching-d09-note','Use Calendar → Request new time.'));}
    item.append(slotActions); slotList.append(item);
  });
  card.append(slotList);
  const proposalMessage=el('div');proposalMessage.setAttribute('role','status');proposalMessage.setAttribute('aria-live','polite');card.append(proposalMessage);
  propose.addEventListener('click',async()=>{propose.disabled=true;proposalMessage.textContent='Building a spaced timetable from your plan, workload and availability…';proposalMessage.className='teaching-message';try{const updated=await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/timetable/propose',{method:'POST',body:{}});await reload(updated,'Proposed timetable created.');}catch(error){proposalMessage.textContent=error.message||'Timetable feasibility could not be calculated.';proposalMessage.className='teaching-message';proposalMessage.dataset.kind='error';propose.disabled=false;}});
  container.append(card);
}
async function renderSchedule({course,container}) {
  installStyles(); const page=el('div','teaching-d09-page'),live=el('div');live.setAttribute('role','status');live.setAttribute('aria-live','polite'); container.replaceChildren(page);
  function renderData(data,notice=''){
    const grid=el('div','teaching-d09-grid'),left=el('div'),right=el('div');grid.append(left,right);page.replaceChildren(live,grid);stage4(course,data,left,renderData);stage5(course,data,right,renderData);live.textContent=notice;live.className=notice?'teaching-message':'';delete live.dataset.kind;
  }
  async function load() {
    page.replaceChildren(el('div','teaching-message','Loading semester and timetable…'));
    try { renderData(await fetchReview(course.course_id)); }
    catch(error){page.replaceChildren(el('div','teaching-message',error.message||'Scheduling could not be loaded.'));page.firstElementChild.dataset.kind='error';}
  }
  await load();
}
async function renderSummary({course,container,openSection}) {
  installStyles(); const card=el('article','teaching-course-feature-card'); card.append(el('div','teaching-kicker','Time and pacing'),el('h3','','Semester & Timetable'),el('p','','Set availability, preserve recovery capacity, and check whether the current Course Plan actually fits the academic period.'));
  const actions=el('div','teaching-course-feature-card__actions'), open=el('button','teaching-d08-link-button teaching-d08-link-button--primary','Open scheduling');open.type='button';open.addEventListener('click',openSection);actions.append(open);card.append(actions);container.replaceChildren(card);
  try{const data=await fetchReview(course.course_id);if(data.feasibility){const badge=el('span','teaching-course-feature-card__status',statusName(data.feasibility.outcome));card.insertBefore(badge,card.children[1]);}}catch(_){}
}
function displayCalendarTime(value,zone){
  if(!value)return 'Time not set';
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Time not set';
  try{return new Intl.DateTimeFormat(undefined,{timeZone:zone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date);}catch{return date.toLocaleString();}
}
function calendarEventCard(item,data){
  const kind=String(item.kind||'CLASS').toUpperCase(),card=el('article','teaching-d09-calendar-item'),top=el('div','teaching-d09-calendar-item__top'),copy=el('div');
  const kindLabel=kind==='ASSESSMENT'?statusName(item.assessmentType||'Assessment'):'Class';
  copy.append(el('strong','',item.title||kindLabel),el('div','teaching-d09-note',kind==='ASSESSMENT'?'Announced assessment':'Approved timetable'));
  const badge=el('span','teaching-d09-calendar-kind',kindLabel);badge.dataset.kind=kind;
  top.append(copy,badge);card.append(top,el('div','teaching-d09-calendar-time',displayCalendarTime(item.startsAt,data.currentTimeZone)+(item.endsAt?' → '+displayCalendarTime(item.endsAt,data.currentTimeZone):'')+' · '+data.currentTimeZone));
  if(kind==='CLASS'&&window.KIWITeachingD10){
    const actions=el('div','teaching-d09-actions'),move=el('button','teaching-d08-link-button','Request new time'),absence=el('button','teaching-d08-link-button','Emergency absence');
    move.type=absence.type='button';move.addEventListener('click',()=>window.KIWITeachingD10.requestClassReschedule(item));absence.addEventListener('click',()=>window.KIWITeachingD10.emergencyAbsence(item));actions.append(move,absence);card.append(actions);
  }
  return card;
}
function proposalCard(item,data){
  const card=el('article','teaching-d09-calendar-item'),top=el('div','teaching-d09-calendar-item__top'),copy=el('div');
  copy.append(el('strong','',item.course_title||item.title||'Proposed Class'),el('div','teaching-d09-note','Pre-activation proposal'));
  const badge=el('span','teaching-d09-calendar-kind','Proposed');badge.dataset.kind='PROPOSAL';top.append(copy,badge);
  const start=item.displayStart||displayCalendarTime(item.startsAt||item.starts_at,data.currentTimeZone),end=item.displayEnd||displayCalendarTime(item.endsAt||item.ends_at,data.currentTimeZone);
  card.append(top,el('div','teaching-d09-calendar-time',start+(end?' → '+end:'')+' · '+data.currentTimeZone));return card;
}
async function renderCalendar() {
  installStyles(); const main=document.getElementById('teachingApp'); if(!main)return; const page=el('section','teaching-view teaching-d09-page'),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  const head=el('div','teaching-d09-card');head.append(el('div','teaching-kicker','Calendar'),el('h2','','Teaching Calendar'),el('p','','Classes and announced assessments share one timetable. Proposed Course times remain separate until they are approved.'));
  const back=el('button','teaching-d08-link-button','Back to courses');back.type='button';back.addEventListener('click',()=>courseSurface.openOverview?courseSurface.openOverview():window.location.reload());head.append(back);page.append(head);main.replaceChildren(page);
  try{
    const data=await kiwiApiRequest('/teaching/information/calendar?currentTimeZone='+encodeURIComponent(zone));
    const events=Array.isArray(data.events)?data.events:[],proposals=Array.isArray(data.preactivationProposals)?data.preactivationProposals:[];
    if(events.length){const section=el('section','teaching-d09-calendar-section'),sectionHead=el('div','teaching-d09-calendar-section__head'),list=el('div','teaching-d09-calendar');sectionHead.append(el('h3','','Scheduled'),el('span','',events.length+' item'+(events.length===1?'':'s')));events.forEach((item)=>list.append(calendarEventCard(item,data)));section.append(sectionHead,list);page.append(section);}
    if(proposals.length){const section=el('section','teaching-d09-calendar-section'),sectionHead=el('div','teaching-d09-calendar-section__head'),list=el('div','teaching-d09-calendar');sectionHead.append(el('h3','','Proposed course times'),el('span','',proposals.length+' item'+(proposals.length===1?'':'s')));proposals.forEach((item)=>list.append(proposalCard(item,data)));section.append(sectionHead,list);page.append(section);}
    if(!events.length&&!proposals.length)page.append(el('div','teaching-empty','No Teaching timetable items yet.'));
    if(data.issues?.length)page.append(el('div','teaching-message','Some calendar information is temporarily unavailable. The items shown above remain the authoritative visible timetable.'));
  }catch(error){const message=el('div','teaching-message',error.message||'Calendar could not be loaded.');message.dataset.kind='error';page.append(message);}
}
courseSurface.registerSection({id:'schedule',label:'Schedule',order:30,render:renderSchedule,renderSummary});
if(nav&&typeof nav.register==='function')nav.register({id:'calendar',label:'Calendar',description:'Classes and assessments in one timetable',icon:'◷',menuIcon:'calendar',onSelect:renderCalendar});
window.KIWITeachingD09=Object.freeze({openSchedule:(courseId)=>courseSurface.openCourse(courseId,'schedule'),openCalendar:renderCalendar});