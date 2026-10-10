'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {assembleStudentFactPack,classClosureTranslation}=require('../../../teaching/d14/fact-pack');
const {validateBlock}=require('../../../teaching/d14/board');
const {validateStageOutput,bindingFrom}=require('../../../teaching/d14/study-note');
const {createD14Service}=require('../../../teaching/d14/service');

const sourceFact=(key,value,extra={})=>({source_owner:'Teaching Controller',truth_domain:'CLASS_ACTUAL',semantic_key:key,fact_class:'CONTROLLER_FACT',truth_status:'AUTHORITATIVE',visibility:'STUDENT',effective_state:value,provenance_refs:['class:c1'],...extra});
test('TPF-19 fact pack filters hidden facts and cannot acquire academic mutation authority',()=>{
  const x=assembleStudentFactPack({snapshotRef:'closure:f1@2',facts:[sourceFact('completed',['o1']),sourceFact('hidden','secret',{visibility:'HIDDEN'})]});
  assert.equal(x.factPack.facts.length,1);assert.equal(x.factPack.facts[0].truth_status,'AUTHORITATIVE_FINAL');assert.equal(x.authoritativeMutation,false);
  assert.equal(x.directive.translation_mode,'CLASS_SUMMARY');
});
test('TPF-19 rejects stale source, protected semantic keys and same-domain conflicting facts',()=>{
  assert.throws(()=>assembleStudentFactPack({snapshotRef:'a',currentSnapshotRef:'b',facts:[]}),/STALE/);
  assert.throws(()=>assembleStudentFactPack({snapshotRef:'a',facts:[sourceFact('answer_key','x')]}),/PROTECTED|CONTRACT/);
  assert.throws(()=>assembleStudentFactPack({snapshotRef:'a',facts:[sourceFact('completed',1),sourceFact('completed',2)]}),/CONFLICT/);
  const pack=assembleStudentFactPack({snapshotRef:'a',facts:[sourceFact('grade',50,{truth_domain:'GRADEBOOK'}),sourceFact('grade','improving',{truth_domain:'KNOWLEDGE'})]});
  assert.equal(pack.factPack.facts.length,2);
});
test('D11 closure is normalized without exposing unrelated internals',()=>{
  const x=classClosureTranslation({closure_fact_id:'f1',controller_version:2,fact_pack:{student_translation_fact_pack:{facts:[sourceFact('completed',['o1'])]},hidden_prompt:'private'}});
  assert.equal(x.factPack.snapshot_ref,'class-closure:f1@2');assert.equal(JSON.stringify(x).includes('hidden_prompt'),false);
});
test('Board accepts typed data and rejects model HTML, external images and unknown blocks',()=>{
  for(const type of ['text','equation','code','source_passage'])assert.equal(validateBlock({type,content:{text:'x'}}).type,type);
  assert.equal(validateBlock({type:'worked_solution',content:{steps:['x=1']}}).type,'worked_solution');
  assert.equal(validateBlock({type:'graph',content:{points:[[0,2],[1,4]]}}).type,'graph');
  assert.equal(validateBlock({type:'image',content:{src:'/assets/example.png',assetId:'a',alt:'Diagram'}}).type,'image');
  for(const block of [{type:'html',content:{html:'<script/>'}},{type:'text',content:{text:'x',innerHTML:'<b>x</b>'}},{type:'image',content:{src:'https://third.party/x',assetId:'a',alt:'x'}}])assert.throws(()=>validateBlock(block),/BOARD_BLOCK_INVALID/);
});
test('TPF-20 pre-Class binding is private and requires validated planned cards',()=>{
  const context={classRow:{class_id:'c1',course_id:'co',course_state_version:3,schedule_version:4},blueprint:{lesson_blueprint_id:'l1',version_no:2,blueprint_state:'VALIDATED'},plan:{course_plan_id:'p1'}};
  const cardSet={ref:'set@1',cards:[{cardId:'k1',version:'1',learningUnitId:'lu1',validated:true}]};
  const binding=bindingFrom({context,cardSet,sourceSnapshot:{ref:'src@1'}});assert.equal(binding.closureRef,null);
  const output={prompt_family:'TPF-20',prompt_version:'1.0',capability_id:'teaching.study.class_grounded_note_generation',task_mode:'PRE_CLASS_NOTE_PREPARATION',status:'PREPARED_NOT_PUBLISHABLE',source_binding:{course_ref:binding.courseRef,class_ref:binding.classRef,lesson_plan_ref:binding.lessonPlanRef,course_source_snapshot_ref:binding.sourceSnapshotRef,class_study_card_set_ref:binding.cardSetRef,class_closure_ref:null,class_summary_ref:null},note:{sections:[]},claim_provenance:[],coverage:{},checks:{}};
  assert.equal(validateStageOutput({output,stage:'PRE_CLASS',binding,plannedLearningUnits:['lu1'],sourceRefs:[],cardSet}).publishable,false);
  assert.throws(()=>bindingFrom({context,cardSet:{ref:'set@1',cards:[{cardId:'k1',version:'1',learningUnitId:'lu1'}]},sourceSnapshot:{ref:'src@1'}}),/VALIDATED_CARD_SET/);
  return {output,binding,cardSet};
});
test('TPF-20 post-Class rejects untaught sections, stale bindings and missing reconciliation',()=>{
  const base={prompt_family:'TPF-20',prompt_version:'1.0',capability_id:'teaching.study.class_grounded_note_generation',task_mode:'POST_CLASS_NOTE_RECONCILIATION',status:'DRAFT_READY_FOR_VALIDATION'};
  const binding={courseRef:'co@1',classRef:'c@1',lessonPlanRef:'l@1',sourceSnapshotRef:'src@1',cardSetRef:'set@1',closureRef:'f@2',summaryRef:'sum@1'};
  const source_binding={course_ref:'co@1',class_ref:'c@1',lesson_plan_ref:'l@1',course_source_snapshot_ref:'src@1',class_study_card_set_ref:'set@1',class_closure_ref:'f@2',class_summary_ref:'sum@1'};
  const checks=Object.fromEntries(['all_substantive_claims_traceable','actual_taught_scope_only_for_publication','source_and_card_versions_aligned','final_card_set_accounted_for','corrections_applied','protected_content_excluded','no_mastery_grade_or_schedule_decision','no_invented_teacher_memory','publishable_only_after_reconciliation'].map((k)=>[k,true]));
  const output={...base,source_binding,note:{sections:[{learning_unit_refs:['lu2']}]},claim_provenance:[],coverage:{removed_untaught_learning_unit_refs:['lu2']},reconciliation:{provisional_note_ref:'n1',actual_class_delta_applied:true},checks};
  const args={output,stage:'POST_CLASS',binding,plannedLearningUnits:['lu1','lu2'],actualTaughtLearningUnits:['lu1'],sourceRefs:[],cardSet:{cards:[]},priorNote:{note_version_id:'n1'}};
  assert.throws(()=>validateStageOutput(args),/UNTAUGHT_SECTION/);
  output.note.sections=[];assert.equal(validateStageOutput(args).publishable,false);
  output.source_binding.class_closure_ref='f@1';assert.throws(()=>validateStageOutput(args),/STALE_BINDING/);
});
test('Classroom response delegates to D12 and help stays a separate non-academic interaction',async()=>{
  const calls=[];
  const repo={getClassContext:async()=>({classRow:{course_id:'co',lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED'},session:{class_session_id:'s',state_version:5,lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION'}})};
  const service=createD14Service({repository:{recordInteraction:async(input)=>{calls.push(input);return {interaction_id:'i1',interaction_kind:input.kind,created_at:'now'};}},d11Repository:repo,d11Service:{},d12Service:{captureResponse:async(_user,_class,input)=>{calls.push(input);return {responseId:'r1'};}},randomUUID:()=> 'uuid'});
  const help=await service.signal({id:'u'},'c',{kind:'NEED_HELP',body:'Please explain',idempotencyKey:'h1'});
  assert.equal(help.academicResponse,false);assert.equal(calls[0].kind,'NEED_HELP');
  const answer=await service.respond({id:'u'},'c',{learningUnitId:'lu1',responsePayload:{text:'4'}});
  assert.equal(answer.responseId,'r1');assert.equal(calls.length,2);
});

test('Classroom projects 30, 60 and 120 minute lessons from server time and keeps break/assessment transitions protected',async()=>{
  for(const minutes of [30,60,120]){
    const start='2026-09-29T10:00:00.000Z',end=new Date(Date.parse(start)+minutes*60000).toISOString();
    const ctx={classRow:{class_id:'c',course_id:'co',course_state_version:1,schedule_version:1,scheduled_start_at:start,scheduled_end_at:end},session:{class_session_id:'s',lifecycle_state:'ACTIVE',instructional_substate:'BREAK',progress_state:{}},blueprint:{blueprint_state:'VALIDATED',planned_learning_unit_refs:[],blueprint_payload:{objectives:[]}}};
    const repository={identity:async()=>({course_title:'Course'}),board:async()=>[],notebook:async()=>[],latestNote:async()=>null,latestTeacherMessage:async()=>null,firstEntry:async()=>({created_at:start})};
    const d11Repository={getClassContext:async()=>ctx};
    const service=createD14Service({repository,d11Repository,d11Service:{getClass:async()=>({class:{scheduledStartAt:start,scheduledEndAt:end},controller:{lifecycleState:'ACTIVE'},time:{}})},d12Service:{},clock:()=>new Date(start),randomUUID:()=> 'uuid'});
    const view=await service.snapshot({id:'u'},'c');
    assert.equal(view.mode,'Break');assert.equal(view.entry.minutesRemaining,minutes);assert.equal(view.boardHistoryAllowed,true);
    ctx.session.instructional_substate='ASSESSMENT';
    const protectedView=await service.snapshot({id:'u'},'c');assert.equal(protectedView.assessmentTakeover,true);assert.equal(protectedView.notebookAllowed,false);assert.equal(protectedView.boardHistoryAllowed,false);
  }
});

test('Classroom separates upcoming Classes from attendance-backed Class history',async()=>{
  const start='2026-10-08T09:00:00.000Z';
  const repository={
    identity:async()=>({course_title:'Physics'}),
    listClasses:async()=>[
      {class_id:'past',scheduled_start_at:'2026-10-07T09:00:00.000Z',scheduled_end_at:'2026-10-07T10:00:00.000Z',attendance_outcome:'PARTIAL',missed_minutes:20},
      {class_id:'future',scheduled_start_at:'2026-10-09T09:00:00.000Z',scheduled_end_at:'2026-10-09T10:00:00.000Z'},
    ],
  };
  const service=createD14Service({repository,d11Repository:{getClassContext:async()=>null},d11Service:{},d12Service:{},clock:()=>new Date(start),randomUUID:()=> 'uuid'});
  const value=await service.listClasses({id:'u1'},'co1');
  assert.deepEqual(value.upcoming.map((row)=>row.class_id),['future']);
  assert.deepEqual(value.history.map((row)=>row.class_id),['past']);
  assert.equal(value.history[0].attendance_outcome,'PARTIAL');
});

test('Classroom UI keeps Start, Resume and LEAVE while Notebook opens as a compact sheet',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(source,/Start Class/);
  assert.match(source,/Resume Class/);
  assert.match(source,/attendance will be recorded up to this moment/);
  assert.match(source,/tc-corner-button/);
  assert.match(source,/tc-course-actions/);
  assert.match(source,/tc-history-tab/);
  assert.doesNotMatch(source,/tc-history-corner/);
  assert.match(source,/Save note/);
  assert.match(source,/Cancel/);
  assert.doesNotMatch(source,/tc-notebook-shortcut/);
  assert.match(source,/Past Classes/);
});

test('Classroom history review is read-only and LEAVE retries retain the same request key',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(source,/open\(item\.class_id,\{reviewOnly:true\}\)/);
  assert.match(source,/if\(!state\.reviewOnly&&data\.controller\?\.lifecycleState==='ACTIVE'&&!data\.hasEntered\)/);
  assert.match(source,/joinCurrentClass\(classId,host\)/);
  assert.match(source,/if\(state\.classId!==classId\|\|state\.host!==host\|\|state\.reviewOnly/);
  assert.match(source,/state\.leaveRequestId \|\|= crypto\.randomUUID\(\)/);
  assert.match(source,/idempotencyKey:state\.leaveRequestId/);
  assert.match(source,/Close Review/);
  assert.match(source,/↻ Refresh/);
});


test('D14 Classroom messages are persisted with no fabricated AI response and restricted modes refuse sends',async()=>{
  const ctx={classRow:{class_id:'c',course_id:'co',lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED',scheduled_start_at:'2026-10-08T09:00:00Z',scheduled_end_at:'2026-10-08T10:00:00Z'},session:{class_session_id:'s',state_version:1,lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION',progress_state:{}}};
  const delivered=[];
  const repository={
    recordInteraction:async input=>{delivered.push(input);return {interaction_id:'int-1',interaction_kind:input.kind,created_at:'2026-10-08T09:20:00Z'};},
    identity:async()=>({course_title:'Course',teacher_name:'AI Teacher'}),
    board:async()=>[],notebook:async()=>[],latestNote:async()=>null,latestTeacherMessage:async()=>null,
    firstEntry:async()=>null,conversation:async()=>[{id:'student-q',role:'STUDENT',kind:'ASK_TEACHER',message:'Why?',sentAt:'2026-10-08T09:18:00Z'},{id:'teacher-a',role:'TEACHER',kind:'TEACHER_TURN',message:'The key idea is…',sentAt:'2026-10-08T09:19:00Z'}]
  };
  const service=createD14Service({repository,d11Repository:{getClassContext:async()=>ctx},d11Service:{getClass:async()=>({class:{scheduledEndAt:'2026-10-08T10:00:00Z'},controller:{lifecycleState:'ACTIVE'},time:{}})},d12Service:{},clock:()=>new Date('2026-10-08T09:20:00Z'),randomUUID:()=> 'uuid'});
  const view=await service.snapshot({id:'student'},'c');
  assert.equal(view.teacherMessagingAllowed,true);
  assert.deepEqual(view.teacherConversation.map(row=>row.role),['STUDENT','TEACHER']);
  const accepted=await service.signal({id:'student'},'c',{kind:'ASK_TEACHER',body:'Please explain gravity',idempotencyKey:'q-id'});
  assert.equal(accepted.status,'RECORDED_FOR_TEACHER');
  assert.equal(accepted.academicResponse,false);
  assert.equal(delivered[0].body,'Please explain gravity');
  await assert.rejects(service.signal({id:'student'},'c',{kind:'ASK_TEACHER',body:' ',idempotencyKey:'empty'}),{code:'TEACHING_D14_TEACHER_MESSAGE_REQUIRED'});
  ctx.session.instructional_substate='BREAK';
  assert.equal((await service.snapshot({id:'student'},'c')).teacherMessagingAllowed,false);
  await assert.rejects(service.signal({id:'student'},'c',{kind:'ASK_TEACHER',body:'Question',idempotencyKey:'break'}),{code:'TEACHING_D14_TEACHER_MESSAGES_PAUSED'});
  ctx.session.instructional_substate='ASSESSMENT';
  const protectedView=await service.snapshot({id:'student'},'c');
  assert.deepEqual(protectedView.teacherConversation,[]);
  assert.equal(protectedView.teacherMessagingAllowed,false);
  await assert.rejects(service.signal({id:'student'},'c',{kind:'NEED_HELP',body:'Please',idempotencyKey:'exam'}),{code:'TEACHING_D14_ASSESSMENT_CONTROL_RESTRICTED'});
  assert.equal(delivered.length,1);
});

test('Classroom messaging timeline reads student questions and student-visible Teacher publications only',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d14-classroom.js'),'utf8');
  assert.match(source,/async function conversation\(studentId,classId\)/);
  assert.match(source,/interaction_kind in \('ASK_TEACHER','NEED_HELP'\)/);
  assert.match(source,/visibility='STUDENT'/);
  assert.match(source,/order by created_at desc limit 40/);
  const client=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(client,/idempotencyKey:key/);
  assert.match(client,/state\.sheetKey \|\|= crypto\.randomUUID\(\)/);
  assert.match(client,/if\(previous\)previous\.replaceWith\(root\)/);
  assert.match(client,/classroom-sheets|openSheet\('notebook'\)/);
  assert.doesNotMatch(client,/window\.prompt\(/);
});


test('Closed Classroom stops overtime counter and replaces empty Board illustration with explicit record guidance',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(source,/overall\.textContent=\['CLOSURE','UNSTARTED_PAST'\]\.includes\(s\.modeKey\)/);
  assert.match(source,/No Board scenes published/);
  assert.match(source,/Review attendance and any saved notes in Past Classes/);
});


test('Assessment/Classwork transitions dismiss an already-open Notebook or Teacher sheet',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(source,/if\(\['ASSESSMENT','CLASSWORK'\]\.includes\(s\.modeKey\)&&state\.sheet\)closeSheet\(\{restore:false,force:true\}\)/);
  assert.match(source,/if\(!state\.sheet\|\|state\.sheetBusy&&!force\)return/);
});


test('Classroom live refresh preserves the focused sheet DOM, not just the note text',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(source,/const previous=state\.host\.querySelector\('\.tc-shell'\)/);
  assert.match(source,/if\(previous\)previous\.replaceWith\(root\);else state\.host\.prepend\(root\)/);
  assert.match(source,/focus\?\.isConnected\?focus:fallback/);
});


test('D14 respects the authoritative server clock for future, current, overtime, and past Class entry buttons',async()=>{
  const present=new Date('2026-10-08T09:00:00Z');
  const entries=[
    {class_id:'future',scheduled_start_at:'2026-10-08T11:00:00Z',scheduled_end_at:'2026-10-08T12:00:00Z'},
    {class_id:'now',scheduled_start_at:'2026-10-08T09:00:00Z',scheduled_end_at:'2026-10-08T10:00:00Z'},
    {class_id:'overtime',scheduled_start_at:'2026-10-08T07:00:00Z',scheduled_end_at:'2026-10-08T08:00:00Z',session_state:'ACTIVE'},
    {class_id:'past',scheduled_start_at:'2026-10-07T07:00:00Z',scheduled_end_at:'2026-10-07T08:00:00Z'},
    {class_id:'closed',scheduled_start_at:'2026-10-08T08:00:00Z',scheduled_end_at:'2026-10-08T10:00:00Z',session_state:'CLOSED',attendance_outcome:'PARTIAL'},
  ];
  const repository={identity:async()=>({course_title:'PHY 103',lifecycle_state:'ACTIVE'}),listClasses:async()=>entries};
  const service=createD14Service({repository,d11Repository:{},d11Service:{},d12Service:{},clock:()=>present,randomUUID:()=> 'id'});
  const data=await service.listClasses({id:'student'},'physics');
  assert.equal(data.serverNow,present.toISOString());
  const rows=new Map(data.classes.map(row=>[row.class_id,row]));
  assert.equal(rows.get('future').can_enter,false);
  assert.equal(rows.get('now').can_enter,true);
  assert.equal(rows.get('overtime').can_enter,true);
  assert.equal(rows.get('past').can_enter,false);
  assert.equal(rows.get('past').historical_unstarted,true);
  assert.equal(rows.get('closed').can_enter,false);
  assert.deepEqual(data.upcoming.map(row=>row.class_id),['future','now','overtime']);
  assert.deepEqual(data.history.map(row=>row.class_id),['closed','past']);
});

test('D14 enter blocks a pre-start JOIN, expired unstarted Class, closed session, and cancelled Class without attendance writes',async()=>{
  let now=new Date('2026-10-08T09:00:00Z');
  const context={classRow:{scheduled_start_at:'2026-10-08T10:00:00Z',scheduled_end_at:'2026-10-08T11:00:00Z',lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE'},session:null};
  let joins=0,attendance=0;
  const service=createD14Service({repository:{recordInteraction:async()=>{joins++;return {interaction_id:'j1',created_at:now.toISOString()};}},d11Repository:{getClassContext:async()=>context},d11Service:{},d12Service:{},attendanceService:{observeJoin:async()=>{attendance++;return {};}} ,clock:()=>now,randomUUID:()=> 'uuid'});
  await assert.rejects(service.enter({id:'u'},'c'),{code:'TEACHING_D14_CLASS_NOT_STARTED'});
  assert.equal(joins,0);
  now=new Date('2026-10-08T10:30:00Z');
  const entry=await service.enter({id:'u'},'c');assert.equal(entry.enteredAt,now.toISOString());
  assert.equal(joins,1);assert.equal(attendance,1);
  now=new Date('2026-10-08T12:00:00Z');
  await assert.rejects(service.enter({id:'u'},'c'),{code:'TEACHING_D14_CLASS_ALREADY_ENDED'});
  context.session={lifecycle_state:'ACTIVE'};
  await service.enter({id:'u'},'c');assert.equal(joins,2);
  context.session={lifecycle_state:'CLOSED'};
  await assert.rejects(service.enter({id:'u'},'c'),{code:'TEACHING_D14_CLASS_ALREADY_ENDED'});
  context.session=null;context.classRow.lifecycle_state='CANCELLED';
  await assert.rejects(service.enter({id:'u'},'c'),{code:'TEACHING_D14_CLASS_CANCELLED'});
  context.classRow.lifecycle_state='SCHEDULED';context.classRow.course_lifecycle_state='DRAFT';
  await assert.rejects(service.enter({id:'u'},'c'),{code:'TEACHING_D14_COURSE_NOT_ACTIVE'});
  assert.equal(joins,2);assert.equal(attendance,2);
});

test('D14 snapshot labels an elapsed, unstarted Class as historical without exposing a start control',async()=>{
  const ctx={classRow:{class_id:'c',course_id:'co',lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',scheduled_start_at:'2026-10-07T09:00:00Z',scheduled_end_at:'2026-10-07T10:00:00Z'},session:null};
  const repository={identity:async()=>({course_title:'Physics'}),board:async()=>[],notebook:async()=>[],latestNote:async()=>null,latestTeacherMessage:async()=>null,firstEntry:async()=>null,conversation:async()=>[]};
  const service=createD14Service({repository,d11Repository:{getClassContext:async()=>ctx},d11Service:{getClass:async()=>({class:{scheduledStartAt:ctx.classRow.scheduled_start_at,scheduledEndAt:ctx.classRow.scheduled_end_at},controller:null,time:{}})},d12Service:{},clock:()=>new Date('2026-10-08T11:00:00Z'),randomUUID:()=> 'id'});
  const snapshot=await service.snapshot({id:'u'},'c');
  assert.equal(snapshot.modeKey,'UNSTARTED_PAST');
  assert.equal(snapshot.canStartClass,false);
  assert.equal(snapshot.controlsEnabled,false);
  assert.equal(snapshot.teacherMessagingAllowed,false);
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(ui,/if\(s\.modeKey==='UNSTARTED_PAST'\)/);
  assert.match(ui,/enter\.disabled=!item\.can_enter/);
  assert.match(ui,/tc-history-tab-count/);
});

test('Superseded Classes are hidden only when never started and no attendance record exists',()=>{
  const sql=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d14-classroom.js'),'utf8');
  assert.match(sql,/approved\.timetable_version_id/);
  assert.match(sql,/c\.source_timetable_version_id=approved\.timetable_version_id/);
  assert.match(sql,/or s\.lifecycle_state is not null/);
  assert.match(sql,/or a\.attendance_record_id is not null/);
  assert.match(sql,/c\.lifecycle_state<>'CANCELLED'/);
});

test('Expired scheduled start events and manual Starts are terminal, not retried forever',()=>{
  const runtime=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/runtime.js'),'utf8');
  const controller=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d11/service.js'),'utf8');
  assert.match(runtime,/CLASS_START_WINDOW_EXPIRED/);
  assert.match(runtime,/RECONCILIATION_DISPOSITIONS\.SUPERSEDED/);
  assert.match(controller,/TEACHING_D11_CLASS_WINDOW_EXPIRED/);
  assert.match(controller,/!context\.session && now\.getTime\(\)>=new Date\(context\.classRow\.scheduled_end_at\)/);
});

test('the same D14 Teacher/Board validation rejects oversized prepared turns and unsafe text before publication',()=>{const {validateTeacherTurnBlocks}=require('../../../teaching/d14/board');assert.throws(()=>validateTeacherTurnBlocks('a'.repeat(5001)),{code:'TEACHING_D14_TEACHER_TURN_INVALID'});assert.throws(()=>validateTeacherTurnBlocks('<script>bad</script>'),{code:'TEACHING_D14_BOARD_BLOCK_INVALID'});assert.equal(validateTeacherTurnBlocks('Readable explanation')[0].type,'text');});
