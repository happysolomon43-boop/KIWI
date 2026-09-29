const { kiwiApiRequest } = window.KIWI_API_CLIENT || {};
if (typeof kiwiApiRequest !== 'function') throw new Error('KIWI shared API client must load before Teaching D10.');
const courseSurface = window.KIWITeachingCourses;
const nav = window.KIWITeachingNavigation;
if (!courseSurface || typeof courseSurface.registerSection !== 'function') throw new Error('KIWI Teaching course surface must load before Teaching D10.');

let pendingRequestContext = null;
function el(tag, cls='', text='') { const node=document.createElement(tag); if(cls) node.className=cls; if(text!==undefined&&text!==null) node.textContent=String(text); return node; }
function words(value){return String(value||'').replaceAll('_',' ').replace(/\b\w/g,(m)=>m.toUpperCase());}
function fmt(value){if(!value)return '—'; try{return new Date(value).toLocaleString();}catch{return String(value);}}
function installStyles(){
  if(document.getElementById('teachingD10Styles')) return;
  const style=document.createElement('style');style.id='teachingD10Styles';style.textContent=`
    .teaching-d10-page{display:grid;gap:18px;min-width:0}
    .teaching-d10-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
    .teaching-d10-card{min-width:0;padding:18px;border:1px solid var(--teaching-border);border-radius:18px;background:var(--teaching-surface-soft)}
    .teaching-d10-card h3{margin:7px 0 4px;font-size:20px}.teaching-d10-card p{color:var(--teaching-muted);line-height:1.55}
    .teaching-d10-list{display:grid;gap:8px;margin:14px 0}.teaching-d10-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--teaching-border)}
    .teaching-d10-row:first-child{border-top:0}.teaching-d10-status{display:inline-flex;align-items:center;min-height:26px;padding:5px 8px;border:1px solid var(--teaching-border);border-radius:999px;background:rgba(255,255,255,.025);font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
    .teaching-d10-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.teaching-d10-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .teaching-d10-field{display:grid;gap:7px;min-width:0}.teaching-d10-field>span{font-size:11px;font-weight:650;color:#a8c5b9;letter-spacing:.01em}
    .teaching-d10-field input,.teaching-d10-field select,.teaching-d10-field textarea{width:100%;box-sizing:border-box}
    .teaching-d10-field input,.teaching-d10-field textarea{border:1px solid var(--teaching-border);border-radius:11px;background:rgba(4,20,15,.72);color:var(--teaching-text);padding:11px 12px;outline:none;font:inherit;transition:border-color 150ms ease,box-shadow 150ms ease,background 150ms ease}
    .teaching-d10-field textarea{min-height:108px;resize:vertical;line-height:1.55}
    .teaching-d10-field input:focus,.teaching-d10-field textarea:focus{border-color:var(--teaching-accent);box-shadow:0 0 0 3px var(--teaching-accent-soft);background:rgba(4,20,15,.92)}
    .teaching-d10-note{font-size:12px;color:var(--teaching-muted)}.teaching-d10-blocker{font-size:12px}

    .teaching-d10-request-center{gap:20px}
    .teaching-d10-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:end;padding:clamp(20px,4vw,32px);border:1px solid var(--teaching-border);border-radius:22px;background:radial-gradient(circle at 90% 0%,rgba(98,217,165,.12),transparent 34%),linear-gradient(145deg,rgba(8,35,26,.96),rgba(4,19,14,.9))}
    .teaching-d10-hero::after{content:"";position:absolute;right:-80px;top:-110px;width:240px;height:240px;border:1px solid rgba(98,217,165,.08);border-radius:50%;pointer-events:none}
    .teaching-d10-hero__copy{position:relative;z-index:1;max-width:720px}.teaching-d10-hero h2{margin:8px 0 8px;font-family:var(--font-display);font-size:clamp(28px,5vw,42px);letter-spacing:-.035em;line-height:1.06}
    .teaching-d10-hero p{max-width:650px;margin:0;color:var(--teaching-muted);font-size:14px;line-height:1.65}
    .teaching-d10-hero__signals{position:relative;z-index:1;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;max-width:360px}
    .teaching-d10-signal{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:7px 10px;border:1px solid var(--teaching-border);border-radius:999px;background:rgba(3,17,13,.64);color:#b8d5c8;font-size:11px;white-space:nowrap}
    .teaching-d10-signal::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--teaching-accent);box-shadow:0 0 0 4px rgba(98,217,165,.08)}

    .teaching-d10-composer{padding:0;overflow:hidden;background:linear-gradient(180deg,rgba(8,30,23,.92),rgba(5,22,17,.88))}
    .teaching-d10-composer__head{display:grid;grid-template-columns:auto minmax(0,1fr);gap:13px;padding:20px 20px 16px;border-bottom:1px solid var(--teaching-border)}
    .teaching-d10-step{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--teaching-border-strong);border-radius:11px;background:var(--teaching-accent-soft);color:var(--teaching-accent);font-family:var(--font-mono);font-size:10px;font-weight:800}
    .teaching-d10-composer__head h3{margin:0 0 4px;font-size:20px}.teaching-d10-composer__head p{margin:0;max-width:720px}
    .teaching-d10-composer__body{display:grid;gap:14px;padding:20px}
    .teaching-d10-form-note{display:flex;gap:9px;align-items:flex-start;padding:11px 12px;border:1px solid rgba(98,217,165,.12);border-radius:11px;background:rgba(98,217,165,.045);color:#93b6a7;font-size:11px;line-height:1.55}
    .teaching-d10-form-note strong{color:#cce6da}
    .teaching-d10-composer__actions{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-top:2px}
    .teaching-d10-composer__actions .teaching-d10-actions{margin:0}
    .teaching-d10-form-message:empty{display:none}.teaching-d10-form-message{margin-top:2px}

    .teaching-d10-request-section{display:grid;gap:11px}
    .teaching-d10-section-head{display:flex;align-items:end;justify-content:space-between;gap:12px;padding:2px 2px 0}
    .teaching-d10-section-head h3{margin:4px 0 0;font-size:20px}.teaching-d10-section-count{color:var(--teaching-muted);font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em}
    .teaching-d10-request-list{display:grid;gap:10px}
    .teaching-d10-request{min-width:0;padding:16px;border:1px solid var(--teaching-border);border-radius:16px;background:linear-gradient(180deg,rgba(8,30,23,.72),rgba(5,21,16,.7));transition:border-color 150ms ease,transform 150ms ease,background 150ms ease}
    .teaching-d10-request:hover{border-color:var(--teaching-border-strong);background:linear-gradient(180deg,rgba(9,34,25,.86),rgba(5,22,17,.8))}
    .teaching-d10-request__top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .teaching-d10-request__title{min-width:0}.teaching-d10-request__title strong{display:block;font-size:15px;line-height:1.3}.teaching-d10-request__meta{margin-top:5px;color:var(--teaching-muted);font-size:11px;line-height:1.45}
    .teaching-d10-request[data-state="APPLIED"] .teaching-d10-status,.teaching-d10-request[data-state="CLOSED"] .teaching-d10-status{border-color:rgba(98,217,165,.24);background:rgba(98,217,165,.09);color:#91e4be}
    .teaching-d10-request[data-state="ALTERNATIVE_PROPOSED"] .teaching-d10-status{border-color:rgba(245,158,11,.26);background:rgba(245,158,11,.08);color:#f7c76f}
    .teaching-d10-request[data-state="REJECTED"] .teaching-d10-status,.teaching-d10-request[data-state="WITHDRAWN"] .teaching-d10-status{border-color:rgba(224,82,82,.25);background:rgba(224,82,82,.08);color:#f19a9a}
    .teaching-d10-request__notice{margin-top:12px;padding:10px 11px;border:1px solid var(--teaching-border);border-radius:10px;background:rgba(255,255,255,.025);font-size:11px;line-height:1.5;color:#a9c6ba}
    .teaching-d10-request__notice[data-kind="alternative"]{border-color:rgba(245,158,11,.2);background:rgba(245,158,11,.055);color:#e9c47d}
    .teaching-d10-request .teaching-d10-actions{padding-top:2px;border-top:1px solid rgba(116,229,180,.08)}

    @media(max-width:800px){
      .teaching-d10-grid,.teaching-d10-fields{grid-template-columns:1fr}
      .teaching-d10-hero{grid-template-columns:1fr;align-items:start}
      .teaching-d10-hero__signals{justify-content:flex-start;max-width:none}
      .teaching-d10-request__top{align-items:flex-start}
    }
    @media(max-width:520px){
      .teaching-d10-page{gap:14px}
      .teaching-d10-hero{padding:19px 16px;border-radius:18px}
      .teaching-d10-hero h2{font-size:30px}
      .teaching-d10-hero__signals{display:grid;grid-template-columns:1fr 1fr;width:100%}
      .teaching-d10-signal{justify-content:flex-start;white-space:normal}
      .teaching-d10-composer__head,.teaching-d10-composer__body{padding-left:15px;padding-right:15px}
      .teaching-d10-composer__actions{align-items:stretch}
      .teaching-d10-composer__actions .teaching-d10-actions{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto}
      .teaching-d10-composer__actions .teaching-button,.teaching-d10-composer__actions .teaching-d08-link-button{min-height:46px}
      .teaching-d10-request{padding:14px}
      .teaching-d10-request__top{display:grid;grid-template-columns:minmax(0,1fr) auto}
      .teaching-d10-request .teaching-d10-actions{display:grid;grid-template-columns:1fr}
      .teaching-d10-request .teaching-d10-actions>*{width:100%}
      .teaching-d10-section-head{align-items:start}
    }
  `;document.head.append(style);
}
function field(label,input){const wrap=el('label','teaching-d10-field');wrap.append(el('span','',label),input);return wrap;}
function button(label,primary=false){const b=el('button',primary?'teaching-button teaching-button--primary':'teaching-d08-link-button',label);b.type='button';return b;}
async function refreshCourseShell(){if(typeof courseSurface.refresh==='function')await courseSurface.refresh({preserveView:true});}

async function fetchRules(courseId){return kiwiApiRequest('/teaching/courses/'+encodeURIComponent(courseId)+'/academic-rules');}
async function fetchActivation(courseId){return kiwiApiRequest('/teaching/courses/'+encodeURIComponent(courseId)+'/activation-review');}

function gradingLabel(key){return ({CLASSWORK:'Classwork',HOMEWORK:'Homework',GRADED_IMPROMPTU:'Graded impromptu',SCHEDULED_TESTS:'Scheduled tests',MID_SEMESTER:'Mid-semester',FINAL_EXAMINATION:'Final examination'})[key]||words(key);}
function renderStage6(course,rules,container,reload){
  const card=el('section','teaching-d10-card');
  card.append(el('div','teaching-kicker','Course setup · Stage 6'),el('h3','','Academic Rules and Teacher'),
    el('p','','Review the declared grading structure and Teacher assignment before the Course becomes an active academic commitment.'));
  if(!rules.gradingPolicy||!rules.teacher){
    card.append(el('p','teaching-d10-note','Academic rules or Teacher assignment have not been prepared yet.'));
    const prepare=button('Prepare Stage 6',true);prepare.addEventListener('click',async()=>{prepare.disabled=true;try{await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/academic-rules/prepare',{method:'POST',body:{}});await reload();}catch(e){window.alert(e.message||'Stage 6 could not be prepared.');}finally{prepare.disabled=false;}});card.append(prepare);container.append(card);return;
  }
  const list=el('div','teaching-d10-list');
  const teacher=el('div','teaching-d10-row');teacher.append(el('span','','Teacher'),el('strong','',rules.teacher.displayName));list.append(teacher);
  const policy=el('div','teaching-d10-row');policy.append(el('span','','Grading policy'),el('strong','',rules.gradingPolicy.kind==='KIWI_DEFAULT'?'KIWI default policy':words(rules.gradingPolicy.kind)));list.append(policy);
  for(const [key,value] of Object.entries(rules.gradingPolicy.categoryWeights||{})){const row=el('div','teaching-d10-row');row.append(el('span','',gradingLabel(key)),el('strong','',Math.round(Number(value)*100)+'%'));list.append(row);}
  card.append(list,el('p','teaching-d10-note',rules.gradingPolicy.locked?'This policy is locked to the active Course record.':'This policy remains reviewable until activation. Grade calculation itself remains owned by the later Gradebook delivery.'));
  container.append(card);
}
function readinessRow(label,value,ok){
  const row=el('div','teaching-d10-row');row.append(el('span','',label),el('span','teaching-d10-status',value||'Not ready'));row.dataset.ready=ok?'true':'false';return row;
}
function quickCourseRequest(type,courseId,requestedChange={}){pendingRequestContext={type,courseId,requestedChange}; if(nav&&typeof nav.open==='function')nav.open('requests'); else renderRequestCenter();}
function renderStage7(course,review,container,reload){
  const card=el('section','teaching-d10-card');
  card.append(el('div','teaching-kicker','Course setup · Stage 7'),el('h3','','Final Review and Coverage Audit'),
    el('p','','This page reads readiness from the authoritative Course Plan, Coverage, Scheduler, policy and lifecycle owners. The browser does not invent a separate readiness result.'));
  const list=el('div','teaching-d10-list');
  list.append(readinessRow('Course Plan',review.coursePlan?('Version '+review.coursePlan.version):'Missing',Boolean(review.coursePlan&&review.coursePlan.currentSourceSnapshot)));
  list.append(readinessRow('Coverage',review.coverage?.allowed?'Ready':(review.coverage?.auditOutcome||'Blocked'),Boolean(review.coverage?.allowed)));
  list.append(readinessRow('Semester',review.semester?review.semester.name:'Missing',Boolean(review.semester)));
  list.append(readinessRow('Timetable',review.timetable?(words(review.timetable.state)+' · v'+review.timetable.version):'Missing',Boolean(review.timetable)));
  list.append(readinessRow('Feasibility',review.feasibility?words(review.feasibility.outcome):'Not calculated',Boolean(review.feasibility&&review.feasibility.outcome!=='INFEASIBLE')));
  list.append(readinessRow('Teacher & academic rules',review.academicRules?.teacher&&review.academicRules?.gradingPolicy?'Ready':'Missing',Boolean(review.academicRules?.teacher&&review.academicRules?.gradingPolicy)));
  list.append(readinessRow('Course admission',review.admission?.allowed?('Capacity '+review.admission.concurrentCoursesBeforeTarget+'/'+review.admission.maximumConcurrentCourses):'Launch limit reached',Boolean(review.admission?.allowed)));
  card.append(list);
  if(review.blockingReasons?.length){const blockers=el('div','teaching-message');blockers.dataset.kind='error';blockers.append(el('strong','','Before this Course can start'));const ul=el('ul','teaching-d08-list');review.blockingReasons.forEach((x)=>ul.append(el('li','teaching-d10-blocker',words(x))));blockers.append(ul);card.append(blockers);}
  if(review.warnings?.length)card.append(el('p','teaching-d10-note','Current warning: '+review.warnings.map(words).join(', ')+'.'));
  const actions=el('div','teaching-d10-actions');
  if(review.canMarkReady){const b=button('Mark Course Ready',true);b.addEventListener('click',async()=>{b.disabled=true;try{await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/ready',{method:'POST',body:{}});await refreshCourseShell();await reload();}catch(e){window.alert(e.message||'Course could not become Ready.');}finally{b.disabled=false;}});actions.append(b);}
  if(review.canActivate){const b=button('Start Course',true);b.addEventListener('click',async()=>{if(!window.confirm('Start this Course? The timetable, Course Plan, grading policy and Teacher assignment will become versioned activation commitments.'))return;b.disabled=true;try{await kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.course_id)+'/activate',{method:'POST',body:{}});await refreshCourseShell();await reload();}catch(e){window.alert(e.message||'Course activation failed safely.');}finally{b.disabled=false;}});actions.append(b);}
  if(review.course.lifecycleState==='ACTIVE')actions.append(Object.assign(button('Request Course Pause'),{onclick:()=>quickCourseRequest('COURSE_PAUSE',course.course_id,{reason:''})}));
  if(review.course.lifecycleState==='PAUSED')actions.append(Object.assign(button('Request Course Resume'),{onclick:()=>quickCourseRequest('COURSE_RESUME',course.course_id,{reason:''})}));
  if(['ACTIVE','PAUSED'].includes(review.course.lifecycleState)){const br=button('Request Academic Break');br.addEventListener('click',()=>quickCourseRequest('ACADEMIC_BREAK',course.course_id,{}));const teacher=button('Request Teacher Change');teacher.addEventListener('click',()=>quickCourseRequest('TEACHER_CHANGE',course.course_id,{}));actions.append(br,teacher);}
  const open=button('Open Request Center');open.addEventListener('click',()=>quickCourseRequest(null,course.course_id,{}));actions.append(open);
  card.append(actions,el('p','teaching-d10-note','Post-activation timetable changes are formal Requests. Direct timetable dragging is not an authority path.'));
  container.append(card);
}
async function renderActivation({course,container}){
  installStyles();const page=el('div','teaching-d10-page');container.replaceChildren(page);
  async function load(){
    page.replaceChildren(el('div','teaching-message','Loading activation review…'));
    try{const [rules,review]=await Promise.all([fetchRules(course.course_id).catch(()=>({gradingPolicy:null,teacher:null})),fetchActivation(course.course_id)]);page.replaceChildren();const grid=el('div','teaching-d10-grid'),left=el('div'),right=el('div');grid.append(left,right);page.append(grid);renderStage6(course,rules,left,load);renderStage7(course,review,right,load);}
    catch(e){page.replaceChildren(el('div','teaching-message',e.message||'Activation review could not be loaded.'));page.firstElementChild.dataset.kind='error';}
  }await load();
}
async function renderActivationSummary({course,container,openSection}){
  installStyles();const card=el('article','teaching-course-feature-card');card.append(el('div','teaching-kicker','Activation & rules'),el('h3','','Final Course Review'),el('p','','Review academic rules, Teacher, Coverage and timetable readiness before activation.'));
  const actions=el('div','teaching-course-feature-card__actions'),open=button('Open final review',true);open.addEventListener('click',openSection);actions.append(open);
  if(['ACTIVE','PAUSED'].includes(String(course.lifecycle_state||''))){const req=button('Request a change');req.addEventListener('click',()=>quickCourseRequest(null,course.course_id,{}));actions.append(req);}card.append(actions);container.replaceChildren(card);
  try{const r=await fetchActivation(course.course_id);const badge=el('span','teaching-course-feature-card__status',r.course.lifecycleState==='ACTIVE'?'Active':(r.blockingReasons?.length?String(r.blockingReasons.length)+' blockers':words(r.course.lifecycleState)));card.insertBefore(badge,card.children[1]);}catch(_){}
}

function buildRequestForm(container,context={}){
  const courses=typeof courseSurface.all==='function'?courseSurface.all():[];
  const card=el('section','teaching-d10-card teaching-d10-composer');
  const head=el('div','teaching-d10-composer__head'),step=el('div','teaching-d10-step','01'),copy=el('div');
  copy.append(el('h3','','Request a change'),el('p','','Choose what should change. KIWI records the proposal first; the authoritative owner decides whether and when it can take effect.'));
  head.append(step,copy);
  const body=el('div','teaching-d10-composer__body');
  const fields=el('div','teaching-d10-fields');

  const courseSelect=el('select');
  courseSelect.setAttribute('aria-label','Course');
  const empty=el('option','','Choose Course');empty.value='';courseSelect.append(empty);
  courses.forEach((course)=>{const option=el('option','',course.title||'Course');option.value=course.course_id;option.selected=String(context.courseId||'')===String(course.course_id);courseSelect.append(option);});

  const type=el('select');type.setAttribute('aria-label','Request type');
  const allowed=context.type?[context.type]:['ACADEMIC_BREAK','COURSE_PAUSE','COURSE_RESUME','TEACHER_CHANGE','COURSE_CANCELLATION'];
  allowed.forEach((value)=>{const option=el('option','',words(value));option.value=value;type.append(option);});
  if(context.type){type.value=context.type;type.disabled=true;}

  fields.append(field('Course',courseSelect),field('Request type',type));

  const dynamic=el('div','teaching-d10-fields');dynamic.style.gridColumn='1/-1';
  const explanation=el('textarea');explanation.rows=3;explanation.placeholder='Add useful context for this request (optional)';
  const effective=el('input');effective.type='datetime-local';
  fields.append(dynamic,field('Explanation (optional)',explanation),field('Earliest effective time (optional)',effective));

  function draw(){
    dynamic.replaceChildren();const requestType=type.value;
    if(requestType==='ACADEMIC_BREAK'){
      const start=el('input'),end=el('input');start.type=end.type='datetime-local';start.dataset.role='start';end.dataset.role='end';dynamic.append(field('Break starts',start),field('Break ends',end));
    }else if(requestType==='SINGLE_CLASS_RESCHEDULE'){
      const start=el('input'),end=el('input');start.type=end.type='datetime-local';start.dataset.role='start';end.dataset.role='end';
      if(context.requestedChange?.startsAt)start.value=context.requestedChange.startsAt.slice(0,16);
      if(context.requestedChange?.endsAt)end.value=context.requestedChange.endsAt.slice(0,16);
      dynamic.append(field('Requested Class start',start),field('Requested Class end',end));
    }else if(requestType==='EMERGENCY_ABSENCE'){
      dynamic.append(el('div','teaching-d10-form-note','Emergency absence can trigger learning recovery later, but it cannot automatically become a behavior penalty.'));
    }else if(['COURSE_PAUSE','COURSE_RESUME','COURSE_CANCELLATION'].includes(requestType)){
      const reason=el('input');reason.dataset.role='reason';reason.placeholder='Short reason (optional)';reason.value=context.requestedChange?.reason||'';dynamic.append(field('Reason (optional)',reason));
    }else if(requestType==='TEACHER_CHANGE'){
      const teacher=el('select');teacher.dataset.role='teacher';teacher.setAttribute('aria-label','New Teacher');
      const loading=el('option','','Loading available Teachers…');loading.value='';teacher.append(loading);dynamic.append(field('New Teacher',teacher));
      kiwiApiRequest('/teaching/teacher-identities').then((rows)=>{
        teacher.replaceChildren();
        if(!rows.length){const none=el('option','','No alternate Teacher is currently available');none.value='';teacher.append(none);return;}
        rows.forEach((row)=>{const option=el('option','',row.displayName);option.value=row.teacherIdentityId;teacher.append(option);});
      }).catch(()=>{teacher.replaceChildren(el('option','','Teacher list unavailable'));});
    }else if(requestType==='ASSIGNMENT_EXTENSION'){
      const due=el('input');due.type='datetime-local';due.dataset.role='deadline';dynamic.append(field('Requested deadline',due));
    }else if(requestType==='EARLY_DISMISSAL'){
      const leave=el('input');leave.type='datetime-local';leave.dataset.role='leave';dynamic.append(field('Requested leave time',leave));
    }else if(requestType==='ATTENDANCE_REVIEW_CORRECTION'){
      const outcome=el('input');outcome.dataset.role='outcome';outcome.placeholder='Describe the attendance outcome you are requesting';dynamic.append(field('Requested attendance outcome',outcome));
    }
  }

  type.addEventListener('change',draw);draw();

  const note=el('div','teaching-d10-form-note');
  const noteText=el('span');noteText.append(el('strong','','Nothing changes immediately. '),document.createTextNode('Submitting creates a formal Request. Alternatives need your explicit acceptance before they can take effect.'));
  note.append(noteText);

  const message=el('div','teaching-d10-form-message');
  const footer=el('div','teaching-d10-composer__actions'),actions=el('div','teaching-d10-actions'),create=button('Create formal Request',true),cancel=button('Reset');
  actions.append(create,cancel);footer.append(actions);
  body.append(fields,note,message,footer);card.append(head,body);

  cancel.addEventListener('click',()=>{pendingRequestContext=null;renderRequestCenter();});
  create.addEventListener('click',async()=>{
    create.disabled=true;
    try{
      const requestType=type.value,courseId=courseSelect.value||context.courseId;if(!courseId)throw new Error('Choose a Course.');
      const change={...(context.requestedChange||{})};
      const localIso=(node)=>node?.value?new Date(node.value).toISOString():null;
      if(requestType==='ACADEMIC_BREAK'||requestType==='SINGLE_CLASS_RESCHEDULE'){const nodes=dynamic.querySelectorAll('input');change.startsAt=localIso(nodes[0]);change.endsAt=localIso(nodes[1]);}
      if(['COURSE_PAUSE','COURSE_RESUME','COURSE_CANCELLATION'].includes(requestType))change.reason=dynamic.querySelector('[data-role="reason"]')?.value||'';
      if(requestType==='TEACHER_CHANGE'){change.teacherIdentityId=dynamic.querySelector('[data-role="teacher"]')?.value||'';if(!change.teacherIdentityId)throw new Error('Choose an available Teacher identity.');}
      if(requestType==='ASSIGNMENT_EXTENSION')change.requestedDeadlineAt=localIso(dynamic.querySelector('[data-role="deadline"]'));
      if(requestType==='EARLY_DISMISSAL')change.requestedLeaveAt=localIso(dynamic.querySelector('[data-role="leave"]'));
      if(requestType==='ATTENDANCE_REVIEW_CORRECTION')change.requestedOutcome=dynamic.querySelector('[data-role="outcome"]')?.value||'';

      const payload={type:requestType,courseId,requestedChange:change,explanation:explanation.value||null,effectiveAt:effective.value?new Date(effective.value).toISOString():null,idempotencyKey:'ui:'+crypto.randomUUID()};
      const created=await kiwiApiRequest('/teaching/requests',{method:'POST',body:payload});
      pendingRequestContext=null;message.textContent='Request created as Draft.';message.className='teaching-message teaching-d10-form-message';
      await renderRequestCenter(created.requestId);
    }catch(error){
      message.textContent=error.message||'Request could not be created.';message.className='teaching-message teaching-d10-form-message';message.dataset.kind='error';
    }finally{create.disabled=false;}
  });

  container.append(card);
}
async function act(path,label,method='POST',body={}){if(!window.confirm(label+'?'))return;await kiwiApiRequest(path,{method,body});await renderRequestCenter();}
function requestCard(item){
  const card=el('article','teaching-d10-request');card.dataset.state=String(item.state||'');card.dataset.requestId=String(item.requestId||'');
  const top=el('div','teaching-d10-request__top'),title=el('div','teaching-d10-request__title');
  title.append(el('strong','',words(item.type)),el('div','teaching-d10-request__meta','Created '+fmt(item.createdAt)+(item.effectiveAt?' · earliest effect '+fmt(item.effectiveAt):'')));
  top.append(title,el('span','teaching-d10-status',words(item.state)));card.append(top);

  if(item.decision?.explanation)card.append(el('div','teaching-d10-request__notice',item.decision.explanation));
  if(item.alternativeProposal){const notice=el('div','teaching-d10-request__notice','Alternative available. Review it carefully; nothing changes until you explicitly accept this exact alternative.');notice.dataset.kind='alternative';card.append(notice);}
  if(item.applicationRef)card.append(el('div','teaching-d10-request__notice','Applied '+fmt(item.appliedAt)+'.'));
  if(item.requiresFutureOwner)card.append(el('div','teaching-d10-request__notice','This Request is recorded, but the '+item.target.owner+' owner is delivered later. KIWI will not fabricate that owner’s state.'));

  const actions=el('div','teaching-d10-actions');
  if(item.state==='DRAFT'){const submit=button('Submit for review',true);submit.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/submit','Submit this Request');actions.append(submit);}
  if(item.state==='REVIEWING'){const review=button('Run authoritative review',true);review.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/review','Review this Request');actions.append(review);}
  if(item.state==='ALTERNATIVE_PROPOSED'){
    const accept=button('Accept alternative',true);accept.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/alternative/accept','Accept this exact alternative','POST',{alternativeVersion:item.alternativeProposal.version});
    const decline=button('Decline');decline.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/alternative/decline','Decline this alternative','POST',{alternativeVersion:item.alternativeProposal.version});
    actions.append(accept,decline);
  }
  if(['DRAFT','SUBMITTED','REVIEWING','ALTERNATIVE_PROPOSED'].includes(item.state)){const withdraw=button('Withdraw');withdraw.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/withdraw','Withdraw this Request');actions.append(withdraw);}
  if(actions.children.length)card.append(actions);
  return card;
}

async function renderRequestCenter(focusRequestId=null){
  installStyles();
  const main=document.getElementById('teachingApp');if(!main)return;
  const page=el('section','teaching-view teaching-d10-page teaching-d10-request-center');

  const hero=el('section','teaching-d10-hero'),heroCopy=el('div','teaching-d10-hero__copy'),signals=el('div','teaching-d10-hero__signals');
  heroCopy.append(el('div','teaching-kicker','Requests'),el('h2','','Request Center'),el('p','','Ask for schedule, Course or administrative changes without directly rewriting academic state. Every Request keeps its decision, timing, alternative and application history.'));
  signals.append(el('span','teaching-d10-signal','Server validated'),el('span','teaching-d10-signal','Alternatives require acceptance'));
  hero.append(heroCopy,signals);page.append(hero);main.replaceChildren(page);

  if(pendingRequestContext||!focusRequestId)buildRequestForm(page,pendingRequestContext||{});

  const section=el('section','teaching-d10-request-section'),head=el('div','teaching-d10-section-head'),headCopy=el('div');
  headCopy.append(el('div','teaching-kicker','History'),el('h3','','Your Requests'));
  const count=el('div','teaching-d10-section-count','Loading…');head.append(headCopy,count);section.append(head);
  const list=el('div','teaching-d10-request-list');section.append(list);page.append(section);

  try{
    const items=await kiwiApiRequest('/teaching/requests');
    count.textContent=items.length+' total';
    if(!items.length){
      const empty=el('div','teaching-empty');empty.append(el('strong','','No formal Requests yet.'),el('div','','When you ask KIWI to change an active academic commitment, its Request history will appear here.'));list.append(empty);
    }else{
      items.forEach((item)=>list.append(requestCard(item)));
    }
    if(focusRequestId){
      const target=[...list.children].find((node)=>node.dataset.requestId===String(focusRequestId));
      target?.scrollIntoView?.({behavior:'smooth',block:'center'});
    }
  }catch(error){
    count.textContent='Unavailable';
    const message=el('div','teaching-message',error.message||'Requests could not be loaded.');message.dataset.kind='error';list.append(message);
  }
}
function openCreateRequest(context){pendingRequestContext=context||{};if(nav&&typeof nav.open==='function')nav.open('requests');else renderRequestCenter();}
async function createAvailabilityRequest(courseId,scheduleInputs){pendingRequestContext={type:'PERMANENT_AVAILABILITY_CHANGE',courseId,requestedChange:{scheduleInputs}};const created=await kiwiApiRequest('/teaching/requests',{method:'POST',body:{...pendingRequestContext,explanation:'Post-activation availability change',idempotencyKey:'schedule:'+crypto.randomUUID()}});pendingRequestContext=null;if(nav&&typeof nav.open==='function')nav.open('requests');return created;}
function requestClassReschedule(item){openCreateRequest({type:'SINGLE_CLASS_RESCHEDULE',courseId:item.course_id||item.courseId,requestedChange:{classId:item.class_id||item.classId,startsAt:item.starts_at||item.startsAt,endsAt:item.ends_at||item.endsAt}});}
function emergencyAbsence(item){openCreateRequest({type:'EMERGENCY_ABSENCE',courseId:item.course_id||item.courseId,requestedChange:{classId:item.class_id||item.classId,note:''}});}

courseSurface.registerSection({id:'activation',label:'Activation',order:40,render:renderActivation,renderSummary:renderActivationSummary});
if(nav&&typeof nav.register==='function')nav.register({id:'requests',label:'Requests',description:'Formal changes and decisions',icon:'↗',menuIcon:'request',onSelect:()=>renderRequestCenter()});
window.KIWITeachingD10=Object.freeze({
  openRequests:()=>nav?.open?.('requests'),
  openCreate:openCreateRequest,
  openContextualRequest:openCreateRequest,
  createScheduleRequest:createAvailabilityRequest,
  requestClassReschedule,
  emergencyAbsence,
  requestAssignmentExtension:(context)=>openCreateRequest({type:'ASSIGNMENT_EXTENSION',...context}),
  requestEarlyDismissal:(context)=>openCreateRequest({type:'EARLY_DISMISSAL',...context}),
  requestAttendanceCorrection:(context)=>openCreateRequest({type:'ATTENDANCE_REVIEW_CORRECTION',...context}),
  requestTeacherChange:(context)=>openCreateRequest({type:'TEACHER_CHANGE',...context}),
  contextualSurfaces:Object.freeze({
    calendar:Object.freeze(['SINGLE_CLASS_RESCHEDULE','EMERGENCY_ABSENCE']),
    course:Object.freeze(['ACADEMIC_BREAK','COURSE_PAUSE','COURSE_RESUME','TEACHER_CHANGE','COURSE_CANCELLATION']),
    assignment:Object.freeze(['ASSIGNMENT_EXTENSION']),
    classroom:Object.freeze(['EARLY_DISMISSAL','EMERGENCY_ABSENCE']),
    attendance:Object.freeze(['ATTENDANCE_REVIEW_CORRECTION']),
  }),
  renderRequestCenter,
});
