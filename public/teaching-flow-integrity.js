(function installTeachingFlowExperience(global){
'use strict';

const api=global.KIWI_API_CLIENT||{};
const request=api.kiwiApiRequest;
const courses=global.KIWITeachingCourses;
const nav=global.KIWITeachingNavigation;
if(typeof request!=='function'||!courses?.registerSection)return;

const $=(tag,cls='',text=null)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==null&&text!==undefined)node.textContent=String(text);return node;};
const add=(parent,...children)=>{children.filter(Boolean).forEach((child)=>parent.append(child));return parent;};
const human=(value)=>String(value||'').replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,(m)=>m.toUpperCase());
const coursePath=(courseId,suffix)=>`/teaching/courses/${encodeURIComponent(courseId)}${suffix}`;

function dateTime(value,zone){
  if(!value)return 'Not scheduled';
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Not scheduled';
  try{return new Intl.DateTimeFormat([], {timeZone:zone||undefined,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date);}catch{return date.toLocaleString();}
}
function dayLabel(value,zone){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Schedule';
  try{return new Intl.DateTimeFormat([], {timeZone:zone||undefined,weekday:'long',month:'short',day:'numeric'}).format(date);}catch{return date.toLocaleDateString();}
}
function timeLabel(value,zone){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';
  try{return new Intl.DateTimeFormat([], {timeZone:zone||undefined,hour:'numeric',minute:'2-digit'}).format(date);}catch{return date.toLocaleTimeString();}
}
function minutes(value){return `${Math.max(0,Math.round(Number(value)||0))} min`;}
function planCounts(review){
  const topics=review?.plan?.topics||[];
  return {topics:topics.length,units:topics.reduce((sum,t)=>sum+(t.learningUnits?.length||0),0)};
}
function summaryText(value){
  if(typeof value==='string'&&value.trim())return value.trim();
  if(Array.isArray(value))return value.map(summaryText).filter(Boolean).join(' ');
  if(value&&typeof value==='object'){
    for(const key of ['summary','overview','review','rationale','description','student_summary']){
      if(typeof value[key]==='string'&&value[key].trim())return value[key].trim();
    }
    for(const key of ['key_points','points','notes','recommendations']){
      if(Array.isArray(value[key])){const text=value[key].map(summaryText).filter(Boolean).join(' ');if(text)return text;}
    }
  }
  return '';
}
function chip(text,tone=''){
  const node=$('span','tf-chip',text);if(tone)node.dataset.tone=tone;return node;
}
function button(text,{primary=false,onClick=null,disabled=false}={}){
  const node=$('button',`tf-button${primary?' tf-button--primary':''}`,text);node.type='button';node.disabled=disabled;if(onClick)node.addEventListener('click',onClick);return node;
}
function metric(value,label){return add($('div','tf-metric'),$('strong','',value),$('span','',label));}
function message(text,kind=''){
  const node=$('div',`tf-card ${kind==='error'?'tf-card--error':kind==='warning'?'tf-card--warning':''}`);node.append($('p','',text));return node;
}
function journey(active,{plan=false,timetable=false,review=false,activeCourse=false}={}){
  const row=$('div','tf-journey');
  const items=[
    ['01','Course Plan','What KIWI will teach',plan],
    ['02','Timetable','When classes will happen',timetable],
    ['03','Final Review','Accept the commitments',review],
    ['04','Classroom','Attend scheduled classes',activeCourse],
  ];
  items.forEach(([num,title,copy,done],index)=>{const step=add($('div','tf-step'),$('span','tf-step__num',done?'✓':num),$('strong','',title),$('span','',copy));step.dataset.active=index===active?'true':'false';step.dataset.done=done?'true':'false';row.append(step);});
  return row;
}
function hero(eyebrow,title,copy,status){
  const root=$('section','tf-hero');const top=$('div','tf-hero__top');const text=$('div');text.append($('div','tf-eyebrow',eyebrow),$('h2','',title));top.append(text,status||null);root.append(top,$('p','',copy));return root;
}
function actionStatus(){const node=$('div','tf-action-status');node.setAttribute('role','status');node.setAttribute('aria-live','polite');return node;}
const ACTIVE_PLAN_JOB_STATUSES=new Set(['PENDING','CLAIMED','RETRY_WAIT']);
function clearActionStatus(live){live.replaceChildren();delete live.dataset.kind;}
function setActionStatus(live,notice){
  clearActionStatus(live);
  if(!notice?.title)return;
  live.dataset.kind=notice.kind||'info';
  const mark=$('span','tf-action-status__mark',notice.kind==='success'?'✓':notice.kind==='error'?'!':'…');
  const copy=$('div','tf-action-status__copy');copy.append($('strong','',notice.title));
  if(notice.detail)copy.append($('span','',notice.detail));
  live.append(mark,copy);
}
function coursePlanGenerationNotice(review){
  const job=review?.generation?.background;if(!job)return null;
  const status=String(job.status||'').toUpperCase(),operation=job.operation==='REGENERATION'?'REGENERATION':'GENERATION';
  const currentVersion=Number(job.resultPlanVersion||review?.plan?.version||0)||null;
  const previousVersion=Number(job.previousPlanVersion||0)||null;
  if(job.completionConfirmed){
    return operation==='REGENERATION'
      ? {kind:'success',title:'Action completed',detail:`Course Plan regenerated successfully. Version ${currentVersion} is now the current Course Plan.`}
      : {kind:'success',title:'Action completed',detail:`Course Plan created successfully. Version ${currentVersion} is now the current Course Plan.`};
  }
  if(status==='CANCELLED'){
    return operation==='REGENERATION'
      ? {kind:'error',title:'Course Plan regeneration failed',detail:`Your existing Course Plan${previousVersion?` v${previousVersion}`:''} has not been changed. You can try regeneration again.`}
      : {kind:'error',title:'Course Plan creation failed',detail:'No Course Plan was committed. You can try again.'};
  }
  if(ACTIVE_PLAN_JOB_STATUSES.has(status)){
    const retry=status==='RETRY_WAIT';
    return operation==='REGENERATION'
      ? {kind:'working',title:retry?'Regeneration is retrying safely':'Regenerating Course Plan',detail:`KIWI is generating and validating a new version in the background. Course Plan${previousVersion?` v${previousVersion}`:''} remains current until the replacement passes validation.`}
      : {kind:'working',title:retry?'Course Plan creation is retrying safely':'Creating Course Plan',detail:'KIWI is generating and validating the Course Plan in the background. It becomes current only after validation and persistence succeed.'};
  }
  if(status==='PUBLISHED'){
    return {kind:'warning',title:'Course Plan result needs confirmation',detail:'The background job finished, but KIWI has not confirmed a current validated Course Plan version for this Course scope.'};
  }
  return null;
}
function showLoading(page,live,label){
  clearActionStatus(live);
  const skeleton=$('div','teaching-shell-skeleton');
  skeleton.setAttribute('role','status');skeleton.setAttribute('aria-label',label);
  const card=$('div','teaching-skeleton-card');
  const title=$('div','teaching-skeleton-line');title.dataset.size='title';
  card.append(title,$('div','teaching-skeleton-line'),$('div','teaching-skeleton-block'));
  skeleton.append(card);page.replaceChildren(skeleton,live);
}
async function refreshShell(){if(typeof courses.refresh==='function')await courses.refresh({preserveView:true});}
function open(section){courses.openSection?.(section);}
function openCalendar(){if(nav?.open)nav.open('calendar');}

function renderTopic(topic){
  const details=$('details','tf-topic');const summary=$('summary','');summary.append($('span','',topic.title||'Topic'),$('span','tf-mini',`${topic.learningUnits?.length||0} units`));const body=$('div','tf-topic__body');
  if(topic.subtopics?.length)body.append($('p','tf-subtopics',`Subtopics · ${topic.subtopics.map((x)=>x.title).filter(Boolean).join(' · ')}`));
  (topic.learningUnits||[]).forEach((unit)=>{const card=$('div','tf-unit');card.append($('strong','',unit.title||'Learning Unit'),$('span','',unit.intendedCompetence||'Competence defined in the Course Plan.'));const meta=$('div','tf-unit__meta');meta.append($('span','tf-mini',human(unit.criticality||'planned')),$('span','tf-mini',human(unit.instructionalTreatment||'full instruction')));if(unit.foundational)meta.append($('span','tf-mini','Foundational'));card.append(meta);body.append(card);});
  details.append(summary,body);return details;
}

async function renderPlan({course,container}){
  const page=$('div','tf-page');container.replaceChildren(page);const live=actionStatus();page.append(live);
  let watchedJobId=null,watchToken=0;
  const wait=(ms)=>new Promise((resolve)=>window.setTimeout(resolve,ms));
  async function watchPlanJob(jobId){
    if(!jobId||watchedJobId===jobId)return;
    watchedJobId=jobId;
    const token=++watchToken,deadline=Date.now()+(4*60*1000);
    while(page.isConnected&&token===watchToken&&Date.now()<deadline){
      await wait(2500);
      if(!page.isConnected||token!==watchToken)return;
      let review;
      try{review=await request(coursePath(course.course_id,'/plan-review'));}catch{continue;}
      const job=review?.generation?.background;
      if(job?.eventId&&String(job.eventId)!==String(jobId))continue;
      const notice=coursePlanGenerationNotice(review);
      setActionStatus(live,notice);
      const terminal=Boolean(job?.completionConfirmed)||String(job?.status||'').toUpperCase()==='CANCELLED';
      if(terminal){
        watchedJobId=null;
        await refreshShell().catch(()=>{});
        await load({showSkeleton:false,notice});
        return;
      }
    }
    if(page.isConnected&&token===watchToken){
      watchedJobId=null;
      await load({showSkeleton:false,notice:{kind:'working',title:'Still running in the background',detail:'KIWI has not reported a final Course Plan result yet. The current plan remains unchanged until a validated replacement is committed.'}});
    }
  }
  async function load({showSkeleton=true,notice=null}={}){
    if(showSkeleton)showLoading(page,live,'Loading Course Plan');
    try{
      const [review,activation,schedule]=await Promise.all([
        request(coursePath(course.course_id,'/plan-review')),
        request(coursePath(course.course_id,'/activation-review')).catch(()=>null),
        request(coursePath(course.course_id,'/schedule-review')).catch(()=>null),
      ]);
      const counts=planCounts(review),hasPlan=Boolean(review.plan),hasTimetable=Boolean(schedule?.timetable),isReady=['READY','ACTIVE','PAUSED'].includes(String(activation?.course?.lifecycleState||course.lifecycle_state)),isActive=['ACTIVE','PAUSED'].includes(String(activation?.course?.lifecycleState||course.lifecycle_state));
      const background=review.generation?.background||null,backgroundStatus=String(background?.status||'').toUpperCase(),planJobActive=ACTIVE_PLAN_JOB_STATUSES.has(backgroundStatus);
      const status=hasPlan?chip(`v${review.plan.version} · ${human(review.plan.state)}`):chip(review.generation?.ready?'Ready to create':'Setup needed',review.generation?.ready?'':'warn');
      const body=$('div','tf-page');body.append(hero('Course Plan','Review what KIWI will teach','This is the academic plan generated from your saved sources and validated curriculum analysis. Review it before you accept the final course commitments.',status),journey(0,{plan:hasPlan,timetable:hasTimetable,review:isReady,activeCourse:isActive}),live);
      if(!hasPlan){
        const card=$('section','tf-card tf-card--accent');card.append($('div','tf-eyebrow','Next step'),$('h3','','Create the academic plan'),$('p','',review.generation?.ready?'KIWI can now organize the validated curriculum into a versioned Course Plan.':'Course preparation still has unresolved steps before planning can begin.'));
        const actions=$('div','tf-actions');
        if(review.generation?.ready){
          if(planJobActive){
            actions.append(button(background?.operation==='REGENERATION'?'Regeneration running in background':'Course Plan running in background',{primary:true,disabled:true}));
          }else{
            const create=button('Create Course Plan',{primary:true,onClick:async()=>{
              create.disabled=true;
              setActionStatus(live,{kind:'working',title:'Creating Course Plan',detail:'KIWI is preparing, generating and validating the Course Plan in the background.'});
              try{
                const queued=await request(coursePath(course.course_id,'/course-plan'),{method:'POST',body:{}});
                if(queued?.background===false&&queued?.status==='COMPLETED'){await refreshShell().catch(()=>{});await load({showSkeleton:false});return;}
                create.textContent='Course Plan running in background';
                watchPlanJob(queued?.jobId);
              }catch(error){
                setActionStatus(live,{kind:'error',title:'Course Plan creation failed',detail:error.message||'No Course Plan was committed. You can try again.'});
                create.disabled=false;
              }
            }});
            actions.append(create);
          }
        }else actions.append(button('Open Setup',{primary:true,onClick:()=>open('setup')}));
        card.append(actions);body.append(card);page.replaceChildren(body);
        setActionStatus(live,notice||coursePlanGenerationNotice(review));
        if(planJobActive&&background?.eventId)watchPlanJob(background.eventId);
        return;
      }
      const grid=$('div','tf-grid'),main=$('div','tf-stack'),side=$('aside','tf-stack');
      const overview=$('section','tf-card tf-card--accent');overview.append($('div','tf-card__head'));overview.firstChild.append(add($('div',''),$('div','tf-eyebrow','Plan at a glance'),$('h3','','The learning journey')),chip(review.plan.currentForCourseScope?'Current':'Needs review',review.plan.currentForCourseScope?'':'warn'));
      const metrics=$('div','tf-metrics');metrics.append(metric(counts.topics,'topics'),metric(counts.units,'learning units'),metric(review.coverageReport?.summary?.mappedRequiredItems??'—','required items mapped'));overview.append(metrics);
      const ai=$('div','tf-ai-note');ai.append($('div','tf-ai-note__mark','AI'));const aiCopy=$('div');aiCopy.append($('strong','','KIWI plan review'),$('p','',summaryText(review.plan.reviewSummary)||'This plan was produced through the Course Plan intelligence route and passed deterministic validation before it became the current version.'));ai.append(aiCopy);overview.append(ai);
      if(review.generation?.regenerationAllowed){
        const regenerateNote=$('p','','Want a different organization of the same validated curriculum? Regeneration creates a new plan version; this current version remains preserved until the replacement passes validation.');
        const regenerateActions=$('div','tf-actions');
        if(planJobActive){
          regenerateActions.append(button(background?.operation==='REGENERATION'?'Regeneration running in background':'Course Plan work running in background',{primary:true,disabled:true}));
        }else{
          const regenerate=button('Regenerate Course Plan',{primary:true,onClick:async()=>{
            const previousVersion=Number(review.plan.version);
            regenerate.disabled=true;
            setActionStatus(live,{kind:'working',title:'Regenerating Course Plan',detail:`KIWI is generating and validating a new version in the background. Course Plan v${previousVersion} remains current until the replacement passes validation.`});
            try{
              const queued=await request(coursePath(course.course_id,'/course-plan/regenerate'),{method:'POST',body:{}});
              regenerate.textContent='Regeneration running in background';
              watchPlanJob(queued?.jobId);
            }catch(error){
              setActionStatus(live,{kind:'error',title:'Course Plan regeneration failed',detail:error.message||`Your existing Course Plan v${previousVersion} has not been changed.`});
              regenerate.disabled=false;
            }
          }});
          regenerateActions.append(regenerate);
        }
        overview.append(regenerateNote,regenerateActions);
      }
      const topics=$('section','tf-card');topics.append($('div','tf-eyebrow','Curriculum'),$('h3','','Topics and Learning Units'));const topicList=$('div','tf-topics');(review.plan.topics||[]).forEach((topic)=>topicList.append(renderTopic(topic)));topics.append(topicList);main.append(overview,topics);
      const coverage=$('section','tf-card');coverage.append($('div','tf-eyebrow','Coverage'),$('h3','','Nothing important should disappear'),$('p','',review.coverageReport?.summary?.unmappedRequiredItems>0?`${review.coverageReport.summary.unmappedRequiredItems} required item(s) still need coverage review.`:'Required source content is mapped into the Course Plan. Coverage is not the same as mastery.'));side.append(coverage);
      if(review.assumptions?.length){const assumptions=$('section','tf-card');assumptions.append($('div','tf-eyebrow','Assumptions'),$('h3','','What KIWI is carrying forward'));(review.assumptions||[]).slice(0,6).forEach((item)=>assumptions.append($('p','',item.disclosure||item.description||item.label)));side.append(assumptions);}
      const next=$('section','tf-card');next.append($('div','tf-eyebrow','Continue'),$('h3','','When this plan looks right'),$('p','','Set availability in Schedule, then review the proposed timetable. Final acceptance happens only on the Final Review screen.'));const actions=$('div','tf-actions');actions.append(button('Availability',{onClick:()=>open('schedule')}),button('Review timetable',{primary:true,onClick:()=>open('timetable-review')}));next.append(actions);side.append(next);
      grid.append(main,side);body.append(grid);page.replaceChildren(body);
      setActionStatus(live,notice||coursePlanGenerationNotice(review));
      if(planJobActive&&background?.eventId)watchPlanJob(background.eventId);
    }catch(error){page.replaceChildren(message(error.message||'Course Plan review could not be loaded.','error'),live);clearActionStatus(live);}
  }
  await load();
}

function slotKind(slot){
  if(slot.kind==='CLASS')return 'Class';
  if(slot.kind==='ASSESSMENT_RESERVE')return 'Assessment reserve';
  if(slot.kind==='REVISION_RESERVE')return 'Revision reserve';
  return human(slot.kind||'Scheduled time');
}
function groupSlots(slots,zone){
  const groups=new Map();
  [...slots].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)).forEach((slot)=>{const key=dayLabel(slot.startsAt,zone);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(slot);});return groups;
}
function renderSlot(slot,zone){
  const row=$('div','tf-slot');const duration=Number(slot.plannedMinutes)||Math.round((Date.parse(slot.endsAt)-Date.parse(slot.startsAt))/60000);row.append($('div','tf-slot__time',`${timeLabel(slot.startsAt,zone)}\n${timeLabel(slot.endsAt,zone)}`));const copy=$('div','tf-slot__copy');copy.append($('strong','',slotKind(slot)),$('span','',slot.kind==='CLASS'?`${minutes(duration)} · ${slot.learningUnitRefs?.length||0} planned learning unit${slot.learningUnitRefs?.length===1?'':'s'}`:`${minutes(duration)} protected time`));row.append(copy,chip(slot.horizonStage||'planned',slot.kind==='CLASS'?'':'muted'));return row;
}

async function renderTimetable({course,container}){
  const page=$('div','tf-page');container.replaceChildren(page);const live=actionStatus();page.append(live);
  async function load(notice=''){
    showLoading(page,live,'Loading timetable');
    try{
      const [data,activation,planReview]=await Promise.all([request(coursePath(course.course_id,'/schedule-review')),request(coursePath(course.course_id,'/activation-review')).catch(()=>null),request(coursePath(course.course_id,'/plan-review')).catch(()=>null)]);
      const lifecycle=String(activation?.course?.lifecycleState||course.lifecycle_state||'DRAFT'),isActive=['ACTIVE','PAUSED'].includes(lifecycle),hasPlan=Boolean(planReview?.plan?.currentForCourseScope),integrity=data.scheduleIntegrity||{},zone=data.semester?.timezone||'UTC',now=Date.parse(data.serverNow||new Date().toISOString());
      const courseSlots=Array.isArray(data.courseSlots)?data.courseSlots:(data.slots||[]).filter((slot)=>String(slot.courseId||slot.course_id||'')===String(course.course_id)),courseSummary=data.feasibility?.courseSummary||null,courseHasTimetable=hasPlan&&Boolean(data.timetable)&&(Boolean(courseSummary)||courseSlots.length>0);
      const future=courseSlots.filter((slot)=>Date.parse(slot.endsAt)>now),classes=future.filter((slot)=>slot.kind==='CLASS'),classMinutes=classes.reduce((sum,slot)=>sum+(Number(slot.plannedMinutes)||Math.round((Date.parse(slot.endsAt)-Date.parse(slot.startsAt))/60000)),0),headroom=Number(data.feasibility?.metrics?.headroomRatio);
      const status=!hasPlan?chip('Plan required','warn'):!courseHasTimetable?chip('Not created','warn'):integrity.recoveryRequired?chip('Repair required','bad'):chip(isActive?'Official':'Proposed');
      const body=$('div','tf-page');body.append(hero('Timetable','See when learning will actually happen',isActive?'This Course is active. Calendar is the authoritative timetable destination; this page explains the approved schedule and its health.':'Review the proposed Classes before Final Review. KIWI schedules from instructional load and real availability—not simply from topic count.',status),journey(1,{plan:hasPlan,timetable:Boolean(courseHasTimetable&&!integrity.recoveryRequired),review:['READY','ACTIVE','PAUSED'].includes(lifecycle),activeCourse:isActive}));
      if(integrity.recoveryRequired||integrity.reserveOnly||integrity.elapsedSlotCount>0){
        const warning=$('section','tf-card tf-card--error');warning.append($('div','tf-eyebrow','KIWI detected a schedule problem'),$('h3','',integrity.reserveOnly?'This timetable has no Classes':'This timetable needs repair'),$('p','',integrity.reserveOnly?'Only reserve blocks were created, so Classroom has no scheduled sessions. KIWI will rebuild the timetable from the Course Plan workload and the remaining semester time.':'The current timetable has no usable future Classes or contains elapsed obligations. KIWI will recalculate from server time without creating a student penalty.'));
        const actions=$('div','tf-actions');const repair=button('Repair timetable',{primary:true,onClick:async()=>{repair.disabled=true;live.textContent='KIWI is estimating missing workload, checking capacity and rebuilding the timetable…';try{await request(coursePath(course.course_id,'/timetable/propose'),{method:'POST',body:{},timeoutMs:210000});await refreshShell();await load('Timetable repaired.');}catch(error){live.textContent=error.message||'The timetable could not be repaired safely.';repair.disabled=false;}}});actions.append(repair);warning.append(actions);body.append(warning);
      }
      const grid=$('div','tf-grid'),main=$('div','tf-stack'),side=$('aside','tf-stack');
      const summary=$('section','tf-card tf-card--accent');summary.append($('div','tf-eyebrow','Schedule state'),$('h3','',courseHasTimetable?`${classes.length} upcoming Class${classes.length===1?'':'es'}`:'No timetable yet'));const metrics=$('div','tf-metrics');metrics.append(metric(classes.length,'upcoming classes'),metric(courseSummary?.requiredMinutes==null?minutes(classMinutes):minutes(courseSummary.requiredMinutes),'required class time'),metric(Number.isFinite(headroom)?`${Math.round(headroom*100)}%`:'—','semester recovery headroom'));summary.append(metrics);
      if(!hasPlan||!courseHasTimetable){summary.append($('p','',hasPlan?'KIWI can build this Course timetable from the current Course Plan and shared availability.':'Create this Course Plan first. Shared Semester availability does not create a Course Plan, and timetable items from other Courses are not shown here.'));const actions=$('div','tf-actions');actions.append(button('Edit availability',{onClick:()=>open('schedule')}));if(hasPlan)actions.append(button('Build timetable',{primary:true,onClick:async(event)=>{const b=event.currentTarget;b.disabled=true;live.textContent='KIWI is checking instructional load and building the timetable…';try{await request(coursePath(course.course_id,'/timetable/propose'),{method:'POST',body:{},timeoutMs:210000});await load('Timetable created.');}catch(error){live.textContent=error.message||'A feasible timetable could not be created.';b.disabled=false;}}}));else actions.append(button('Create Course Plan',{primary:true,onClick:()=>open('course-plan')}));summary.append(actions);}
      else if(!isActive&&!integrity.recoveryRequired){const actions=$('div','tf-actions');actions.append(button('Recalculate',{onClick:async(event)=>{const b=event.currentTarget;b.disabled=true;live.textContent='Rechecking feasibility…';try{await request(coursePath(course.course_id,'/timetable/propose'),{method:'POST',body:{},timeoutMs:210000});await load('Timetable recalculated.');}catch(error){live.textContent=error.message||'Timetable could not be recalculated.';b.disabled=false;}}}),button('Edit availability',{onClick:()=>open('schedule')}));summary.append(actions);}
      main.append(summary);
      if(future.length){const schedule=$('section','tf-card');schedule.append($('div','tf-eyebrow',isActive?'Approved timetable':'Proposed timetable'),$('h3','',isActive?'Your upcoming academic time':'Review the proposed week'));for(const [day,slots] of groupSlots(future,zone)){const block=$('div','tf-day');const heading=$('div','tf-day__head');heading.append($('strong','',day),$('span','',`${slots.length} item${slots.length===1?'':'s'}`));block.append(heading);slots.forEach((slot)=>block.append(renderSlot(slot,zone)));schedule.append(block);}main.append(schedule);}else if(courseHasTimetable)main.append(message('There are no future timetable items for this Course. Recalculation is required before Teaching can create Classroom sessions.','warning'));
      const semester=$('section','tf-card');semester.append($('div','tf-eyebrow','Course period'),$('h3','',data.semester?.name||'Semester'),$('p','',data.semester?`${dateTime(data.semester.startsAt,zone)} → ${dateTime(data.semester.endsAt,zone)} · ${zone}`:'Semester details have not been saved.'));side.append(semester);
      const health=$('section','tf-card');health.append($('div','tf-eyebrow','Feasibility'),$('h3','',human(data.feasibility?.outcome||'Not calculated')),$('p','',data.scheduleHealth?.debtState==='SCHEDULE_DEBT_PRESENT'?'Catch-up capacity is under pressure. KIWI preserves required work rather than silently deleting it.':'No current catch-up condition is being surfaced. Recovery room remains part of schedule planning.'));side.append(health);
      const next=$('section','tf-card');next.append($('div','tf-eyebrow','Next'),$('h3','',isActive?'Use Calendar for the official timetable':'Review everything together'),$('p','',isActive?'After activation, Calendar owns the official timetable and schedule changes use formal Requests.':'Final Review combines the Course Plan, timetable, Teacher, grading policy, assessments and known breaks before you commit.'));const nextActions=$('div','tf-actions');nextActions.append(button('Course Plan',{onClick:()=>open('course-plan')}),button(isActive?'Open Calendar':'Final Review',{primary:true,onClick:isActive?openCalendar:()=>open('activation')}));next.append(nextActions);side.append(next);
      grid.append(main,side);body.append(grid);page.replaceChildren(body,live);live.textContent=notice;
    }catch(error){page.replaceChildren(message(error.message||'Timetable review could not be loaded.','error'),live);live.textContent='';}
  }
  await load();
}

function readinessRow(label,value,ok){const row=$('div','tf-status-row');row.dataset.ok=ok?'true':'false';row.append($('span','tf-status-row__mark',ok?'✓':'!'));const copy=$('div');copy.append($('strong','',label),$('small','',value));row.append(copy,chip(ok?'Ready':'Needs attention',ok?'':'warn'));return row;}
async function renderFinalReview({course,container}){
  const page=$('div','tf-page');container.replaceChildren(page);const live=actionStatus();page.append(live);
  async function load(notice=''){
    showLoading(page,live,'Loading final review');
    try{
      let [review,plan,schedule]=await Promise.all([request(coursePath(course.course_id,'/activation-review')),request(coursePath(course.course_id,'/plan-review')),request(coursePath(course.course_id,'/schedule-review'))]);
      const lifecycle=String(review.course?.lifecycleState||course.lifecycle_state||'DRAFT'),isActive=['ACTIVE','PAUSED'].includes(lifecycle),counts=planCounts(plan),integrity=review.timetableIntegrity||schedule.scheduleIntegrity||{},zone=review.semester?.timezone||schedule.semester?.timezone||'UTC';
      const status=chip(isActive?'Course active':lifecycle==='READY'?'Accepted · ready to start':'Review before accepting',isActive?'':lifecycle==='READY'?'':'warn');
      const body=$('div','tf-page');body.append(hero('Final Review','Know exactly what you are committing to','KIWI brings the important academic commitments together here before activation. Accepting this review moves the Course from Draft to Ready; starting the Course then begins official academic obligations.',status),journey(2,{plan:Boolean(review.coursePlan),timetable:Boolean(review.timetable&&!(integrity.blockers||[]).length),review:['READY','ACTIVE','PAUSED'].includes(lifecycle),activeCourse:isActive}));
      const grid=$('div','tf-grid'),main=$('div','tf-stack'),side=$('aside','tf-stack');
      const readiness=$('section','tf-card tf-card--accent');readiness.append($('div','tf-eyebrow','Readiness'),$('h3','','Everything that must be true'));const list=$('div','tf-status-list');list.append(readinessRow('Course Plan',review.coursePlan?`Version ${review.coursePlan.version} · ${human(review.coursePlan.state)}`:'Missing',Boolean(review.coursePlan&&review.coursePlan.currentSourceSnapshot)),readinessRow('Coverage',review.coverage?.allowed?'Required content accounted for':human(review.coverage?.auditOutcome||'Coverage blocked'),Boolean(review.coverage?.allowed)),readinessRow('Timetable',review.timetable?`${human(review.timetable.state)} · ${integrity.futureClassSlotCount||0} future Classes`:'Missing',Boolean(review.timetable&&!(integrity.blockers||[]).length)),readinessRow('Teacher & grading rules',review.academicRules?.teacher&&review.academicRules?.gradingPolicy?`${review.academicRules.teacher.displayName} · ${human(review.academicRules.gradingPolicy.kind)}`:'Not prepared',Boolean(review.academicRules?.teacher&&review.academicRules?.gradingPolicy)),readinessRow('Course period',review.semester?`${dateTime(review.semester.startsAt,zone)} → ${dateTime(review.semester.endsAt,zone)}`:'Missing',Boolean(review.semester)));readiness.append(list);main.append(readiness);
      const commitments=$('section','tf-card');commitments.append($('div','tf-eyebrow','What you are accepting'),$('h3','','Course commitments'));const metrics=$('div','tf-metrics');metrics.append(metric(counts.units,'learning units'),metric(minutes(integrity.estimatedInstructionalMinutes||schedule.feasibility?.metrics?.requiredMinutes||0),'estimated workload'),metric(integrity.futureClassSlotCount??schedule.scheduleIntegrity?.futureClassCount??0,'future classes'));commitments.append(metrics);
      const ai=$('div','tf-ai-note');ai.append($('div','tf-ai-note__mark','AI'));const aiCopy=$('div');aiCopy.append($('strong','','Plan intelligence'),$('p','',summaryText(plan.plan?.reviewSummary)||'The Course Plan was generated with Teaching intelligence and validated before commit. Scheduler feasibility and activation remain deterministic owner decisions.'));ai.append(aiCopy);commitments.append(ai);main.append(commitments);
      if(review.blockingReasons?.length){const blockers=$('section','tf-card tf-card--error');blockers.append($('div','tf-eyebrow','Before you can continue'),$('h3','','Resolve these items'));review.blockingReasons.forEach((reason)=>blockers.append($('p','',human(reason))));main.append(blockers);}
      const teacher=$('section','tf-card');teacher.append($('div','tf-eyebrow','Teacher & grading'),$('h3','',review.academicRules?.teacher?.displayName||'Teacher not prepared'),$('p','',review.academicRules?.gradingPolicy?`${human(review.academicRules.gradingPolicy.kind)} grading policy · calculation remains owned by Gradebook.`:'Prepare the Teacher identity and grading rules before accepting the final review.'));if(!review.academicRules?.teacher||!review.academicRules?.gradingPolicy){const actions=$('div','tf-actions');const prepare=button('Prepare teacher & grading rules',{primary:true,onClick:async()=>{prepare.disabled=true;live.textContent='Preparing the Teacher and grading policy…';try{await request(coursePath(course.course_id,'/academic-rules/prepare'),{method:'POST',body:{}});await load('Academic rules prepared.');}catch(error){live.textContent=error.message||'Academic rules could not be prepared.';prepare.disabled=false;}}});actions.append(prepare);teacher.append(actions);}side.append(teacher);
      const windows=$('section','tf-card');windows.append($('div','tf-eyebrow','Assessments & breaks'),$('h3','','Known protected time'));const assessment=(schedule.slots||[]).filter((slot)=>slot.kind==='ASSESSMENT_RESERVE').length,revision=(schedule.slots||[]).filter((slot)=>slot.kind==='REVISION_RESERVE').length,breaks=(schedule.profile?.blocks||[]).filter((block)=>['BREAK','HOLIDAY'].includes(block.kind)).length;windows.append($('p','',`${assessment} assessment reserve${assessment===1?'':'s'} · ${revision} revision reserve${revision===1?'':'s'} · ${breaks} known break/holiday block${breaks===1?'':'s'}.`));side.append(windows);
      const actionCard=$('section','tf-card tf-card--accent');actionCard.append($('div','tf-eyebrow',isActive?'Course status':'Decision'),$('h3','',isActive?'This Course is active':lifecycle==='READY'?'Final review accepted':'Accept only when the setup looks right'));
      const actions=$('div','tf-actions');
      if(review.canMarkReady){const accept=button('Accept final review',{primary:true,onClick:async()=>{accept.disabled=true;live.textContent='Accepting the final review…';try{await request(coursePath(course.course_id,'/ready'),{method:'POST',body:{}});await refreshShell();await load('Final review accepted. You can now start the Course.');}catch(error){live.textContent=error.message||'The final review could not be accepted.';accept.disabled=false;}}});actions.append(accept);}
      if(review.canActivate){const start=button('Start Course',{primary:true,onClick:async()=>{if(!global.confirm('Start this Course? Attendance, timetable obligations and official academic history will begin.'))return;start.disabled=true;live.textContent='Starting the Course and materializing scheduled Classes…';try{await request(coursePath(course.course_id,'/activate'),{method:'POST',body:{}});await refreshShell();await load('Course started. Scheduled Classes are now available in Classroom.');}catch(error){live.textContent=error.message||'Course activation failed safely.';start.disabled=false;}}});actions.append(start);}
      if(isActive){actions.append(button('Open Classroom',{primary:true,onClick:()=>open('classroom')}),button('Official Calendar',{onClick:openCalendar}));}
      if(!isActive&&!review.canMarkReady&&!review.canActivate){if(!review.timetable||integrity.blockers?.length)actions.append(button('Review timetable',{primary:true,onClick:()=>open('timetable-review')}));else actions.append(button('Course Plan',{onClick:()=>open('course-plan')}));}
      actionCard.append($('p','',isActive?'After activation, timetable changes use formal Requests and Calendar remains authoritative.':lifecycle==='READY'?'Ready is the explicit acceptance state. Starting the Course is the separate activation boundary.':'No official attendance or grading history begins until the Course is activated.'),actions);side.append(actionCard);
      grid.append(main,side);body.append(grid);page.replaceChildren(body,live);live.textContent=notice;
    }catch(error){page.replaceChildren(message(error.message||'Final Review could not be loaded.','error'),live);live.textContent='';}
  }
  await load();
}

function planSummary({course,container,openSection}){const card=$('article','teaching-course-feature-card');card.append($('div','teaching-kicker','Course Plan'),$('h3','','Review the academic plan'),$('p','','See the Topics, Learning Units, coverage and KIWI plan summary before scheduling.'));const actions=$('div','teaching-course-feature-card__actions');actions.append(button('Review Course Plan',{primary:true,onClick:openSection}));card.append(actions);container.replaceChildren(card);}
function timetableSummary({container,openSection}){const card=$('article','teaching-course-feature-card');card.append($('div','teaching-kicker','Timetable'),$('h3','','Review actual Class times'),$('p','','See upcoming Classes, protected assessment/revision time and schedule health in a readable timetable.'));const actions=$('div','teaching-course-feature-card__actions');actions.append(button('Review Timetable',{primary:true,onClick:openSection}));card.append(actions);container.replaceChildren(card);}
function finalSummary({container,openSection}){const card=$('article','teaching-course-feature-card');card.append($('div','teaching-kicker','Final Review'),$('h3','','Accept before the Course starts'),$('p','','Course Plan, timetable, Teacher, workload, assessments, grading policy and known breaks come together here.'));const actions=$('div','teaching-course-feature-card__actions');actions.append(button('Open Final Review',{primary:true,onClick:openSection}));card.append(actions);container.replaceChildren(card);}

courses.registerSection({id:'course-plan',label:'Course Plan',order:20,render:renderPlan,renderSummary:planSummary});
courses.registerSection({id:'timetable-review',label:'Timetable',order:31,render:renderTimetable,renderSummary:timetableSummary});
courses.registerSection({id:'activation',label:'Final Review',order:40,render:renderFinalReview,renderSummary:finalSummary});

function renameAvailability(){document.querySelectorAll('.teaching-course-nav__item').forEach((item)=>{if(item.textContent.trim()==='Schedule')item.textContent='Availability';});}
const observer=new MutationObserver(renameAvailability);observer.observe(document.documentElement,{childList:true,subtree:true});renameAvailability();

global.KIWITeachingFlowExperience=Object.freeze({openPlan:()=>open('course-plan'),openTimetable:()=>open('timetable-review'),openFinalReview:()=>open('activation')});
})(window);
