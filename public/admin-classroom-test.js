// Admin walkthrough over the EXISTING KIWI D14 Classroom. A reviewed test
// step is never an official class closure or a student attendance decision.
const api=window.KIWI_API_CLIENT;
const sourceTitle=document.getElementById('source-title');
const sourceDetail=document.getElementById('source-detail');
const status=document.getElementById('status');
const panel=document.getElementById('classroom-panel');
const mount=document.getElementById('classroom-mount');
const refreshButton=document.getElementById('refresh-course');
const PREFIX='/teaching/admin/classroom-test';
let classroomSection=null,walkthrough=null,loading=false,busy=false;
if(typeof api?.kiwiApiRequest!=='function'||typeof api?.hasKiwiSession!=='function')
  throw new Error('KIWI shared API client is required.');

const node=(tag,className='',content=null)=>{
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(content!==null)el.textContent=String(content);
  return el;
};
function action(label,callback,kind=''){
  const btn=node('button',kind?'admin-action '+kind:'admin-action',label);
  btn.type='button';
  btn.addEventListener('click',callback);
  return btn;
}
function displayDate(iso){
  if(!iso)return 'Date unavailable';
  return new Date(iso).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function showProblem(error){
  const descriptions={
    CLASSROOM_TEST_SOURCE_NOT_CONFIGURED:'No course is linked to this admin account.',
    CLASSROOM_TEST_SOURCE_NOT_FOUND:'Your linked course is no longer active or accessible.',
    CLASSROOM_TEST_SOURCE_UNAVAILABLE:'The KIWI Course could not be verified.',
    CLASSROOM_TEST_ADMIN_REQUIRED:'Only a signed-in KIWI admin can use this walkthrough.',
    WALKTHROUGH_SCHEMA_UNAVAILABLE:'Review tracking is being prepared. Try refreshing in a moment.',
    WALKTHROUGH_SOURCE_UNAVAILABLE:'The source Course is no longer available.',
    WALKTHROUGH_CLASS_OUT_OF_ORDER:'Finish the current review before moving to this Class.',
    WALKTHROUGH_SCHEDULE_CHANGED:'KIWI changed this Class schedule. Refresh to see the current sequence.',
    WALKTHROUGH_START_REQUIRED:'Start the test review before marking it complete.'
  };
  status.textContent=descriptions[error?.code]||error?.message||'Could not load Classroom reviews.';
}
async function refreshProgress(){
  walkthrough=await api.kiwiApiRequest(PREFIX+'/walkthrough');
  renderWalkthrough();
  return walkthrough;
}
async function mutate(id,operation){
  const uri=operation==='reset'?PREFIX+'/walkthrough/reset':PREFIX+'/walkthrough/'+encodeURIComponent(id)+'/'+operation;
  if(busy)throw new Error('Please wait for the current action to finish.');
  busy=true;
  try{
    const response=await api.kiwiApiRequest(uri,{method:'POST',body:operation==='reset'?{confirm:true}:{}});
    if(operation==='reset')return await refreshProgress();
    walkthrough=response;
    renderWalkthrough();
    return response;
  }catch(error){showProblem(error);throw error;}
  finally{busy=false;}
}
async function onReviewComplete(classId){
  const updated=await mutate(classId,'complete');
  if(!updated.currentClassId){
    status.textContent='All KIWI Classroom test reviews completed. Official academic records are unchanged.';
    return null;
  }
  await mutate(updated.currentClassId,'start');
  return updated.currentClassId;
}
async function reviewClass(item,track=true){
  if(!classroomSection?.openClassroom)throw new Error('The KIWI Classroom interface is unavailable.');
  if(track&&item.reviewState==='NOT_STARTED'){
    await mutate(item.classId,'start');
  }
  // The original Classroom read-only mode never calls /classroom/enter.
  await classroomSection.openClassroom(item.classId,{
    reviewOnly:true,
    onReviewComplete:track?onReviewComplete:null
  });
}
async function joinRealClass(item){
  if(!item.realCanEnter)throw new Error('KIWI has not opened this scheduled Class.');
  const accepted=window.confirm('This joins the REAL KIWI Class. Attendance and academic progress may be recorded. Continue?');
  if(!accepted)return;
  // No admin override. Same normal /classroom/enter as student Classroom.
  await classroomSection.openClassroom(item.classId);
}

function renderWalkthrough(){
  if(!walkthrough)return;
  const {classes=[],reviewedCount=0,total=0,currentClassId=null,allReviewed=false}=walkthrough;
  mount.replaceChildren();
  const heading=node('div','admin-walkthrough-heading');
  const title=node('h2','','Class-by-class walkthrough');
  const progress=node('p','admin-muted',
    total?reviewedCount+' of '+total+' test reviews complete':'No Classes available in this Course');
  heading.append(title,progress);
  mount.append(heading);
  if(total){
    const meter=node('progress','admin-review-meter');
    meter.max=total;meter.value=reviewedCount;
    meter.setAttribute('aria-label','Completed test reviews');
    mount.append(meter);
  }
  if(allReviewed){
    mount.append(node('div','admin-completed','All Class previews reviewed. This is test-review progress, not official Class completion.'));
  }
  if(!total){
    mount.append(node('p','admin-muted','KIWI has not materialized any Classes for this Course yet.'));
    return;
  }
  const list=node('div','admin-step-list');
  classes.forEach(item=>{
    const current=item.classId===currentClassId;
    const reviewed=item.reviewState==='REVIEWED';
    const card=node('article','admin-step'+(current?' admin-step--current':'')+(reviewed?' admin-step--reviewed':''));
    const top=node('div','admin-step-top');
    const summary=node('div','');
    summary.append(node('div','admin-kicker','LESSON '+item.step+' OF '+total),
      node('h3','',displayDate(item.scheduledStartAt)));
    const badge=node('span','admin-step-badge',
      reviewed?'Test review complete':current?(item.reviewState==='IN_PROGRESS'?'Review in progress':'Next review'):'Locked · review previous Class');
    top.append(summary,badge);
    const controls=node('div','admin-step-actions');
    if(reviewed){
      controls.append(action('Review again (read only)',()=>void reviewClass(item,false).catch(showProblem),'admin-action--quiet'));
    }else if(current){
      const label=item.reviewState==='IN_PROGRESS'?'Resume test Classroom':'Join test review';
      controls.append(action(label,()=>void reviewClass(item,true).catch(showProblem)));
      if(item.reviewState==='IN_PROGRESS'){
        controls.append(action('Complete review & next →',async()=>{try{const next=await onReviewComplete(item.classId);if(next)await classroomSection.openClassroom(next,{reviewOnly:true,onReviewComplete});}catch(error){showProblem(error);}},'admin-action--quiet'));
      }
      if(item.realCanEnter){
        controls.append(action('Join real Class',()=>void joinRealClass(item).catch(showProblem),'admin-action--live'));
      }
    }
    const hint=node('p','admin-muted',reviewed?'Reviewed '+displayDate(item.reviewedAt)
      :current?'Preview uses the real KIWI Classroom. Official attendance is not affected by the test review.'
      :'Finish the earlier test review to unlock this lesson.');
    card.append(top,hint,controls);
    list.append(card);
  });
  mount.append(list);
  const footer=node('div','admin-walkthrough-footer');
  footer.append(node('p','admin-muted','Reset only clears your admin test-review progress, never the real timetable, attendance or grades.'));
  footer.append(action('Restart walkthrough',async()=>{
    if(!window.confirm('Restart test reviews from lesson 1? Your real KIWI records are not affected.'))return;
    try{await mutate(null,'reset');status.textContent='Test reviews reset to lesson 1.';}catch(error){showProblem(error);}
  },'admin-action--quiet'));
  mount.append(footer);
}

async function load(){
  if(loading)return;
  loading=true;refreshButton.disabled=true;panel.hidden=true;
  sourceTitle.textContent='Checking course…';
  sourceDetail.textContent='Verifying the existing KIWI Course.';
  status.textContent='Loading Class reviews…';
  try{
    if(!api.hasKiwiSession())throw new Error('Sign in to KIWI with your administrator account.');
    const binding=await api.kiwiApiRequest(PREFIX+'/source-course');
    if(binding?.linked!==true||binding.execution!=='NORMAL_KIWI_CLASSROOM'
      ||!binding.course?.courseId||binding.course.lifecycleState!=='ACTIVE')
      throw new Error('KIWI could not verify the linked Classroom.');
    const course=binding.course;
    if(!classroomSection){
      window.KIWITeachingCourses=Object.freeze({
        registerSection(section){if(section.id==='classroom')classroomSection=section;},
        openSection(){}
      });
      window.KIWI_CLASSROOM_TEST_MODE='LIVE_COURSE';
      await import('/teaching-classroom.js?v=20261009-mobile-classroom-recovery-1');
    }
    if(typeof classroomSection?.openClassroom!=='function')
      throw new Error('KIWI Classroom could not load.');
    sourceTitle.textContent=course.title||'KIWI Classroom';
    sourceDetail.textContent=(course.subjectName||'Subject')+' · '+course.planCount+
      ' Course Plan(s) · '+course.scheduledClassCount+' scheduled Classes';
    panel.hidden=false;
    await refreshProgress();
    status.textContent='Connected to KIWI · Complete test reviews in order, or join a live Class at its scheduled time.';
  }catch(error){panel.hidden=true;showProblem(error);}
  finally{refreshButton.disabled=false;loading=false;}
}
refreshButton.addEventListener('click',()=>void load());
void load();
