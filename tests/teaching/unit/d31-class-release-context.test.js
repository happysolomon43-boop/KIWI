'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createD31ReleaseReaders}=require('../../../teaching/d31/release-orchestrator');
const {lessonPlanRequest}=require('../../../teaching/d11/intelligence');

function fixture(){
  const course={student_id:'student-1',course_id:'course-1',lifecycle_state:'ACTIVE',state_version:7,subject_snapshot_ref:'subject:1'};
  const klass={student_id:'student-1',class_id:'class-1',course_id:'course-1',schedule_version:22,lifecycle_state:'SCHEDULED'};
  const plan={student_id:'student-1',course_id:'course-1',course_plan_id:'plan-1',version_no:4,plan_state:'APPROVED'};
  const session={state_version:3,lifecycle_state:'ACTIVE'};
  const closure={student_id:'student-1',course_id:'course-1',class_id:'class-1',closure_fact_id:'closure-1'};
  const teacher={student_id:'student-1',course_id:'course-1',class_id:'class-1',teacher_note_id:'note-1'};
  const state={course,klass,plan,session:null,calls:[]};
  const query=async(sql,args)=>{
    state.calls.push({sql,args});
    const [studentId,id,ref]=args||[];
    if(sql.includes('from public.teaching_courses'))return {rows:studentId===course.student_id&&id===course.course_id?[course]:[]};
    if(sql.includes('from public.teaching_classes c'))return {rows:studentId===klass.student_id&&id===klass.class_id?[klass]:[]};
    if(sql.includes('from public.teaching_course_plans')){
      if(sql.includes('course_plan_id=$3'))return {rows:studentId===plan.student_id&&id===plan.course_id&&ref===plan.course_plan_id?[plan]:[]};
      return {rows:studentId===plan.student_id&&id===plan.course_id?[plan]:[]};
    }
    if(sql.includes('from public.teaching_class_sessions'))return {rows:state.session?[state.session]:[]};
    if(sql.includes('from public.teaching_class_closure_facts'))return {rows:studentId===closure.student_id&&id===closure.course_id&&ref===closure.closure_fact_id?[closure]:[]};
    if(sql.includes('from public.teaching_post_class_teacher_notes'))return {rows:studentId===teacher.student_id&&id===teacher.course_id&&ref===teacher.teacher_note_id?[teacher]:[]};
    return {rows:[]};
  };
  return {state,readers:createD31ReleaseReaders({query})};
}
const request=()=>({
  trigger:{actor_id:'student-1'},
  state_reference:{aggregate_type:'teaching_class_controller',aggregate_id:'class-1'},
  preconditions:{course_lifecycle_state:'ACTIVE',course_state_version:'7',class_schedule_version:'22',course_plan_id:'plan-1',course_plan_version:'4',controller_version:null},
});
test('D31 validates a current, student-owned Class planning request against its Course and Plan',async()=>{
  const {readers,state}=fixture();
  const result=await readers.stateReader(request());
  assert.deepEqual(result.stateReference,{aggregate_type:'teaching_class_controller',aggregate_id:'class-1',state_version:'22'});
  assert.deepEqual(result.preconditions,request().preconditions);
  state.session={state_version:3,lifecycle_state:'ACTIVE'};
  const versioned=await readers.stateReader(request());
  assert.equal(versioned.stateReference.state_version,'3');
  assert.equal(versioned.preconditions.controller_version,'3');
});
test('D31 keeps Course-scoped request compatibility and refuses foreign Class ownership',async()=>{
  const {readers}=fixture();
  const course=await readers.stateReader({trigger:{actor_id:'student-1'},state_reference:{aggregate_type:'teaching_course',aggregate_id:'course-1'},preconditions:{lifecycle_state:'ACTIVE',subject_snapshot_ref:'subject:1'}});
  assert.equal(course.stateReference.state_version,'7');
  await assert.rejects(readers.stateReader({...request(),trigger:{actor_id:'other-student'}}),{code:'TEACHING_CLASS_NOT_FOUND'});
  await assert.rejects(readers.stateReader({...request(),state_reference:{aggregate_type:'unknown',aggregate_id:'class-1'}}),{code:'TEACHING_D31_RELEASE_CONTEXT_UNAVAILABLE'});
});
test('D31 Class context resolves exact authenticated Course/Plan/Class and safe prior-Class provenance',async()=>{
  const {readers,state}=fixture();
  const req={
    contextSpec:{
      authoritative_refs:[{ref:'course:course-1'},{ref:'course-plan:plan-1'},{ref:'class:class-1'}],
      provenance_refs:[{ref:'class-closure:closure-1'},{ref:'teacher-note:note-1'}],
      untrusted_refs:[],
    },
    accessContext:{actorId:'student-1',aggregateType:'teaching_class_controller',classId:'class-1'},
  };
  const context=await readers.contextAssembler(req);
  assert.ok(context);
  assert.equal(state.calls.some(c=>c.sql.includes('from public.teaching_class_closure_facts')),true);
  assert.equal(state.calls.some(c=>c.sql.includes('from public.teaching_post_class_teacher_notes')),true);
  await assert.rejects(readers.contextAssembler({...req,contextSpec:{authoritative_refs:[{ref:'class:other-class'}]}}),{code:'TEACHING_D31_RELEASE_CONTEXT_UNAVAILABLE'});
  await assert.rejects(readers.contextAssembler({...req,contextSpec:{authoritative_refs:[{ref:'course-plan:old-plan'}]}}),{code:'TEACHING_D31_RELEASE_CONTEXT_UNAVAILABLE'});
  await assert.rejects(readers.contextAssembler({...req,contextSpec:{authoritative_refs:[{ref:'source:source-1'}]}}),{code:'TEACHING_D31_RELEASE_CONTEXT_UNAVAILABLE'});
});
test('D31 never permits unscoped permission authority or cross-student Class context',async()=>{
  const {readers}=fixture();
  const base={contextSpec:{authoritative_refs:[{ref:'course:course-1'}],permission_refs:[{ref:'permission:x'}]},accessContext:{actorId:'student-1',aggregateType:'teaching_class_controller',classId:'class-1'}};
  await assert.rejects(readers.contextAssembler(base),{code:'TEACHING_D31_RELEASE_CONTEXT_UNAVAILABLE'});
  await assert.rejects(readers.contextAssembler({...base,contextSpec:{authoritative_refs:[{ref:'course:course-1'}]},accessContext:{...base.accessContext,actorId:'other-student'}}),{code:'TEACHING_CLASS_NOT_FOUND'});
});
test('D11 planner uses Class reference while D31 translation keeps Class and Course identities separate',()=>{
  const path=require('node:path'),fs=require('node:fs');
  const d11=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/intelligence.js'),'utf8');
  const d31=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d31/release-orchestrator.js'),'utf8');
  assert.match(d11,/aggregate_type: 'teaching_class_controller'/);
  assert.match(d31,/aggregateType:request\?\.stateReference\?\.aggregate_type/);
  assert.match(d31,/classId:request\?\.stateReference\?\.aggregate_type==='teaching_class_controller'/);
  assert.match(d31,/query\('select state_version,lifecycle_state from public\.teaching_class_sessions/);
  assert.match(d31,/const current=await latestPlan\(actorId,course\.course_id\)/);
});
