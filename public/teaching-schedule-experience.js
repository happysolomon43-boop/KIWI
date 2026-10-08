const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};
const courseSurface = window.KIWITeachingCourses;
if (typeof kiwiApiRequest !== 'function' || !courseSurface?.registerSection) {
  throw new Error('Teaching Schedule experience requires the shared KIWI client and Course shell.');
}

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const el = (tag, cls = '', text = null) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  return node;
};
const words = (value) => String(value || '').replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,(m)=>m.toUpperCase());
const postActivationState = (course) => !['DRAFT','READY','PLANNING','SETUP'].includes(String(course.lifecycle_state || 'DRAFT'));
const scheduleActionError = (error, fallback) => {
  const code=String(error?.code||'').toUpperCase();
  const message=String(error?.message||'');
  if(code.includes('SEMESTER_CAPACITY_INFEASIBLE')||code.includes('REQUIRED_INSTRUCTIONAL_LOAD_UNSCHEDULED')||code.includes('RECOVERY_HEADROOM_BELOW_MINIMUM')){
    return 'There is not enough conflict-free time in the current Semester date range and availability. Extend the Semester, add study windows, or reduce protected time, then rebuild.';
  }
  if(code.includes('LOAD_ESTIMATION_TRUNCATED')||code.includes('AI_OUTPUT_TRUNCATED')||/MAX_TOKENS|incomplete Teaching artifact/i.test(message)){
    return 'KIWI could not finish workload preparation for this timetable. Nothing was changed; try the timetable action again.';
  }
  return message||fallback;
};

function localParts(date, zone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(date).filter((part)=>part.type!=='literal').map((part)=>[part.type,part.value]));
}
function wallToIso(dateKey,time,zone) {
  const ymd=dateKey.split('-').map(Number),hm=time.split(':').map(Number);
  const target=Date.UTC(ymd[0],ymd[1]-1,ymd[2],hm[0],hm[1]);let guess=target;
  for(let i=0;i<5;i+=1){const p=localParts(new Date(guess),zone);const observed=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);const delta=target-observed;if(!delta)break;guess+=delta;}
  const matches=[];for(let delta=-180;delta<=180;delta+=15){const ms=guess+delta*60000,p=localParts(new Date(ms),zone);if(`${p.year}-${p.month}-${p.day}`===dateKey&&`${p.hour}:${p.minute}`===time)matches.push(ms);}
  if(!matches.length)throw new Error(`That local time does not exist in ${zone}.`);
  return new Date(Math.min(...matches)).toISOString();
}
function isoToLocalInput(value,zone){if(!value)return'';const p=localParts(new Date(value),zone);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
function dateInputValue(date){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;}
function usePicker(input){input.addEventListener('click',()=>{try{input.showPicker?.();}catch{}});return input;}
function field(label,input){const wrap=el('label','teaching-schedule-x__field');wrap.append(el('span','',label),input);return wrap;}
function metric(value,label){const box=el('div','teaching-schedule-x__metric');box.append(el('strong','',value),el('span','',label));return box;}
function scheduleSkeleton(label='Loading Semester timetable'){
  const root=el('div','teaching-shell-skeleton');root.setAttribute('role','status');root.setAttribute('aria-label',label);
  const card=el('div','teaching-skeleton-card'),title=el('div','teaching-skeleton-line');title.dataset.size='title';
  card.append(title,el('div','teaching-skeleton-line'),el('div','teaching-skeleton-block'));root.append(card);return root;
}
function formatTime(value,zone){return new Intl.DateTimeFormat([],{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(value));}
function formatDay(value,zone){return new Intl.DateTimeFormat([],{timeZone:zone,weekday:'long',month:'short',day:'numeric'}).format(new Date(value));}

function groupedAvailability(rows=[]) {
  const map=new Map();
  for(const row of rows){
    const key=`${row.startLocal}|${row.endLocal}`;
    if(!map.has(key))map.set(key,{startLocal:row.startLocal,endLocal:row.endLocal,days:[]});
    map.get(key).days.push(Number(row.dayOfWeek));
  }
  return [...map.values()].map((item)=>({...item,days:[...new Set(item.days)].sort((a,b)=>a-b)}));
}

function dayChooser(selected=[]) {
  const root=el('div','teaching-schedule-x__days');
  const set=new Set(selected.map(Number));
  DAYS.forEach((name,index)=>{
    const label=el('label','teaching-schedule-x__day');
    const input=el('input');input.type='checkbox';input.value=String(index);input.checked=set.has(index);
    label.append(input,document.createTextNode(name));root.append(label);
  });
  root.readDays=()=>[...root.querySelectorAll('input:checked')].map((input)=>Number(input.value));
  return root;
}

function createWindowEditor(initialRows=[]) {
  const root=el('div');
  const tabs=el('div','teaching-schedule-x__window-tabs');
  const panelHost=el('div');
  const actions=el('div','teaching-schedule-x__window-actions');
  root.append(tabs,panelHost,actions);
  let active=0;
  const windows=initialRows.length
    ? initialRows.map((item)=>({...item,days:[...(item.days||[])]}))
    : [
        {days:[1,2,3,4,5],startLocal:'09:00',endLocal:'12:00'},
        {days:[],startLocal:'14:00',endLocal:'17:00'},
      ];

  function render(){
    tabs.replaceChildren();panelHost.replaceChildren();actions.replaceChildren();
    windows.forEach((window,index)=>{
      const tab=el('button','teaching-schedule-x__window-tab',`Window ${index+1}`);tab.type='button';tab.dataset.active=index===active?'true':'false';tab.addEventListener('click',()=>{active=index;render();});tabs.append(tab);
    });
    const item=windows[active];
    if(!item)return;
    const panel=el('div','teaching-schedule-x__window-panel');
    panel.append(el('div','teaching-schedule-x__hint','Select the days when this exact time range is normally available. Different windows may cover different days.'));
    const days=dayChooser(item.days);panel.append(days);
    const fields=el('div','teaching-schedule-x__fields');
    const start=usePicker(el('input'));start.type='time';start.value=item.startLocal||'09:00';
    const end=usePicker(el('input'));end.type='time';end.value=item.endLocal||'12:00';
    const sync=()=>{item.days=days.readDays();item.startLocal=start.value;item.endLocal=end.value;};
    days.addEventListener('change',sync);start.addEventListener('change',sync);end.addEventListener('change',sync);
    fields.append(field('From',start),field('To',end));panel.append(fields);panelHost.append(panel);
    const add=el('button','teaching-schedule-x__mini','+ Add time window');add.type='button';add.addEventListener('click',()=>{sync();windows.push({days:[],startLocal:'14:00',endLocal:'17:00'});active=windows.length-1;render();});actions.append(add);
    if(windows.length>1){const remove=el('button','teaching-schedule-x__mini','Remove this window');remove.type='button';remove.addEventListener('click',()=>{windows.splice(active,1);active=Math.max(0,active-1);render();});actions.append(remove);}
  }
  root.readValue=()=>{
    const rows=[];
    windows.forEach((item,index)=>{
      if(!item.startLocal||!item.endLocal||item.endLocal<=item.startLocal)throw new Error(`Availability Window ${index+1} needs a valid From/To range.`);
      (item.days||[]).forEach((day)=>rows.push({dayOfWeek:day,startLocal:item.startLocal,endLocal:item.endLocal,kind:'AVAILABLE',label:`Availability window ${index+1}`}));
    });
    if(!rows.length)throw new Error('Choose at least one available day in one time window.');
    return rows;
  };
  root.preferredStarts=()=>[...new Set(windows.filter((item)=>item.days?.length).map((item)=>item.startLocal).filter(Boolean))].slice(0,14);
  render();return root;
}

function singleRecurringEditor(title,rows,defaults,kind) {
  const grouped=groupedAvailability(rows);
  const initial=grouped[0]||defaults;
  const section=el('div','teaching-schedule-x__section');
  const head=el('div','teaching-schedule-x__section-head');const copy=el('div');copy.append(el('h4','',title),el('p','',kind==='RECOVERY_ONLY'?'Optional capacity kept aside for recovery.':'Recurring periods KIWI must never schedule across.'));head.append(copy);section.append(head);
  const days=dayChooser(initial.days||[]);section.append(days);
  const fields=el('div','teaching-schedule-x__fields');const start=usePicker(el('input'));start.type='time';start.value=initial.startLocal||defaults.startLocal;const end=usePicker(el('input'));end.type='time';end.value=initial.endLocal||defaults.endLocal;fields.append(field('From',start),field('To',end));section.append(fields);
  section.readValue=()=>{if(days.readDays().length&&(!start.value||!end.value||end.value<=start.value))throw new Error(`${title} needs a valid From/To range.`);return days.readDays().map((day)=>({dayOfWeek:day,startLocal:start.value,endLocal:end.value,kind}));};
  return section;
}

function blockRow(block,zoneInput,courseId){
  const row=el('div','teaching-schedule-x__fields');row.dataset.scheduleBlock='true';
  const kind=el('select');['HARD_UNAVAILABLE','BREAK','HOLIDAY','TRAVEL','PROTECTED_REVISION','PROTECTED_ASSESSMENT'].forEach((value)=>{const option=el('option','',words(value));option.value=value;option.selected=value===(block?.kind||'HARD_UNAVAILABLE');kind.append(option);});
  const start=usePicker(el('input'));start.type='datetime-local';start.value=isoToLocalInput(block?.startsAt,zoneInput.value);
  const end=usePicker(el('input'));end.type='datetime-local';end.value=isoToLocalInput(block?.endsAt,zoneInput.value);
  const controls=el('div','teaching-schedule-x__window-actions');const remove=el('button','teaching-schedule-x__mini','Remove');remove.type='button';remove.addEventListener('click',()=>row.parentElement?.remove());controls.append(remove);
  row.append(field('Type',kind),field('Starts',start),field('Ends',end));
  const host=el('div');host.append(row,controls);
  host.readValue=()=>{if(!start.value||!end.value)return null;const s=start.value.split('T'),e=end.value.split('T'),zone=zoneInput.value.trim();return{kind:kind.value,startsAt:wallToIso(s[0],s[1],zone),endsAt:wallToIso(e[0],e[1],zone),courseId:kind.value.startsWith('PROTECTED_')?courseId:null};};
  return host;
}

function renderTimetable(data,course,card,reload){
  const integrity=data.scheduleIntegrity||{};
  const backgroundBuild=data.backgroundBuild||null;
  const buildActive=backgroundBuild?.active===true;
  const post=postActivationState(course);
  const unresolvedSelf=(data.unresolvedSemesterCourses||[]).filter((item)=>String(item.courseId||item.course_id||'')===String(course.course_id));
  const missingAttachment=unresolvedSelf.some((item)=>item.reason==='COURSE_NOT_ATTACHED_TO_DEFAULT_SEMESTER')||data.requestedCourse?.attachedToSemester===false;
  const missingPlan=data.requestedCourse?data.requestedCourse.planReady===false:unresolvedSelf.some((item)=>item.reason==='COURSE_PLAN_NOT_READY');
  const missingInputs=!data.semester||!data.profile;
  const courseSlots=Array.isArray(data.courseSlots)?data.courseSlots:(data.slots||[]).filter((slot)=>String(slot.courseId||slot.course_id||'')===String(course.course_id));
  const courseSummary=data.feasibility?.courseSummary||null;
  const hasCourseTimetable=Boolean(data.timetable)&&(Boolean(courseSummary)||courseSlots.length>0);
  const status=el('div','teaching-schedule-x__actions');
  const action=el('button','teaching-schedule-x__primary',missingPlan?'Open Course Plan':buildActive?'Timetable building in background':integrity.recoveryRequired?'Repair Semester timetable':post?'Timetable active':(hasCourseTimetable?'Rebuild Semester timetable':'Build Semester timetable'));
  action.type='button';action.disabled=buildActive||missingInputs||(post&&!integrity.recoveryRequired);
  const badge=el('span','teaching-schedule-x__badge',missingPlan?'Plan required':buildActive?'Running in background':missingAttachment?'Using shared availability':words(data.feasibility?.outcome||'Not calculated'));status.append(action,badge);card.append(status);
  if(missingPlan){
    card.append(el('div','teaching-schedule-x__hint','This Course has no current Course Plan. Create it first; then KIWI will add this Course to the shared Semester timetable.'));
    const message=el('div','teaching-schedule-x__message');card.append(message);
    action.disabled=post;
    action.addEventListener('click',()=>{if(!action.disabled)courseSurface.openCourse(course.course_id,'course-plan');});
    return;
  }
  if(missingAttachment)card.append(el('div','teaching-schedule-x__hint','This Course inherits your shared Semester availability automatically. KIWI rebuilds the future Semester rhythm as one combined schedule: past Classes stay fixed, while future Classes from existing Courses may move when needed so this Course is woven into the same cadence instead of being appended.'));
  const m=data.feasibility?.metrics||{},scheduledMinutes=courseSummary?.scheduledMinutes??courseSlots.reduce((sum,slot)=>sum+(Number(slot.plannedMinutes)||Math.max(0,Math.round((Date.parse(slot.endsAt)-Date.parse(slot.startsAt))/60000))),0),requiredMinutes=courseSummary?.requiredMinutes??'—';const metrics=el('div','teaching-schedule-x__metrics');metrics.append(metric(String(scheduledMinutes),'scheduled minutes'),metric(String(requiredMinutes),'required minutes'),metric(m.headroomRatio==null?'—':`${Math.round(Number(m.headroomRatio)*100)}%`,'semester recovery headroom'));card.append(metrics);
  if(data.feasibility?.metrics?.naturalizedCadence)card.append(el('div','teaching-schedule-x__hint','Cadence is deterministic but varied: KIWI prefers spaced meetings, one or two Classes on a day as needed, and 3–8 hour same-day gaps when feasible. Heavier course load may compress those preferences.'));
  if(integrity.recoveryRequired)card.append(el('div','teaching-schedule-x__hint','This active Course has no future instructional Classes. Repair rebuilds the shared Semester timetable from the remaining time while preserving the other Courses and current workload.'));

  const groups=new Map();
  for(const slot of courseSlots){const key=formatDay(slot.startsAt,slot.timezone||data.semester?.timezone||'UTC');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(slot);}
  for(const [label,slots] of groups){const group=el('section','teaching-schedule-x__day-group');const head=el('div','teaching-schedule-x__day-title');head.append(document.createTextNode(label),el('small','',`${slots.length} item${slots.length===1?'':'s'}`));group.append(head);slots.forEach((slot)=>{const zone=slot.timezone||data.semester?.timezone||'UTC';const item=el('article','teaching-schedule-x__slot');item.append(el('div','teaching-schedule-x__slot-time',`${formatTime(slot.startsAt,zone)}\n${formatTime(slot.endsAt,zone)}`));const copy=el('div','teaching-schedule-x__slot-copy');copy.append(el('strong','',slot.kind==='CLASS'?'Class':words(slot.kind)),el('small','',`${slot.plannedMinutes||Math.round((Date.parse(slot.endsAt)-Date.parse(slot.startsAt))/60000)} min${slot.learningUnitRefs?.length?` · ${slot.learningUnitRefs.length} learning unit${slot.learningUnitRefs.length===1?'':'s'}`:''}`));item.append(copy,el('span','teaching-schedule-x__badge',words(slot.horizonStage||'scheduled')));group.append(item);});card.append(group);}
  if(buildActive)card.append(el('div','teaching-schedule-x__hint','KIWI is building the shared Semester timetable in the background. You can leave this page; the build will continue and this view will update when it finishes.'));
  if(!courseSlots.length&&!buildActive)card.append(el('div','teaching-schedule-x__hint','No timetable has been created for this Course yet. KIWI will use instructional load, availability, deadlines and recovery capacity to place Classes.'));
  const message=el('div','teaching-schedule-x__message');card.append(message);
  action.addEventListener('click',async()=>{
    action.disabled=true;
    message.textContent=integrity.recoveryRequired?'Queueing Semester timetable repair…':'Starting the Semester timetable build in the background…';
    delete message.dataset.kind;
    try{
      await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/timetable/propose`,{method:'POST',body:{}});
      message.textContent='Timetable build started in the background. You can keep using KIWI while it finishes.';
      message.dataset.kind='success';
      const monitor=async()=>{
        try{
          const review=await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/schedule-review`);
          const build=review.backgroundBuild;
          if(build?.active){window.setTimeout(monitor,3000);return;}
          if(build&&['CANCELLED','FAILED'].includes(String(build.status||'').toUpperCase())){
            message.textContent=scheduleActionError({code:build.lastErrorCode},'The timetable could not be rebuilt.');
            message.dataset.kind='error';
            action.disabled=missingInputs||(post&&!integrity.recoveryRequired);
            return;
          }
          await reload(review,'Semester timetable rebuilt successfully.');
        }catch(error){
          message.textContent=scheduleActionError(error,'KIWI could not check the timetable build.');
          message.dataset.kind='error';
          action.disabled=missingInputs||(post&&!integrity.recoveryRequired);
        }
      };
      window.setTimeout(monitor,2500);
    }catch(error){
      message.textContent=scheduleActionError(error,'Semester timetable could not be started.');
      message.dataset.kind='error';
      action.disabled=missingInputs||(post&&!integrity.recoveryRequired);
    }
  });
}

async function renderSchedule({course,container}){
  const page=el('div','teaching-schedule-x');container.replaceChildren(page);
  let buildPollTimer=null;
  page.append(scheduleSkeleton('Loading Semester availability and timetable'));
  async function load(prefetched=null,notice=''){
    if(buildPollTimer!=null){window.clearTimeout(buildPollTimer);buildPollTimer=null;}
    try{
      const data=prefetched||await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/schedule-review`);
      page.replaceChildren();
      const hero=el('section','teaching-schedule-x__hero');const copy=el('div');copy.append(el('div','teaching-kicker','Time & pacing'),el('h2','','Make the week feel realistic'),el('p','','Tell KIWI when you are normally free. Multiple availability windows let the Scheduler spread Classes naturally instead of filling the earliest block every day.'));const meta=el('div','teaching-schedule-x__hero-meta');meta.append(el('span','teaching-schedule-x__signal',data.semester?.timezone||'Timezone not set'),el('span','teaching-schedule-x__signal',postActivationState(course)?'Formal changes after activation':'Editable before activation'));hero.append(copy,meta);page.append(hero);
      const grid=el('div','teaching-schedule-x__grid');const preferences=el('section','teaching-schedule-x__card'),timetable=el('section','teaching-schedule-x__card');grid.append(preferences,timetable);page.append(grid);
      preferences.append(el('div','teaching-kicker','Availability'),el('h3','','Your shared Semester study windows'),el('p','',data.inheritedAvailability?'This Course is inheriting the Semester availability you already set. You do not need to enter it again; KIWI plans all future Course workload together inside one shared timetable version.':'Availability is Semester-wide: save it from any Course and KIWI rebuilds one timetable for every current Course Plan in this Semester.'));
      const sem=data.semester||{};const semFields=el('div','teaching-schedule-x__fields');semFields.style.marginTop='18px';const name=el('input');name.value=sem.name||'Semester';const today=new Date(),defaultEnd=new Date(today);defaultEnd.setMonth(defaultEnd.getMonth()+1);const start=usePicker(el('input'));start.type='date';start.value=(sem.startsAt||'').slice(0,10)||dateInputValue(today);const end=usePicker(el('input'));end.type='date';end.value=(sem.endsAt||'').slice(0,10)||dateInputValue(defaultEnd);const zone=el('input');zone.value=sem.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';semFields.append(field('Semester name',name),field('Start date',start),field('End date',end),field('Timetable timezone',zone));preferences.append(semFields);

      const rows=data.profile?.availability||[];const available=groupedAvailability(rows.filter((x)=>x.kind==='AVAILABLE'));
      const availabilitySection=el('div','teaching-schedule-x__section');const availabilityHead=el('div','teaching-schedule-x__section-head');const availableCopy=el('div');availableCopy.append(el('h4','','Available time windows'),el('p','','Use two or more windows when your free hours differ during the week.'));availabilityHead.append(availableCopy);availabilitySection.append(availabilityHead);const windowEditor=createWindowEditor(available);availabilitySection.append(windowEditor);preferences.append(availabilitySection);
      const recoveryEditor=singleRecurringEditor('Recovery-only days',rows.filter((x)=>x.kind==='RECOVERY_ONLY'),{days:[],startLocal:'10:00',endLocal:'12:00'},'RECOVERY_ONLY');preferences.append(recoveryEditor);
      const hardEditor=singleRecurringEditor('Recurring unavailable time',rows.filter((x)=>x.kind==='HARD_UNAVAILABLE'),{days:[],startLocal:'13:00',endLocal:'14:00'},'HARD_UNAVAILABLE');preferences.append(hardEditor);

      const blocksSection=el('div','teaching-schedule-x__section');const blocksHead=el('div','teaching-schedule-x__section-head');const blockCopy=el('div');blockCopy.append(el('h4','','Breaks & protected periods'),el('p','','Specific holidays, travel, hard blocks and protected assessment/revision time.'));blocksHead.append(blockCopy);blocksSection.append(blocksHead);const blocks=el('div');(data.profile?.blocks||[]).filter((b)=>!b.courseId||String(b.courseId)===String(course.course_id)).forEach((block)=>blocks.append(blockRow(block,zone,course.course_id)));const addBlock=el('button','teaching-schedule-x__mini','+ Add block');addBlock.type='button';addBlock.addEventListener('click',()=>blocks.append(blockRow(null,zone,course.course_id)));blocksSection.append(blocks,addBlock);preferences.append(blocksSection);

      const academic=el('div','teaching-schedule-x__section');const academicHead=el('div','teaching-schedule-x__section-head');const academicCopy=el('div');academicCopy.append(el('h4','','Target & reserves'),el('p','','Deadlines guide cadence; revision and assessment reserves protect capacity.'));academicHead.append(academicCopy);academic.append(academicHead);const academicFields=el('div','teaching-schedule-x__fields');const currentDeadline=data.profile?.deadlines?.find((d)=>String(d.courseId)===String(course.course_id));const deadline=usePicker(el('input'));deadline.type='datetime-local';deadline.value=isoToLocalInput(currentDeadline?.deadlineAt,zone.value);const deadlineKind=el('select');['FLEXIBLE','HARD'].forEach((value)=>{const option=el('option','',words(value));option.value=value;option.selected=value===(currentDeadline?.kind||'FLEXIBLE');deadlineKind.append(option);});const revision=el('input');revision.type='number';revision.min='0';revision.value=String(data.profile?.reserves?.find((r)=>r.kind==='REVISION'&&String(r.courseId)===String(course.course_id))?.minutes||0);const assessment=el('input');assessment.type='number';assessment.min='0';assessment.value=String(data.profile?.reserves?.find((r)=>r.kind==='ASSESSMENT'&&String(r.courseId)===String(course.course_id))?.minutes||0);academicFields.append(field('Target / deadline',deadline),field('Deadline type',deadlineKind),field('Revision reserve minutes',revision),field('Assessment reserve minutes',assessment));academic.append(academicFields);preferences.append(academic);

      const actions=el('div','teaching-schedule-x__actions');const save=el('button','teaching-schedule-x__primary',postActivationState(course)?'Request availability change':'Save availability');save.type='button';const saveMessage=el('div','teaching-schedule-x__message',notice);actions.append(save,saveMessage);preferences.append(actions);
      save.addEventListener('click',async()=>{save.disabled=true;saveMessage.textContent=postActivationState(course)?'Preparing the governed availability-change Request…':'Saving shared availability and queueing the Semester timetable rebuild…';delete saveMessage.dataset.kind;try{const tz=zone.value.trim();if(!name.value.trim())throw new Error('Enter a semester name.');if(!start.value||!end.value)throw new Error('Semester start and end dates are required.');const availability=[...windowEditor.readValue(),...recoveryEditor.readValue(),...hardEditor.readValue()];const blockValues=[...blocks.children].map((row)=>row.readValue?.()).filter(Boolean);const deadlines=[];if(deadline.value){const parts=deadline.value.split('T');deadlines.push({courseId:course.course_id,kind:deadlineKind.value,deadlineAt:wallToIso(parts[0],parts[1],tz)});}const body={semester:{semesterId:sem.semesterId||null,name:name.value.trim(),startsAt:wallToIso(start.value,'00:00',tz),endsAt:wallToIso(end.value,'23:59',tz),timezone:tz},availability,blocks:blockValues,deadlines,reserves:[{courseId:course.course_id,kind:'REVISION',minutes:Number(revision.value)||0},{courseId:course.course_id,kind:'ASSESSMENT',minutes:Number(assessment.value)||0}],preferences:{avoidConsecutiveSameCourseDays:true,preferredStartTimes:windowEditor.preferredStarts()}};if(postActivationState(course)){if(!window.KIWITeachingD10?.createScheduleRequest)throw new Error('Formal Request Center is unavailable.');await window.KIWITeachingD10.createScheduleRequest(course.course_id,body);saveMessage.textContent='Request created. Submit it in Requests; KIWI will evaluate it against the shared Semester timetable.';}else{const updated=await kiwiApiRequest(`/teaching/courses/${encodeURIComponent(course.course_id)}/schedule-inputs`,{method:'PUT',body});const sync=updated?.automaticRecalculation;const count=sync?.affectedCourseCount||sync?.affectedCourseIds?.length||1;const savedNotice=sync?.queued?`Availability saved. The shared Semester timetable is rebuilding in the background across ${count} Course${count===1?'':'s'}.`:sync?.recalculated?`Availability saved. Semester timetable v${sync.timetableVersion??'new'} rebuilt across ${count} Course${count===1?'':'s'}.`:sync?.reason==='CURRENT_COURSE_PLAN_REQUIRED'?'Availability saved. The Semester timetable will build automatically when a current Course Plan is ready.':'Availability saved, but the shared Semester timetable rebuild needs attention.';await load(updated,savedNotice);}}catch(error){saveMessage.textContent=scheduleActionError(error,'Availability could not be saved.');saveMessage.dataset.kind='error';}finally{save.disabled=false;}});

      timetable.append(el('div','teaching-kicker','Timetable'),el('h3','','Your Course inside the shared Semester rhythm'),el('p','','The Scheduler owns one deterministic Semester timetable version. This panel is filtered to this Course, while availability changes and rebuilds reflow all current Course Plans together.'));renderTimetable(data,course,timetable,load);
      if(data.backgroundBuild?.active){
        buildPollTimer=window.setTimeout(()=>{if(page.isConnected)load(null,'Timetable build is still running in the background.');},5000);
      }
    }catch(error){page.replaceChildren(el('div','teaching-message',error.message||'Scheduling could not be loaded.'));page.firstElementChild.dataset.kind='error';}
  }
  await load();
}

async function renderSummary({course,container,openSection}){
  const card=el('article','teaching-course-feature-card');card.append(el('div','teaching-kicker','Time & pacing'),el('h3','','Semester & Timetable'),el('p','','Set multiple availability windows and let KIWI build a spaced, realistic Class cadence while preserving hard constraints and recovery headroom.'));const actions=el('div','teaching-course-feature-card__actions');const open=el('button','teaching-button teaching-button--primary','Review timetable');open.type='button';open.addEventListener('click',openSection);actions.append(open);card.append(actions);container.replaceChildren(card);
}

courseSurface.registerSection({id:'schedule',label:'Schedule',order:30,render:renderSchedule,renderSummary});
