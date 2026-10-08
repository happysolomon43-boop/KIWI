const normal=window.KIWI_API_CLIENT;
const statusElement=document.getElementById('sandbox-status');
const detail=document.getElementById('sandbox-detail');
const picker=document.getElementById('course-picker');
const openButton=document.getElementById('open-course');
const mount=document.getElementById('classroom-mount');
const help=document.getElementById('course-help');
const sourceTitle=document.getElementById('source-title');
const sourceDetail=document.getElementById('source-detail');
const PREFIX='/teaching/admin/classroom-test';
let classroomSection=null,ready=false,linkedSource=null;
if(!normal?.kiwiApiRequest||!normal?.hasKiwiSession)throw new Error('Test Classroom requires KIWI session handling.');

function routedPath(path){
  if(!/^\/teaching\/(classes|courses)(\/|$)/.test(path))throw new TypeError('Non-Classroom API requests are prohibited from Test Classroom.');
  return PREFIX+path.substring('/teaching'.length);
}
// The normal KIWI Classroom module is loaded unchanged. Only its API
// transport prefix changes; the backend verifies admin and database isolation.
window.KIWI_API_CLIENT=Object.freeze({
  ...normal,
  kiwiApiRequest:(path,options)=>normal.kiwiApiRequest(routedPath(path),options),
  kiwiApiBlobRequest:(path,options)=>normal.kiwiApiBlobRequest(routedPath(path),options),
});
window.KIWITeachingCourses=Object.freeze({
  registerSection(section){if(section.id==='classroom')classroomSection=section;},
  openSection(){},
});
window.KIWI_CLASSROOM_TEST_MODE=true;
await import('/teaching-classroom.js');

function showStatus(title,description){statusElement.textContent=title;detail.textContent=description||'';}
const courseKey=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const matchesLinkedSource=course=>linkedSource&&courseKey(course?.title||course?.subject_name)===courseKey(linkedSource.title);
async function check(){
  picker.disabled=true;openButton.disabled=true;ready=false;
  showStatus('Verifying source course…','');
  linkedSource=null;
  sourceTitle.textContent='Loading course…';
  sourceDetail.textContent='Checking active Course ownership and Plan details.';
  try{
    const binding=await normal.kiwiApiRequest(PREFIX+'/source-course');
    if(binding.linked!==true||!binding.course?.courseId||binding.execution!=='ISOLATED_SANDBOX_ONLY')throw new Error('Source Course binding is not verified.');
    linkedSource=binding.course;
    sourceTitle.textContent=linkedSource.title||'KIWI Course';
    sourceDetail.textContent=(linkedSource.subjectName||'KIWI subject')+' · '+linkedSource.planCount+' Course Plan(s) · '+linkedSource.scheduledClassCount+' real scheduled Classes · read only';
    showStatus('Verifying isolated KIWI engine…','');
    const info=await normal.kiwiApiRequest(PREFIX+'/status',{timeoutMs:16000});
    if(info.isolated!==true||info.realEngine!==true)throw new Error('The target is not a verified KIWI test runtime.');
    if(info.ready!==true){showStatus('Test account needs provisioning','The sandbox database does not have its test-user record.');return;}
    showStatus('Isolated KIWI engine connected',String(info.activeCourseCount)+' active test Course(s), '+String(info.upcomingClassCount)+' upcoming test Class(es).');
    const data=await normal.kiwiApiRequest(PREFIX+'/courses');
    const courses=Array.isArray(data)?data:Array.isArray(data?.courses)?data.courses:[];
    picker.replaceChildren();
    const valid=courses.filter(x=>x?.course_id&&matchesLinkedSource(x)&&x.lifecycle_state==='ACTIVE');
    if(!valid.length){
      picker.append(new Option('No matching rehearsal Course',''));
      help.textContent=linkedSource.title+' is linked as a source. A matching active test Course must be prepared in the separate KIWI sandbox before the rehearsal can start.';
      return;
    }
    valid.forEach(course=>picker.append(new Option((course.title||course.course_code||'Course')+' · '+(course.lifecycle_state||'Unknown state'),course.course_id)));
    ready=true;
    picker.disabled=false;openButton.disabled=false;
  }catch(error){
    const messages={
      CLASSROOM_TEST_SOURCE_NOT_CONFIGURED:'No production course is selected for Test Classroom.',
      CLASSROOM_TEST_SOURCE_NOT_FOUND:'The linked KIWI Course is no longer active or belongs to another account.',
      CLASSROOM_TEST_SOURCE_UNAVAILABLE:'KIWI could not verify the source Course.',
      CLASSROOM_TEST_NOT_CONFIGURED:'The isolated KIWI service is not connected in the primary server configuration.',
      CLASSROOM_TEST_SANDBOX_UNAVAILABLE:'The isolated KIWI engine is offline or cannot be reached.',
      CLASSROOM_TEST_ISOLATION_UNVERIFIED:'Safety block: KIWI could not prove that this runtime uses a different database.',
      CLASSROOM_TEST_USER_NOT_PROVISIONED:'A dedicated test user has not been provisioned in the isolated database.',
      CLASSROOM_TEST_ADMIN_REQUIRED:'Only the authenticated KIWI admin account can use this feature.',
      CLASSROOM_TEST_AUTH_UNAVAILABLE:'KIWI could not verify the admin role against the account database.',
    };
    if(!linkedSource){sourceTitle.textContent='Source Course unavailable';sourceDetail.textContent=messages[error?.code]||'KIWI could not verify the selected Course.';}
    showStatus('Test Classroom unavailable',(messages[error?.code]||String(error?.message||'Sandbox unavailable')).slice(0,240));
    picker.replaceChildren(new Option('No verified sandbox connection',''));
  }
}
openButton.addEventListener('click',async()=>{
  if(!ready||!picker.value||!classroomSection)return;
  try {
    const data=await normal.kiwiApiRequest(PREFIX+'/courses');
    const courses=Array.isArray(data)?data:Array.isArray(data?.courses)?data.courses:[];
    const course=courses.find(x=>String(x.course_id)===picker.value&&x.lifecycle_state==='ACTIVE'&&matchesLinkedSource(x));
    if(!course)return;
    mount.replaceChildren();
    await classroomSection.render({course,container:mount});
  } catch(error) {showStatus('Course unavailable',String(error?.message||'Unable to load').slice(0,200));}
});
document.getElementById('check-again').addEventListener('click',()=>void check());
if(!normal.hasKiwiSession()){
  showStatus('Admin sign-in required','Sign in to KIWI with your admin account and return to this page.');
  picker.replaceChildren(new Option('Admin session required',''));
}else await check();
