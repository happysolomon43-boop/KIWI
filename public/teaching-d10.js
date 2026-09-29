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
    .teaching-d10-page{display:grid;gap:16px}.teaching-d10-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
    .teaching-d10-card{padding:18px;border:1px solid var(--teaching-border);border-radius:18px;background:var(--teaching-surface-soft)}
    .teaching-d10-card h3{margin:7px 0 4px;font-size:20px}.teaching-d10-card p{color:var(--teaching-muted);line-height:1.55}
    .teaching-d10-list{display:grid;gap:8px;margin:14px 0}.teaching-d10-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--teaching-border)}
    .teaching-d10-row:first-child{border-top:0}.teaching-d10-status{font-family:var(--font-mono);font-size:10px;letter-spacing:.05em;text-transform:uppercase}
    .teaching-d10-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.teaching-d10-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .teaching-d10-field{display:grid;gap:6px}.teaching-d10-field span{font-size:11px;color:var(--teaching-muted)}.teaching-d10-field input,.teaching-d10-field select,.teaching-d10-field textarea{width:100%;box-sizing:border-box}
    .teaching-d10-request{padding:14px;border:1px solid var(--teaching-border);border-radius:14px}.teaching-d10-request__top{display:flex;justify-content:space-between;gap:12px}
    .teaching-d10-note{font-size:12px;color:var(--teaching-muted)}.teaching-d10-blocker{font-size:12px}
    @media(max-width:800px){.teaching-d10-grid,.teaching-d10-fields{grid-template-columns:1fr}}
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
  const card=el('section','teaching-d10-card');card.append(el('div','teaching-kicker','New formal Request'),el('h3','','Ask for an academic change'),el('p','','Requests are proposals until the authoritative owner approves and applies them. Alternatives never take effect without explicit acceptance.'));
  const fields=el('div','teaching-d10-fields');
  const courseSelect=el('select');const empty=el('option','','Choose Course');empty.value='';courseSelect.append(empty);courses.forEach((c)=>{const o=el('option','',c.title||'Course');o.value=c.course_id;o.selected=String(context.courseId||'')===String(c.course_id);courseSelect.append(o);});
  const type=el('select');
  const allowed=context.type?[context.type]:['ACADEMIC_BREAK','COURSE_PAUSE','COURSE_RESUME','TEACHER_CHANGE','COURSE_CANCELLATION'];
  allowed.forEach((v)=>{const o=el('option','',words(v));o.value=v;type.append(o);});if(context.type)type.value=context.type;
  fields.append(field('Course',courseSelect),field('Request type',type));
  const dynamic=el('div','teaching-d10-fields');dynamic.style.gridColumn='1/-1';
  const explanation=el('textarea');explanation.rows=3;explanation.placeholder='Optional explanation in ordinary academic language';
  const effective=el('input');effective.type='datetime-local';
  fields.append(dynamic,field('Explanation',explanation),field('Take effect no earlier than (optional)',effective));
  function draw(){
    dynamic.replaceChildren();const t=type.value;
    if(t==='ACADEMIC_BREAK'){const a=el('input'),b=el('input');a.type=b.type='datetime-local';a.dataset.role='start';b.dataset.role='end';dynamic.append(field('Break starts',a),field('Break ends',b));}
    else if(t==='SINGLE_CLASS_RESCHEDULE'){const a=el('input'),b=el('input');a.type=b.type='datetime-local';a.dataset.role='start';b.dataset.role='end';if(context.requestedChange?.startsAt)a.value=context.requestedChange.startsAt.slice(0,16);if(context.requestedChange?.endsAt)b.value=context.requestedChange.endsAt.slice(0,16);dynamic.append(field('Requested Class start',a),field('Requested Class end',b));}
    else if(t==='EMERGENCY_ABSENCE'){dynamic.append(el('p','teaching-d10-note','Emergency absence does not require proof interrogation and cannot automatically become a behavior penalty.'));}
    else if(['COURSE_PAUSE','COURSE_RESUME','COURSE_CANCELLATION'].includes(t)){const reason=el('input');reason.dataset.role='reason';reason.value=context.requestedChange?.reason||'';dynamic.append(field('Reason (optional)',reason));}
    else if(t==='TEACHER_CHANGE'){const teacher=el('select');teacher.dataset.role='teacher';const loading=el('option','','Loading available Teachers…');loading.value='';teacher.append(loading);dynamic.append(field('New Teacher',teacher));kiwiApiRequest('/teaching/teacher-identities').then((rows)=>{teacher.replaceChildren();if(!rows.length){const none=el('option','','No alternate Teacher identity is currently available');none.value='';teacher.append(none);return;}rows.forEach((row)=>{const option=el('option','',row.displayName);option.value=row.teacherIdentityId;teacher.append(option);});}).catch(()=>{teacher.replaceChildren(el('option','','Teacher list unavailable'));});}
    else if(t==='ASSIGNMENT_EXTENSION'){const due=el('input');due.type='datetime-local';due.dataset.role='deadline';dynamic.append(field('Requested deadline',due));}
    else if(t==='EARLY_DISMISSAL'){const leave=el('input');leave.type='datetime-local';leave.dataset.role='leave';dynamic.append(field('Requested leave time',leave));}
    else if(t==='ATTENDANCE_REVIEW_CORRECTION'){const outcome=el('input');outcome.dataset.role='outcome';dynamic.append(field('Requested attendance outcome',outcome));}
  }type.addEventListener('change',draw);draw();
  const message=el('div'),actions=el('div','teaching-d10-actions'),create=button('Create Request',true),cancel=button('Clear');actions.append(create,cancel);card.append(fields,actions,message);
  cancel.addEventListener('click',()=>{pendingRequestContext=null;renderRequestCenter();});
  create.addEventListener('click',async()=>{
    create.disabled=true;try{
      const t=type.value,cid=courseSelect.value||context.courseId;if(!cid)throw new Error('Choose a Course.');
      const change={...(context.requestedChange||{})};
      const localIso=(node)=>node?.value?new Date(node.value).toISOString():null;
      if(t==='ACADEMIC_BREAK'||t==='SINGLE_CLASS_RESCHEDULE'){const nodes=dynamic.querySelectorAll('input');change.startsAt=localIso(nodes[0]);change.endsAt=localIso(nodes[1]);}
      if(['COURSE_PAUSE','COURSE_RESUME','COURSE_CANCELLATION'].includes(t))change.reason=dynamic.querySelector('[data-role="reason"]')?.value||'';
      if(t==='TEACHER_CHANGE'){change.teacherIdentityId=dynamic.querySelector('[data-role="teacher"]')?.value||'';if(!change.teacherIdentityId)throw new Error('Choose an available Teacher identity.');}
      if(t==='ASSIGNMENT_EXTENSION')change.requestedDeadlineAt=localIso(dynamic.querySelector('[data-role="deadline"]'));
      if(t==='EARLY_DISMISSAL')change.requestedLeaveAt=localIso(dynamic.querySelector('[data-role="leave"]'));
      if(t==='ATTENDANCE_REVIEW_CORRECTION')change.requestedOutcome=dynamic.querySelector('[data-role="outcome"]')?.value||'';
      const body={type:t,courseId:cid,requestedChange:change,explanation:explanation.value||null,effectiveAt:effective.value?new Date(effective.value).toISOString():null,idempotencyKey:'ui:'+crypto.randomUUID()};
      const created=await kiwiApiRequest('/teaching/requests',{method:'POST',body});pendingRequestContext=null;message.textContent='Request created as Draft.';message.className='teaching-message';await renderRequestCenter(created.requestId);
    }catch(e){message.textContent=e.message||'Request could not be created.';message.className='teaching-message';message.dataset.kind='error';}finally{create.disabled=false;}
  });
  container.append(card);
}
async function act(path,label,method='POST',body={}){if(!window.confirm(label+'?'))return;await kiwiApiRequest(path,{method,body});await renderRequestCenter();}
function requestCard(item){
  const card=el('article','teaching-d10-request'),top=el('div','teaching-d10-request__top');top.append(el('strong','',words(item.type)),el('span','teaching-d10-status',words(item.state)));card.append(top,el('p','teaching-d10-note','Created '+fmt(item.createdAt)+(item.effectiveAt?' · effective '+fmt(item.effectiveAt):'')));
  if(item.decision?.explanation)card.append(el('p','',item.decision.explanation));
  if(item.alternativeProposal)card.append(el('p','teaching-message','Alternative available. It will not change academic state until you explicitly accept it.'));
  if(item.applicationRef)card.append(el('p','teaching-d10-note','Applied '+fmt(item.appliedAt)+'.'));
  if(item.requiresFutureOwner)card.append(el('p','teaching-d10-note','The formal Request record is ready, but the authoritative '+item.target.owner+' owner is delivered later. D10 does not fabricate that owner’s state.'));
  const actions=el('div','teaching-d10-actions');
  if(item.state==='DRAFT'){const b=button('Submit');b.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/submit','Submit this Request');actions.append(b);}
  if(item.state==='REVIEWING'){const b=button('Run authoritative review',true);b.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/review','Review this Request');actions.append(b);}
  if(item.state==='ALTERNATIVE_PROPOSED'){const accept=button('Accept alternative',true);accept.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/alternative/accept','Accept this exact alternative','POST',{alternativeVersion:item.alternativeProposal.version});const decline=button('Decline');decline.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/alternative/decline','Decline this alternative','POST',{alternativeVersion:item.alternativeProposal.version});actions.append(accept,decline);}
  if(['DRAFT','SUBMITTED','REVIEWING','ALTERNATIVE_PROPOSED'].includes(item.state)){const w=button('Withdraw');w.onclick=()=>act('/teaching/requests/'+encodeURIComponent(item.requestId)+'/withdraw','Withdraw this Request');actions.append(w);}
  card.append(actions);return card;
}
async function renderRequestCenter(focusRequestId=null){
  installStyles();const main=document.getElementById('teachingApp');if(!main)return;const page=el('section','teaching-view teaching-d10-page'),head=el('div','teaching-d10-card');head.append(el('div','teaching-kicker','Requests'),el('h2','','Request Center'),el('p','','Formal schedule, Course and administrative changes live here with their decision, effective time, alternatives and application history.'));page.append(head);main.replaceChildren(page);
  if(pendingRequestContext||!focusRequestId)buildRequestForm(page,pendingRequestContext||{});
  const list=el('div','teaching-d10-page');list.append(el('div','teaching-kicker','', ''));
  try{const items=await kiwiApiRequest('/teaching/requests');if(!items.length)list.append(el('div','teaching-empty','No formal Requests yet.'));else items.forEach((item)=>list.append(requestCard(item)));page.append(list);if(focusRequestId){const target=[...list.children].find((node)=>node.textContent.includes(focusRequestId));target?.scrollIntoView?.({behavior:'smooth'});}}
  catch(e){page.append(el('div','teaching-message',e.message||'Requests could not be loaded.'));}
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
