'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const f=require('../fixtures/classroom-remodel-academic');
const {createClassroomPreparationIntelligence}=require('../../../teaching/classroom-remodel/preparation-intelligence');
const {createClassroomIndependentReviewService}=require('../../../teaching/classroom-remodel/independent-review');
const context={classRow:{class_id:'c1',student_id:'s1',course_id:'course1',course_lifecycle_state:'ACTIVE',schedule_version:1,scheduled_start_at:new Date('2026-10-10T10:00:00Z'),scheduled_end_at:new Date('2026-10-10T10:12:00Z')},plan:{course_plan_id:'cp1',version_no:1},learningUnits:[{learning_unit_id:'lu1',title:'Force'}],learningUnitDependencies:[],planPrerequisites:[]};
const requirements={scope:{version:'FIXTURE_ONLY'},sourceMaterial:[{sourceRef:'source1',version:'1'}],numericPolicy:{version:'FIXTURE_ONLY'},dependencies:[],depth:{requiredUnits:['U01']},supportedBoardOperations:[]};
function author(){return {task_mode:'pre_class_lesson_blueprint',input_state_reference:'fixture',status:'ok',review_required:false,review_reasons:[],completion:{chapter:'complete',unit_map:'complete',teaching_plan:'complete',controller_blueprint:'complete'},provenance:{},artifacts:{chapter:f.chapter(),unit_map:[f.ref('U01','chapter_unit')],teaching_plan:f.plan(),controller_blueprint:{status:'OK',review_required:false,review_reasons:[],objectives:[{id:'o1',learning_unit_ref:'lu1',label:'Explain force',criticality:'CORE',minimum_safe_minutes:1,prerequisite_refs:[],evidence_descriptor_targets:[]}],segments:[{id:'seg1',kind:'INSTRUCTION',objective_refs:['o1'],planned_minutes:10,minimum_safe_minutes:1,criticality:'CORE',optional:false,learning_evidence_descriptor:null,assistance_level:'NONE'}],adaptive_reserve_minutes:2,stopping_conditions:[],prerequisite_checks:[],likely_misconceptions:[],examples:[],guided_work:[],independent_evidence_opportunities:[],remediation_branches:[],homework_candidates:[],unresolved_items:[]}},handoff:[]};}
test('preparation intelligence validates all three roles, commits generation before completion and recovers durable output',async()=>{
 const outputs={author:author(),coordinator:{request_ref:'fixture',task_mode:'prepare_guidance',input_state_reference:'fixture',status:'complete',review_required:false,artifacts:{explanation_guides:f.guide()},next_action:null,runtime_requests:[],issues:[]},presenter:f.opening()};
 const stored=new Map();let calls=0;const requests=[];
 const repository={loadOperation:async(s,c,k,key)=>stored.get(key)||null,saveCandidate:async input=>{assert.equal(input.kind,'generation');assert.ok(input.generationContext.executionId);const result={payload:input.payload,validity_state:'CURRENT',generation_context:input.generationContext};stored.set(input.operationKey,result);return result;}};
 const orchestrator={execute:async request=>{calls++;requests.push(request);const role=request.outputSchema.format_contract.role,checked=await request.schemaValidator(outputs[role]);assert.equal(checked.ok,true,checked.reason);const validated={output:checked.value};await request.provisionalResultSink(validated,{executionId:'FIXTURE_EXECUTION',modelMetadata:{routeKey:'FIXTURE_ROUTE',modelIdentifier:'FIXTURE_MODEL'}});return {accepted:true,validatedResult:validated};}};
 const intelligence=createClassroomPreparationIntelligence({orchestrator,repository,d11Repository:{ensurePreparationWorkspace:async()=>({workspace:{workspace_id:'w1',current_authoritative_input_bundle_ref:'b1'}})}});
 const args={context,requirements,operationKey:'op:author',producer:f.producer('chapter')};
 assert.deepEqual(await intelligence.author(args),outputs.author);assert.deepEqual(await intelligence.author(args),outputs.author);assert.equal(calls,1);
 await intelligence.coordinator({...args,operationKey:'op:guidance',producer:f.producer('guide'),chapter:f.chapter(),plan:f.plan()});
 await intelligence.presenter({...args,operationKey:'op:presenter',producer:f.producer('opening'),chapter:f.chapter(),guide:f.guide(),directive:f.directive()});
 const originalSource=outputs.author.artifacts.chapter.units[0].elements[0].source_refs;outputs.author.artifacts.chapter.units[0].elements[0].source_refs=['forged-source@9'];await assert.rejects(()=>intelligence.author({...args,operationKey:'forged-source'}));assert.equal(stored.has('forged-source'),false);outputs.author.artifacts.chapter.units[0].elements[0].source_refs=originalSource;
 assert.equal(calls,4);for(const r of requests){assert.equal(r.commit,false);assert.equal(r.candidatePromptBinding.runtimeAuthorized,false);assert.equal(r.academicInput.legacy_controller_output_contract.placement,'artifacts.controller_blueprint');}
 await assert.rejects(()=>intelligence.author({...args,requirements:{...requirements,scope:{version:'changed'}}}),{code:'CLASSROOM_GENERATION_OPERATION_STALE'});
 const broken=createClassroomPreparationIntelligence({orchestrator:{execute:async request=>{const bad=author();delete bad.artifacts.controller_blueprint;delete bad.completion.controller_blueprint;const result=await request.schemaValidator(bad);assert.equal(result.ok,false);return {accepted:false,rejectionReason:result.reason};}}});
 await assert.rejects(()=>broken.author(args),{code:'CLASSROOM_CONTROLLER_BLUEPRINT_REQUIRED'});
});
test('independent review rejects missing provenance, same-route review and fixture qualification before provider dispatch',async()=>{
 let calls=0;const base={run:async()=>{calls++;},router:{resolveCandidates:()=>[]}};
 const args={baseOrchestrator:base,reviewerRouteKey:'review-route',qualificationReader:async()=>({status:'QUALIFIED',evidenceKind:'FIXTURE_ONLY',evidenceId:'fixture'}),caseSpecReader:async()=>({id:'fixture',expected:{},inputFixture:{}}),candidateProvenanceReader:async()=>({routeKey:'author-route',modelIdentifier:'fixture',executionId:'e1'}),randomUUID};
 const input={artifact:{payload:{},content_sha256:'fixture'},context:{},workflow:{}};
 await assert.rejects(()=>createClassroomIndependentReviewService(args).reviewArtifact(input),{code:'CLASSROOM_REVIEW_ROUTE_NOT_QUALIFIED'});
 await assert.rejects(()=>createClassroomIndependentReviewService({...args,candidateProvenanceReader:async()=>({routeKey:'review-route',modelIdentifier:'fixture',executionId:'e1'})}).reviewArtifact(input),{code:'CLASSROOM_REVIEW_INDEPENDENCE_COLLAPSED'});
 await assert.rejects(()=>createClassroomIndependentReviewService({...args,candidateProvenanceReader:async()=>null}).reviewArtifact(input),{code:'CLASSROOM_GENERATION_PROVENANCE_MISSING'});assert.equal(calls,0);
});

test('real D11 owner requires independent review, current authority and retained Blueprint validation before commit',async()=>{
 const {createD11Service}=require('../../../teaching/d11/service');let commits=0;const current=f.clone(context);current.classRow.course_state_version=1;current.classRow.lifecycle_state='SCHEDULED';current.classRow.source_timetable_version_id='tt1';let saved=null;
 const repository={getClassContext:async()=>({...current,blueprint:saved}),commitClassroomBlueprint:async input=>{commits++;saved={lesson_blueprint_id:'FIXTURE_BLUEPRINT',validation_metadata:input.validationMetadata};return {blueprint:saved};}};
 const service=createD11Service({repository,withTransaction:async fn=>fn({}),dueEventStore:{enqueueUsing(){}},outboxStore:{appendUsing(){}},preparationRepository:{}});
 const input={context:current,chapter:{artifact_version_id:'chapter1'},plan:{artifact_version_id:'plan1'},authorOutput:author(),requirements,review:{accepted:true,independent:true,routeQualified:true,contentHashes:['FIXTURE_CHAPTER_HASH','FIXTURE_PLAN_HASH']},operationKey:'owner-op'};
 await assert.rejects(()=>service.acceptClassroomBlueprint({...input,review:{accepted:true,independent:false,routeQualified:true}}),{code:'CLASSROOM_D11_REVIEW_REQUIRED'});assert.equal(commits,0);
 const stale=f.clone(current);stale.classRow.schedule_version=2;await assert.rejects(()=>service.acceptClassroomBlueprint({...input,context:stale}),{code:'CLASSROOM_D11_AUTHORITY_CHANGED'});assert.equal(commits,0);
 const wrong=author();wrong.artifacts.controller_blueprint.objectives[0].learning_unit_ref='not-authorized';await assert.rejects(()=>service.acceptClassroomBlueprint({...input,authorOutput:wrong}));assert.equal(commits,0);
 assert.equal((await service.acceptClassroomBlueprint(input)).lesson_blueprint_id,'FIXTURE_BLUEPRINT');assert.equal(commits,1);await service.acceptClassroomBlueprint(input);assert.equal(commits,1);
 await assert.rejects(()=>service.acceptClassroomBlueprint({...input,chapter:{artifact_version_id:'changed'}}),{code:'CLASSROOM_D11_IDEMPOTENCY_CONFLICT'});
});
