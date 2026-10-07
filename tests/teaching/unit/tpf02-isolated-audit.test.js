'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
 TPF02_FAMILY_VERSION,
 TPF02_OUTPUT_SCHEMA_VERSION,
 TPF02_TOP_LEVEL_FIELDS,
 TPF02_MAX_OUTPUT_TOKENS,
 EXECUTION_STAGES,
 buildTpf02AcademicInput,
 validateTpf02Schema,
 validateTpf02Domain,
 composeTpf02DirectModelContent,
}=require('../../../teaching/d07/tpf02-direct');
const {curriculumAuditRequest}=require('../../../teaching/d07/intelligence');
const {createFrozenPromptBinding,getPromptBody}=require('../../../teaching/prompt-runtime/prompt-catalog');
const {createTeachingAIAdapter}=require('../../../teaching/orchestrator/ai-adapter');
const {createCentralAIExecutionBoundary}=require('../../../teaching/ai/central-orchestrator-boundary');
const {createDurableTeachingOutboxRuntime,isTerminalPublicationFailure}=require('../../../teaching/runtime/durable-outbox-runtime');

const course={course_id:'course-1',student_id:'u1',subject_id:'physics',title:'Physics',lifecycle_state:'DRAFT',state_version:7,subject_snapshot_ref:'subject:physics:snapshot-7'};
const sources=[
 {source_content_item_id:'s1',source_kind:'PRIMARY_KIWI_SUBJECT',source_ref:'subject:physics:card:1',source_version_ref:'v1',locator:{card_id:'1'},content_hash:'h1',content_summary:'Force is rate of change of momentum.'},
 {source_content_item_id:'s2',source_kind:'PRIMARY_KIWI_SUBJECT',source_ref:'subject:physics:card:2',source_version_ref:'v1',locator:{card_id:'2'},content_hash:'h2',content_summary:'Acceleration is rate of change of velocity.'},
];

function canonicalAudit(){return {
 input_state_reference:'teaching_course:course-1:state:7',
 task_mode:'DEEP_AUDIT',
 execution_stage:EXECUTION_STAGES.SINGLE_PASS,
 audit_scope:{
  subject_or_course:'Physics',
  source_refs:['source:s1','source:s2'],
  trusted_scope_version:'subject:physics:snapshot-7',
  source_walk:[
   {source_item_ref:'source:s1',analysis_status:'complete',note:null},
   {source_item_ref:'source:s2',analysis_status:'complete',note:null},
  ],
 },
 source_inventory:[
  {source_item_ref:'source:s1',provenance:'subject:physics:card:1',academic_meaning:'Force definition and relationship to momentum.',proposed_scope_classification:'required',scope_classification_basis:'Approved Course source.',duplicate_of_ref:null,content_validity_status:'current_supported',content_validity_basis:'Consistent with supplied Course material.',confidence:'high'},
  {source_item_ref:'source:s2',provenance:'subject:physics:card:2',academic_meaning:'Acceleration definition.',proposed_scope_classification:'required',scope_classification_basis:'Approved Course source.',duplicate_of_ref:null,content_validity_status:'current_supported',content_validity_basis:'Consistent with supplied Course material.',confidence:'high'},
 ],
 topics:[{topic_id:'topic-1',title:'Motion and Forces',source_item_refs:['source:s1','source:s2'],subtopics:[{subtopic_id:'sub-force',title:'Force'},{subtopic_id:'sub-acceleration',title:'Acceleration'}]}],
 learning_units:[
  {learning_unit_id:'lu-1',title:'Explain force',intended_competence:'Explain force as rate of change of momentum.',source_item_refs:['source:s1'],topic_refs:['topic-1'],subtopic_id:'sub-force',prerequisite_refs:[],dependency_type_notes:'No in-Course prerequisite.',criticality:'foundational',criticality_basis:'Supports later mechanics.',proposed_exit_evidence:'Independent explanation and application.',gap_refs:[],uncertainties:[]},
  {learning_unit_id:'lu-2',title:'Explain acceleration',intended_competence:'Explain acceleration and use it in motion reasoning.',source_item_refs:['source:s2'],topic_refs:['topic-1'],subtopic_id:'sub-acceleration',prerequisite_refs:['lu-1'],dependency_type_notes:'Preferred conceptual sequence.',criticality:'major',criticality_basis:'Central to motion analysis.',proposed_exit_evidence:'Independent explanation and calculation.',gap_refs:[],uncertainties:[]},
 ],
 assumed_prerequisites:[],
 source_conflicts:[],
 coverage_gaps:[],
 structure_change_proposals:[],
 source_to_unit_reconciliation:{
  required_item_map:[
   {source_item_ref:'source:s1',learning_unit_refs:['lu-1']},
   {source_item_ref:'source:s2',learning_unit_refs:['lu-2']},
  ],
  unmapped_required_refs:[],
 },
 unresolved_items:[],
 status:'ok',
 review_required:false,
 review_reasons:[],
 student_facing_summary_candidate:'The Course begins with core mechanics relationships.',
};}

function validationContext(){
 const input=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.SINGLE_PASS});
 return {
  inputStateReference:input.input_state_reference,
  trustedScopeVersion:input.audit_scope.trusted_scope_version,
  sourceItems:input.source_items,
  taskMode:input.task_mode,
  executionStage:input.execution_stage,
  decompositionLimits:input.constraints.decomposition_limits,
 };
}

test('TPF-02 v1.2 canonical output exposes the exact governed v3 contract',()=>{
 assert.equal(TPF02_FAMILY_VERSION,'1.2');
 assert.equal(TPF02_OUTPUT_SCHEMA_VERSION,'3');
 const output=canonicalAudit();
 assert.deepEqual(Object.keys(output).sort(),[...TPF02_TOP_LEVEL_FIELDS].sort());
 assert.equal(validateTpf02Schema(output).ok,true);
 const extra={...output,source_accounting:[]};
 assert.equal(validateTpf02Schema(extra).reason,'TPF02_TOP_LEVEL_CONTRACT_MISMATCH');
 for(const key of TPF02_TOP_LEVEL_FIELDS){const missing={...output};delete missing[key];assert.equal(validateTpf02Schema(missing).ok,false,`missing ${key} must fail`);}
});

test('TPF-02 v1.2 domain validation requires exact source census, state echo and runtime-owned source ids',()=>{
 const context=validationContext();
 assert.equal(validateTpf02Domain(canonicalAudit(),context).ok,true);
 const omitted=canonicalAudit();omitted.source_inventory=omitted.source_inventory.slice(0,1);
 assert.equal(validateTpf02Domain(omitted,context).reason,'TPF02_SOURCE_INVENTORY_CENSUS_MISMATCH');
 const stale=canonicalAudit();stale.input_state_reference='teaching_course:course-1:state:6';
 assert.equal(validateTpf02Domain(stale,context).reason,'TPF02_INPUT_STATE_REFERENCE_MISMATCH');
 const invented=canonicalAudit();invented.source_inventory[0]={...invented.source_inventory[0],source_item_ref:'SI-001'};
 assert.equal(validateTpf02Domain(invented,context).ok,false);
});

test('TPF-02 v1.2 rejects a missing or wrong-Topic Subtopic link',()=>{
 const missing=canonicalAudit();delete missing.learning_units[0].subtopic_id;
 assert.equal(validateTpf02Schema(missing).reason,'TPF02_LEARNING_UNIT_INVALID:0');
 const wrong=canonicalAudit();wrong.learning_units[0].subtopic_id='sub-acceleration';
 assert.ok(['TPF02_HIERARCHY_SUBTOPIC_REF_INVALID','TPF02_HIERARCHY_EMPTY_SUBTOPIC'].includes(validateTpf02Domain(wrong,validationContext()).reason));
});

test('TPF-02 v1.2 rejects status ok when a required source is inventoried but absent from every Learning Unit',()=>{
 const broken=canonicalAudit();
 broken.learning_units[1]={...broken.learning_units[1],source_item_refs:['source:s1']};
 broken.topics[0]={...broken.topics[0],source_item_refs:['source:s1']};
 broken.source_to_unit_reconciliation={
  required_item_map:[
   {source_item_ref:'source:s1',learning_unit_refs:['lu-1','lu-2']},
   {source_item_ref:'source:s2',learning_unit_refs:[]},
  ],
  unmapped_required_refs:['source:s2'],
 };
 assert.equal(validateTpf02Domain(broken,validationContext()).reason,'TPF02_OK_STATUS_HAS_UNMAPPED_REQUIRED_SOURCE');
});

test('TPF-02 v1.2 reconciliation must exactly match every Learning Unit carrying a required source',()=>{
 const broken=canonicalAudit();
 broken.learning_units[1]={...broken.learning_units[1],source_item_refs:['source:s1','source:s2']};
 assert.equal(validateTpf02Domain(broken,validationContext()).reason,'TPF02_RECONCILIATION_UNIT_SET_MISMATCH');
});

test('D07 curriculum audit request uses TPF-02 v1.2, v3 output schema, bounded sources and a 48k output budget',async()=>{
 const request=curriculumAuditRequest({course,sources});
 assert.equal(request.taskMode,'DEEP_AUDIT');
 assert.equal(request.outputSchema.id,'tpf02.curriculum-audit');
 assert.equal(request.outputSchema.version,'3');
 assert.deepEqual(request.outputSchema.declared_fields,TPF02_TOP_LEVEL_FIELDS);
 assert.equal(request.generation.maxOutputTokens,TPF02_MAX_OUTPUT_TOKENS);
 assert.equal(request.academicInput.execution_stage,EXECUTION_STAGES.SINGLE_PASS);
 assert.equal(request.academicInput.source_items.length,2);
 assert.equal(request.academicInput.source_items[0].content,sources[0].content_summary);
 assert.deepEqual(request.provenanceRefs,['source:s1','source:s2']);
 assert.equal((await request.domainValidator(canonicalAudit())).ok,true);
});

test('direct TPF-02 composer uses the governed v1.2 artifact plus isolated runtime/input binding',()=>{
 const binding=createFrozenPromptBinding('TPF-02','1.2');
 const academicInput=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.SINGLE_PASS});
 const content=composeTpf02DirectModelContent({invocation:{capability:{id:'teaching.curriculum.deep_curriculum_audit'},state_reference:{aggregate_type:'teaching_course',aggregate_id:'course-1',state_version:'7'},prompt:{family_id:'TPF-02',family_version:'1.2',frozen_binding:binding}},academicInput});
 assert.match(content,/<KIWI_TPF02_FROZEN_PROMPT>/);
 assert.match(content,/<KIWI_TPF02_DIRECT_RUNTIME_BINDING>/);
 assert.match(content,/KIWI_TPF02_DIRECT_CURRICULUM_AUDIT_V3/);
 assert.match(content,/"version":"3"/);
 assert.match(content,/Force is rate of change of momentum/);
 assert.doesNotMatch(content,/<KIWI_TEACHING_RUNTIME_CONTRACT_JSON>/);
 assert.equal(getPromptBody('TPF-02','1.2').promptSha256,'c3084d859209c672d86659b54ce63cc52422b3887414c0b50a64722f4744c004');
});

test('Teaching AI adapter sends isolated TPF-02 v1.2 through MAIN_CBT with 48k structured output generation',async()=>{
 const calls=[];
 const binding=createFrozenPromptBinding('TPF-02','1.2');
 const adapter=createTeachingAIAdapter({
  promptControl:{createInvocation(){throw new Error('not used');}},
  aiBoundary:{async execute(args){calls.push(args);return {accepted:true,modelMetadata:{}};}},
  resolveCentralTaskId:async()=>({taskId:'MAIN_CBT'}),
  assertRouteExecutable:()=>true,
 });
 const invocation={
  capability:{id:'teaching.curriculum.deep_curriculum_audit',authority_ceiling:'T3',execution_class:'DIRECT-AI',authoritative_owner_boundary:'Curriculum Audit owner'},
  prompt:{family_id:'TPF-02',family_version:'1.2',frozen_binding:binding},
  output_schema:{id:'tpf02.curriculum-audit',version:'3'},
  route_control:{},
  state_reference:{aggregate_type:'teaching_course',aggregate_id:'course-1',state_version:'7'},
  audit:{correlation_id:'corr',causation_id:null},
  constitution:{version:'test'},
 };
 await adapter.execute({invocation,academicInput:buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.SINGLE_PASS}),schemaValidator:validateTpf02Schema,domainValidator:async out=>({ok:true,value:out}),provenanceValidator:async()=>({ok:true})});
 assert.equal(calls.length,1);
 assert.equal(calls[0].taskId,'MAIN_CBT');
 assert.equal(calls[0].request.generation.maxOutputTokens,48000);
 assert.equal(calls[0].request.generation.structuredOutput.mimeType,'application/json');
 assert.match(calls[0].request.content,/<KIWI_TPF02_DIRECT_RUNTIME_BINDING>/);
});

test('Teaching boundary rejects MAX_TOKENS before truncated JSON can reach schema validation',async()=>{
 let validated=false;
 const boundary=createCentralAIExecutionBoundary({aiRun:async()=>({text:'{"status":"ok"',finishReason:'MAX_TOKENS',usage:{outputTokens:16384}})});
 await assert.rejects(boundary.execute({taskId:'MAIN_CBT',request:{content:'x'},responsibilityKey:'test',intelligenceClass:'DIRECT-AI',authorityLevel:'T2',schemaValidator:async()=>{validated=true;return {ok:true};},domainValidator:async()=>({ok:true})}),{code:'TEACHING_AI_OUTPUT_TRUNCATED'});
 assert.equal(validated,false);
});

test('Teaching outbox treats deterministic TPF-02/truncation failures as terminal rather than scheduling identical retries',async()=>{
 assert.equal(isTerminalPublicationFailure({code:'TEACHING_AI_OUTPUT_TRUNCATED'}),true);
 const actions=[];
 const event={event_id:'e1',attempt_count:1,status:'CLAIMED',schema_version:1,event_type:'teaching.curriculum.audit_requested',event_category:'operational_recovery_event',trigger_type:'background_analysis',source:'teaching.d07',origin:'teaching.course_setup',actor_id:'u1',aggregate_type:'teaching_course',aggregate_id:'course-1',aggregate_version:7,occurred_at:new Date(),effective_at:null,correlation_id:'e1',causation_id:null,idempotency_key:'k',payload:{},audit_refs:[],provenance_refs:[]};
 const runtime=createDurableTeachingOutboxRuntime({store:{async releaseExpiredClaims(){},async claimPending(){return [event];},async markPublished(){actions.push('published');},async markCancelled(_e,x){actions.push(['cancelled',x.errorCode]);},async retry(){actions.push('retry');}},publish:async()=>{const error=new Error('truncated');error.code='TEACHING_AI_OUTPUT_TRUNCATED';throw error;},workerId:'test-worker',logger:{error(){}}});
 const result=await runtime.tick();
 assert.deepEqual(result.outcomes,['CANCELLED']);
 assert.deepEqual(actions,[['cancelled','TEACHING_AI_OUTPUT_TRUNCATED']]);
});

test('canonical TPF-02 persistence baseline keeps normalized audit sections and JSON artifact storage available for v3 output',()=>{
 const sql=fs.readFileSync(path.resolve(__dirname,'../../../migrations/20261005_teaching_tpf02_canonical_audit.sql'),'utf8');
 for(const column of ['artifact_status','input_state_reference','review_required','review_reasons','audit_scope','student_facing_summary_candidate'])assert.match(sql,new RegExp(`ADD COLUMN ${column}`));
 for(const table of ['teaching_curriculum_audit_source_inventory','teaching_curriculum_audit_topics','teaching_curriculum_audit_learning_units','teaching_curriculum_audit_assumed_prerequisites','teaching_curriculum_audit_source_conflicts','teaching_curriculum_audit_coverage_gaps','teaching_curriculum_audit_structure_change_proposals','teaching_curriculum_audit_unresolved_items'])assert.match(sql,new RegExp(`CREATE TABLE public\\.${table}`));
 assert.doesNotMatch(sql,/ALTER COLUMN status/);
});

test('D07 persists governed v1.2 identity and v3 hierarchy projections without losing the complete JSON artifact', async () => {
 const {createD07CourseIntakeRepository}=require('../../../teaching/repositories/d07-course-intake');
 const statements=[];
 const query=async(sql,params=[])=>{
  statements.push({sql,params});
  if(sql.includes('max(audit_version)'))return {rows:[{v:2}]};
  if(sql.includes('insert into public.teaching_curriculum_audits('))return {rows:[{curriculum_audit_id:'new-audit',prompt_family_version:params[15],output_schema_version:params[16],audit_output:JSON.parse(params[6])}]};
  return {rows:[]};
 };
 const repository=createD07CourseIntakeRepository({query,withTransaction:fn=>fn(query),randomUUID:()=> 'new-audit'});
 const output=canonicalAudit();
 output.source_conflicts=[{conflict_id:'conflict-1',conflict:'Terminology differs.',conflict_type:'terminology',source_item_refs:['source:s1','source:s2'],authority_context:'Course sources',resolution_status:'resolved_by_authoritative_rule',resolution_or_required_review:'Use Course terminology.',blocking:false}];
 output.structure_change_proposals=[{type:'merge',affected_unit_refs:['lu-1','lu-2'],resulting_unit_refs:['lu-1'],source_item_refs_before:['source:s1','source:s2'],source_item_refs_after:['source:s1','source:s2'],proposal:'Consider one connected unit.',reason:'Closely related foundations.'}];
 const saved=await repository.saveAudit({studentId:'u1',courseId:'course-1',subjectSnapshotRef:course.subject_snapshot_ref,inventoryDigest:'digest',output,provenanceRefs:[],validationMetadata:{domain_validated:true,lineage_reconciled:true}});
 assert.equal(saved.prompt_family_version,'1.2');
 assert.equal(saved.output_schema_version,'3');
 assert.deepEqual(saved.audit_output,output);
 const audit=statements.find(x=>x.sql.includes('insert into public.teaching_curriculum_audits('));
 assert.equal(JSON.parse(audit.params[8]).schema,'tpf02.curriculum-audit.v3');
 const learningUnit=statements.find(x=>x.sql.includes('insert into public.teaching_curriculum_audit_learning_units('));
 assert.ok(learningUnit.sql.includes('subtopic_id'));
 assert.equal(learningUnit.params[9],'sub-force');
 const conflict=statements.find(x=>x.sql.includes('insert into public.teaching_curriculum_audit_source_conflicts('));
 assert.deepEqual(JSON.parse(conflict.params[6]),['source:s1','source:s2']);
 const structure=statements.find(x=>x.sql.includes('insert into public.teaching_curriculum_audit_structure_change_proposals('));
 assert.equal(structure.params[7],true);
 const before=statements.length;
 await assert.rejects(repository.saveAudit({output:{}}),{code:'TPF02_TOP_LEVEL_CONTRACT_MISMATCH'});
 assert.equal(statements.length,before);
});
