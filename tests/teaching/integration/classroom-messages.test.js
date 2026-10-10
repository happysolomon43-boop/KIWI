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
 await h.repository.acceptSequence({studentId:h.ids.studentId,classId:h.ids.classId,operationKey:'answer',output:reply,directive:f.directive(),expected:await h.repository.capture(h.ids.studentId,h.ids.classId),types:['text'],messageRefs:[accepted.message_id],messageToken:q.lease_token});
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

test('unit scheduling, grouped lineage and rejected cross-session proposal remain durable and auditable',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),one=await r.admit(h.ids.studentId,h.ids.classId,body()),two=await r.admit(h.ids.studentId,h.ids.classId,body('A related concern'));
 const first=await r.claim(h.ids.studentId,h.ids.classId,one.message_id);assert.equal((await r.acceptDisposition(h.ids.studentId,h.ids.classId,first,proposal(one.message_id,{kind:'unit',anchor:'U01'}))).accepted,true);
 const second=await r.claim(h.ids.studentId,h.ids.classId,two.message_id);assert.equal((await r.acceptDisposition(h.ids.studentId,h.ids.classId,second,proposal(two.message_id,{disposition:'combine with related questions',group:[one.message_id]}))).accepted,true);
 assert.equal((await h.query('select group_id from public.teaching_classroom_message_queue where message_id=$1',[two.message_id])).rows[0].group_id,one.message_id);assert.equal((await h.read()).messages.questions.length,2);
 await assert.rejects(()=>r.admit('another-student',h.ids.classId,body()),{code:'CLASSROOM_SESSION_NOT_FOUND'});
}));
test('invalid group proposal is retained as rejected; unclear concern is not erased',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),one=await r.admit(h.ids.studentId,h.ids.classId,body());const claim=await r.claim(h.ids.studentId,h.ids.classId,one.message_id);const result=await r.acceptDisposition(h.ids.studentId,h.ids.classId,claim,proposal(one.message_id,{group:['foreign-message']}));assert.equal(result.accepted,false);assert.equal(result.reason,'CLASSROOM_MESSAGE_GROUP_INVALID');const audit=(await h.query('select accepted,reason from public.teaching_classroom_message_proposals where message_id=$1',[one.message_id])).rows[0];assert.equal(audit.accepted,false);assert.equal((await h.read()).messages.remaining,1);
}));
test('service routes one immediate concern through Presenter and creates no unsupported response task',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),one=await r.admit(h.ids.studentId,h.ids.classId,body());let routed=0,presented=0;
 const presentation=require('../../../teaching/classroom-remodel/presentation-service').createClassroomPresentationService({repository:h.repository,presenter:{generate:async args=>{presented++;assert.deepEqual(args.messageRefs,[one.message_id]);return f.opening();}}});
 const service=require('../../../teaching/classroom-remodel/message-service').createClassroomMessageService({repository:r,presentationRepository:h.repository,presentationService:presentation,coordinator:{route:async args=>{routed++;return proposal(args.messageId,{timing:'immediately'});}},directiveReader:async()=>f.directive()});
 const outcome=await service.process({studentId:h.ids.studentId,classId:h.ids.classId,messageId:one.message_id});assert.equal(outcome.accepted,true);assert.equal(routed,1);assert.equal(presented,1);assert.equal((await h.read()).active_task,null);assert.equal((await h.read()).messages.questions[0].state,'ready');assert.equal((await h.query('select count(*)::int n from public.teaching_classroom_allowance_charges where session_id=$1',[h.sessionId])).rows[0].n,1);
}));
test('bounded failed routing preserves unresolved work after retry budget rather than cancelling it',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),one=await r.admit(h.ids.studentId,h.ids.classId,body());const service=require('../../../teaching/classroom-remodel/message-service').createClassroomMessageService({repository:r,presentationRepository:h.repository,coordinator:{route:async()=>{throw Error('provider unavailable');}}});
 await service.process({studentId:h.ids.studentId,classId:h.ids.classId,messageId:one.message_id});await h.query('select pg_sleep(0.02)');await service.process({studentId:h.ids.studentId,classId:h.ids.classId,messageId:one.message_id});const row=(await h.query('select processing_state,state from public.teaching_classroom_message_queue where message_id=$1',[one.message_id])).rows[0];assert.equal(row.processing_state,'HELD');assert.equal(row.state,'waiting');assert.equal((await h.read()).messages.remaining,1);
}));
test('actual D03/D05 candidate coordinator boundary validates and persists native routing without active owner writes',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h),one=await r.admit(h.ids.studentId,h.ids.classId,body());const claim=await r.claim(h.ids.studentId,h.ids.classId,one.message_id);let ownerWrites=0,providerCalls=0;
 const d11=require('../../../teaching/repositories/d11-lesson-controller').createD11LessonControllerRepository({...h,randomUUID});
 const orchestrator={execute:async request=>{
  const promptControl=require('../../../teaching/prompt-runtime').createTeachingPromptControlPlane();
  const aiBoundary=require('../../../teaching/ai/central-orchestrator-boundary').createCentralAIExecutionBoundary({aiRun:async()=>{providerCalls++;return {text:JSON.stringify(proposal(one.message_id)),modelId:'FIXTURE_ONLY',provider:'FIXTURE_ONLY'};}});
  const aiAdapter=require('../../../teaching/orchestrator/ai-adapter').createTeachingAIAdapter({promptControl,aiBoundary,allowCandidateEvaluation:true,assertRouteExecutable:()=>true,resolveCentralTaskId:()=> 'MAIN_CBT'});
  const actual=require('../../../teaching/orchestrator/teaching-orchestrator').createTeachingOrchestrator({promptControl,aiAdapter,executionStore:{begin:async()=>({inserted:true}),mark:async()=>{}},stateReader:async()=>({stateReference:request.stateReference,preconditions:request.preconditions}),contextAssembler:{assemble:async()=>({trustedAuthoritativeState:{},permissionConstraints:{},provenanceLinkedAcademicContent:[],untrustedContent:[]})},preflight:require('../../../teaching/orchestrator/preflight').createOrchestratorPreflight(),ownerRouter:{commit:async()=>{ownerWrites++;}},randomUUID});
  return actual.execute(request);
 }};
 const intelligence=require('../../../teaching/classroom-remodel/message-intelligence').createClassroomMessageIntelligence({orchestrator,repository:r,d11Repository:d11,requirementsReader:async()=>({version:'FIXTURE_ONLY',adoptionRef:'FIXTURE_NOT_PRODUCTION',numericPolicy:claim.policy})});
 await intelligence.route({...claim,signal:new AbortController().signal});assert.equal(providerCalls,1);assert.equal(ownerWrites,0);const q=(await h.query('select accepted_proposal,commitment_kind from public.teaching_classroom_message_queue where message_id=$1',[one.message_id])).rows[0];assert.equal(q.commitment_kind,'boundary');assert.equal(q.accepted_proposal.task_mode,'handle_message');assert.equal((await h.read()).messages.remaining,1);
}));
test('remodeled legacy Help cannot create a parallel queue; existing technical signal remains available at exhaustion',{skip},async()=>run(async h=>{
 const {repository:r,body}=setup(h);await r.admit(h.ids.studentId,h.ids.classId,body());await r.admit(h.ids.studentId,h.ids.classId,body('Second'));const session=(await h.query('select * from public.teaching_class_sessions where class_session_id=$1',[h.sessionId])).rows[0];
 await assert.rejects(()=>h.d14Repository.recordInteraction({studentId:h.ids.studentId,classId:h.ids.classId,session,kind:'NEED_HELP',body:'Use the single teacher thread',idempotencyKey:randomUUID()}),{code:'CLASSROOM_USE_PERSISTENT_COMPOSER'});
 const report=await h.d14Repository.recordInteraction({studentId:h.ids.studentId,classId:h.ids.classId,session,kind:'TECHNICAL_ISSUE',body:null,idempotencyKey:randomUUID()});assert.equal(report.interaction_kind,'TECHNICAL_ISSUE');assert.equal((await h.read()).messages.remaining,0);
}));
