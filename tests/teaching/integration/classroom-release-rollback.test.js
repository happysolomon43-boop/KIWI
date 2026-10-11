'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {integrationConfig}=require('./test-db');const {skipReason:skip}=integrationConfig('Classroom coordinated rollback');
const {harness}=require('../fixtures/classroom-presentation-database');
const {taskPolicy}=require('../fixtures/classroom-task-policy');
const {open}=require('../fixtures/classroom-task-lifecycle');
const {createClassroomReleaseControl}=require('../../../teaching/classroom-remodel/release-control');
const {hash}=require('../../../teaching/classroom-remodel/academic-artifacts');
const run=(fn,options={})=>{const policy=taskPolicy();policy.fields.taskDurations.value={short_text:60000};return harness(fn,{policy,learningUnit:true,releasePin:'a'.repeat(64),...options});};
test('durable rollback holds an open response and pending question; restart and restoration never reset or downgrade state',{skip},()=>run(async h=>{
 const q=await open(h),messages=require('../fixtures/classroom-messages').setup(h),message=await messages.repository.admit(h.ids.studentId,h.ids.classId,messages.body('A question still awaiting reply'));
 const before=await h.read(),pin='a'.repeat(64);
 const control=createClassroomReleaseControl({withTransaction:h.withTransaction});h.repository.connectReleaseControl(control);
 const op={operationKey:randomUUID(),expectedRevision:1,state:'ROLLBACK',reasonRef:'FIXTURE_ONLY_ROLLBACK',supportedManifestHashes:[]};const applied=await control.transition(op);assert.equal(applied.newAdmissionEnabled,false);assert.equal((await control.transition(op)).replay,true);
 await assert.rejects(()=>control.transition({...op,operationKey:randomUUID()}),{code:'CLASSROOM_RELEASE_REVISION_CONFLICT'});
 const held=await h.read();assert.equal(held.delivery_state,'RECOVERING');assert.equal(held.dependency_hold.reason,'CLASSROOM_RELEASE_COMPATIBILITY_HOLD');assert.equal(held.active_task.window.deadline_at,before.active_task.window.deadline_at);assert.equal(held.active_task.window.state,'OPEN');assert.equal(held.messages.remaining,before.messages.remaining);assert.ok(held.messages.questions.some(x=>x.id===message.message_id));assert.equal(held.cursor,before.cursor);assert.equal((await h.repository.release(h.ids.studentId,h.ids.classId)).released,false);
 await assert.rejects(()=>q.r.submit(h.ids.studentId,h.ids.classId,q.body),{code:'CLASSROOM_TASK_RESPONSE_RESTRICTED'});
 const newProcessControl=createClassroomReleaseControl({withTransaction:h.withTransaction});h.repository.connectReleaseControl(newProcessControl);assert.equal((await h.read()).active_task.window.deadline_at,q.window.deadline_at);
 // Fixture-only adoption emulates a previously accepted manifest for restoring
 // support. It is never production qualification or a public mutation route.
 await h.query('update public.teaching_classroom_release_control set supported_manifest_hashes=$1::jsonb,manifest_hash=$2 where singleton=true',[JSON.stringify([pin]),pin]);
 await newProcessControl.transition({operationKey:randomUUID(),expectedRevision:applied.revision,state:'ROLLBACK',reasonRef:'FIXTURE_COMPATIBLE_ENGINE',supportedManifestHashes:[pin]});
 const resumed=await h.read();assert.equal(resumed.delivery_state,before.delivery_state);assert.equal(resumed.active_task.window.deadline_at,q.window.deadline_at);assert.equal(resumed.messages.remaining,before.messages.remaining);assert.equal((await q.r.submit(h.ids.studentId,h.ids.classId,q.body)).charged,false);
 const session=(await h.query('select classroom_engine,lifecycle_state from public.teaching_class_sessions where class_session_id=$1',[h.sessionId])).rows[0];assert.equal(session.classroom_engine,'CLASSROOM_V1');assert.equal(session.lifecycle_state,'ACTIVE');
}));
test('release controls reject fixture-only activation and arbitrary compatibility; stopped new admission remains legacy',{skip},()=>run(async h=>{
 const control=createClassroomReleaseControl({withTransaction:h.withTransaction});
 await assert.rejects(()=>control.transition({operationKey:randomUUID(),expectedRevision:1,state:'COHORT',reasonRef:'FIXTURE_ONLY',cohortStudentIds:[h.ids.studentId],manifest:{},policy:taskPolicy()}),{code:'CLASSROOM_RELEASE_ACCEPTANCE_HELD'});
 await assert.rejects(()=>control.transition({operationKey:randomUUID(),expectedRevision:1,state:'ROLLBACK',reasonRef:'FIXTURE_ONLY',supportedManifestHashes:[hash('unadopted')]}),{code:'CLASSROOM_RELEASE_UNADOPTED_COMPATIBILITY'});
 const admission=await h.withTransaction(tx=>control.admissionUsing(tx,{studentId:h.ids.studentId,classId:h.ids.classId,blueprintId:h.ids.blueprint}));assert.equal(admission.engine,'LEGACY');
 assert.equal((await h.query('select count(*)::int n from public.teaching_classroom_release_operations')).rows[0].n,0);
}));
test('a supported manifest cannot bypass worker version skew or publish preserved private buffers',{skip},()=>run(async h=>{
 await h.accept();const pin='a'.repeat(64);
 const current=require('../../../teaching/repositories/classroom-presentation').createClassroomPresentationRepository({query:h.query,withTransaction:h.withTransaction,randomUUID,d14Repository:h.d14Repository,dueEventStore:h.dueEventStore,outboxStore:h.outboxStore,releaseControl:createClassroomReleaseControl({withTransaction:h.withTransaction})});
 await h.query('update public.teaching_classroom_release_control set supported_manifest_hashes=$1::jsonb where singleton=true',[JSON.stringify([pin])]);
 h.repository.connectReleaseControl(createClassroomReleaseControl({withTransaction:h.withTransaction}));
 const preparedBefore=(await h.query("select count(*)::int n from public.teaching_classroom_portions where session_id=$1 and status='PREPARED'",[h.sessionId])).rows[0].n;assert.ok(preparedBefore>0);
 const snapshot=await current.read(h.ids.studentId,h.ids.classId,{snapshot:true});assert.equal(snapshot.delivery_state,'RECOVERING');assert.equal(snapshot.dependency_hold.reason,'CLASSROOM_RELEASE_COMPATIBILITY_HOLD');assert.equal((await current.release(h.ids.studentId,h.ids.classId)).released,false);
 assert.equal((await h.query("select count(*)::int n from public.teaching_classroom_portions where session_id=$1 and status='PREPARED'",[h.sessionId])).rows[0].n,preparedBefore);
 assert.equal((await h.query("select count(*)::int n from public.teaching_classroom_portions where session_id=$1 and status='PUBLISHED'",[h.sessionId])).rows[0].n,0);
},{engineVersion:'previous-worker'}));
test('rollback reaching the original task deadline records a system hold without inventing a learner response',{skip},()=>run(async h=>{
 const q=await open(h);
 h.repository.connectReleaseControl(createClassroomReleaseControl({withTransaction:h.withTransaction}));await h.read();
 // Advance the persisted fixture deadline, avoiding wall-clock waits in CI.
 await h.query("update public.teaching_classroom_task_windows set opened_at=clock_timestamp()-interval '2 seconds',deadline_at=clock_timestamp()-interval '1 second' where window_id=$1",[q.window.id]);
 await h.repository.reconcile(h.ids.studentId,h.ids.classId);
 const row=(await h.query('select state,system_reason,handling_complete from public.teaching_classroom_task_windows where window_id=$1',[q.window.id])).rows[0];
 assert.equal(row.state,'EXPIRED_NO_RESPONSE');assert.equal(row.system_reason,'SYSTEM_RELEASE_HOLD_AT_DEADLINE');assert.equal(row.handling_complete,true);
 assert.equal((await h.read()).delivery_state,'RECOVERING');
 assert.equal((await h.query('select count(*)::int n from public.teaching_classroom_task_admissions where session_id=$1',[h.sessionId])).rows[0].n,0);
}));

test('D11 creates the engine and release pin in its first insert; retry cannot duplicate the session or change its release',{skip},()=>run(async h=>{
 const session=(await h.query('select classroom_engine,classroom_release_manifest_hash from public.teaching_class_sessions where class_session_id=$1',[h.sessionId])).rows[0];assert.equal(session.classroom_engine,'CLASSROOM_V1');assert.equal(session.classroom_release_manifest_hash,'a'.repeat(64));
 const retry=await h.withTransaction(tx=>h.d11Repository.ensureControllerStartedUsing(tx,{studentId:h.ids.studentId,classId:h.ids.classId,expectedBlueprintId:h.ids.blueprint}));assert.equal(retry.inserted,false);assert.equal(retry.session.class_session_id,h.sessionId);
 await assert.rejects(()=>h.withTransaction(tx=>tx.query('update public.teaching_class_sessions set classroom_release_manifest_hash=$2 where class_session_id=$1',[h.sessionId,'b'.repeat(64)])),/CLASSROOM_RELEASE_PIN_IMMUTABLE/);
 assert.equal((await h.query('select count(*)::int n from public.teaching_class_sessions where class_id=$1',[h.ids.classId])).rows[0].n,1);
},{startThroughD11:true}));
