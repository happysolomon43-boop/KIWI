'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createD23Service}=require('../../../teaching/d23/service');

function fixture(){
  const courses=[{course_id:'c1',title:'Chemistry',lifecycle_state:'ACTIVE',state_version:4},{course_id:'c2',title:'Old Physics',lifecycle_state:'ARCHIVED',state_version:9}];
  const d07={listCourses:async()=>courses,getSetup:async()=>({sources:[{source_kind:'KIWI_SUBJECT',source_ref:'subject:chem',content_summary:'Atomic structure',classification:'ACADEMICALLY_MEANINGFUL'}]})};
  const d08={getPlanReview:async(_u,id)=>({course:{courseId:id,title:id==='c1'?'Chemistry':'Old Physics'},plan:{version:2,currentForCourseScope:true,topics:[{title:'Atomic Structure',subtopics:[],learningUnits:[{title:'Atoms',intendedCompetence:'Explain atomic structure'}]}]}})};
  const d09={listSemesters:async()=>[{semester_id:'s1',name:'Semester 1'}],getCalendar:async()=>({serverNow:'2026-10-03T12:00:00.000Z',currentTimeZone:'UTC',authoritativeClasses:[{classId:'cl1',courseId:'c1',title:'Atomic Structure',startsAt:'2026-10-03T14:00:00.000Z',endsAt:'2026-10-03T15:00:00.000Z',kind:'CLASS'}],preactivationProposals:[]})};
  const d10={listRequests:async()=>[]};
  const d14={listClasses:async(_u,id)=>({course:{course_id:id},classes:id==='c1'?[{class_id:'cl0',scheduled_start_at:'2026-10-02T14:00:00.000Z'}]:[]}),snapshot:async()=>({class:{lifecycleState:'CLOSED'},controlsEnabled:false,identity:{course_title:'Chemistry',teacher_name:'Dr. Rowan'},objective:'Atomic Structure',mode:'Class Summary',summary:{headline:'Atoms and isotopes'},studyNote:{state:'VALIDATED_PRIVATE'}})};
  const d16={listWork:async(_u,{courseId=null}={})=>({scope:courseId?'COURSE':'GLOBAL',courseId,assignments:[{assignmentId:'w1',courseId:'c1',title:'Isotope practice',lifecycleState:'OPEN',deadline:{dueAt:'2026-10-03T20:00:00.000Z'},graded:false}]})};
  const d19={list:async()=>[
    {assessment_id:'a1',course_id:'c1',assessment_type:'SCHEDULED_TEST',title:'Atomic Structure Test',scheduled_start_at:'2026-10-05T10:00:00.000Z',scheduled_end_at:'2026-10-05T10:30:00.000Z',lifecycle_state:'LOCKED'},
    {assessment_id:'a2',course_id:'c1',assessment_type:'IMPROMPTU_TEST',title:'Surprise',lifecycle_state:'DRAFT',source_lineage:{d19_measurement:{intended_class_scheduled_end_at:'2026-10-06T15:00:00.000Z'}}},
  ]};
  const d20={courseResults:async()=>({courseId:'c1',topics:[{topicId:'t1',title:'Atomic Structure',state:'PROVISIONAL_INSUFFICIENT_EVIDENCE'}]})};
  const d21={courseProgression:async()=>({outcome:'PASS'}),semesterRecord:async()=>({gpa:{gpa:3.7},courses:[{courseId:'c1',title:'Chemistry',score_percentage:74,grade:'B'}]})};
  const d22={teacherSurface:async()=>({teacher:{displayName:'Dr. Rowan'}})};
  return createD23Service({d07,d08,d09,d10,d14,d16,d19,d20,d21,d22,clock:()=>new Date('2026-10-03T12:00:00.000Z')});
}

test('D23 Calendar composes Scheduler and announced Assessment truth while hiding future surprise assessment',async()=>{
  const service=fixture(),model=await service.calendar({id:'student'},{currentTimeZone:'UTC'});
  assert.equal(model.singleTeachingTimetable,true);assert.deepEqual(model.events.map(e=>e.id),['class:cl1','assessment:a1']);assert.equal(model.hiddenImpromptuAssessmentsExcluded,true);assert.deepEqual(model.sourceOwners,['D09_SCHEDULER','D17_ASSESSMENT']);
});

test('D23 Courses keeps active and archived courses separate and restrained',async()=>{
  const service=fixture(),active=await service.courses({id:'student'}),archive=await service.archivedCourses({id:'student'});
  assert.deepEqual(active.courses.map(c=>c.courseId),['c1']);assert.deepEqual(archive.courses.map(c=>c.courseId),['c2']);assert.equal(active.courses[0].currentTopic,'Atomic Structure');assert.equal(active.courses[0].teacher.displayName,'Dr. Rowan');assert.equal(active.internalEnginesExposed,false);
});

test('D23 Course Overview reads predecessor owners and never exposes Teacher Notes',async()=>{
  const service=fixture(),model=await service.courseOverview({id:'student'},'c1');
  assert.equal(model.course.title,'Chemistry');assert.equal(model.currentTopic,'Atomic Structure');assert.equal(model.teacher.displayName,'Dr. Rowan');assert.equal(model.teacherNotesExposed,false);assert.equal(model.communication.promptFamily,'TPF-19');assert.equal(model.communication.authoritativeMutation,false);assert.equal(model.nextAssessment.assessmentId,'a1');
});

test('D23 Study is one Course/Class-filterable collection and does not acquire card authority',async()=>{
  const service=fixture(),model=await service.study({id:'student'},{courseId:'c1',classId:'cl0'});
  assert.equal(model.mainKiwiStudyCollection,true);assert.equal(model.cardSelectionOwner,'D27_NOT_D23');assert.equal(model.groups.length,1);assert.equal(model.groups[0].packs[0].classId,'cl0');
});

test('D23 Record uses D21 record projection backed by Gradebook truth',async()=>{
  const service=fixture(),model=await service.record({id:'student'},{});
  assert.equal(model.records.length,1);assert.equal(model.records[0].record.gpa.gpa,3.7);assert.equal(model.sourceOwner,'D21_RECORD_FROM_D20_GRADEBOOK');assert.equal(model.hierarchy,'SEMESTER_TO_COURSE_TO_TOPIC_OR_ASSESSMENT');
});
