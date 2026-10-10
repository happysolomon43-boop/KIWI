'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {integrationConfig}=require('./test-db');
const {skipReason:skip}=integrationConfig('Classroom closure and continuity');
const {harness}=require('../fixtures/classroom-presentation-database');
const {taskPolicy}=require('../fixtures/classroom-task-policy');
const tf=require('../fixtures/classroom-tasks');
const {open}=require('../fixtures/classroom-task-lifecycle');
const {hash}=require('../../../teaching/classroom-remodel/academic-artifacts');
test('D11 closes presentation and writes grounded closure facts in one transaction, with idempotent replay',{skip},()=>harness(async h=>{
  await h.accept();
  const first=await h.d11Repository.commitClosure({studentId:h.ids.studentId,classId:h.ids.classId,expectedVersion:1});
  assert.equal(first.session.lifecycle_state,'CLOSED');
  assert.equal(first.closureFact.fact_pack.classroom.published.length,0);
  assert.equal(first.closureFact.fact_pack.classroom.position.last_render_confirmed,0);
  assert.equal((await h.query('select delivery_state from public.teaching_classroom_delivery where session_id=$1',[h.sessionId])).rows[0].delivery_state,'COMPLETED');
  assert.equal((await h.query('select count(*)::int n from public.teaching_classroom_portions where session_id=$1 and status=\'PREPARED\'',[h.sessionId])).rows[0].n,0);
  const again=await h.d11Repository.commitClosure({studentId:h.ids.studentId,classId:h.ids.classId,expectedVersion:1});
  assert.equal(again.idempotent,true);
  assert.equal(again.closureFact.closure_fact_id,first.closureFact.closure_fact_id);
  const record=await h.continuity.latestRecord(h.ids.studentId,h.ids.classId);
  const replay=await h.continuity.latestRecord(h.ids.studentId,h.ids.classId);
  assert.equal(record.record_id,replay.record_id);
  await assert.rejects(()=>h.query('update public.teaching_classroom_reconciliation_versions set content_hash=$2 where record_id=$1',[record.record_id,'changed']));
}));
test('a failed D11 closure rolls back presentation changes and leaves no closure fact',{skip},()=>harness(async h=>{
  await h.accept();
  await assert.rejects(()=>h.withTransaction(async tx=>{
    await h.d11Repository.commitClosureUsing(tx,{studentId:h.ids.studentId,classId:h.ids.classId,expectedVersion:1});
    throw new Error('forced rollback');
  }),/forced rollback/);
  assert.equal((await h.query('select lifecycle_state from public.teaching_class_sessions where class_session_id=$1',[h.sessionId])).rows[0].lifecycle_state,'ACTIVE');
  assert.equal(await h.d11Repository.getClosureFact(h.ids.studentId,h.ids.classId),null);
  assert.equal((await h.query('select count(*)::int n from public.teaching_classroom_portions where session_id=$1 and status=\'PREPARED\'',[h.sessionId])).rows[0].n,1);
}));
test('history retrieval rejects foreign owners and active protected modes',{skip},()=>harness(async h=>{
  await assert.rejects(()=>h.continuity.history('foreign',h.ids.classId),{code:'CLASSROOM_HISTORY_NOT_OWNED'});
  await h.query("update public.teaching_class_sessions set instructional_substate='ASSESSMENT' where class_session_id=$1",[h.sessionId]);
  await assert.rejects(()=>h.continuity.history(h.ids.studentId,h.ids.classId),{code:'CLASSROOM_HISTORY_PROTECTED_ACTIVITY'});
  await assert.rejects(()=>h.continuity.exactRecord(h.ids.studentId,h.ids.classId,{sessionId:'foreign'}),{code:'CLASSROOM_HISTORY_PROTECTED_ACTIVITY'});
}));
test('accepted work survives closure and late evaluation creates a new immutable linked record',{skip},()=>harness(async h=>{
  const q=await open(h),accepted=await q.r.submit(h.ids.studentId,h.ids.classId,q.body);
  const closed=await h.d11Repository.commitClosure({studentId:h.ids.studentId,classId:h.ids.classId,expectedVersion:1});
  assert.deepEqual(closed.closureFact.fact_pack.classroom.pending_evaluations,[accepted.admission_id]);
  assert.deepEqual(closed.closureFact.fact_pack.classroom.confirmed_taught_learning_unit_refs,[h.ids.learningUnit]);
  const first=await h.continuity.latestRecord(h.ids.studentId,h.ids.classId);
  const claim=await q.r.claimEvaluation(h.ids.studentId,h.ids.classId,accepted.admission_id);
  const output=tf.interpretation(q.task,accepted.response_id);
  const interpreted=require('../../../teaching/classroom-remodel/task-contracts').interpretation(output,{task:q.task,exposure:claim.exposure,responseId:accepted.response_id,demand:claim.context.design.artifacts.checks[0].task_demand,stateReference:claim.context.design.input_state_reference});
  const receipt={accepted:true,ownerRef:'FIXTURE_EVALUATION_OWNER',admissionId:accepted.admission_id,contextHash:hash(claim.context),outputHash:hash(interpreted.evaluation),executionId:'FIXTURE_EXECUTION'};
  const result=await q.r.commitEvaluation(h.ids.studentId,h.ids.classId,claim,output,receipt);
  assert.equal(result.afterClosure,true);
  const latest=await h.continuity.latestRecord(h.ids.studentId,h.ids.classId);
  assert.equal(latest.version_no,first.version_no+1);
  assert.deepEqual(latest.record.pending_evaluations,[]);
  assert.equal(latest.record.evaluations[0].completed_after_closure,true);
  assert.equal(latest.record.evaluations[0].feedback_delivered_in_class,false);
  const nextClass=h.ids.classId+'-next';
  await h.query("insert into public.teaching_classes(class_id,student_id,course_id,scheduled_start_at,scheduled_end_at,timezone,source_timetable_version_id) values($1,$2,$3,clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour','UTC',$4)",[nextClass,h.ids.studentId,h.ids.course,h.ids.timetable]);
  const history=await h.continuity.history(h.ids.studentId,nextClass);
  assert.equal(history.records[0].record_ref,`classroom-record:${latest.record_id}@${latest.content_hash}`);
  assert.deepEqual(history.records[0].classroom.pending_evaluations,[]);
  assert.equal((await h.d11Repository.getClosureFact(h.ids.studentId,h.ids.classId)).closure_fact_id,closed.closureFact.closure_fact_id);
  await assert.rejects(()=>h.d11Repository.persistSummary({studentId:h.ids.studentId,classId:h.ids.classId,classSessionId:h.sessionId,closureFactId:closed.closureFact.closure_fact_id,state:'ROUTE_HELD',provenance:{classroom_record_hash:first.content_hash}}),{code:'CLASSROOM_CLOSURE_RESULT_STALE'});
},{policy:taskPolicy(),learningUnit:true}));

test('prior history exposes versioned summary and note publication metadata, never their private payloads',{skip},()=>harness(async h=>{
  await h.accept();
  const closed=await h.d11Repository.commitClosure({studentId:h.ids.studentId,classId:h.ids.classId,expectedVersion:1});
  const latest=await h.continuity.latestRecord(h.ids.studentId,h.ids.classId);
  const nextClass=h.ids.classId+'-artifact-history';
  await h.query("insert into public.teaching_classes(class_id,student_id,course_id,scheduled_start_at,scheduled_end_at,timezone,source_timetable_version_id) values($1,$2,$3,clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour','UTC',$4)",[nextClass,h.ids.studentId,h.ids.course,h.ids.timetable]);
  const pending=await h.continuity.history(h.ids.studentId,nextClass);
  assert.equal(pending.records[0].artifacts.summary.state,'NOT_AVAILABLE');
  assert.equal(pending.records[0].artifacts.study_notes.published,false);
  await h.d11Repository.persistSummary({studentId:h.ids.studentId,classId:h.ids.classId,classSessionId:h.sessionId,closureFactId:closed.closureFact.closure_fact_id,state:'TRANSLATED',payload:{private_translation_context:'DO_NOT_LEAK'},provenance:{classroom_record_hash:latest.content_hash,translation_only:true},idempotencyKey:'history-summary-accepted'});
  const good=await h.continuity.history(h.ids.studentId,nextClass);
  assert.equal(good.records[0].artifacts.summary.state,'TRANSLATED');
  assert.equal(good.records[0].artifacts.summary.available,true);
  assert.match(good.records[0].artifacts.summary.source_refs.join(','),/classroom-record:/);
  assert.equal(JSON.stringify(good).includes('DO_NOT_LEAK'),false);
  await h.query("insert into public.teaching_class_study_note_versions(note_version_id,student_id,class_id,version_no,state,stage,binding,note_payload,validation,closure_fact_id,idempotency_key) values($1,$2,$3,1,'VALIDATED_PRIVATE','POST_CLASS','{}'::jsonb,$4::jsonb,'{}'::jsonb,$5,$6)",[h.ids.classId+'-note',h.ids.studentId,h.ids.classId,JSON.stringify({private_note:'DO_NOT_LEAK_NOTES'}),closed.closureFact.closure_fact_id,'history-study-private']);
  const withNotes=await h.continuity.history(h.ids.studentId,nextClass);
  assert.equal(withNotes.records[0].artifacts.study_notes.state,'PRIVATE_AWAITING_D27');
  assert.equal(withNotes.records[0].artifacts.study_notes.published,false);
  assert.equal(JSON.stringify(withNotes).includes('DO_NOT_LEAK_NOTES'),false);
  // The older-summary conflict is tested with immutable historic rows in the
  // projector unit suite; PostgreSQL correctly rejects rewriting committed summaries.
}));

test('D16 atomic reviewed source check rejects stale, foreign and untaught classroom assignments',{skip},()=>harness(async h=>{
 const {assertClassroomSourceUsing}=require('../../../teaching/d16/classroom-source');
 await open(h);
 const closed=await h.d11Repository.commitClosure({studentId:h.ids.studentId,classId:h.ids.classId,expectedVersion:1});
 const record=await h.continuity.latestRecord(h.ids.studentId,h.ids.classId);
 const spec={studentId:h.ids.studentId,classId:h.ids.classId,courseId:h.ids.course,
  sourceLineage:{classroomRecordRef:'classroom-record:'+record.record_id+'@'+record.content_hash,
   classClosureRef:'class-closure:'+closed.closureFact.closure_fact_id,reviewedProposalHash:'a'.repeat(64)},
  learningUnitIds:record.record.confirmed_taught_learning_unit_refs};
 await assert.rejects(()=>h.withTransaction(tx=>assertClassroomSourceUsing(tx,{...spec,studentId:'foreign'})),{code:'TEACHING_D16_CLASSROOM_SOURCE_NOT_OWNED_OR_CLOSED'});
 await assert.rejects(()=>h.withTransaction(tx=>assertClassroomSourceUsing(tx,{...spec,sourceLineage:{...spec.sourceLineage,classroomRecordRef:'classroom-record:stale@'+record.content_hash}})),{code:'TEACHING_D16_CLASSROOM_SOURCE_STALE'});
 await assert.rejects(()=>h.withTransaction(tx=>assertClassroomSourceUsing(tx,{...spec,learningUnitIds:['not-taught']})),{code:'TEACHING_D16_CLASSROOM_SCOPE_NOT_CONFIRMED'});
 assert.equal((await h.withTransaction(tx=>assertClassroomSourceUsing(tx,{...spec}))).contentHash,record.content_hash);
},{learningUnit:true}));
