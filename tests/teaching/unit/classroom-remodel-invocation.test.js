'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createTeachingPromptControlPlane}=require('../../../teaching/prompt-runtime');
const {createTeachingAIAdapter}=require('../../../teaching/orchestrator/ai-adapter');
const {createTeachingOrchestrator}=require('../../../teaching/orchestrator/teaching-orchestrator');
const {createOrchestratorPreflight}=require('../../../teaching/orchestrator/preflight');
const {createCentralAIExecutionBoundary}=require('../../../teaching/ai/central-orchestrator-boundary');
const {isValidatedModelResult}=require('../../../teaching/ai/output-validation');
const {createCandidateInvocationBinding}=require('../../../teaching/classroom-remodel/invocation-binding');
const {buildLegacyCoordinatorRequest,createLegacyCoordinatorExecutor}=require('../../../teaching/classroom-remodel/legacy-invocation');
const {getCapability}=require('../../../teaching/capability-registry');
const bindings=require('../../../teaching/classroom-remodel/migration-proposal.v1.json').bindings;
function harness(request,payload,{allow=true,stale=false}={}) {
 const promptControl=createTeachingPromptControlPlane();let calls=0,ownerCalls=0,content='';
 const aiBoundary=createCentralAIExecutionBoundary({aiRun:async(task,input)=>{calls++;content=input.content;return {text:JSON.stringify(payload),modelId:'FIXTURE_ONLY',provider:'FIXTURE_ONLY'};}});
 const aiAdapter=createTeachingAIAdapter({promptControl,aiBoundary,allowCandidateEvaluation:allow,assertRouteExecutable:()=>true,resolveCentralTaskId:()=> 'MAIN_CBT'});
 let read=0;const marks=[];
 const orchestrator=createTeachingOrchestrator({promptControl,aiAdapter,executionStore:{begin:async()=>({inserted:true}),mark:async(id,status)=>{marks.push(status);}},stateReader:async()=>({stateReference:{...request.stateReference,state_version:stale&&read++>0?'999':request.stateReference.state_version},preconditions:request.preconditions||{}}),contextAssembler:{assemble:async()=>({trustedAuthoritativeState:{},permissionConstraints:{},provenanceLinkedAcademicContent:[],untrustedContent:[]})},preflight:createOrchestratorPreflight(),ownerRouter:{commit:async()=>{ownerCalls++;}},randomUUID});
 return {orchestrator,calls:()=>calls,owners:()=>ownerCalls,content:()=>content,marks};
}
function coordinator(mode,payload){return {request_ref:'fixture',task_mode:mode,input_state_reference:null,status:'complete',review_required:false,artifacts:{legacy_consumer:{payload}},next_action:null,runtime_requests:[],issues:[]};}
function genericRequest(binding) {
 const validate=async x=>({ok:x?.value==='original',value:x});const outputSchema={id:'fixture.original',version:'1',validate,declared_fields:['value']};
 return {capabilityId:binding.capabilityId,declaredAuthorityLevel:binding.authorityCeiling,taskMode:'original_mode',trigger:{type:'workflow_continuation',ref:'fixture',source:'fixture',actor_id:'s1'},stateReference:{aggregate_type:'teaching_course',aggregate_id:'c1',state_version:'1'},preconditions:{},idempotencyKey:randomUUID(),correlationId:randomUUID(),resultContract:{output_schema_id:outputSchema.id,output_schema_version:'1',validator_ids:['schema','domain','provenance']},outputSchema,schemaValidator:validate,domainValidator:validate,provenanceValidator:validate,academicInput:{original:'retained'},directive:{bounded_actions:['provisional compatibility'],allowed_operations:['return candidate'],prohibited_operations:['mutate academic truth'],evidence_purpose:'fixture compatibility',downstream_handoff:{type:'validated_candidate',commit_owner_boundary:binding.owner,validator_ids:['schema','domain','provenance']}},commit:false};
}
test('all 22 legacy capabilities execute the central candidate path and preserve branded original contracts',async()=>{
 for(const binding of bindings){const request=genericRequest(binding),h=harness(request,coordinator(binding.modes[0],{value:'original'}));
  const result=await createLegacyCoordinatorExecutor({orchestrator:h.orchestrator}).execute(request);
  assert.equal(result.accepted,true,binding.capabilityId);assert.deepEqual(result.validatedResult.output,{value:'original'});assert.ok(isValidatedModelResult(result.validatedResult));assert.equal(h.calls(),1);assert.equal(h.owners(),0);assert.match(h.content(),/<KIWI_TEACHING_CANDIDATE_PROMPT>/);assert.match(h.content(),/"family_id":"TPF-21"/);assert.equal(getCapability(binding.capabilityId).prompt_family_id,binding.legacyFamilyId);
 }
});
test('candidate requests cannot authorize default adapters, JSON binding copies or owner mutation',async()=>{
 const original=genericRequest(bindings[0]),request=buildLegacyCoordinatorRequest(original),h=harness(original,{}, {allow:false});
 await assert.rejects(()=>h.orchestrator.execute(request),{code:'CLASSROOM_CANDIDATE_EVALUATION_DISABLED'});assert.equal(h.calls(),0);
 const evaluation=harness(original,{});await assert.rejects(()=>evaluation.orchestrator.execute({...request,candidatePromptBinding:{...request.candidatePromptBinding}}),{code:'CLASSROOM_CANDIDATE_BINDING_UNTRUSTED'});
 await assert.rejects(()=>evaluation.orchestrator.execute({...request,commit:true}),{code:'CLASSROOM_CANDIDATE_COMMIT_FORBIDDEN'});assert.equal(evaluation.owners(),0);
 assert.throws(()=>createCandidateInvocationBinding({capabilityId:bindings[0].capabilityId,familyId:'TPF-08',mode:'natural_teacher_instruction'}));
});
test('real D07 diagnostic request crosses D03/D05 and rejects stale or out-of-scope replacement output',async()=>{
 const request=require('../../../teaching/d07/intelligence').diagnosticRequest({course:{course_id:'c1',state_version:1,lifecycle_state:'ACTIVE'},requirement:{targets:['lu1']},audit:{curriculum_audit_id:'a1'}});
 const payload={purpose:'Verify',targets:['lu1'],opportunities:[{id:'o1'},{id:'o2'}],critical_criteria:[],non_graded:true};
 const h=harness(request,coordinator('design_check',payload));const result=await createLegacyCoordinatorExecutor({orchestrator:h.orchestrator}).execute(request);assert.equal(result.accepted,true);assert.deepEqual(result.validatedResult.output,payload);
 const wrong=harness(request,coordinator('design_check',{...payload,targets:['other']}));assert.equal((await createLegacyCoordinatorExecutor({orchestrator:wrong.orchestrator}).execute(request)).accepted,false);
 const stale=harness(request,coordinator('design_check',payload),{stale:true});assert.equal((await createLegacyCoordinatorExecutor({orchestrator:stale.orchestrator}).execute(request)).stale,true);
});
test('real D12 profile caller receives the same profile payload and original validators reject wrong LU',async()=>{
 const context={classRow:{class_id:'c1',student_id:'s1',course_lifecycle_state:'ACTIVE',course_state_version:1,schedule_version:1},session:{class_session_id:'session1',state_version:2},plan:{course_plan_id:'p1',version_no:1}};
 const request=require('../../../teaching/d12/intelligence').profileClassificationRequest({context,learningUnit:{learning_unit_id:'lu1',title:'Force',intended_competence:'Explain',exit_conditions:[],criticality:'CORE',foundational:true,metadata:{}},subjectTemplate:{}});
 const payload={status:'ok',review_required:false,review_reasons:[],profile:{learning_unit_ref:'lu1',knowledge_type:'mixed',primary_student_actions:['explain'],answer_space:'multiple_valid_approaches',representations:['text']},uncertainties:[]};
 const h=harness(request,coordinator('prepare_guidance',payload));const result=await createLegacyCoordinatorExecutor({orchestrator:h.orchestrator}).execute(request);assert.equal(result.accepted,true);assert.deepEqual(result.validatedResult.output,(await request.schemaValidator(payload)).value);
 payload.profile.learning_unit_ref='other';const wrong=harness(request,coordinator('prepare_guidance',payload));assert.equal((await createLegacyCoordinatorExecutor({orchestrator:wrong.orchestrator}).execute(request)).accepted,false);
});

test('provisional persistence runs before COMPLETED and a failed sink leaves no completed execution',async()=>{
 const original=genericRequest(bindings[0]),request=buildLegacyCoordinatorRequest(original),h=harness(original,coordinator(bindings[0].modes[0],{value:'original'}));let persisted=false;
 request.provisionalResultSink=async(result,execution)=>{assert.equal(result.output.status,'complete');assert.ok(execution.executionId);assert.equal(h.marks.includes('COMPLETED'),false);persisted=true;};
 assert.equal((await h.orchestrator.execute(request)).accepted,true);assert.equal(persisted,true);assert.equal(h.marks.at(-1),'COMPLETED');
 const failed=harness(original,coordinator(bindings[0].modes[0],{value:'original'}));request.provisionalResultSink=async()=>{throw Object.assign(new Error('fixture durable write failure'),{code:'FIXTURE_DB_UNAVAILABLE'});};
 await assert.rejects(()=>failed.orchestrator.execute(request),{code:'FIXTURE_DB_UNAVAILABLE'});assert.equal(failed.marks.includes('COMPLETED'),false);assert.equal(failed.marks.at(-1),'FAILED');
});
