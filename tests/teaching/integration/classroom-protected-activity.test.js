'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {integrationConfig}=require('./test-db');const {skipReason:skip}=integrationConfig('Classroom protected owner handoff');
const {harness}=require('../fixtures/classroom-presentation-database');
test('D11 atomically pins exact D16 work; owner drafts survive retry and stale bindings hold',{skip},async()=>harness(async h=>{
 const d11=require('../../../teaching/repositories/d11-lesson-controller').createD11LessonControllerRepository({...h,randomUUID});
 const repository=require('../../../teaching/repositories/d16-assignments').createD16AssignmentRepository({...h,randomUUID});
 const service=require('../../../teaching/d16/service').createD16Service({repository,randomUUID});
 const {ids}=h;
 await h.query(`update public.teaching_class_sessions set source_course_state_version=(select state_version from public.teaching_courses where course_id=$2),source_class_schedule_version=1,source_timetable_version_id=$3,source_course_plan_version=1 where class_session_id=$1`,[h.sessionId,ids.course,ids.timetable]);
 const user={id:ids.studentId};
 const created=await service.createFromTrustedSpec({studentId:ids.studentId,classId:ids.classId,idempotencyKey:randomUUID(),spec:{courseId:ids.course,title:'Exact active Classwork',instructions:'Explain your reasoning.',purpose:'PRACTICE',workStake:'PREPARATION',lifecycleState:'OPEN',assistanceMode:'OPEN_LEARNING_ASSISTANCE',deadlineType:'SOFT',dueAt:new Date(Date.now()+3600000).toISOString(),estimatedEffortMinMinutes:1,estimatedEffortMaxMinutes:5}});
 const transition=reference=>h.withTransaction(tx=>d11.transitionUsing(tx,{studentId:ids.studentId,classId:ids.classId,expectedVersion:1,toState:'CLASSWORK',protectedActivity:reference}));
 await assert.rejects(transition(null),{code:'CLASSROOM_PROTECTED_ACTIVITY_REQUIRED'});
 assert.equal(Number((await d11.getSession(ids.studentId,ids.classId)).state_version),1);
 const ref={owner:'D16',id:created.assignmentId,version:1};await transition(ref);
 const binding=await d11.protectedActivity(ids.studentId,ids.classId);assert.equal(binding.id,created.assignmentId);
 const draftKey=randomUUID();await service.saveDraft(user,binding.id,{response:{text:'My durable reasoning'},idempotencyKey:draftKey});await service.saveDraft(user,binding.id,{response:{text:'My durable reasoning'},idempotencyKey:draftKey});
 const detail=await service.getAssignment(user,binding.id);assert.equal(detail.submission.response.text,'My durable reasoning');
 assert.equal((await h.query('select count(*)::int n from public.teaching_assignment_submissions where assignment_id=$1',[binding.id])).rows[0].n,1);
 await h.query('update public.teaching_assignments set state_version=state_version+1 where assignment_id=$1',[binding.id]);
 await assert.rejects(d11.protectedActivity(ids.studentId,ids.classId),{code:'CLASSROOM_PROTECTED_ACTIVITY_STALE'});
 await h.withTransaction(tx=>d11.transitionUsing(tx,{studentId:ids.studentId,classId:ids.classId,expectedVersion:2,toState:'INSTRUCTION'}));
 assert.equal((await d11.getSession(ids.studentId,ids.classId)).progress_state.active_protected_activity,undefined);
}));

test('protected interruption hides conversation and chapter and rejects Notebook writes under the native session lock',{skip},async()=>harness(async h=>{
 await h.accept();await h.query("update public.teaching_class_sessions set instructional_substate='INTERRUPTED',resume_instructional_substate='CLASSWORK',lifecycle_state='INTERRUPTED',state_version=state_version+1 where class_session_id=$1",[h.sessionId]);
 const snapshot=await h.read();assert.equal(snapshot.chapter_ref,null);assert.deepEqual(snapshot.conversation,[]);await assert.rejects(h.repository.read(h.ids.studentId,h.ids.classId),{code:'CLASSROOM_PROTECTED_ACTIVITY'});
 await assert.rejects(h.d14Repository.addNotebook({studentId:h.ids.studentId,classId:h.ids.classId,content:'Must not be accepted here',sourceKind:'PERSONAL',idempotencyKey:randomUUID()}),{code:'TEACHING_D14_NOTEBOOK_RESTRICTED'});assert.equal((await h.d14Repository.notebook(h.ids.studentId,h.ids.classId)).length,0);
}));

test('formal owner starts its locked fixture package and D18 returns a private-safe response workspace',{skip},async()=>harness(async h=>{
 const fixture=await require('../fixtures/classroom-protected-assessment').assessmentFixture(h);
 const repository=require('../../../teaching/repositories/d17-assessments').createD17AssessmentRepository({...h,randomUUID});
 const service=require('../../../teaching/d17/service').createD17Service({repository,randomUUID});
 const d18=require('../../../teaching/d18/service').createD18AssessmentShellService({repository});const user={id:h.ids.studentId};
 const input={packageId:fixture.packageId,deviceId:'native-fixture-device',idempotencyKey:randomUUID()};
 const first=await service.startAttempt(user,fixture.assessmentId,input),retry=await service.startAttempt(user,fixture.assessmentId,input);
 assert.equal(retry.attempt.assessment_attempt_id,first.attempt.assessment_attempt_id);assert.equal(new Date(retry.expiresAt).toISOString(),new Date(first.expiresAt).toISOString());
 const workspace=await d18.getAttemptWorkspace(user,first.attempt.assessment_attempt_id,{deviceId:input.deviceId});assert.equal(workspace.items.length,1);assert.equal(workspace.items[0].renderer.kind,'short');assert.equal(workspace.attempt.device_authority,'MATCH');assert.equal(JSON.stringify(workspace).includes('PRIVATE_FIXTURE'),false);
}));
