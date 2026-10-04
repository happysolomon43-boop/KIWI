'use strict';

const {assembleStudentFactPack}=require('../d14/fact-pack');

const PRIMARY_NAV=Object.freeze([
  Object.freeze({id:'today',label:'Today',href:'/teaching/today/view',glyph:'sun'}),
  Object.freeze({id:'courses',label:'Courses',href:'/teaching/courses/view',glyph:'layers'}),
  Object.freeze({id:'calendar',label:'Calendar',href:'/teaching/calendar/view',glyph:'calendar'}),
  Object.freeze({id:'work',label:'Work',href:'/teaching/work/view',glyph:'check'}),
  Object.freeze({id:'record',label:'Record',href:'/teaching/record/view',glyph:'record'}),
]);

const SECONDARY_NAV=Object.freeze([
  Object.freeze({id:'requests',label:'Requests',href:'/teaching/requests/view'}),
  Object.freeze({id:'archive',label:'Archived Courses',href:'/teaching/archive/view'}),
  Object.freeze({id:'create',label:'Create Course',href:'/teaching/create-course/view'}),
]);

const COURSE_NAV=Object.freeze([
  Object.freeze({id:'overview',label:'Overview',path:'overview'}),
  Object.freeze({id:'plan',label:'Course Plan',path:'plan'}),
  Object.freeze({id:'work',label:'Work',path:'work'}),
  Object.freeze({id:'results',label:'Results',path:'results'}),
  Object.freeze({id:'teacher',label:'Teacher',path:'teacher'}),
]);

const TRUTH_PRESENTATION=Object.freeze({
  AUTHORITATIVE_FINAL:Object.freeze({label:'Official',tone:'official',description:'Confirmed by the authoritative academic owner.'}),
  AUTHORITATIVE_PROVISIONAL:Object.freeze({label:'Provisional',tone:'provisional',description:'Authoritative, but not yet final.'}),
  INFERRED:Object.freeze({label:'Learning insight',tone:'inferred',description:'An evidence-derived learning inference, not an official mark.'}),
  PLANNED:Object.freeze({label:'Planned',tone:'planned',description:'Scheduled or proposed future state, not completed fact.'}),
  UNRESOLVED:Object.freeze({label:'Needs confirmation',tone:'unresolved',description:'The authoritative sources do not yet support one settled statement.'}),
});

const CLOSED_WORK_STATES=new Set(['CLOSED','VERIFIED','REPLACED','INVALIDATED']);
const CLOSED_REQUEST_STATES=new Set(['CLOSED','REJECTED','WITHDRAWN','APPLIED']);

function truthPresentation(status){return TRUTH_PRESENTATION[String(status||'').toUpperCase()]||TRUTH_PRESENTATION.UNRESOLVED;}
function courseHref(courseId,section='overview'){const id=encodeURIComponent(String(courseId));return section==='teacher'?`/teaching/courses/${id}/teacher/view`:`/teaching/courses/${id}/${section}/view`;}
function classHref(classId){return `/teaching/classes/${encodeURIComponent(String(classId))}/event/view`;}
function studyHref({courseId=null,classId=null}={}){const q=new URLSearchParams();if(courseId)q.set('courseId',String(courseId));if(classId)q.set('classId',String(classId));const suffix=q.toString();return `/teaching/study/view${suffix?`?${suffix}`:''}`;}

function notificationDeepLink(kind,id,{courseId=null,semesterId=null}={}){
  const value=encodeURIComponent(String(id||''));
  switch(String(kind||'').toUpperCase()){
    case 'CLASS': return `/teaching/classes/${value}/event/view`;
    case 'ASSIGNMENT': return `/teaching/work/view?focus=${value}`;
    case 'ASSESSMENT': return `/teaching/calendar/view?focus=assessment:${value}`;
    case 'REQUEST': return `/teaching/requests/view?focus=${value}`;
    case 'COURSE': return courseHref(id,'overview');
    case 'COURSE_PLAN': return courseId?courseHref(courseId,'plan'):'/teaching/courses/view';
    case 'RESULT': return courseId?`${courseHref(courseId,'results')}?focus=${value}`:'/teaching/record/view';
    case 'PROGRESSION': return courseId?`${courseHref(courseId,'results')}?progression=1`:'/teaching/record/view';
    case 'SEMESTER_RECORD': return semesterId?`/teaching/record/view?semesterId=${encodeURIComponent(String(semesterId))}`:'/teaching/record/view';
    case 'STUDY_PACK': return studyHref({courseId,classId:id});
    case 'RECOVERY_CASE': return `/teaching/today/view?recoveryCase=${value}`;
    default: return '/teaching/today/view';
  }
}

function isImpromptuAssessment(row){return String(row?.assessment_type||row?.assessmentType||'').toUpperCase()==='IMPROMPTU_TEST';}
function surpriseMayBeVisible(row,now=new Date()){
  if(!isImpromptuAssessment(row))return true;
  const state=String(row?.lifecycle_state||row?.lifecycleState||row?.state||'').toUpperCase();
  if(['ACTIVE','STARTED','IN_PROGRESS','SUBMITTED','CLOSED','MARKED','RELEASED'].includes(state))return true;
  const lineage=row?.source_lineage?.d19_measurement||row?.sourceLineage?.d19_measurement||{};
  const end=lineage.intended_class_scheduled_end_at||lineage.intendedClassScheduledEndAt||null;
  return Boolean(end&&new Date(now).getTime()>=new Date(end).getTime());
}
function filterStudentVisibleAssessments(rows,now=new Date()){return (Array.isArray(rows)?rows:[]).filter(row=>surpriseMayBeVisible(row,now));}

function localDateKey(value,timeZone='UTC'){
  const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))return null;
  try{return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}catch{return new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
}
function asTime(value){const t=new Date(value||0).getTime();return Number.isFinite(t)?t:null;}
function firstFuture(events,now){const t=now.getTime();return [...events].filter(e=>asTime(e.startsAt)>t).sort((a,b)=>asTime(a.startsAt)-asTime(b.startsAt))[0]||null;}

function allocateToday({now=new Date(),timeZone='UTC',calendarEvents=[],workItems=[],requests=[],recentChanges=[]}={}){
  const instant=now instanceof Date?now:new Date(now);const ms=instant.getTime();const today=localDateKey(instant,timeZone);
  const visibleEvents=(Array.isArray(calendarEvents)?calendarEvents:[]).filter(event=>!event.hiddenUntilActive);
  const nowItems=visibleEvents.filter(event=>{const start=asTime(event.startsAt),end=asTime(event.endsAt);return start!=null&&end!=null&&start<=ms&&ms<end;});
  const dueWork=(Array.isArray(workItems)?workItems:[]).filter(item=>!CLOSED_WORK_STATES.has(String(item.lifecycleState||item.lifecycle_state||'').toUpperCase())).filter(item=>{const due=asTime(item?.deadline?.dueAt||item?.due_at);return due!=null&&due>=ms&&due-ms<=24*60*60*1000;});
  const actionRequests=(Array.isArray(requests)?requests:[]).filter(r=>!CLOSED_REQUEST_STATES.has(String(r.lifecycle_state||r.lifecycleState||r.state||'').toUpperCase())).filter(r=>Boolean(r.student_action_required||r.studentActionRequired||String(r.lifecycle_state||'').includes('ALTERNATIVE')));
  const next=firstFuture(visibleEvents,instant);
  const laterToday=visibleEvents.filter(event=>{const start=asTime(event.startsAt);return start!=null&&start>ms&&localDateKey(event.startsAt,timeZone)===today&&(!next||event.id!==next.id);});
  return Object.freeze({
    now:Object.freeze(nowItems),
    needsAction:Object.freeze([...dueWork.map(item=>Object.freeze({kind:'WORK',id:item.assignmentId||item.assignment_id,title:item.title||'Course Work',href:`/teaching/work/view?focus=${encodeURIComponent(String(item.assignmentId||item.assignment_id||''))}`,dueAt:item?.deadline?.dueAt||item?.due_at||null})),...actionRequests.map(r=>Object.freeze({kind:'REQUEST',id:r.request_id||r.requestId,title:r.student_title||r.type||'Request',href:notificationDeepLink('REQUEST',r.request_id||r.requestId)}))]),
    next:next?Object.freeze([next]):Object.freeze([]),
    laterToday:Object.freeze(laterToday),
    recentlyChanged:Object.freeze(Array.isArray(recentChanges)?recentChanges.slice(0,8):[]),
    quiet:nowItems.length===0&&dueWork.length===0&&actionRequests.length===0&&!next&&laterToday.length===0&&(recentChanges?.length||0)===0,
  });
}

function contextualActions({kind,state,courseId=null,id=null,conditions=[]}={}){
  const actions=[];const upper=String(state||'').toUpperCase();const flags=new Set((conditions||[]).map(v=>String(v).toUpperCase()));
  if(kind==='CLASS'&&['SCHEDULED','UPCOMING'].includes(upper))actions.push({id:'reschedule',label:'Request reschedule',href:`/teaching/requests/view?new=CLASS_RESCHEDULE&classId=${encodeURIComponent(String(id||''))}`});
  if(kind==='ASSIGNMENT'&&!['CLOSED','VERIFIED','INVALIDATED'].includes(upper))actions.push({id:'extension',label:'Request extension',href:`/teaching/requests/view?new=ASSIGNMENT_EXTENSION&assignmentId=${encodeURIComponent(String(id||''))}`});
  if(kind==='COURSE'&&courseId)actions.push({id:'teacher-change',label:'Teacher options',href:courseHref(courseId,'teacher')});
  if(kind==='PROGRESSION'&&['REMEDIATION_REQUIRED','RESIT_ELIGIBLE','RECOVERY_REQUIRED','REPEAT_REQUIRED'].includes(upper))actions.push({id:'pathway',label:upper.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase()),href:`${courseHref(courseId,'results')}?progression=1`});
  if(flags.has('EXCUSED'))actions.push({id:'excused',label:'Excused',disabled:true});
  return Object.freeze(actions);
}

function buildStudentCommunication({snapshotRef,currentSnapshotRef=snapshotRef,translationMode='AUTHORITATIVE_DECISION_EXPLANATION',facts=[]}={}){
  try{
    const assembled=assembleStudentFactPack({snapshotRef,currentSnapshotRef,facts,translationMode});
    return Object.freeze({status:'READY_FOR_TRANSLATION',promptFamily:'TPF-19',promptFamilyVersion:'1.0',routeQualification:'UNQUALIFIED_UNTIL_D30',translationDirective:assembled.directive,factPack:assembled.factPack,modelText:null,authoritativeMutation:false});
  }catch(error){
    if(error?.code!=='TEACHING_D14_UNRESOLVED_FACT_CONFLICT')throw error;
    const normalized=[];
    for(let i=0;i<facts.length;i++){
      const one=assembleStudentFactPack({snapshotRef:`${snapshotRef}:conflict:${i}`,currentSnapshotRef:`${snapshotRef}:conflict:${i}`,facts:[facts[i]],translationMode});
      normalized.push(...one.factPack.facts);
    }
    return Object.freeze({status:'CONFLICTED_FACTS',promptFamily:'TPF-19',promptFamilyVersion:'1.0',routeQualification:'UNQUALIFIED_UNTIL_D30',translationDirective:Object.freeze({translation_mode:translationMode,conflict_policy:'SURFACE_CONFLICT_AND_HANDOFF'}),factPack:Object.freeze({snapshot_ref:snapshotRef,facts:Object.freeze(normalized)}),modelText:null,authoritativeMutation:false});
  }
}

function studyPackCollection(classesByCourse=[]){
  const groups=[];
  for(const group of classesByCourse||[]){
    const packs=(group.classes||[]).filter(row=>row.studyNote||row.study_note_state||row.studyNoteState).map(row=>Object.freeze({classId:row.classId||row.class_id,title:row.title||row.objective||'Class Study Pack',scheduledStartAt:row.scheduledStartAt||row.scheduled_start_at||null,state:row.studyNote?.state||row.study_note_state||row.studyNoteState,href:studyHref({courseId:group.courseId,classId:row.classId||row.class_id})}));
    if(packs.length)groups.push(Object.freeze({courseId:group.courseId,courseTitle:group.courseTitle||'Course',packs:Object.freeze(packs)}));
  }
  return Object.freeze(groups);
}

module.exports={PRIMARY_NAV,SECONDARY_NAV,COURSE_NAV,TRUTH_PRESENTATION,truthPresentation,courseHref,classHref,studyHref,notificationDeepLink,isImpromptuAssessment,surpriseMayBeVisible,filterStudentVisibleAssessments,localDateKey,allocateToday,contextualActions,buildStudentCommunication,studyPackCollection};
