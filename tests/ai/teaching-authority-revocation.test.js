'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createAcademicAuthorityCancellationReader}=require('../../teaching/authority/revocation-reader');
const {createTeachingPromptControlPlane}=require('../../teaching/prompt-runtime');
const {createD31ReleaseOrchestrator}=require('../../teaching/d31/release-orchestrator');
const {curriculumAuditRequest}=require('../../teaching/d07/intelligence');

function envelope(type='teaching_class_controller') {
  return {
    trigger:{actor_id:'student1'},
    state_reference:{aggregate_type:type,aggregate_id:type==='teaching_course'?'course1':'class1',state_version:'7'},
    preconditions:{class_schedule_version:'11',course_state_version:'9',course_plan_id:'plan1',course_plan_version:'5',lesson_blueprint_id:'lesson1',lesson_blueprint_version:'2'},
  };
}
function memoryRevocations(initial=[]) {
  const committed=new Set(initial.map(x=>x.join('|')));
  const queries=[];
  const query=async(sql,args)=>{
    queries.push({sql,args});
    if(sql.includes('from public.teaching_classes c'))return {rows:[{course_id:'course1',source_timetable_version_id:'tt1',timetable_version:3}]};
    if(sql.includes('teaching_runtime.academic_authority_revocations')){
      const matched=[];
      for(let i=1;i<args.length;i+=3){
        const key=args[0]+'|'+args[i]+'|'+args[i+1]+'|'+args[i+2];
        if(committed.has(key))matched.push({owner_kind:args[i],reason_code:'PARENT_SUPERSEDED'});
      }
      return {rows:matched.slice(0,1)};
    }
    throw Error('Unexpected cancellation read: '+sql);
  };
  return {query,committed,queries};
}
test('multi-worker reader sees durable Course → Plan → Blueprint → Class → Timetable revocation without local shared state',async()=>{
  const db=memoryRevocations();
  const workerA=createAcademicAuthorityCancellationReader({query:db.query});
  const workerB=createAcademicAuthorityCancellationReader({query:db.query});
  const claims=[['COURSE','course1','9'],['CLASS','class1','11'],['COURSE_PLAN','plan1','5'],['LESSON_BLUEPRINT','lesson1','2'],['TIMETABLE','tt1','3']];
  const input=envelope();
  for(const [kind,ref,version] of claims){
    assert.equal((await workerA.read(input)).cancelled,false);
    db.committed.add(['student1',kind,ref,version].join('|'));
    const detected=await workerB.read(input,{phase:'before_retry'});
    assert.equal(detected.cancelled,true);
    assert.equal(detected.ownerKind,kind);
    db.committed.delete(['student1',kind,ref,version].join('|'));
  }
  assert.ok(db.queries.some(q=>q.sql.includes('academic_authority_revocations')));
});
test('a resumed Course or newly materialized Class version does not inherit an old revocation',async()=>{
  const db=memoryRevocations([['student1','COURSE','course1','8'],['student1','CLASS','class1','10'],['student1','COURSE_PLAN','plan1','4']]);
  const check=createAcademicAuthorityCancellationReader({query:db.query});
  assert.equal((await check.read(envelope())).cancelled,false);
  const course=envelope('teaching_course');course.state_reference.state_version='9';
  assert.equal((await check.read(course)).cancelled,false);
  course.state_reference.state_version='8';
  assert.equal((await check.read(course)).cancelled,true);
});
test('revocation status is student-scoped, not a cross-user cancellation',async()=>{
  const db=memoryRevocations([['student2','COURSE','course1','9']]);
  assert.equal((await createAcademicAuthorityCancellationReader({query:db.query}).read(envelope())).cancelled,false);
});
test('missing original Class parent stops work instead of launching provider after Class deletion',async()=>{
  const db=memoryRevocations();
  const reader=createAcademicAuthorityCancellationReader({query:async(sql,args)=>sql.includes('from public.teaching_classes c')?{rows:[]}:db.query(sql,args)});
  const decision=await reader.read(envelope());
  assert.equal(decision.cancelled,true);
  assert.equal(decision.reason,'CLASS_PARENT_NOT_FOUND');
});
test('immutable trigger migration covers all six academic owner families with no student-facing DML grants',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../../migrations/20261008_teaching_d05_durable_authority_revocations.sql'),'utf8');
  for(const name of ['teaching_courses','teaching_classes','teaching_course_plans','teaching_lesson_blueprints','teaching_timetable_versions','workspaces'])
    assert.match(sql,new RegExp("TRIGGER[\\s\\S]*?ON (?:public|teaching_preparation)\\."+name));
  assert.match(sql,/AFTER UPDATE/);
  assert.match(sql,/ON CONFLICT \(student_id,owner_kind,owner_ref,authority_version\) DO NOTHING/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL.*anon,authenticated/);
  assert.doesNotMatch(sql,/GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]*TO\s+(?:anon|authenticated)/i);
});
test('D31 cancels a Course model run before model inference when a committed version was revoked',async()=>{
  const course={course_id:'course1',student_id:'student1',state_version:7,lifecycle_state:'ACTIVE'};
  const rows=new Map(),audit=[];
  const db=memoryRevocations([['student1','COURSE','course1','7']]);
  const query=async(sql,args)=>{
    if(sql.includes('teaching_runtime.academic_authority_revocations'))return db.query(sql,args);
    if(sql.includes('from public.teaching_courses'))return {rows:[course]};
    throw Error('Unexpected D31 query: '+sql);
  };
  let aiCalls=0;
  const platform={
    promptControl:createTeachingPromptControlPlane(),
    aiBoundary:{async execute(){aiCalls++;return {accepted:true,validatedResult:{output:{reviewNeeded:false}}};}},
    orchestrationStore:{
      async begin(e){rows.set(e.execution_id,'PENDING');return {inserted:true};},
      async mark(id,status,metadata){rows.set(id,status);audit.push({status,metadata});}
    }
  };
  const coordinator=createD31ReleaseOrchestrator({runtimePlatform:platform,query,randomUUID:()=> 'cancellation-operation'});
  const request=curriculumAuditRequest({course,sources:[{source_content_item_id:'source1',student_id:'student1',course_id:'course1',source_kind:'PRIMARY_KIWI_SUBJECT',source_ref:'subject:1:card:1',content_summary:'Force and acceleration material'}]});
  const result=await coordinator.execute(request);
  assert.equal(result.cancelled,true);
  assert.equal(aiCalls,0);
  assert.equal(rows.get('cancellation-operation'),'CANCELLED');
  assert.ok(audit.some(x=>x.status==='CANCELLED'&&x.metadata?.validationOutcome==='CANCELLED_BEFORE_MODEL_DISPATCH'&&x.metadata?.safeMetadata?.model_dispatch_avoided===true));
});

function liveCancellationFixture({lateResult=false}={}){
  const course={course_id:'course1',student_id:'student1',state_version:7,lifecycle_state:'ACTIVE',subject_snapshot_ref:'subject:1:scope'};
  const source={source_content_item_id:'source1',student_id:'student1',course_id:'course1',source_kind:'PRIMARY_KIWI_SUBJECT',source_ref:'subject:1:card:1',content_summary:'A force is needed to accelerate an object'};
  const db=memoryRevocations();const marks=[],attempts=[];
  const query=async(sql,args)=>{
    if(sql.includes('teaching_runtime.academic_authority_revocations'))return db.query(sql,args);
    if(sql.includes('from public.teaching_courses'))return {rows:[course]};
    if(sql.includes('from public.teaching_source_content_items'))return {rows:[source]};
    throw Error('Unexpected cancellation fixture query: '+sql);
  };
  const platform={
    promptControl:createTeachingPromptControlPlane(),
    aiBoundary:{async execute(input){
      assert.equal(typeof input.centralRouteOptions.beforeAttempt,'function');
      await input.centralRouteOptions.beforeAttempt();
      assert.equal(input.signal.aborted,false);
      attempts.push('first-provider-dispatch');
      // A remote KIWI instance commits parent revocation after provider
      // dispatch. The central retry hook catches it before any fallback call.
      db.committed.add('student1|COURSE|course1|7');
      await input.centralRouteOptions.beforeAttempt();
      assert.equal(input.signal.aborted,true);
      if(lateResult)return {accepted:true,validatedResult:{output:{status:'ok'}}};
      throw Object.assign(new Error('Local network request interrupted'),{code:'CANCELLED'});
    }},
    orchestrationStore:{
      async begin(){return {inserted:true};},
      async mark(_id,status,metadata){marks.push({status,metadata});return {status};},
    },
  };
  const orchestrator=createD31ReleaseOrchestrator({runtimePlatform:platform,query,randomUUID:()=> 'cancellation-inflight'});
  return {orchestrator,course,source,marks,attempts};
}
test('a remote revocation stops provider fallback and records local interruption without inventing provider acknowledgement',async()=>{
  const f=liveCancellationFixture();
  const result=await f.orchestrator.execute(curriculumAuditRequest({course:f.course,sources:[f.source]}));
  assert.equal(result.cancelled,true);
  assert.deepEqual(f.attempts,['first-provider-dispatch']);
  const done=f.marks.find(x=>x.status==='CANCELLED');
  assert.equal(done.metadata?.validationOutcome,'MODEL_EXECUTION_INTERRUPTED');
  assert.ok(done.metadata?.safeMetadata?.abort_requested_at);
  assert.ok(done.metadata?.safeMetadata?.model_dispatch_started_at);
  assert.equal(done.metadata?.safeMetadata?.remote_abort_confirmation,'NOT_OBSERVABLE');
});
test('a non-cooperating provider cannot publish its late answer after the authority revocation',async()=>{
  const f=liveCancellationFixture({lateResult:true});
  const result=await f.orchestrator.execute(curriculumAuditRequest({course:f.course,sources:[f.source]}));
  assert.equal(result.cancelled,true);
  const done=f.marks.find(x=>x.status==='CANCELLED');
  assert.equal(done.metadata?.validationOutcome,'LATE_RESULT_DISCARDED');
  assert.ok(done.metadata?.safeMetadata?.late_result_discarded_at);
  assert.equal(done.metadata?.safeMetadata?.remote_abort_confirmation,'NOT_OBSERVABLE');
});

test('D08 REVIEW_READY plan revocation and Topic/Learning Unit descendant invalidation match real owner lifecycle',()=>{
  const base=fs.readFileSync(path.join(__dirname,'../../migrations/20261008_teaching_d05_durable_authority_revocations.sql'),'utf8');
  const patch=fs.readFileSync(path.join(__dirname,'../../migrations/20261008_teaching_d05_topic_dependency_revocation.sql'),'utf8');
  assert.match(base,/before_value->>'plan_state' IN \('REVIEW_READY','APPROVED','VALIDATED'\)/);
  assert.match(patch,/parent_state='REVIEW_READY'/);
  assert.match(patch,/AFTER UPDATE OR DELETE ON public\.teaching_topics/);
  assert.match(patch,/AFTER UPDATE OR DELETE ON public\.teaching_learning_units/);
  assert.doesNotMatch(patch,/AFTER INSERT(?: OR UPDATE)? ON public\.teaching_(?:topics|learning_units)/);
  assert.match(patch,/ON CONFLICT \(student_id,owner_kind,owner_ref,authority_version\) DO NOTHING/);
});

test('an edited Topic cancels only the prior Plan version for every descendant worker',async()=>{
  const db=memoryRevocations();
  const a=createAcademicAuthorityCancellationReader({query:db.query});
  const b=createAcademicAuthorityCancellationReader({query:db.query});
  const before=envelope();
  assert.equal((await a.read(before)).cancelled,false);
  db.committed.add('student1|COURSE_PLAN|plan1|5');
  const old=await b.read(before,{phase:'during_model'});
  assert.equal(old.cancelled,true);
  assert.equal(old.ownerKind,'COURSE_PLAN');
  const replacement=envelope();replacement.preconditions.course_plan_version='6';
  assert.equal((await a.read(replacement)).cancelled,false);
});
