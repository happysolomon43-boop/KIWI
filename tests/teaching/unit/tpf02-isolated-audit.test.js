'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
 TPF02_TOP_LEVEL_FIELDS,
 TPF02_MAX_OUTPUT_TOKENS,
 buildTpf02AcademicInput,
 validateTpf02Schema,
 validateTpf02Domain,
 composeTpf02DirectModelContent,
}=require('../../../teaching/d07/tpf02-direct');
const {curriculumAuditRequest}=require('../../../teaching/d07/intelligence');
const {createFrozenPromptBinding}=require('../../../teaching/prompt-runtime/prompt-catalog');
const {createTeachingAIAdapter}=require('../../../teaching/orchestrator/ai-adapter');
const {createCentralAIExecutionBoundary}=require('../../../teaching/ai/central-orchestrator-boundary');
const {createDurableTeachingOutboxRuntime,isTerminalPublicationFailure}=require('../../../teaching/runtime/durable-outbox-runtime');

const course={course_id:'course-1',student_id:'u1',subject_id:'physics',title:'Physics',lifecycle_state:'DRAFT',state_version:7,subject_snapshot_ref:'subject:physics:snapshot-7'};
const sources=[
 {source_content_item_id:'s1',source_kind:'PRIMARY_KIWI_SUBJECT',source_ref:'subject:physics:card:1',source_version_ref:'v1',locator:{card_id:'1'},content_hash:'h1',content_summary:'Force is rate of change of momentum.'},
 {source_content_item_id:'s2',source_kind:'PRIMARY_KIWI_SUBJECT',source_ref:'subject:physics:card:2',source_version_ref:'v1',locator:{card_id:'2'},content_hash:'h2',content_summary:'Acceleration is rate of change of velocity.'},
];

function canonicalAudit(){return {
 status:'ok',
 input_state_reference:'teaching_course:course-1:state:7',
 review_required:false,
 review_reasons:[],
 audit_scope:{subject_or_course:'Physics',source_refs:['source:s1','source:s2'],trusted_scope_version:'subject:physics:snapshot-7'},
 source_inventory:[
  {source_item_ref:'source:s1',provenance:'subject:physics:card:1',academic_meaning:'Force definition and relationship to momentum.',proposed_scope_classification:'required',scope_classification_basis:'Approved Course source.',content_validity_status:'current_supported',content_validity_basis:'Consistent with supplied Course material.',confidence:'high'},
  {source_item_ref:'source:s2',provenance:'subject:physics:card:2',academic_meaning:'Acceleration definition.',proposed_scope_classification:'required',scope_classification_basis:'Approved Course source.',content_validity_status:'current_supported',content_validity_basis:'Consistent with supplied Course material.',confidence:'high'},
 ],
 topics:[{topic_id:'topic-1',title:'Motion and Forces',source_item_refs:['source:s1','source:s2'],subtopics:['Force','Acceleration']}],
 learning_units:[
  {learning_unit_id:'lu-1',title:'Explain force',intended_competence:'Explain force as rate of change of momentum.',source_item_refs:['source:s1'],topic_refs:['topic-1'],prerequisite_refs:[],dependency_type_notes:'No in-Course prerequisite.',criticality:'foundational',criticality_basis:'Supports later mechanics.',proposed_exit_evidence:'Independent explanation and application.',uncertainties:[]},
  {learning_unit_id:'lu-2',title:'Explain acceleration',intended_competence:'Explain acceleration and use it in motion reasoning.',source_item_refs:['source:s2'],topic_refs:['topic-1'],prerequisite_refs:['lu-1'],dependency_type_notes:'Preferred conceptual sequence.',criticality:'major',criticality_basis:'Central to motion analysis.',proposed_exit_evidence:'Independent explanation and calculation.',uncertainties:[]},
 ],
 assumed_prerequisites:[],
 source_conflicts:[],
 coverage_gaps:[],
 structure_change_proposals:[],
 unresolved_items:[],
 student_facing_summary_candidate:'The Course begins with core mechanics relationships.',
};}

test('TPF-02 canonical output contains exactly the 14 frozen top-level fields',()=>{
 const output=canonicalAudit();
 assert.deepEqual(Object.keys(output).sort(),[...TPF02_TOP_LEVEL_FIELDS].sort());
 assert.equal(validateTpf02Schema(output).ok,true);
 const extra={...output,source_accounting:[]};
 assert.equal(validateTpf02Schema(extra).reason,'TPF02_TOP_LEVEL_CONTRACT_MISMATCH');
 for(const key of TPF02_TOP_LEVEL_FIELDS){const missing={...output};delete missing[key];assert.equal(validateTpf02Schema(missing).ok,false,`missing ${key} must fail`);}
});

test('TPF-02 domain validation requires exact source census and authoritative state echo',()=>{
 const input=buildTpf02AcademicInput({course,sources});
 const context={inputStateReference:input.input_state_reference,trustedScopeVersion:input.audit_scope.trusted_scope_version,sourceItems:input.source_items};
 assert.equal(validateTpf02Domain(canonicalAudit(),context).ok,true);
 const omitted=canonicalAudit();omitted.source_inventory=omitted.source_inventory.slice(0,1);
 assert.equal(validateTpf02Domain(omitted,context).reason,'TPF02_SOURCE_INVENTORY_CENSUS_MISMATCH');
 const stale=canonicalAudit();stale.input_state_reference='teaching_course:course-1:state:6';
 assert.equal(validateTpf02Domain(stale,context).reason,'TPF02_INPUT_STATE_REFERENCE_MISMATCH');
});

test('D07 curriculum audit request uses canonical TPF-02 contract, actual bounded sources and a 48k output budget',()=>{
 const request=curriculumAuditRequest({course,sources});
 assert.equal(request.taskMode,'DEEP_AUDIT');
 assert.equal(request.outputSchema.id,'tpf02.curriculum-audit');
 assert.deepEqual(request.outputSchema.declared_fields,TPF02_TOP_LEVEL_FIELDS);
 assert.equal(request.generation.maxOutputTokens,TPF02_MAX_OUTPUT_TOKENS);
 assert.equal(request.academicInput.source_items.length,2);
 assert.equal(request.academicInput.source_items[0].content,sources[0].content_summary);
 assert.deepEqual(request.provenanceRefs,['source:s1','source:s2']);
 assert.equal(request.domainValidator(canonicalAudit()) instanceof Promise,true);
});

test('direct TPF-02 composer uses only the frozen TPF-02 artifact plus isolated runtime/input binding',()=>{
 const binding=createFrozenPromptBinding('TPF-02','1.0');
 const academicInput=buildTpf02AcademicInput({course,sources});
 const content=composeTpf02DirectModelContent({invocation:{capability:{id:'teaching.curriculum.deep_curriculum_audit'},state_reference:{aggregate_type:'teaching_course',aggregate_id:'course-1',state_version:'7'},prompt:{family_id:'TPF-02',family_version:'1.0',frozen_binding:binding}},academicInput});
 assert.match(content,/<KIWI_TPF02_FROZEN_PROMPT>/);
 assert.match(content,/<KIWI_TPF02_DIRECT_RUNTIME_BINDING>/);
 assert.match(content,/"exact_top_level_fields":\["status","input_state_reference","review_required"/);
 assert.match(content,/Force is rate of change of momentum/);
 assert.doesNotMatch(content,/<KIWI_TEACHING_RUNTIME_CONTRACT_JSON>/);
});

test('Teaching AI adapter sends isolated canonical TPF-02 through MAIN_CBT with 48k structured output generation',async()=>{
 const calls=[];
 const binding=createFrozenPromptBinding('TPF-02','1.0');
 const adapter=createTeachingAIAdapter({
  promptControl:{createInvocation(){throw new Error('not used');}},
  aiBoundary:{async execute(args){calls.push(args);return {accepted:true,modelMetadata:{}};}},
  resolveCentralTaskId:async()=>({taskId:'MAIN_CBT'}),
  assertRouteExecutable:()=>true,
 });
 const invocation={
  capability:{id:'teaching.curriculum.deep_curriculum_audit',authority_ceiling:'T3',execution_class:'DIRECT-AI',authoritative_owner_boundary:'Curriculum Audit owner'},
  prompt:{family_id:'TPF-02',family_version:'1.0',frozen_binding:binding},
  output_schema:{id:'tpf02.curriculum-audit',version:'1'},
  route_control:{},
  state_reference:{aggregate_type:'teaching_course',aggregate_id:'course-1',state_version:'7'},
  audit:{correlation_id:'corr',causation_id:null},
  constitution:{version:'test'},
 };
 await adapter.execute({invocation,academicInput:buildTpf02AcademicInput({course,sources}),schemaValidator:validateTpf02Schema,domainValidator:async out=>({ok:true,value:out}),provenanceValidator:async()=>({ok:true})});
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

test('canonical TPF-02 migration persists each required section separately and preserves execution status separately',()=>{
 const sql=fs.readFileSync(path.resolve(__dirname,'../../../migrations/20261005_teaching_tpf02_canonical_audit.sql'),'utf8');
 for(const column of ['artifact_status','input_state_reference','review_required','review_reasons','audit_scope','student_facing_summary_candidate'])assert.match(sql,new RegExp(`ADD COLUMN ${column}`));
 for(const table of ['teaching_curriculum_audit_source_inventory','teaching_curriculum_audit_topics','teaching_curriculum_audit_learning_units','teaching_curriculum_audit_assumed_prerequisites','teaching_curriculum_audit_source_conflicts','teaching_curriculum_audit_coverage_gaps','teaching_curriculum_audit_structure_change_proposals','teaching_curriculum_audit_unresolved_items'])assert.match(sql,new RegExp(`CREATE TABLE public\\.${table}`));
 assert.match(sql,/output_schema_version <> 'tpf02\.curriculum-audit\.v1'/);
 assert.doesNotMatch(sql,/ALTER COLUMN status/);
});
