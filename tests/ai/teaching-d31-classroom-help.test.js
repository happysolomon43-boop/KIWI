'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createTeachingPromptControlPlane}=require('../../teaching/prompt-runtime');
const {createD31ReleaseOrchestrator}=require('../../teaching/d31/release-orchestrator');
const {createD14HelpIntelligence}=require('../../teaching/d14/help-intelligence');
test('a real TPF-08 registered in-Class raised hand traverses D31, D05, D03 and the central T1 boundary',async()=>{
  const course={course_id:'course1',student_id:'student1',state_version:5,lifecycle_state:'ACTIVE'};
  const klass={class_id:'class1',student_id:'student1',course_id:'course1',schedule_version:2,lifecycle_state:'SCHEDULED',source_timetable_state:'APPROVED',course_lifecycle_state:'ACTIVE',course_state_version:5};
  const plan={course_plan_id:'plan1',course_id:'course1',student_id:'student1',version_no:3,plan_state:'APPROVED'};
  const blueprint={lesson_blueprint_id:'blueprint1',student_id:'student1',class_id:'class1',version_no:2,blueprint_state:'VALIDATED',objective_summary:"Newton's second law",planned_learning_unit_refs:['force'],blueprint_payload:{objectives:[{id:'force',title:'Explain F = ma'}]}};
  const session={class_session_id:'session1',state_version:7,lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION',progress_state:{current_learning_unit_ref:'force'}};
  const help={help_request_id:'help1',interaction_id:'interaction1'};
  const question={interaction_id:'interaction1',interaction_kind:'NEED_HELP',body:'Why does greater mass require more force?',created_at:'2026-10-08T16:00:00Z'};
  const observed=[];
  const states=new Map();
  const platform={
    promptControl:createTeachingPromptControlPlane(),
    aiBoundary:{async execute(input){observed.push(input);return {accepted:true,validatedResult:{output:{decision:'ANSWER_NOW',teacherMessage:'Newton\'s second law relates force, mass and acceleration through F = ma.',reason:'',delayMinutes:0}}};}},
    orchestrationStore:{
      async begin(envelope){states.set(envelope.execution_id,'PENDING');return {inserted:true};},
      async mark(id,status){states.set(id,status);}
    }
  };
  const query=async(sql,params)=>{
    if(sql.includes('teaching_runtime.academic_authority_revocations'))return {rows:[]};
    if(sql.includes('from public.teaching_classes c'))return {rows:[klass]};
    if(sql.includes('from public.teaching_courses'))return {rows:[course]};
    if(sql.includes('from public.teaching_course_plans'))return {rows:[plan]};
    if(sql.includes('state_version,lifecycle_state from public.teaching_class_sessions'))return {rows:[session]};
    if(sql.includes('from public.teaching_lesson_blueprints'))return {rows:[blueprint]};
    if(sql.includes('from public.teaching_classroom_interactions'))return {rows:[question]};
    throw new Error('Unexpected in-Class T1 query: '+sql);
  };
  const orchestrator=createD31ReleaseOrchestrator({runtimePlatform:platform,query,randomUUID:()=> 'd14-test-execution1'});
  const intelligence=createD14HelpIntelligence({orchestrator});
  const result=await intelligence.decide({studentId:'student1',classId:'class1',helpRequest:help,context:{classRow:klass,plan,blueprint,session}});
  assert.equal(result.decision,'ANSWER_NOW');
  assert.equal(observed.length,1);
  assert.equal(observed[0].intelligenceClass,'DIRECT-AI');
  assert.equal(observed[0].authorityLevel,'T1');
  assert.match(observed[0].request.content,/greater mass require more force/);
  assert.match(observed[0].request.content,/Newton's second law/);
  assert.equal(states.get('d14-test-execution1'),'COMPLETED');
});
