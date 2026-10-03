'use strict';

const {
  allocateToday,contextualActions,filterStudentVisibleAssessments,courseHref,classHref,studyHref,
  notificationDeepLink,buildStudentCommunication,studyPackCollection,
}=require('./contracts');

function createD23Service({d07,d08,d09,d10,d14,d16,d19,d20,d21,d22,clock=()=>new Date()}={}){
  for(const [name,value] of Object.entries({d07,d08,d09,d10,d14,d16,d19,d20,d21,d22})){
    if(!value)throw new TypeError(`D23 requires accepted predecessor service ${name}.`);
  }
  const now=()=>{const value=clock();return value instanceof Date?value:new Date(value);};
  const idOf=(row)=>String(row?.course_id||row?.courseId||'');
  const stateOf=(row)=>String(row?.lifecycle_state||row?.lifecycleState||row?.state||'').toUpperCase();
  const activeCourse=(row)=>!['ARCHIVED','CANCELLED','COMPLETED','CLOSED'].includes(stateOf(row));
  const archivedCourse=(row)=>['ARCHIVED','CANCELLED','COMPLETED','CLOSED'].includes(stateOf(row));
  const safe=async(label,fn)=>{try{return {ok:true,value:await fn(),label};}catch(error){return {ok:false,value:null,label,error:Object.freeze({code:error?.code||'READ_UNAVAILABLE',message:error?.message||`${label} unavailable`,status:Number(error?.status)||500})};}};
  const courseTitle=(row)=>String(row?.title||row?.name||'Course');
  const sortTime=(a,b)=>new Date(a.startsAt||0)-new Date(b.startsAt||0);

  async function courseRows(user){const rows=await d07.listCourses(user);return Array.isArray(rows)?rows:[];}

  function classEvent(row){
    const classId=row.classId||row.class_id||row.aggregateId||row.slotId||row.timetable_slot_id;
    return Object.freeze({
      id:`class:${classId}`,kind:'CLASS',classId:String(classId||''),courseId:String(row.courseId||row.course_id||''),
      title:row.title||row.label||'Teaching Class',startsAt:row.startsAt||row.starts_at||row.scheduledStartAt||row.scheduled_start_at,
      endsAt:row.endsAt||row.ends_at||row.scheduledEndAt||row.scheduled_end_at,
      timezone:row.timezone||null,sourceOwner:'D09_SCHEDULER',truthStatus:'AUTHORITATIVE_FINAL',
      href:classHref(classId),hiddenUntilActive:false,slotKind:row.kind||row.slotKind||row.slot_kind||'CLASS',
    });
  }
  function assessmentEvent(row){
    const assessmentId=row.assessment_id||row.assessmentId;
    const measurement=row?.source_lineage?.d19_measurement||row?.sourceLineage?.d19_measurement||{};
    const startsAt=row.scheduled_start_at||row.starts_at||row.scheduled_at||row.available_from||measurement.intended_class_scheduled_start_at||null;
    const endsAt=row.scheduled_end_at||row.ends_at||row.expires_at||measurement.intended_class_scheduled_end_at||null;
    if(!startsAt)return null;
    const type=String(row.assessment_type||row.assessmentType||'ASSESSMENT').toUpperCase();
    return Object.freeze({id:`assessment:${assessmentId}`,kind:'ASSESSMENT',assessmentId:String(assessmentId),courseId:String(row.course_id||row.courseId||''),title:row.title||type.replaceAll('_',' '),startsAt,endsAt,sourceOwner:'D17_ASSESSMENT',truthStatus:'AUTHORITATIVE_FINAL',assessmentType:type,href:notificationDeepLink('ASSESSMENT',assessmentId,{courseId:row.course_id||row.courseId}),hiddenUntilActive:false});
  }

  async function assessmentsByCourse(user,courses){
    const map=new Map(),issues=[];
    await Promise.all(courses.map(async course=>{const courseId=idOf(course);const result=await safe('Assessments',()=>d19.list(user,{courseId,limit:500}));if(result.ok)map.set(courseId,filterStudentVisibleAssessments(result.value,now()));else{map.set(courseId,[]);issues.push(result.error);}}));
    return {map,issues};
  }

  async function calendar(user,{from=null,to=null,currentTimeZone='UTC'}={}){
    const courses=await courseRows(user),base=await d09.getCalendar(user,{from,to,currentTimeZone}),assessmentData=await assessmentsByCourse(user,courses);
    const events=(base.authoritativeClasses||[]).map(classEvent);
    for(const rows of assessmentData.map.values())for(const row of rows){const event=assessmentEvent(row);if(event)events.push(event);}
    events.sort(sortTime);
    return Object.freeze({serverNow:base.serverNow,currentTimeZone:base.currentTimeZone,events:Object.freeze(events),preactivationProposals:Object.freeze(base.preactivationProposals||[]),sourceOwners:Object.freeze(['D09_SCHEDULER','D17_ASSESSMENT']),singleTeachingTimetable:true,hiddenImpromptuAssessmentsExcluded:true,issues:Object.freeze(assessmentData.issues)});
  }

  async function today(user,{currentTimeZone='UTC'}={}){
    const instant=now(),windowStart=new Date(instant.getTime()-6*60*60*1000).toISOString(),windowEnd=new Date(instant.getTime()+36*60*60*1000).toISOString();
    const [calendarResult,workResult,requestsResult]=await Promise.all([
      safe('Calendar',()=>calendar(user,{from:windowStart,to:windowEnd,currentTimeZone})),
      safe('Work',()=>d16.listWork(user)),safe('Requests',()=>d10.listRequests(user,{})),
    ]);
    const issues=[calendarResult,workResult,requestsResult].filter(x=>!x.ok).map(x=>x.error);
    const recent=[];
    for(const request of requestsResult.value||[]){const state=stateOf(request);if(['APPLIED','REJECTED','CLOSED'].includes(state)){recent.push(Object.freeze({kind:'REQUEST',id:request.request_id||request.requestId,title:request.type||'Request updated',state,href:notificationDeepLink('REQUEST',request.request_id||request.requestId),changedAt:request.updated_at||request.applied_at||request.decided_at||null}));}}
    const allocation=allocateToday({now:instant,timeZone:calendarResult.value?.currentTimeZone||currentTimeZone,calendarEvents:calendarResult.value?.events||[],workItems:workResult.value?.assignments||[],requests:requestsResult.value||[],recentChanges:recent.sort((a,b)=>new Date(b.changedAt||0)-new Date(a.changedAt||0))});
    return Object.freeze({...allocation,serverNow:(calendarResult.value?.serverNow)||instant.toISOString(),currentTimeZone:calendarResult.value?.currentTimeZone||currentTimeZone,issues:Object.freeze(issues),authority:Object.freeze({time:'D09_SCHEDULER',work:'D16_WORK',requests:'D10_REQUEST',assessments:'D17_ASSESSMENT'}),surpriseAssessmentsNeverPreviewed:true});
  }

  async function courses(user,{includeArchived=false}={}){
    const rows=await courseRows(user),visible=rows.filter(includeArchived?archivedCourse:activeCourse),cal=await safe('Calendar',()=>calendar(user,{currentTimeZone:'UTC'}));
    const events=cal.value?.events||[];const projected=[];
    for(const course of visible){
      const courseId=idOf(course),next=events.filter(e=>e.courseId===courseId&&new Date(e.startsAt)>now()).sort(sortTime)[0]||null;
      const [plan,teacher]=await Promise.all([safe('Course Plan',()=>d08.getPlanReview(user,courseId)),safe('Teacher',()=>d22.teacherSurface(user,courseId))]);
      const planTopics=plan.value?.plan?.topics||[];
      projected.push(Object.freeze({courseId,title:courseTitle(course),lifecycleState:stateOf(course),currentTopic:planTopics[0]?.title||null,nextEvent:next,teacher:teacher.value?.teacher?Object.freeze({displayName:teacher.value.teacher.displayName,href:courseHref(courseId,'teacher')}):null,href:courseHref(courseId,'overview'),planVersion:plan.value?.plan?.version||null,issues:Object.freeze([plan,teacher].filter(r=>!r.ok).map(r=>r.error))}));
    }
    return Object.freeze({courses:Object.freeze(projected),archived:includeArchived,primaryStatusRestrained:true,internalEnginesExposed:false});
  }

  async function courseOverview(user,courseId){
    const rows=await courseRows(user),course=rows.find(row=>idOf(row)===String(courseId));if(!course){const e=new Error('Teaching Course not found.');e.status=404;e.code='TEACHING_D23_COURSE_NOT_FOUND';throw e;}
    const [plan,teacher,work,results,progression,assessments,cal]=await Promise.all([
      safe('Course Plan',()=>d08.getPlanReview(user,courseId)),safe('Teacher',()=>d22.teacherSurface(user,courseId)),safe('Work',()=>d16.listWork(user,{courseId})),safe('Results',()=>d20.courseResults(user,courseId)),safe('Progression',()=>d21.courseProgression(user,courseId)),safe('Assessments',()=>d19.list(user,{courseId,limit:500})),safe('Calendar',()=>calendar(user,{currentTimeZone:'UTC'})),
    ]);
    const events=(cal.value?.events||[]).filter(e=>e.courseId===String(courseId));const nextClass=events.filter(e=>e.kind==='CLASS'&&new Date(e.startsAt)>now()).sort(sortTime)[0]||null;
    const visibleAssessments=filterStudentVisibleAssessments(assessments.value||[],now()),nextAssessment=visibleAssessments.map(assessmentEvent).filter(Boolean).filter(e=>new Date(e.startsAt)>now()).sort(sortTime)[0]||null;
    const assignments=work.value?.assignments||[],importantWork=assignments.filter(a=>!['CLOSED','VERIFIED'].includes(String(a.lifecycleState||'').toUpperCase())).slice(0,5);
    const warnings=[];if(plan.value?.plan&&!plan.value.plan.currentForCourseScope)warnings.push({kind:'COURSE_PLAN_UPDATE',message:'Course Plan review is required for the current Course scope.',href:courseHref(courseId,'plan')});
    if(progression.value?.outcome&&String(progression.value.outcome).toUpperCase().includes('REQUIRED'))warnings.push({kind:'PROGRESSION',message:'A progression pathway requires attention.',href:`${courseHref(courseId,'results')}?progression=1`});
    const facts=[{semantic_key:'course_lifecycle',truth_domain:'COURSE',truth_status:'AUTHORITATIVE_FINAL',fact_class:'OFFICIAL_RECORD',source_owner:'D10_COURSE_LIFECYCLE',visibility:'STUDENT',effective_state:stateOf(course),provenance_refs:[`course:${courseId}`]}];
    const communication=buildStudentCommunication({snapshotRef:`d23-course:${courseId}:${course.state_version||0}`,translationMode:'AUTHORITATIVE_DECISION_EXPLANATION',facts});
    return Object.freeze({course:Object.freeze({courseId,title:courseTitle(course),lifecycleState:stateOf(course),actions:contextualActions({kind:'COURSE',state:stateOf(course),courseId})}),phase:progression.value?.phase||progression.value?.outcome||null,currentTopic:plan.value?.plan?.topics?.[0]?.title||null,nextClass,teacher:teacher.value?.teacher?Object.freeze({displayName:teacher.value.teacher.displayName,href:courseHref(courseId,'teacher')}):null,importantWork:Object.freeze(importantWork),nextAssessment,warnings:Object.freeze(warnings),notices:Object.freeze([]),courseNav:true,teacherNotesExposed:false,communication,issues:Object.freeze([plan,teacher,work,results,progression,assessments,cal].filter(r=>!r.ok).map(r=>r.error))});
  }

  async function coursePlan(user,courseId){return Object.freeze({courseId,review:await d08.getPlanReview(user,courseId),sourceOwner:'D08_COURSE_PLAN',teacherNotesExposed:false});}
  async function courseMaterials(user,courseId){const setup=await d07.getSetup(user,courseId);return Object.freeze({courseId,materials:Object.freeze((setup.sources||[]).map(source=>Object.freeze({kind:source.source_kind,ref:source.source_ref,summary:source.content_summary||null,classification:source.classification||'UNRESOLVED'}))),secondarySurface:true,sourceOwner:'D07_CURRICULUM_SOURCE_INVENTORY'});}
  async function courseWork(user,courseId){return d16.listWork(user,{courseId});}
  async function courseResults(user,courseId){const [results,progression]=await Promise.all([safe('Results',()=>d20.courseResults(user,courseId)),safe('Progression',()=>d21.courseProgression(user,courseId))]);return Object.freeze({courseId,results:results.value,progression:progression.value,truthSeparation:Object.freeze({officialMarks:'D20_GRADEBOOK',learningInference:'D13_SKM',progression:'D21_PROGRESSION'}),issues:Object.freeze([results,progression].filter(r=>!r.ok).map(r=>r.error))});}
  async function globalWork(user){return d16.listWork(user);}
  async function requests(user){return Object.freeze({requests:Object.freeze(await d10.listRequests(user,{})),secondaryDestination:true});}
  async function archivedCourses(user){return courses(user,{includeArchived:true});}

  async function record(user,{semesterId=null}={}){
    const semesters=await d09.listSemesters(user);const selected=semesterId?semesters.filter(s=>String(s.semester_id||s.semesterId)===String(semesterId)):semesters;
    const records=[];const issues=[];
    for(const semester of selected){const id=semester.semester_id||semester.semesterId;const loaded=await safe('Semester Record',()=>d21.semesterRecord(user,id));if(loaded.ok)records.push(Object.freeze({semesterId:String(id),name:semester.name||'Semester',record:loaded.value}));else issues.push(loaded.error);}
    return Object.freeze({records:Object.freeze(records),issues:Object.freeze(issues),hierarchy:'SEMESTER_TO_COURSE_TO_TOPIC_OR_ASSESSMENT',sourceOwner:'D21_RECORD_FROM_D20_GRADEBOOK'});
  }

  async function classEventDetail(user,classId){
    const snapshot=await d14.snapshot(user,classId),state=String(snapshot?.class?.lifecycleState||snapshot?.class?.lifecycle_state||snapshot?.controller?.lifecycleState||snapshot?.controller?.lifecycle_state||'SCHEDULED').toUpperCase();
    const before=!['ACTIVE','IN_PROGRESS','CLOSED'].includes(state)&&!snapshot.summary,during=['ACTIVE','IN_PROGRESS'].includes(state)||snapshot.controlsEnabled===true&&!snapshot.summary,after=Boolean(snapshot.summary)||state==='CLOSED';
    return Object.freeze({classId,state:after?'AFTER_CLASS':during?'DURING_CLASS':'BEFORE_CLASS',course:Object.freeze({title:snapshot.identity?.course_title||'Course'}),teacher:snapshot.identity?.teacher_name||null,objective:snapshot.objective||null,mode:snapshot.mode||null,time:snapshot.time||null,summary:after?snapshot.summary:null,studyPack:snapshot.studyNote?Object.freeze({...snapshot.studyNote,href:studyHref({classId})}):null,actions:Object.freeze(before?[{id:'class-details',label:'Class details',href:classHref(classId)}]:during?[{id:'enter-class',label:'Enter Class',href:`/teaching/classes/${encodeURIComponent(String(classId))}/classroom`}]:after?[{id:'study',label:'Open Study Pack',href:studyHref({classId})}]:[]),sameEventObject:true,teacherNotesExposed:false});
  }

  async function study(user,{courseId=null,classId=null}={}){
    const rows=(await courseRows(user)).filter(course=>!courseId||idOf(course)===String(courseId)),groups=[];
    for(const course of rows){const id=idOf(course);const listed=await safe('Classes',()=>d14.listClasses(user,id));if(!listed.ok)continue;const classes=[];for(const row of listed.value?.classes||[]){if(classId&&String(row.class_id||row.classId)!==String(classId))continue;const snap=await safe('Class Study Pack',()=>d14.snapshot(user,row.class_id||row.classId));if(snap.ok&&snap.value?.studyNote)classes.push({classId:row.class_id||row.classId,scheduledStartAt:row.scheduled_start_at||row.scheduledStartAt,objective:snap.value.objective,studyNote:snap.value.studyNote});}groups.push({courseId:id,courseTitle:courseTitle(course),classes});}
    return Object.freeze({groups:studyPackCollection(groups),courseFilter:courseId||null,classFilter:classId||null,mainKiwiStudyCollection:true,cardSelectionOwner:'D27_NOT_D23',notesDoNotCreateCards:true});
  }

  async function createCourseEntry(user){const subjects=await d07.listCourses?null:null;return Object.freeze({href:'/teaching/create-course/view',sourceRequirement:'EXISTING_KIWI_SUBJECT',createEndpoint:'/teaching/courses',subjectPickerEndpoint:'/teaching/subjects'});}

  return Object.freeze({today,courses,calendar,courseOverview,coursePlan,courseMaterials,courseWork,courseResults,globalWork,record,requests,archivedCourses,classEventDetail,study,createCourseEntry,notificationDeepLink});
}

module.exports={createD23Service};
