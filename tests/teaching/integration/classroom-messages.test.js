'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {integrationConfig}=require('./test-db');const {skipReason:skip}=integrationConfig('Classroom durable messages');
const {harness}=require('../fixtures/classroom-presentation-database');const {messagePolicy}=require('../fixtures/classroom-message-policy');const {setup,proposal}=require('../fixtures/classroom-messages');const f=require('../fixtures/classroom-remodel-academic');
const run=fn=>harness(fn,{policy:messagePolicy()});
test('atomic message retry persists one charge, queue, conversation and durable routing recovery event',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),input=body();const first=await r.admit(h.ids.studentId,h.ids.classId,input),again=await r.admit(h.ids.studentId,h.ids.classId,input);
 assert.equal(again.message_id,first.message_id);assert.equal(again.replay,true);assert.equal(first.remaining,1);
 for(const table of ['messages','allowance_charges','message_queue'])assert.equal((await h.query('select count(*)::int n from public.teaching_classroom_'+table+' where session_id=$1',[h.sessionId])).rows[0].n,1);
 assert.equal((await h.read()).conversation[0].id,first.message_id);assert.equal((await h.read()).messages.remaining,1);
 await assert.rejects(()=>r.admit(h.ids.studentId,h.ids.classId,{...input,content:'Changed content'}),{code:'CLASSROOM_MESSAGE_IDEMPOTENCY_CONFLICT'});
 const claim=await r.claim(h.ids.studentId,h.ids.classId,first.message_id);assert.ok(claim.token);assert.equal((await r.claim(h.ids.studentId,h.ids.classId,first.message_id)).held,true);
 assert.ok((await h.query("select event_id from teaching_runtime.due_events where payload->>'message_id'=$1",[first.message_id])).rows.length>=2);
}));
test('admission rollback never returns partial acceptance when outbox fails',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),emit=h.repository.emitUsing;h.repository.emitUsing=()=>{throw Error('outbox fault');};
 await assert.rejects(()=>r.admit(h.ids.studentId,h.ids.classId,body()),/outbox fault/);h.repository.emitUsing=emit;
 assert.equal((await h.query('select count(*)::int n from public.teaching_classroom_messages where session_id=$1',[h.sessionId])).rows[0].n,0);assert.equal((await h.read()).cursor,0);
}));
test('allowance exhaustion preserves free requested clarification and bounded support controls',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h);const a=await r.admit(h.ids.studentId,h.ids.classId,body());await r.admit(h.ids.studentId,h.ids.classId,body('Second question'));await assert.rejects(()=>r.admit(h.ids.studentId,h.ids.classId,body('Third question')),{code:'CLASSROOM_MESSAGE_ALLOWANCE_EXHAUSTED'});
 await assert.rejects(()=>r.admit(h.ids.studentId,h.ids.classId,body('Fake free reply',{intent:'clarification',replyTo:a.message_id})),{code:'CLASSROOM_MESSAGE_CLARIFICATION_NOT_REQUESTED'});
 // Simulates the confirmed owner clarification outcome, not a student-selected lane.
 await h.query("update public.teaching_classroom_message_queue set state='needing clarification',clarification_open=true where message_id=$1",[a.message_id]);
 const clarification=await r.admit(h.ids.studentId,h.ids.classId,body('The second condition',{intent:'clarification',replyTo:a.message_id}));assert.equal(clarification.charged,false);assert.equal(clarification.remaining,0);
 await assert.rejects(()=>r.admit(h.ids.studentId,h.ids.classId,body('Another free clarification',{intent:'clarification',replyTo:a.message_id})),{code:'CLASSROOM_MESSAGE_CLARIFICATION_NOT_REQUESTED'});
 const technical=await r.admit(h.ids.studentId,h.ids.classId,body('Audio unavailable',{intent:'technical_report'}));assert.equal(technical.charged,false);assert.equal((await r.claim(h.ids.studentId,h.ids.classId,technical.message_id)).held,true);
 const correction=await r.admit(h.ids.studentId,h.ids.classId,body('Suspected source contradiction',{intent:'correction_report'}));assert.equal(correction.charged,false);assert.ok((await h.repository.withAuthority(h.ids.studentId,h.ids.classId,(tx,a,d)=>r.boundaryUsing(tx,a,d))).held);
}));
test('routing failure stays visible without refund, loss or a second charge; stale worker is fenced',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),a=await r.admit(h.ids.studentId,h.ids.classId,body());const claim=await r.claim(h.ids.studentId,h.ids.classId,a.message_id);await r.failed(h.ids.studentId,h.ids.classId,claim,'CLASSROOM_MESSAGE_ROUTING_TIMEOUT');
 assert.equal((await h.read()).messages.questions[0].state,'waiting');assert.equal((await h.read()).messages.remaining,1);
 await assert.rejects(()=>r.acceptDisposition(h.ids.studentId,h.ids.classId,claim,proposal(a.message_id)),{code:'CLASSROOM_MESSAGE_LEASE_STALE'});
}));
test('suitable boundary answers interleave and resume prepared lesson; answer is confirmed only after render',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),opening=f.opening();opening.interaction.portions[0].boundary='suitable_teaching_pause';opening.interaction.portions.push({...f.clone(opening.interaction.portions[0]),id:'later',sequence:2,teacher_message:'Now continue the unfinished reasoning.'});await h.accept(opening);
 const lease=await h.repository.command(h.ids.studentId,h.ids.classId,h.args(await h.read(),{intent:'claim'}));const first=await h.repository.release(h.ids.studentId,h.ids.classId);assert.equal(first.released,true);
 const accepted=await r.admit(h.ids.studentId,h.ids.classId,body()),claim=await r.claim(h.ids.studentId,h.ids.classId,accepted.message_id);assert.equal((await r.acceptDisposition(h.ids.studentId,h.ids.classId,claim,proposal(accepted.message_id))).accepted,true);
 await h.repository.receipt(h.ids.studentId,h.ids.classId,h.args(await h.read(),{portionId:first.portionId,leaseToken:lease.leaseToken,renderState:'accessible_ready',active:true,representationReady:true,readyAssetIds:[]}));assert.equal((await h.repository.release(h.ids.studentId,h.ids.classId)).released,false);
 const q=await r.readyQuestion(h.ids.studentId,h.ids.classId);assert.equal(q.message_id,accepted.message_id);
 const reply=f.opening();reply.interaction.portions[0].teacher_message='The condition applies because the relationship depends on it. Returning to the same reasoning…';
 await h.repository.acceptSequence({studentId:h.ids.studentId,classId:h.ids.classId,operationKey:'answer',output:reply,directive:f.directive(),expected:await h.repository.capture(h.ids.studentId,h.ids.classId),types:['text'],messageRefs:[accepted.message_id]});
 await h.query('select pg_sleep(0.02)');const answer=await h.repository.release(h.ids.studentId,h.ids.classId);assert.equal(answer.released,true);assert.equal((await h.read()).messages.questions[0].state,'ready');assert.ok((await h.read()).conversation.at(-1).source_refs.some(ref=>ref.id===accepted.message_id));
 await h.repository.receipt(h.ids.studentId,h.ids.classId,h.args(await h.read(),{portionId:answer.portionId,leaseToken:lease.leaseToken,renderState:'accessible_ready',active:true,representationReady:true,readyAssetIds:[]}));assert.equal((await h.read()).messages.questions[0].state,'answered');await h.query('select pg_sleep(0.02)');const continuation=await h.repository.release(h.ids.studentId,h.ids.classId);assert.equal(continuation.released,true);assert.equal((await h.read()).conversation.at(-1).text,'Now continue the unfinished reasoning.');
}));
test('closure retains unresolved questions and protected reads reveal no question content',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h);await r.admit(h.ids.studentId,h.ids.classId,body());await h.query("update public.teaching_class_sessions set instructional_substate='ASSESSMENT',state_version=state_version+1 where class_session_id=$1",[h.sessionId]);const protectedSnapshot=await h.read();assert.deepEqual(protectedSnapshot.messages.questions,[]);assert.equal(protectedSnapshot.messages.enabled,false);await assert.rejects(()=>r.admit(h.ids.studentId,h.ids.classId,body()),{code:'CLASSROOM_MESSAGE_ADMISSION_RESTRICTED'});
 await h.query("update public.teaching_class_sessions set instructional_substate='INSTRUCTION',lifecycle_state='CLOSED',state_version=state_version+1 where class_session_id=$1",[h.sessionId]);const closed=await h.read();assert.equal(closed.messages.questions[0].state,'unresolved at closure');assert.equal(closed.messages.remaining,1);
}));
test('two clients cannot double-charge one operation or exceed the shared allowance',{skip},async()=>harness(async h=>{
 const {repository:r,body}=setup(h),input=body();const both=await Promise.all([r.admit(h.ids.studentId,h.ids.classId,input),r.admit(h.ids.studentId,h.ids.classId,input)]);assert.equal(both[0].message_id,both[1].message_id);
 const rest=await Promise.allSettled([r.admit(h.ids.studentId,h.ids.classId,body('A')),r.admit(h.ids.studentId,h.ids.classId,body('B'))]);assert.equal(rest.filter(x=>x.status==='fulfilled').length,1);assert.equal((await h.read()).messages.remaining,0);
},{policy:messagePolicy(),concurrent:true}));
