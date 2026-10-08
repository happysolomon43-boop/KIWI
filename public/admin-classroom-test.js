// Admin view of the REAL KIWI Classroom. No second runtime, synthetic snapshot,
// or alternative academic controller is involved.
const api=window.KIWI_API_CLIENT;
const sourceTitle=document.getElementById('source-title');
const sourceDetail=document.getElementById('source-detail');
const status=document.getElementById('status');
const panel=document.getElementById('classroom-panel');
const mount=document.getElementById('classroom-mount');
const refreshButton=document.getElementById('refresh-course');
const PREFIX='/teaching/admin/classroom-test';
let classroomSection=null;
let loading=false;
if(typeof api?.kiwiApiRequest!=='function'||typeof api?.hasKiwiSession!=='function')
  throw new Error('KIWI shared API client is required.');

function showProblem(error){
  const descriptions={
    CLASSROOM_TEST_SOURCE_NOT_CONFIGURED:'No course is linked to this admin account.',
    CLASSROOM_TEST_SOURCE_NOT_FOUND:'Your linked course is no longer active or accessible.',
    CLASSROOM_TEST_SOURCE_UNAVAILABLE:'The KIWI Course could not be verified.',
    CLASSROOM_TEST_ADMIN_REQUIRED:'Only a signed-in KIWI admin can open this page.',
    CLASSROOM_TEST_AUTH_UNAVAILABLE:'KIWI could not verify administrator access.',
  };
  panel.hidden=true;
  sourceTitle.textContent='Classroom unavailable';
  status.textContent=descriptions[error?.code]||error?.message||'Could not connect to KIWI Classroom.';
}
async function load(){
  if(loading)return;
  loading=true;
  refreshButton.disabled=true;
  panel.hidden=true;
  mount.replaceChildren();
  sourceTitle.textContent='Checking course…';
  sourceDetail.textContent='Verifying the existing KIWI course.';
  status.textContent='Connecting to KIWI Classroom…';
  try{
    if(!api.hasKiwiSession())throw new Error('Please sign in to KIWI with the administrator account.');
    // This route verifies the currently authenticated user is a database admin
    // AND the production Course belongs to that account and is active.
    const binding=await api.kiwiApiRequest(PREFIX+'/source-course');
    if(binding?.linked!==true||binding.execution!=='NORMAL_KIWI_CLASSROOM'
       ||!binding.course?.courseId||binding.course.lifecycleState!=='ACTIVE')
      throw new Error('KIWI could not verify the linked Classroom.');
    const course=binding.course;
    const response=await api.kiwiApiRequest('/teaching/courses/'+encodeURIComponent(course.courseId)+'/classes');
    if(!Array.isArray(response?.upcoming)&&!Array.isArray(response?.classes))
      throw new Error('The KIWI Classroom list is temporarily unavailable.');
    sourceTitle.textContent=course.title||'KIWI Classroom';
    sourceDetail.textContent=(course.subjectName||'Subject')+' · '+course.planCount+' Course Plan(s) · '+course.scheduledClassCount+' scheduled Class(es)';
    if(!classroomSection){
      // The same production Classroom module registers its section here.
      window.KIWITeachingCourses=Object.freeze({
        registerSection(section){if(section.id==='classroom')classroomSection=section;},
        openSection(){},
      });
      window.KIWI_CLASSROOM_TEST_MODE='LIVE_COURSE';
      await import('/teaching-classroom.js?v=20261009-direct-preview');
    }
    if(typeof classroomSection?.render!=='function')throw new Error('KIWI Classroom interface could not load.');
    panel.hidden=false;
    await classroomSection.render({
      course:{course_id:course.courseId,title:course.title,lifecycle_state:'ACTIVE'},
      container:mount,
      adminPreview:true,
    });
    status.textContent='Connected to existing KIWI Classroom · Read-only preview available';
  }catch(error){showProblem(error);}
  finally{refreshButton.disabled=false;loading=false;}
}
refreshButton.addEventListener('click',()=>void load());
void load();
