'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {lessonTeacherRequest,normalizeLessonProposal}=require('../../../teaching/d14/lesson-intelligence');
const {createD14Service}=require('../../../teaching/d14/service');
const {createD14ClassroomRepository}=require('../../../teaching/repositories/d14-classroom');

const lessonContext=(course='COURSE')=>({
 classRow:{class_id:course+'-class',course_id:course,lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED',course_state_version:2,schedule_version:5},
 session:{class_session_id:course+'-session',lifecycle_state:'ACTIVE',instructional_substate:'OPENING',state_version:3,progress_state:{}},
 plan:{course_plan_id:course+'-plan',version_no:7},
 blueprint:{lesson_blueprint_id:course+'-blueprint',version_no:2,blueprint_state:'VALIDATED'},
});

test('Lesson AI requests meaningful Board notation independently of optional visual generation',async()=>{
 const ctx=lessonContext();
 const request=lessonTeacherRequest({studentId:'student',classId:ctx.classRow.class_id,context:ctx,turnKey:'turn'});
 assert.ok(request.outputSchema.declared_fields.includes('boardBlocks'));
 assert.match(request.academicInput.instruction,/independently|separately readable|separately readable, concise/i);
 assert.match(request.academicInput.instruction,/pictures are optional/i);
 assert.equal((await request.schemaValidator({decision:'ANSWER_NOW',teacherMessage:'Language has rules that make meaning possible.',boardBlocks:[{type:'text',content:{text:'Rule-governed language'}}]})).ok,true);
});

test('Optional untrusted Board notation fails closed without suppressing verified Teacher speech',()=>{
 const base={decision:'ANSWER_NOW',teacherMessage:'A full and grounded explanation of this lesson.'};
 assert.deepEqual(normalizeLessonProposal({...base,boardBlocks:[{type:'text',content:{text:'Key idea'}}]}).boardBlocks,[{type:'text',content:{text:'Key idea'}}]);
 assert.equal(normalizeLessonProposal({...base,boardBlocks:[{type:'text',content:{text:'<script>bad</script>'}}]}).boardBlocks.length,0);
 assert.equal(normalizeLessonProposal({...base,boardBlocks:[{type:'image',content:{src:'https://not-allowed'}}]}).boardBlocks.length,0);
 assert.equal(normalizeLessonProposal({...base,boardBlocks:new Array(5).fill({type:'text',content:{text:'overflow'}})}).boardBlocks.length,0);
 assert.equal(normalizeLessonProposal({...base,boardBlocks:[{type:'worked_solution',content:{steps:[]}}]}).boardBlocks.length,0);
 assert.equal(normalizeLessonProposal({...base,boardBlocks:[{type:'equation',content:{text:'x + 2 = 4'}}]}).boardBlocks[0].type,'equation');
 assert.equal(normalizeLessonProposal({...base,boardBlocks:null}).boardBlocks.length,0);
});

test('D14 publishes approved Board notations across different Courses without depending on image generation',async()=>{
 for(const course of ['GST','PHY101','BIO101']){
  const ctx=lessonContext(course),calls=[];
  const service=createD14Service({repository:{teacherTurn:async()=>null,publishTeacherTurn:async args=>{calls.push(args);return {communication_id:'comm'};}},d11Repository:{getClassContext:async()=>ctx},d11Service:{},d12Service:{},randomUUID:()=> 'uuid',lessonIntelligence:{decide:async()=>({decision:'ANSWER_NOW',teacherMessage:'Let us explore the core principle together.',boardBlocks:[{type:'text',content:{text:'Core principle: observable and testable'}}]})}});
  const output=await service.processLessonTurn({studentId:'student',classId:ctx.classRow.class_id,sessionId:ctx.session.class_session_id,controllerVersion:3});
  assert.equal(output.published,true);
  assert.equal(calls[0].blocks[0].content.text,'Core principle: observable and testable');
  assert.equal(calls[0].idempotencyKey,'d14-instruction:'+ctx.session.class_session_id+':v3');
 }
});

function liveRepository({parentState='SCHEDULED',mode='OPENING'}={}){
 const messages=new Map(),scenes=[],items=[],sqls=[];let seq=0;
 const run=async(sql,values=[])=>{
  sqls.push(sql);
  if(sql.includes('from public.teaching_teacher_communications where student_id=$1 and idempotency_key=$2'))return {rows:messages.has(values[1])?[messages.get(values[1])]:[]};
  if(sql.includes('select c.lifecycle_state as class_state'))return {rows:[{class_state:parentState,course_state:'ACTIVE',timetable_state:'APPROVED',schedule_version:5,course_state_version:2,course_id:'course'}]};
  if(sql.includes('from public.teaching_class_sessions where student_id=$1 and class_id=$2 for update'))return {rows:[{class_session_id:'session',state_version:3,lifecycle_state:'ACTIVE',instructional_substate:mode}]};
  if(sql.includes('from public.teaching_course_plans where'))return {rows:[{course_plan_id:'plan',version_no:7}]};
  if(sql.includes('from public.teaching_lesson_blueprints where'))return {rows:[{lesson_blueprint_id:'blueprint',version_no:2}]};
  if(sql.includes('insert into public.teaching_teacher_communications')){const row={communication_id:'communication-'+(++seq),message:values[5]};messages.set(values[7],row);return {rows:[row]};}
  if(sql.includes('select coalesce(max(ordinal)'))return {rows:[{n:scenes.length}]};
  if(sql.includes('insert into public.teaching_board_scenes')){scenes.push({sceneId:values[0],sessionId:values[2],ordinal:values[3]});return {rows:[]};}
  if(sql.includes('insert into public.teaching_board_items')){items.push({sceneId:values[2],type:values[4],content:JSON.parse(values[5]),provenance:JSON.parse(values[6])});return {rows:[]};}
  throw Error('Unhandled SQL: '+sql);
 };
 const repository=createD14ClassroomRepository({query:run,withTransaction:fn=>fn({query:run}),randomUUID:()=> 'uuid-'+(++seq),d11Repository:{}});
 return {repository,scenes,items,sqls,messages};
}
const publishArgs={studentId:'student',classId:'class',expectedControllerVersion:3,expectedBlueprintId:'blueprint',expectedBlueprintVersion:2,expectedScheduleVersion:5,expectedCourseStateVersion:2,expectedPlanId:'plan',expectedPlanVersion:7,message:'Understanding begins with clear examples.',idempotencyKey:'instruction:session:v3'};

test('Teacher publication atomically creates an accessible text Board scene when no visual or notation exists',async()=>{
 const f=liveRepository();
 const published=await f.repository.publishTeacherTurn({...publishArgs,blocks:[]});
 assert.ok(published.communication_id);
 assert.equal(f.scenes.length,1);
 assert.equal(f.items.length,1);
 assert.equal(f.items[0].type,'text');
 assert.equal(f.items[0].content.text,publishArgs.message);
 assert.deepEqual(f.items[0].provenance,[`teacher-communication:${published.communication_id}`]);
 await f.repository.publishTeacherTurn({...publishArgs,blocks:[]});
 assert.equal(f.scenes.length,1,'replaying an already published turn must not duplicate a Board scene');
 assert.equal(f.items.length,1);
});

test('Models may supply separate text and equation blocks without inserting synthetic speech copies',async()=>{
 const f=liveRepository();
 await f.repository.publishTeacherTurn({...publishArgs,blocks:[{type:'text',content:{text:'A concise key idea'}},{type:'equation',content:{text:'2+2=4'}}]});
 assert.equal(f.scenes.length,1);
 assert.deepEqual(f.items.map(i=>i.type),['text','equation']);
 assert.equal(f.items[0].content.text,'A concise key idea');
});

test('Unavailable Board notation must not weaken protected-mode or cancelled-parent publication fences',async()=>{
 for(const condition of [{mode:'ASSESSMENT'},{mode:'CLASSWORK'},{mode:'BREAK'},{mode:'INTERRUPTED'},{parentState:'CANCELLED'}]){
  const f=liveRepository(condition);
  await assert.rejects(f.repository.publishTeacherTurn({...publishArgs}),{code:condition.parentState?'TEACHING_D14_PARENT_AUTHORITY_REVOKED':'TEACHING_D14_TEACHER_TURN_STALE'});
  assert.equal(f.scenes.length,0);
  assert.equal(f.items.length,0);
  assert.equal(f.messages.size,0);
 }
});
