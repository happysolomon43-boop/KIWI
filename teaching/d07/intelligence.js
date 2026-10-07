'use strict';
const { validateCurriculumAuditSchema, validateCurriculumAuditDomain, normalizeIntakeExtraction } = require('./contracts');
const { getCapability } = require('../capability-registry');
const {
  TPF02_OUTPUT_SCHEMA_ID,
  TPF02_OUTPUT_SCHEMA_VERSION,
  tpf02OutputTokenBudget,
  TPF02_TOP_LEVEL_FIELDS,
  TPF02_DECOMPOSITION_PATCH_SCHEMA_ID,
  TPF02_DECOMPOSITION_PATCH_SCHEMA_VERSION,
  TPF02_DECOMPOSITION_PATCH_FIELDS,
  EXECUTION_STAGES,
  buildTpf02AcademicInput,
  validateTpf02Schema,
  validateTpf02DecompositionPatchSchema,
  validateTpf02Domain,
  validateHierarchy,
  validateDecomposition,
  decompositionRepairState,
  DECOMPOSITION_JUSTIFICATION_PREFIX,
} = require('./tpf02-direct');
const {
  TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA,
  TPF02_DECOMPOSITION_PATCH_RESPONSE_SCHEMA,
} = require('./tpf02-provider-schema');
const {
  TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_ID,
  TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_VERSION,
  TPF02_MERGE_COMPRESSION_PATCH_FIELDS,
  TPF02_MERGE_COMPRESSION_PATCH_RESPONSE_SCHEMA,
  validateTpf02MergeCompressionPatchSchema,
  isMergeCompressionChangeRequest,
  buildMergeCompressionContext,
  validateMergeCompressionPatch,
  applyMergeCompressionPatch,
} = require('./tpf02-merge-compression');

const TPF02_SOURCE_INVENTORY_BATCH_SIZE = 24;
const TPF02_SOURCE_INVENTORY_CONCURRENCY = 2;
const TPF02_STAGED_SOURCE_COUNT_THRESHOLD = 48;
const TPF02_STAGED_INPUT_BYTES_THRESHOLD = 192 * 1024;
const TPF02_PROGRESSIVE_STRUCTURE_SOURCE_COUNT_THRESHOLD = 120;
const TPF02_STRUCTURE_BATCH_SIZE = 24;
const TPF02_STRUCTURE_CONCURRENCY = 2;
const TPF02_LINEAGE_REPAIR_BATCH_SIZE = 12;
const TPF02_LINEAGE_REPAIR_REVIEW_REASON = 'Required source lineage needs bounded TPF-02 completion before Course planning.';
const TPF02_DECOMPOSITION_REPAIR_MAX_ATTEMPTS = 12;
const TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE = 24;
const TPF02_PROGRESSIVE_SYNTHESIS_INPUT_BYTES_LIMIT = 512 * 1024;
const TPF02_LINEAGE_UNRESOLVED_PREFIX = 'runtime-lineage-unmapped:';
const TPF02_STATUS_PRIORITY = Object.freeze({
  ok: 0,
  unresolved: 1,
  blocked_authority_conflict: 2,
  blocked_insufficient_sources: 3,
});

function base({capabilityId,course,stateVersion,taskMode,outputSchema,contextSpec,academicInput,provenanceRefs=[]}){
  return {
    trigger:{type:'authenticated_input',ref:`course:${course.course_id}:${taskMode}`,source:'teaching.d07',actor_id:course.student_id},
    capabilityId,
    stateReference:{aggregate_type:'teaching_course',aggregate_id:course.course_id,state_version:String(stateVersion||course.state_version)},
    preconditions:{lifecycle_state:course.lifecycle_state},
    provenanceRefs,
    resultContract:{output_schema_id:outputSchema.id,output_schema_version:outputSchema.version,validator_ids:['schema','domain','provenance']},
    taskMode,
    directive:{
      bounded_actions:['analyze supplied D07 data'],
      allowed_operations:['return schema-valid candidate output'],
      prohibited_operations:['mutate authoritative state','certify mastery from self-report','omit source items','select provider or model'],
      evidence_purpose:taskMode,
      downstream_handoff:{type:'validated_candidate',validator_ids:['schema','domain','provenance'],commit_owner_boundary:getCapability(capabilityId).authoritative_owner_boundary},
    },
    contextSpec,
    outputSchema,
    academicInput,
    commit:false,
  };
}

function intakeRequest({course,intake}){
  const outputSchema={id:'d07.student-intake-extraction',version:'1',uncertainty_states:['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED'],review_needed_field:'uncertainty',declared_fields:['interaction_preferences','academic_self_report','goals','deadlines','planning_hypotheses','diagnostic_targets','uncertainty','provenance'],validate:async out=>normalizeIntakeExtraction(out,intake.intake_id)};
  return {...base({capabilityId:'teaching.curriculum.intake_signal_extraction',course,taskMode:'student_intake_signal_extraction',outputSchema,contextSpec:{untrusted_refs:[{ref:`intake:${intake.intake_id}`}],context_kind:'course_intake',access_purpose:'planning_hypothesis_extraction'},academicInput:{intake_ref:intake.intake_id},provenanceRefs:[`intake:${intake.intake_id}`]}),schemaValidator:outputSchema.validate,domainValidator:async value=>({ok:value?.provenance?.evidence_status==='NON_EVIDENCE_PLANNING_HYPOTHESIS',value,reason:'INTAKE_MUST_REMAIN_NON_EVIDENCE'}),provenanceValidator:async value=>({ok:value?.provenance?.intake_id===intake.intake_id,reason:'INTAKE_PROVENANCE_INVALID'})};
}

function tpf02OutputSchema(){
  return {
    id:TPF02_OUTPUT_SCHEMA_ID,
    version:TPF02_OUTPUT_SCHEMA_VERSION,
    uncertainty_states:['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED','unresolved','blocked_insufficient_sources','blocked_authority_conflict'],
    review_needed_field:'review_required',
    declared_fields:[...TPF02_TOP_LEVEL_FIELDS],
    validate:validateTpf02Schema,
  };
}

function tpf02DecompositionPatchOutputSchema(){
  return {
    id:TPF02_DECOMPOSITION_PATCH_SCHEMA_ID,
    version:TPF02_DECOMPOSITION_PATCH_SCHEMA_VERSION,
    uncertainty_states:['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED'],
    review_needed_field:'review_required',
    declared_fields:[...TPF02_DECOMPOSITION_PATCH_FIELDS],
    validate:validateTpf02DecompositionPatchSchema,
  };
}

function tpf02MergeCompressionPatchOutputSchema(){
  return {
    id:TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_ID,
    version:TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_VERSION,
    uncertainty_states:['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED'],
    review_needed_field:'review_required',
    declared_fields:[...TPF02_MERGE_COMPRESSION_PATCH_FIELDS],
    validate:validateTpf02MergeCompressionPatchSchema,
  };
}

function tpf02Generation(academicInput,responseSchema=TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA){
  return Object.freeze({
    maxOutputTokens:tpf02OutputTokenBudget(academicInput),
    structuredOutput:Object.freeze({
      mimeType:'application/json',
      schema:responseSchema,
    }),
  });
}

function tpf02ContextSpec(course,sources,accessPurpose='source_accounting'){
  const untrusted=new Set(['PRIMARY_STUDY_NOTE','STUDENT_SUPPLEMENT']);
  return {
    authoritative_refs:[{ref:`course:${course.course_id}`}],
    provenance_refs:sources.filter(s=>!untrusted.has(s.source_kind)).map(s=>({ref:`source:${s.source_content_item_id}`})),
    untrusted_refs:sources.filter(s=>untrusted.has(s.source_kind)).map(s=>({ref:`source:${s.source_content_item_id}`})),
    context_kind:'curriculum_audit',
    access_purpose:accessPurpose,
  };
}

function validationContextFor(academicInput,{allowDecompositionRepair=false}={}){
  return {
    inputStateReference:academicInput.input_state_reference,
    trustedScopeVersion:academicInput.audit_scope.trusted_scope_version,
    sourceItems:academicInput.source_items,
    taskMode:academicInput.task_mode,
    executionStage:academicInput.execution_stage,
    decompositionLimits:academicInput.constraints?.decomposition_limits || null,
    allowDecompositionRepair,
  };
}

function fullProvenanceValidator(sourceRefs){
  return async out=>{
    const refs=new Set(out?.source_inventory?.map((item)=>String(item.source_item_ref))||[]);
    return {ok:sourceRefs.length===refs.size&&sourceRefs.every((ref)=>refs.has(ref)),reason:'CURRICULUM_SOURCE_PROVENANCE_INCOMPLETE'};
  };
}


function canonicalizeTpf02RuntimeEnvelope(output,academicInput,{canonicalizeAuditScope=true}={}){
  if(!output||typeof output!=='object'||Array.isArray(output))return output;
  const canonical={
    ...output,
    input_state_reference:String(academicInput?.input_state_reference||output.input_state_reference||''),
    task_mode:String(academicInput?.task_mode||output.task_mode||''),
    execution_stage:String(academicInput?.execution_stage||output.execution_stage||''),
  };
  if(canonicalizeAuditScope&&output.audit_scope&&typeof output.audit_scope==='object'&&!Array.isArray(output.audit_scope)&&academicInput?.audit_scope){
    canonical.audit_scope={
      ...output.audit_scope,
      subject_or_course:String(academicInput.audit_scope.subject_or_course||''),
      source_refs:uniqueStrings(academicInput.audit_scope.source_refs||[]),
      trusted_scope_version:String(academicInput.audit_scope.trusted_scope_version||''),
    };
  }
  return canonical;
}

function canonicalizeStructurePassOutput(output,{academicInput,canonicalInventory=[]}={}){
  const runtime=canonicalizeTpf02RuntimeEnvelope(output,academicInput);
  if(!runtime||typeof runtime!=='object'||Array.isArray(runtime))return runtime;
  const eligible=new Set(
    (canonicalInventory||[])
      .filter((item)=>['required','supplementary'].includes(String(item?.proposed_scope_classification||'')))
      .map((item)=>String(item.source_item_ref))
  );
  const topics=Array.isArray(runtime.topics)
    ? runtime.topics.map((topic)=>({
      ...topic,
      source_item_refs:uniqueStrings((topic?.source_item_refs||[]).filter((ref)=>eligible.has(String(ref)))),
    }))
    : runtime.topics;
  const learningUnits=Array.isArray(runtime.learning_units)
    ? runtime.learning_units.map((unit)=>({
      ...unit,
      source_item_refs:uniqueStrings((unit?.source_item_refs||[]).filter((ref)=>eligible.has(String(ref)))),
      topic_refs:uniqueStrings(unit?.topic_refs||[]),
      prerequisite_refs:uniqueStrings(unit?.prerequisite_refs||[]),
      gap_refs:[],
      uncertainties:uniqueStrings(unit?.uncertainties||[]),
    })).filter((unit)=>unit.source_item_refs.length>0)
    : runtime.learning_units;
  const assumedPrerequisites=Array.isArray(runtime.assumed_prerequisites)
    ? runtime.assumed_prerequisites.map((item)=>({...item,inside_course_scope:false}))
    : runtime.assumed_prerequisites;
  return {
    ...runtime,
    audit_scope:{...(runtime.audit_scope||{}),source_walk:[]},
    source_inventory:[],
    topics,
    learning_units:learningUnits,
    assumed_prerequisites:assumedPrerequisites,
    source_conflicts:[],
    coverage_gaps:[],
    structure_change_proposals:[],
    source_to_unit_reconciliation:{required_item_map:[],unmapped_required_refs:[]},
    unresolved_items:[],
    status:'ok',
    review_required:false,
    review_reasons:[],
    student_facing_summary_candidate:null,
  };
}

function canonicalizeLineageRepairOutput(output,{academicInput,baseOutput,repairRefs=[]}={}){
  const runtime=canonicalizeTpf02RuntimeEnvelope(output,academicInput);
  if(!runtime||typeof runtime!=='object'||Array.isArray(runtime))return runtime;
  const repaired=new Set(uniqueStrings(repairRefs));
  const existingTopics=new Map((baseOutput?.topics||[]).map((topic)=>[String(topic.topic_id),topic]));
  const existingUnits=new Map((baseOutput?.learning_units||[]).map((unit)=>[String(unit.learning_unit_id),unit]));
  const topics=Array.isArray(runtime.topics)
    ? runtime.topics.map((topic)=>{
      const id=String(topic?.topic_id||'');
      const existing=existingTopics.get(id);
      if(existing){
        return {
          topic_id:id,
          title:String(existing.title),
          source_item_refs:[],
          subtopics:(existing.subtopics||[]).map((subtopic)=>({...subtopic})),
        };
      }
      return {
        ...topic,
        source_item_refs:uniqueStrings((topic?.source_item_refs||[]).filter((ref)=>repaired.has(String(ref)))),
      };
    })
    : runtime.topics;
  const learningUnits=Array.isArray(runtime.learning_units)
    ? runtime.learning_units.map((unit)=>{
      const id=String(unit?.learning_unit_id||'');
      const refs=uniqueStrings((unit?.source_item_refs||[]).filter((ref)=>repaired.has(String(ref))));
      const existing=existingUnits.get(id);
      if(existing){
        return {
          ...existing,
          source_item_refs:refs,
          topic_refs:[...(existing.topic_refs||[])],
          prerequisite_refs:[...(existing.prerequisite_refs||[])],
          gap_refs:[...(existing.gap_refs||[])],
          uncertainties:[...(existing.uncertainties||[])],
        };
      }
      return {
        ...unit,
        source_item_refs:refs,
        topic_refs:uniqueStrings(unit?.topic_refs||[]),
        prerequisite_refs:uniqueStrings(unit?.prerequisite_refs||[]),
        gap_refs:uniqueStrings(unit?.gap_refs||[]),
        uncertainties:uniqueStrings(unit?.uncertainties||[]),
      };
    }).filter((unit)=>unit.source_item_refs.length>0)
    : runtime.learning_units;
  return {
    ...runtime,
    audit_scope:{...(runtime.audit_scope||{}),source_walk:[]},
    source_inventory:[],
    topics,
    learning_units:learningUnits,
    assumed_prerequisites:[],
    source_conflicts:[],
    coverage_gaps:[],
    structure_change_proposals:[],
    source_to_unit_reconciliation:{required_item_map:[],unmapped_required_refs:[]},
    unresolved_items:[],
    status:'ok',
    review_required:false,
    review_reasons:[],
    student_facing_summary_candidate:null,
  };
}

function buildRegenerationContext({regenerationReason=null,previousAudit=null}={}){
  const reason=String(regenerationReason||'').trim().slice(0,1500);
  if(!previousAudit&&!reason)return null;
  const previousOutput=previousAudit?.audit_output&&typeof previousAudit.audit_output==='object'
    ? previousAudit.audit_output
    : {};
  return Object.freeze({
    requested:true,
    student_reason:reason||null,
    previous_audit_version:previousAudit?.audit_version==null?null:Number(previousAudit.audit_version),
    previous_learning_unit_count:Array.isArray(previousOutput.learning_units)?previousOutput.learning_units.length:null,
    instruction:Object.freeze([
      'Treat the student reason as advisory decomposition feedback, not as authority to omit required Course scope.',
      'Re-evaluate the full source evidence and change Learning Unit granularity only when academically defensible.',
      'Preserve distinct assessable competencies, required source lineage, prerequisites, and exit evidence even when the student asks for fewer units.',
      'Do not create filler units merely to satisfy a request for more units.',
    ]),
  });
}

function withRegenerationContext(academicInput,regenerationContext){
  return regenerationContext
    ? Object.freeze({...academicInput,regeneration_context:regenerationContext})
    : academicInput;
}

function buildRefinementContext({changeRequest=null,previousAudit=null}={}){
  const request=String(changeRequest||'').trim().slice(0,1500);
  if(!request){
    const error=new Error('A Course analysis change request is required.');
    error.code='TEACHING_D07_ANALYSIS_REFINEMENT_REQUEST_REQUIRED';
    throw error;
  }
  const current=previousAudit?.audit_output&&typeof previousAudit.audit_output==='object'
    ? previousAudit.audit_output
    : null;
  if(!current){
    const error=new Error('A validated Course analysis is required before targeted refinement.');
    error.code='TEACHING_D07_ANALYSIS_REFINEMENT_REQUIRES_CURRENT';
    throw error;
  }
  return Object.freeze({
    mode:'STUDENT_DIRECTED_ANALYSIS_REFINEMENT',
    student_request:request,
    previous_audit_id:previousAudit?.curriculum_audit_id||null,
    previous_audit_version:previousAudit?.audit_version==null?null:Number(previousAudit.audit_version),
    current_analysis:current,
    immutable_scope:Object.freeze([
      'source_inventory',
      'audit_scope',
      'source_conflicts',
      'coverage_gaps',
    ]),
    instruction:Object.freeze([
      'Apply only academically defensible changes requested by the student.',
      'Preserve unaffected curriculum structure instead of regenerating the Course analysis from scratch.',
      'Do not reclassify sources, invent source evidence, remove required scope, or change validated source conflicts or coverage gaps.',
      'A request for fewer Learning Units may merge only genuinely inseparable competencies; a request for more Learning Units may split only where distinct assessable competencies exist.',
      'Keep required source lineage, prerequisite validity, hierarchy integrity, and exit evidence valid after every structural change.',
    ]),
  });
}

function canonicalJsonValue(value){
  if(Array.isArray(value))return value.map(canonicalJsonValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,canonicalJsonValue(value[key])]));
  return value??null;
}
function stableJson(value){return JSON.stringify(canonicalJsonValue(value));}

function validateRefinementOutput(output,previousOutput,validationContext){
  const validated=validateTpf02Domain(output,validationContext);
  if(!validated.ok)return validated;
  if(stableJson(output.source_inventory)!==stableJson(previousOutput.source_inventory))return {ok:false,reason:'TPF02_REFINEMENT_SOURCE_INVENTORY_MUTATION_FORBIDDEN'};
  if(stableJson(output.audit_scope)!==stableJson(previousOutput.audit_scope))return {ok:false,reason:'TPF02_REFINEMENT_AUDIT_SCOPE_MUTATION_FORBIDDEN'};
  if(stableJson(output.source_conflicts)!==stableJson(previousOutput.source_conflicts))return {ok:false,reason:'TPF02_REFINEMENT_SOURCE_CONFLICT_MUTATION_FORBIDDEN'};
  if(stableJson(output.coverage_gaps)!==stableJson(previousOutput.coverage_gaps))return {ok:false,reason:'TPF02_REFINEMENT_COVERAGE_GAP_MUTATION_FORBIDDEN'};
  return validated;
}

function curriculumRefinementRequest({course,sources,previousAudit,changeRequest}={}){
  const previousOutput=previousAudit?.audit_output;
  const refinementContext=buildRefinementContext({changeRequest,previousAudit});
  const fullAcademicInput=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.SINGLE_PASS});
  const academicInput=Object.freeze({...fullAcademicInput,source_items:Object.freeze([]),refinement_context:refinementContext});
  const sourceRefs=fullAcademicInput.source_items.map((item)=>item.source_item_ref);
  const outputSchema=tpf02OutputSchema();
  const request=base({
    capabilityId:'teaching.curriculum.deep_curriculum_audit',
    course,
    taskMode:'DEEP_AUDIT',
    outputSchema,
    contextSpec:{...tpf02ContextSpec(course,sources,'student_directed_analysis_refinement'),context_kind:'student_directed_analysis_refinement'},
    academicInput,
    provenanceRefs:sourceRefs,
  });
  const validationContext=validationContextFor(fullAcademicInput,{allowDecompositionRepair:true});
  return {
    ...request,
    modelContentMode:'TPF02_DIRECT',
    generation:tpf02Generation(academicInput),
    validationContext,
    schemaValidator:out=>validateTpf02Schema(canonicalizeTpf02RuntimeEnvelope(out,academicInput)),
    domainValidator:async out=>validateRefinementOutput(out,previousOutput,validationContext),
    provenanceValidator:fullProvenanceValidator(sourceRefs),
  };
}


function mergeCompressionRefinementRequest({course,sources,previousAudit,changeRequest}={}){
  const previousOutput=previousAudit?.audit_output;
  if(!previousOutput){
    const error=new Error('A validated Course analysis is required before merge/compression.');
    error.code='TEACHING_D07_MERGE_COMPRESSION_REQUIRES_CURRENT';
    throw error;
  }
  const mergeContext=buildMergeCompressionContext({changeRequest,previousAudit});
  const taskAcademicInput=buildTpf02AcademicInput({
    course,
    sources,
    taskMode:'MERGE_OR_COMPRESS_UNITS',
    executionStage:EXECUTION_STAGES.SINGLE_PASS,
  });
  const academicInput=Object.freeze({
    ...taskAcademicInput,
    source_items:Object.freeze([]),
    merge_compression_context:mergeContext,
  });
  const fullAcademicInput=buildTpf02AcademicInput({
    course,
    sources,
    taskMode:'DEEP_AUDIT',
    executionStage:EXECUTION_STAGES.SINGLE_PASS,
  });
  const sourceRefs=fullAcademicInput.source_items.map((item)=>item.source_item_ref);
  const fullValidationContext=validationContextFor(fullAcademicInput,{allowDecompositionRepair:true});
  const outputSchema=tpf02MergeCompressionPatchOutputSchema();
  const request=base({
    capabilityId:'teaching.curriculum.dynamic_learning_unit_merging_compression',
    course,
    taskMode:'MERGE_OR_COMPRESS_UNITS',
    outputSchema,
    contextSpec:{...tpf02ContextSpec(course,sources,'student_directed_merge_compression'),context_kind:'student_directed_merge_compression'},
    academicInput,
    provenanceRefs:sourceRefs,
  });
  return {
    ...request,
    directive:{
      ...request.directive,
      bounded_actions:[
        'propose only academically defensible Learning Unit merge/compression groups from the validated Course analysis',
        'preserve all required source lineage and unaffected curriculum structure',
      ],
      allowed_operations:[
        'merge or compress existing Learning Units that share the same Topic/Subtopic placement',
        'reuse one affected Learning Unit id as the continuity identity for each accepted merge group',
      ],
      prohibited_operations:[
        'mutate authoritative state',
        'reclassify source scope',
        'split Learning Units',
        'create or delete Topics or Subtopics',
        'move Learning Units across Topic/Subtopic placement',
        'drop required source lineage',
        'rewrite unaffected Learning Units',
        'select provider or model',
      ],
      evidence_purpose:'student_directed_merge_compression',
    },
    modelContentMode:'TPF02_DIRECT',
    generation:tpf02Generation(academicInput,TPF02_MERGE_COMPRESSION_PATCH_RESPONSE_SCHEMA),
    validationContext:fullValidationContext,
    schemaValidator:out=>validateTpf02MergeCompressionPatchSchema(canonicalizeTpf02RuntimeEnvelope(out,academicInput,{canonicalizeAuditScope:false})),
    domainValidator:async out=>{
      const currentBase=canonicalizeSynthesisSourceScope(
        canonicalizeTpf02RuntimeEnvelope(previousOutput,fullAcademicInput),
        previousOutput.source_inventory||[],
        fullAcademicInput.audit_scope,
      );
      const patch=validateMergeCompressionPatch(out,{academicInput,baseOutput:currentBase});
      if(!patch.ok)return patch;
      if(!(patch.value.merge_groups||[]).length){
        const unchanged=validateTpf02Domain(currentBase,fullValidationContext);
        return unchanged.ok?{ok:true,value:currentBase}:unchanged;
      }
      const applied=applyMergeCompressionPatch(currentBase,patch.value);
      const assembled=canonicalizeSynthesisSourceScope(
        canonicalizeTpf02RuntimeEnvelope(applied,fullAcademicInput),
        previousOutput.source_inventory||[],
        fullAcademicInput.audit_scope,
      );
      const validated=validateTpf02Domain(assembled,fullValidationContext);
      if(!validated.ok)return validated;

      const decomposition=decompositionRepairState(
        assembled,
        new Map((assembled.source_inventory||[]).map((item)=>[String(item.source_item_ref),item])),
        {decompositionLimits:fullAcademicInput.constraints.decomposition_limits},
      );
      const mergedIds=new Set((patch.value.merge_groups||[]).map((group)=>String(group.continuity_unit_ref)));
      if((decomposition.pending_unit_flags||[]).some((flag)=>mergedIds.has(String(flag.learning_unit_id)))){
        return {ok:false,reason:'TPF02_MERGE_COMPRESSION_DECOMPOSITION_GUARD_FAILED'};
      }
      return validated;
    },
    provenanceValidator:fullProvenanceValidator(sourceRefs),
  };
}

function curriculumAuditRequest({course,sources,regenerationContext=null}){
  const academicInput=withRegenerationContext(buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.SINGLE_PASS}),regenerationContext);
  const sourceRefs=academicInput.source_items.map((item)=>item.source_item_ref);
  const outputSchema=tpf02OutputSchema();
  const request=base({
    capabilityId:'teaching.curriculum.deep_curriculum_audit',
    course,
    taskMode:'DEEP_AUDIT',
    outputSchema,
    contextSpec:tpf02ContextSpec(course,sources,'source_accounting'),
    academicInput,
    provenanceRefs:sourceRefs,
  });
  const validationContext=validationContextFor(academicInput,{allowDecompositionRepair:true});
  return {
    ...request,
    modelContentMode:'TPF02_DIRECT',
    generation:tpf02Generation(academicInput),
    validationContext,
    schemaValidator:out=>validateTpf02Schema(canonicalizeTpf02RuntimeEnvelope(out,academicInput)),
    domainValidator:async out=>validateTpf02Domain(out,validationContext),
    provenanceValidator:fullProvenanceValidator(sourceRefs),
  };
}

function sourceInventoryRequest({course,sources}){
  const academicInput=buildTpf02AcademicInput({course,sources,taskMode:'SOURCE_INVENTORY',executionStage:EXECUTION_STAGES.SOURCE_INVENTORY_STAGE});
  const sourceRefs=academicInput.source_items.map((item)=>item.source_item_ref);
  const outputSchema=tpf02OutputSchema();
  const validationContext=validationContextFor(academicInput);
  return {
    ...base({
      capabilityId:'teaching.curriculum.deep_curriculum_audit',
      course,
      taskMode:'SOURCE_INVENTORY',
      outputSchema,
      contextSpec:tpf02ContextSpec(course,sources,'source_inventory'),
      academicInput,
      provenanceRefs:sourceRefs,
    }),
    modelContentMode:'TPF02_DIRECT',
    generation:tpf02Generation(academicInput),
    validationContext,
    schemaValidator:out=>validateTpf02Schema(canonicalizeTpf02RuntimeEnvelope(out,academicInput)),
    domainValidator:async out=>validateTpf02Domain(out,validationContext),
    provenanceValidator:fullProvenanceValidator(sourceRefs),
  };
}

function strongerStatus(left='ok',right='ok'){
  const a=Object.hasOwn(TPF02_STATUS_PRIORITY,left)?left:'unresolved';
  const b=Object.hasOwn(TPF02_STATUS_PRIORITY,right)?right:'unresolved';
  return TPF02_STATUS_PRIORITY[a]>=TPF02_STATUS_PRIORITY[b]?a:b;
}

function uniqueStrings(values=[]){
  return [...new Set(values.map((value)=>String(value||'').trim()).filter(Boolean))];
}

function uniqueUnresolved(items=[]){
  const seen=new Set();
  const result=[];
  for(const item of items){
    if(!item||typeof item!=='object')continue;
    const key=String(item.unresolved_id||'')||JSON.stringify([
      item.issue,
      item.why_unresolved,
      item.required_next_input_or_review,
      item.blocks_responsible_planning===true,
      ...(item.source_item_refs||[]),
    ]);
    if(seen.has(key))continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function sameStringSet(leftValues=[],rightValues=[]){
  const left=new Set(leftValues),right=new Set(rightValues);
  if(left.size!==right.size)return false;
  for(const value of left)if(!right.has(value))return false;
  return true;
}

function requiredSourceRefs(preparedInventory=[]){
  return uniqueStrings(
    (preparedInventory||[])
      .filter((item)=>String(item?.proposed_scope_classification||'')==='required')
      .map((item)=>item.source_item_ref)
  );
}

function runtimeLineageUnresolvedId(sourceRef,originStatus='ok'){
  return `${TPF02_LINEAGE_UNRESOLVED_PREFIX}${String(originStatus||'unresolved')}:${String(sourceRef||'')}`;
}

function runtimeLineageOriginStatus(item){
  const id=String(item?.unresolved_id||'');
  if(!id.startsWith(TPF02_LINEAGE_UNRESOLVED_PREFIX))return null;
  const rest=id.slice(TPF02_LINEAGE_UNRESOLVED_PREFIX.length);
  const index=rest.indexOf(':');
  return index<0?null:rest.slice(0,index);
}

function isRuntimeLineageUnresolved(item){
  return String(item?.unresolved_id||'').startsWith(TPF02_LINEAGE_UNRESOLVED_PREFIX);
}

function deferUnmappedRequiredSources(output){
  const refs=uniqueStrings(output?.source_to_unit_reconciliation?.unmapped_required_refs||[]);
  if(!refs.length)return output;
  const originStatus=String(output?.status||'unresolved');
  const existing=Array.isArray(output?.unresolved_items)?output.unresolved_items:[];
  const runtimeItems=refs.map((ref)=>({
    unresolved_id:runtimeLineageUnresolvedId(ref,originStatus),
    issue:'Required source has not yet been attached to a Learning Unit.',
    source_item_refs:[ref],
    why_unresolved:'Whole-curriculum synthesis did not assign this required source to a Learning Unit.',
    required_next_input_or_review:'Run bounded TPF-02 Learning Unit lineage completion before Course planning.',
    blocks_responsible_planning:true,
  }));
  return {
    ...output,
    status:strongerStatus(originStatus,'unresolved'),
    review_required:true,
    review_reasons:uniqueStrings([...(output.review_reasons||[]),TPF02_LINEAGE_REPAIR_REVIEW_REASON]),
    unresolved_items:uniqueUnresolved([...existing,...runtimeItems]),
    student_facing_summary_candidate:null,
  };
}

function learningUnitEligibleSourceRefs(preparedInventory=[]){
  return uniqueStrings(
    (preparedInventory||[])
      .filter((item)=>['required','supplementary'].includes(String(item?.proposed_scope_classification||'')))
      .map((item)=>item.source_item_ref)
  );
}

function canonicalizeSynthesisSourceScope(output,preparedInventory=[],authoritativeAuditScope=null){
  if(!output||typeof output!=='object'||Array.isArray(output))return output;
  const eligibleRefs=new Set(learningUnitEligibleSourceRefs(preparedInventory));
  const requiredRefs=uniqueStrings(
    (preparedInventory||[])
      .filter((item)=>String(item?.proposed_scope_classification||'')==='required')
      .map((item)=>item.source_item_ref)
  );

  const learningUnits=Array.isArray(output.learning_units)
    ? output.learning_units.map((unit)=>{
      if(!unit||typeof unit!=='object'||Array.isArray(unit))return unit;
      const sourceItemRefs=Array.isArray(unit.source_item_refs)
        ? uniqueStrings(unit.source_item_refs.filter((ref)=>eligibleRefs.has(String(ref||'').trim())))
        : unit.source_item_refs;
      return {...unit,source_item_refs:sourceItemRefs};
    })
    : output.learning_units;

  if(!Array.isArray(learningUnits))return {...output,learning_units:learningUnits};

  // Topic source membership is a deterministic projection of final Learning Unit
  // lineage. This keeps provisional synthesis repairable when the model omits a
  // required source from every unit, and it prevents excluded source classes
  // from surviving only in Topic metadata.
  const topicSourceRefs=new Map((output.topics||[]).map((topic)=>[String(topic.topic_id),[]]));
  const unitRefsBySource=new Map(requiredRefs.map((ref)=>[ref,[]]));
  for(const unit of learningUnits){
    const unitId=String(unit?.learning_unit_id||'').trim();
    if(!unitId||!Array.isArray(unit?.source_item_refs))continue;
    for(const topicRef of unit.topic_refs||[]){
      const key=String(topicRef);
      if(topicSourceRefs.has(key))topicSourceRefs.get(key).push(...unit.source_item_refs);
    }
    for(const ref of unit.source_item_refs){
      if(unitRefsBySource.has(ref))unitRefsBySource.get(ref).push(unitId);
    }
  }
  const topics=Array.isArray(output.topics)
    ? output.topics.map((topic)=>({
      ...topic,
      source_item_refs:uniqueStrings(topicSourceRefs.get(String(topic.topic_id))||[]),
    }))
    : output.topics;

  const reconciliation={
    ...(output.source_to_unit_reconciliation&&typeof output.source_to_unit_reconciliation==='object'&&!Array.isArray(output.source_to_unit_reconciliation)
      ? output.source_to_unit_reconciliation
      : {}),
    required_item_map:requiredRefs.map((ref)=>({
      source_item_ref:ref,
      learning_unit_refs:uniqueStrings(unitRefsBySource.get(ref)||[]),
    })),
    unmapped_required_refs:requiredRefs.filter((ref)=>(unitRefsBySource.get(ref)||[]).length===0),
  };

  const auditScope=authoritativeAuditScope&&typeof authoritativeAuditScope==='object'&&!Array.isArray(authoritativeAuditScope)
    ? {
      ...(output.audit_scope&&typeof output.audit_scope==='object'&&!Array.isArray(output.audit_scope)?output.audit_scope:{}),
      // source_refs and trusted_scope_version are runtime-owned census fields.
      // Whole-curriculum synthesis must not depend on a large model echo for
      // their completeness; the model owns academic structure, not source identity.
      subject_or_course:String(authoritativeAuditScope.subject_or_course||output?.audit_scope?.subject_or_course||''),
      source_refs:uniqueStrings(authoritativeAuditScope.source_refs||[]),
      trusted_scope_version:String(authoritativeAuditScope.trusted_scope_version||output?.audit_scope?.trusted_scope_version||''),
    }
    : output.audit_scope;

  return {
    ...output,
    audit_scope:auditScope,
    topics,
    learning_units:learningUnits,
    source_to_unit_reconciliation:reconciliation,
  };
}

function applyLineageRepair(baseOutput,repairOutput,{
  repairedRefs=[],
  preparedInventory=[],
  preparedSourceWalk=[],
  stageFindings={},
}={}){
  const repaired=new Set(uniqueStrings(repairedRefs));
  if(!repaired.size)return baseOutput;

  const topics=(baseOutput.topics||[]).map((topic)=>({...topic}));
  const topicIds=new Set(topics.map((topic)=>String(topic.topic_id)));
  for(const topic of repairOutput.topics||[]){
    const id=String(topic?.topic_id||'').trim();
    if(!id||topicIds.has(id))continue;
    topicIds.add(id);
    topics.push({...topic});
  }

  const units=(baseOutput.learning_units||[]).map((unit)=>({...unit,source_item_refs:[...(unit.source_item_refs||[])]}));
  const unitById=new Map(units.map((unit)=>[String(unit.learning_unit_id),unit]));
  for(const patch of repairOutput.learning_units||[]){
    const id=String(patch?.learning_unit_id||'').trim();
    if(!id)continue;
    const refs=uniqueStrings((patch.source_item_refs||[]).filter((ref)=>repaired.has(String(ref))));
    if(!refs.length)continue;
    const existing=unitById.get(id);
    if(existing){
      existing.source_item_refs=uniqueStrings([...(existing.source_item_refs||[]),...refs]);
      continue;
    }
    const added={...patch,source_item_refs:refs};
    units.push(added);
    unitById.set(id,added);
  }

  const runtimeItems=(baseOutput.unresolved_items||[]).filter(isRuntimeLineageUnresolved);
  const originStatuses=uniqueStrings(runtimeItems.map(runtimeLineageOriginStatus));
  const unresolvedItems=(baseOutput.unresolved_items||[]).filter((item)=>{
    if(!isRuntimeLineageUnresolved(item))return true;
    return !(item.source_item_refs||[]).some((ref)=>repaired.has(String(ref)));
  });
  const remainingRuntime=unresolvedItems.filter(isRuntimeLineageUnresolved);
  const nonLineageReviewReasons=(baseOutput.review_reasons||[]).filter((reason)=>reason!==TPF02_LINEAGE_REPAIR_REVIEW_REASON);
  const reviewReasons=remainingRuntime.length
    ? uniqueStrings([...nonLineageReviewReasons,TPF02_LINEAGE_REPAIR_REVIEW_REASON])
    : uniqueStrings(nonLineageReviewReasons);

  let originStatus='ok';
  if(originStatuses.length){
    for(const value of originStatuses)originStatus=strongerStatus(originStatus,value);
  }else{
    originStatus=String(baseOutput.status||'ok');
  }
  let status=strongerStatus(String(stageFindings.status||'ok'),remainingRuntime.length?'unresolved':originStatus);
  if((baseOutput.source_conflicts||[]).some((item)=>item.blocking===true&&item.resolution_status==='unresolved')){
    status=strongerStatus(status,'blocked_authority_conflict');
  }
  if((baseOutput.coverage_gaps||[]).some((item)=>item.blocking===true)){
    status=strongerStatus(status,'blocked_insufficient_sources');
  }
  if(unresolvedItems.some((item)=>item.blocks_responsible_planning===true)
    ||(preparedSourceWalk||[]).some((item)=>item.analysis_status!=='complete')){
    status=strongerStatus(status,'unresolved');
  }

  const reviewRequired=Boolean(
    stageFindings.review_required
    ||reviewReasons.length
    ||status!=='ok'
    ||unresolvedItems.some((item)=>item.blocks_responsible_planning===true)
  );
  const merged={
    ...baseOutput,
    topics,
    learning_units:units,
    status,
    review_required:reviewRequired,
    review_reasons:reviewReasons,
    unresolved_items:unresolvedItems,
    source_inventory:[...preparedInventory],
    audit_scope:{...baseOutput.audit_scope,source_walk:[...preparedSourceWalk]},
    student_facing_summary_candidate:status==='ok'?baseOutput.student_facing_summary_candidate:null,
  };
  return canonicalizeSynthesisSourceScope(merged,preparedInventory);
}

function validateLineageRepairPatch(output,{academicInput,baseOutput,repairRefs=[]}={}){
  const expectedRefs=uniqueStrings(repairRefs);
  const expectedSet=new Set(expectedRefs);
  if(output.input_state_reference!==academicInput.input_state_reference)return {ok:false,reason:'TPF02_LINEAGE_REPAIR_STATE_REFERENCE_MISMATCH'};
  if(output.task_mode!=='LEARNING_UNIT_DECOMPOSITION')return {ok:false,reason:'TPF02_LINEAGE_REPAIR_TASK_MODE_MISMATCH'};
  if(output.execution_stage!==EXECUTION_STAGES.SINGLE_PASS)return {ok:false,reason:'TPF02_LINEAGE_REPAIR_STAGE_MISMATCH'};
  if(!sameStringSet(output.audit_scope?.source_refs||[],expectedRefs))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_SOURCE_CENSUS_MISMATCH'};
  if(String(output.audit_scope?.trusted_scope_version||'')!==String(academicInput.audit_scope.trusted_scope_version||''))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_SCOPE_VERSION_MISMATCH'};
  if((output.source_inventory||[]).length!==0)return {ok:false,reason:'TPF02_LINEAGE_REPAIR_MUST_DEFER_SOURCE_INVENTORY'};
  if((output.audit_scope?.source_walk||[]).length!==0)return {ok:false,reason:'TPF02_LINEAGE_REPAIR_MUST_DEFER_SOURCE_WALK'};
  for(const field of ['assumed_prerequisites','source_conflicts','coverage_gaps','structure_change_proposals','unresolved_items']){
    if((output[field]||[]).length!==0)return {ok:false,reason:`TPF02_LINEAGE_REPAIR_SCOPE_EXCEEDED:${field}`};
  }
  if(output.status!=='ok'||output.review_required!==false||(output.review_reasons||[]).length!==0||output.student_facing_summary_candidate!=null){
    return {ok:false,reason:'TPF02_LINEAGE_REPAIR_COMPLETION_STATE_INVALID'};
  }

  const existingTopicById=new Map((baseOutput.topics||[]).map((topic)=>[String(topic.topic_id),topic]));
  const existingTopicIds=new Set(existingTopicById.keys());
  const newTopicIds=new Set();
  const seenRepairTopicById=new Map();
  const sameTopicStructure=(left,right)=>
    String(left?.title||'')===String(right?.title||'')
    &&JSON.stringify(left?.subtopics||[])===JSON.stringify(right?.subtopics||[]);
  for(const topic of output.topics||[]){
    const id=String(topic?.topic_id||'').trim();
    if(!id)return {ok:false,reason:'TPF02_LINEAGE_REPAIR_TOPIC_ID_INVALID'};

    const repeated=seenRepairTopicById.get(id);
    if(repeated){
      // A structured-output retry can harmlessly repeat the same Topic row.
      // Collapse only an exact structural duplicate; conflicting reuse of the
      // same ID is still rejected and can never reach the canonical artifact.
      if(!sameTopicStructure(topic,repeated))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_TOPIC_ID_CONFLICT'};
      continue;
    }
    seenRepairTopicById.set(id,topic);

    const existing=existingTopicById.get(id);
    if(existing){
      // Existing Topics are immutable in lineage repair. Providers sometimes
      // harmlessly restate one while attaching a source to an existing Learning
      // Unit. Accept only an exact structural restatement; applyLineageRepair()
      // already ignores existing Topic rows, so no rewrite can cross authority.
      if(!sameTopicStructure(topic,existing))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_EXISTING_TOPIC_REWRITE_FORBIDDEN'};
      continue;
    }
    newTopicIds.add(id);
    if((topic.source_item_refs||[]).some((ref)=>!expectedSet.has(String(ref))))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_TOPIC_SOURCE_REF_INVALID'};
  }

  const existingUnitById=new Map((baseOutput.learning_units||[]).map((unit)=>[String(unit.learning_unit_id),unit]));
  const repairUnitIds=new Set();
  for(const unit of output.learning_units||[]){
    const id=String(unit?.learning_unit_id||'').trim();
    if(!id||repairUnitIds.has(id))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_UNIT_ID_INVALID'};
    repairUnitIds.add(id);
  }
  const existingAssumedIds=new Set((baseOutput.assumed_prerequisites||[]).map((item)=>String(item.assumed_prerequisite_id)));
  const allowedTopicIds=new Set([...existingTopicIds,...newTopicIds]);
  const allowedPrerequisiteIds=new Set([...existingUnitById.keys(),...repairUnitIds,...existingAssumedIds]);
  const covered=new Set();

  for(const unit of output.learning_units||[]){
    const id=String(unit.learning_unit_id);
    const refs=uniqueStrings(unit.source_item_refs||[]);
    if(!refs.length||refs.some((ref)=>!expectedSet.has(ref)))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_UNIT_SOURCE_REF_INVALID'};
    for(const ref of refs)covered.add(ref);
    const existing=existingUnitById.get(id);
    if(existing){
      if(existing.criticality==='enrichment')return {ok:false,reason:'TPF02_LINEAGE_REPAIR_REQUIRED_SOURCE_ENRICHMENT_FORBIDDEN'};
      continue;
    }
    if(unit.criticality==='enrichment')return {ok:false,reason:'TPF02_LINEAGE_REPAIR_REQUIRED_SOURCE_ENRICHMENT_FORBIDDEN'};
    if((unit.topic_refs||[]).some((ref)=>!allowedTopicIds.has(String(ref))))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_TOPIC_REF_UNKNOWN'};
    if((unit.prerequisite_refs||[]).some((ref)=>String(ref)===id||!allowedPrerequisiteIds.has(String(ref))))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_PREREQUISITE_REF_UNKNOWN'};
    if((unit.gap_refs||[]).length!==0)return {ok:false,reason:'TPF02_LINEAGE_REPAIR_NEW_GAP_FORBIDDEN'};
  }

  if(!sameStringSet([...covered],expectedRefs))return {ok:false,reason:'TPF02_LINEAGE_REPAIR_SOURCE_CENSUS_INCOMPLETE'};
  return {ok:true,value:output};
}

function lineageRepairRequest({
  course,
  sources,
  baseOutput,
  preparedInventory,
  preparedSourceWalk,
  stageFindings,
  repairRefs,
}={}){
  const requestedRefs=uniqueStrings(repairRefs);
  const requestedSet=new Set(requestedRefs);
  const repairSources=(sources||[]).filter((source)=>requestedSet.has(`source:${String(source?.source_content_item_id||'').trim()}`));
  if(repairSources.length!==requestedRefs.length){
    const error=new Error('TPF-02 lineage completion could not resolve every runtime-owned source reference.');
    error.code='TEACHING_TPF02_LINEAGE_REPAIR_SOURCE_MISSING';
    throw error;
  }
  const academicBase=buildTpf02AcademicInput({
    course,
    sources:repairSources,
    taskMode:'LEARNING_UNIT_DECOMPOSITION',
    executionStage:EXECUTION_STAGES.SINGLE_PASS,
  });
  const canonicalInventory=(preparedInventory||[]).filter((item)=>requestedSet.has(String(item.source_item_ref)));
  if(canonicalInventory.length!==requestedRefs.length||canonicalInventory.some((item)=>item.proposed_scope_classification!=='required')){
    const error=new Error('TPF-02 lineage completion is restricted to prepared required sources.');
    error.code='TEACHING_TPF02_LINEAGE_REPAIR_SCOPE_INVALID';
    throw error;
  }
  const academicInput=Object.freeze({
    ...academicBase,
    lineage_repair_context:Object.freeze({
      mode:'REQUIRED_SOURCE_LINEAGE_COMPLETION',
      canonical_source_inventory:Object.freeze(canonicalInventory.map((item)=>Object.freeze({...item}))),
      existing_topics:Object.freeze((baseOutput.topics||[]).map((topic)=>Object.freeze({
        topic_id:topic.topic_id,
        title:topic.title,
        subtopics:Object.freeze((topic.subtopics||[]).map((subtopic)=>Object.freeze({
          subtopic_id:subtopic.subtopic_id,
          title:subtopic.title,
        }))),
      }))),
      existing_learning_units:Object.freeze((baseOutput.learning_units||[]).map((unit)=>Object.freeze({
        // Existing-unit attachment still has to satisfy the canonical TPF-02
        // Learning Unit schema before the server can consume only its lineage
        // delta. Give the model every immutable field it must echo so it never
        // has to invent filler just to attach a source ref.
        learning_unit_id:unit.learning_unit_id,
        title:unit.title,
        intended_competence:unit.intended_competence,
        topic_refs:Object.freeze([...(unit.topic_refs||[])]),
        subtopic_id:unit.subtopic_id==null?null:unit.subtopic_id,
        prerequisite_refs:Object.freeze([...(unit.prerequisite_refs||[])]),
        dependency_type_notes:unit.dependency_type_notes==null?null:unit.dependency_type_notes,
        criticality:unit.criticality,
        criticality_basis:unit.criticality_basis,
        proposed_exit_evidence:unit.proposed_exit_evidence,
        gap_refs:Object.freeze([...(unit.gap_refs||[])]),
        uncertainties:Object.freeze([...(unit.uncertainties||[])]),
      }))),
      existing_assumed_prerequisite_refs:Object.freeze((baseOutput.assumed_prerequisites||[]).map((item)=>item.assumed_prerequisite_id)),
      existing_gap_refs:Object.freeze((baseOutput.coverage_gaps||[]).map((item)=>item.gap_id)),
    }),
  });
  const outputSchema=tpf02OutputSchema();
  const fullAcademicInput=buildTpf02AcademicInput({
    course,
    sources,
    taskMode:'DEEP_AUDIT',
    executionStage:EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const fullValidationContext=validationContextFor(fullAcademicInput,{allowDecompositionRepair:true});
  const fullSourceRefs=fullAcademicInput.source_items.map((item)=>item.source_item_ref);
  const request=base({
    capabilityId:'teaching.curriculum.learning_unit_decomposition',
    course,
    taskMode:'LEARNING_UNIT_DECOMPOSITION',
    outputSchema,
    contextSpec:tpf02ContextSpec(course,repairSources,'required_source_lineage_completion'),
    academicInput,
    provenanceRefs:requestedRefs,
  });
  return {
    ...request,
    directive:{
      ...request.directive,
      bounded_actions:[
        'complete Learning Unit lineage only for the supplied unmapped required sources',
        'preserve the existing validated curriculum structure while proposing bounded lineage attachments or additional units',
      ],
      allowed_operations:[
        'attach supplied required source refs to academically matching existing Learning Units',
        'propose additional non-enrichment Learning Units and Topics when existing units are not academically suitable',
      ],
      prohibited_operations:[
        'mutate authoritative state',
        'reclassify source scope',
        'remove or rewrite existing Learning Units or Topics',
        'map source refs outside the supplied repair census',
        'select provider or model',
      ],
      evidence_purpose:'required_source_lineage_completion',
    },
    modelContentMode:'TPF02_DIRECT',
    generation:tpf02Generation(academicInput),
    schemaValidator:out=>validateTpf02Schema(canonicalizeLineageRepairOutput(out,{academicInput,baseOutput,repairRefs:requestedRefs})),
    domainValidator:async out=>{
      const patch=validateLineageRepairPatch(out,{academicInput,baseOutput,repairRefs:requestedRefs});
      if(!patch.ok)return patch;
      const merged=applyLineageRepair(baseOutput,patch.value,{
        repairedRefs:requestedRefs,
        preparedInventory,
        preparedSourceWalk,
        stageFindings,
      });
      return validateTpf02Domain(merged,fullValidationContext);
    },
    provenanceValidator:fullProvenanceValidator(fullSourceRefs),
    validationContext:fullValidationContext,
  };
}


function selectDecompositionRepairScope({
  baseOutput,
  decompositionState,
  sources,
  sourceBatchSize=TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE,
}={}){
  const units=Array.isArray(baseOutput?.learning_units)?baseOutput.learning_units:[];
  const unitById=new Map(units.map((unit)=>[String(unit.learning_unit_id),unit]));
  const pendingFlags=Array.isArray(decompositionState?.pending_unit_flags)?decompositionState.pending_unit_flags:[];
  let targetFlag=pendingFlags.find((flag)=>unitById.has(String(flag?.learning_unit_id||'')))||null;
  let targetUnit=targetFlag?unitById.get(String(targetFlag.learning_unit_id)):null;

  if(!targetUnit&&decompositionState?.course_ratio_flag===true&&decompositionState?.course_ratio_justified!==true){
    const justified=new Set((decompositionState.justified_unit_ids||[]).map(String));
    targetUnit=[...units]
      .filter((unit)=>!justified.has(String(unit.learning_unit_id)))
      .sort((left,right)=>(right.source_item_refs||[]).length-(left.source_item_refs||[]).length)[0]||null;
  }
  if(!targetUnit)return null;

  const targetUnitId=String(targetUnit.learning_unit_id);
  const allSourceRefs=uniqueStrings(targetUnit.source_item_refs||[]);
  const repairSourceRefs=allSourceRefs.slice(0,Math.max(1,Number(sourceBatchSize)||TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE));
  const repairRefSet=new Set(repairSourceRefs);
  const sourceByRef=new Map((sources||[]).map((source)=>[`source:${String(source?.source_content_item_id||'').trim()}`,source]));
  const scopedSources=repairSourceRefs.map((ref)=>sourceByRef.get(ref)).filter(Boolean);
  if(scopedSources.length!==repairSourceRefs.length){
    const error=new Error('TPF-02 decomposition repair could not resolve every scoped runtime source.');
    error.code='TEACHING_TPF02_DECOMPOSITION_REPAIR_SOURCE_MISSING';
    throw error;
  }

  const topicIds=uniqueStrings(targetUnit.topic_refs||[]);
  const topicById=new Map((baseOutput.topics||[]).map((topic)=>[String(topic.topic_id),topic]));
  const currentTopics=topicIds.map((id)=>topicById.get(id)).filter(Boolean).map((topic)=>Object.freeze({
    topic_id:String(topic.topic_id),
    title:String(topic.title),
    subtopics:Object.freeze((topic.subtopics||[]).map((subtopic)=>Object.freeze({
      subtopic_id:String(subtopic.subtopic_id),
      title:String(subtopic.title),
    }))),
  }));
  if(currentTopics.length!==topicIds.length){
    const error=new Error('TPF-02 decomposition repair target references an unknown Topic.');
    error.code='TEACHING_TPF02_DECOMPOSITION_REPAIR_TOPIC_MISSING';
    throw error;
  }

  const allUnitOutline=Object.freeze(units.map((unit)=>Object.freeze({
    learning_unit_id:String(unit.learning_unit_id),
    title:String(unit.title),
    intended_competence:String(unit.intended_competence),
    source_ref_count:(unit.source_item_refs||[]).length,
    topic_refs:Object.freeze([...(unit.topic_refs||[])]),
    subtopic_id:unit.subtopic_id==null?null:String(unit.subtopic_id),
    criticality:String(unit.criticality),
  })));

  return Object.freeze({
    target_unit_id:targetUnitId,
    target_unit_flag:targetFlag?Object.freeze({
      learning_unit_id:String(targetFlag.learning_unit_id),
      reasons:Object.freeze([...(targetFlag.reasons||[])]),
    }):null,
    target_unit:Object.freeze({
      ...targetUnit,
      source_item_refs:Object.freeze([...allSourceRefs]),
      topic_refs:Object.freeze([...(targetUnit.topic_refs||[])]),
      prerequisite_refs:Object.freeze([...(targetUnit.prerequisite_refs||[])]),
      gap_refs:Object.freeze([...(targetUnit.gap_refs||[])]),
      uncertainties:Object.freeze([...(targetUnit.uncertainties||[])]),
    }),
    repair_source_refs:Object.freeze(repairSourceRefs),
    untouched_source_refs:Object.freeze(allSourceRefs.filter((ref)=>!repairRefSet.has(ref))),
    scoped_sources:Object.freeze(scopedSources),
    current_topics:Object.freeze(currentTopics),
    all_unit_outline:allUnitOutline,
    course_ratio_flag:decompositionState?.course_ratio_flag===true,
    course_ratio_justified:decompositionState?.course_ratio_justified===true,
    unit_required_ratio:Number(decompositionState?.unit_required_ratio)||0,
    min_units_per_required_source:Number(decompositionState?.min_units_per_required_source)||0,
  });
}

function validateDecompositionRepairPatch(output,{academicInput,baseOutput,repairScope}={}){
  const schema=validateTpf02DecompositionPatchSchema(output);
  if(!schema.ok)return schema;
  const scope=repairScope||academicInput?.decomposition_repair_context?.repair_scope;
  if(!scope)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_SCOPE_REQUIRED'};
  const targetUnitId=String(scope.target_unit_id||'');
  const baseUnit=(baseOutput.learning_units||[]).find((unit)=>String(unit.learning_unit_id)===targetUnitId);
  if(!baseUnit)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_TARGET_UNIT_UNKNOWN'};
  if(output.input_state_reference!==academicInput.input_state_reference)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_STATE_REFERENCE_MISMATCH'};
  if(output.target_unit_id!==targetUnitId)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_TARGET_UNIT_MISMATCH'};

  const repairRefs=uniqueStrings(scope.repair_source_refs||[]);
  const repairRefSet=new Set(repairRefs);
  const untouchedRefs=uniqueStrings(scope.untouched_source_refs||[]);
  const existingUnitIds=new Set((baseOutput.learning_units||[]).map((unit)=>String(unit.learning_unit_id)));
  const assumedIds=new Set((baseOutput.assumed_prerequisites||[]).map((item)=>String(item.assumed_prerequisite_id)));

  const unitJustification=String(output.unit_justification||'').trim();
  const courseJustification=String(output.course_ratio_justification||'').trim();
  if(output.decision==='keep'){
    if(!unitJustification.startsWith(DECOMPOSITION_JUSTIFICATION_PREFIX)||unitJustification.length<=DECOMPOSITION_JUSTIFICATION_PREFIX.length+12)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_KEEP_JUSTIFICATION_PREFIX_REQUIRED'};
    if(courseJustification){
      if(scope.course_ratio_flag!==true)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_COURSE_JUSTIFICATION_OUT_OF_SCOPE'};
      if(!courseJustification.startsWith(DECOMPOSITION_JUSTIFICATION_PREFIX)||courseJustification.length<=DECOMPOSITION_JUSTIFICATION_PREFIX.length+12)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_COURSE_JUSTIFICATION_PREFIX_REQUIRED'};
    }
    if(scope.course_ratio_flag===true&&!scope.target_unit_flag&&!courseJustification)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_NO_PROGRESS'};
    return {ok:true,value:output};
  }

  if(output.decision==='unresolved'){
    if(String(output.unresolved_reason||'').trim().length<12||String(output.required_next_input_or_review||'').trim().length<8){
      return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_UNRESOLVED_DETAIL_TOO_THIN'};
    }
    return {ok:true,value:output};
  }

  if(courseJustification)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_SPLIT_COURSE_JUSTIFICATION_FORBIDDEN'};
  const outputUnits=output.resulting_units||[];
  const outputUnitById=new Map();
  for(const unit of outputUnits){
    const id=String(unit.learning_unit_id||'').trim();
    if(outputUnitById.has(id))return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_UNIT_ID_DUPLICATE'};
    if(existingUnitIds.has(id)&&id!==targetUnitId)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_UNAFFECTED_UNIT_REWRITE_FORBIDDEN'};
    if((unit.source_item_refs||[]).some((ref)=>!repairRefSet.has(String(ref))))return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_UNIT_SOURCE_REF_INVALID'};
    if(id!==targetUnitId&&(unit.source_item_refs||[]).length===0)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_NEW_UNIT_SOURCE_REQUIRED'};
    outputUnitById.set(id,unit);
  }
  const continuity=outputUnitById.get(targetUnitId);
  if(!continuity)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_CONTINUITY_UNIT_REQUIRED'};
  if((continuity.source_item_refs||[]).length===0&&untouchedRefs.length===0)return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_CONTINUITY_SOURCE_REQUIRED'};

  const mappedRepairRefs=new Set(outputUnits.flatMap((unit)=>unit.source_item_refs||[]).map(String));
  if(mappedRepairRefs.size!==repairRefSet.size||repairRefs.some((ref)=>!mappedRepairRefs.has(ref))){
    return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_BOUNDED_LINEAGE_INCOMPLETE'};
  }

  const allowedPrereqs=new Set([...existingUnitIds,...outputUnitById.keys(),...assumedIds]);
  for(const unit of outputUnits){
    if((unit.prerequisite_refs||[]).some((ref)=>!allowedPrereqs.has(String(ref)))){
      return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_PREREQUISITE_REF_UNKNOWN'};
    }
    if((unit.prerequisite_refs||[]).includes(unit.learning_unit_id)){
      return {ok:false,reason:'TPF02_DECOMPOSITION_REPAIR_SELF_PREREQUISITE'};
    }
  }
  return {ok:true,value:output};
}

function applyDecompositionRepair(baseOutput,repairOutput,{preparedInventory=[],preparedSourceWalk=[],repairScope}={}){
  const targetUnitId=String(repairScope?.target_unit_id||'');
  const baseUnit=(baseOutput.learning_units||[]).find((unit)=>String(unit.learning_unit_id)===targetUnitId);
  if(!baseUnit){
    const error=new Error('TPF-02 decomposition repair target disappeared before patch application.');
    error.code='TEACHING_TPF02_DECOMPOSITION_REPAIR_TARGET_MISSING';
    throw error;
  }

  const untouchedUnits=(baseOutput.learning_units||[])
    .filter((unit)=>String(unit.learning_unit_id)!==targetUnitId)
    .map((unit)=>({...unit,source_item_refs:[...(unit.source_item_refs||[])],topic_refs:[...(unit.topic_refs||[])],prerequisite_refs:[...(unit.prerequisite_refs||[])],gap_refs:[...(unit.gap_refs||[])],uncertainties:[...(unit.uncertainties||[])]}));

  let replacementUnits=[];
  let structureChangeProposals=[...(baseOutput.structure_change_proposals||[])];
  let reviewReasons=[...(baseOutput.review_reasons||[])];
  let reviewRequired=Boolean(baseOutput.review_required);

  if(repairOutput.decision==='keep'){
    replacementUnits=[{
      ...baseUnit,
      source_item_refs:[...(baseUnit.source_item_refs||[])],
      topic_refs:[...(baseUnit.topic_refs||[])],
      prerequisite_refs:[...(baseUnit.prerequisite_refs||[])],
      gap_refs:[...(baseUnit.gap_refs||[])],
      uncertainties:uniqueStrings([...(baseUnit.uncertainties||[]),String(repairOutput.unit_justification)]),
    }];
    if(repairOutput.course_ratio_justification)reviewReasons=uniqueStrings([...reviewReasons,String(repairOutput.course_ratio_justification)]);
    reviewRequired=true;
  }else if(repairOutput.decision==='unresolved'){
    replacementUnits=[{
      ...baseUnit,
      source_item_refs:[...(baseUnit.source_item_refs||[])],
      topic_refs:[...(baseUnit.topic_refs||[])],
      prerequisite_refs:[...(baseUnit.prerequisite_refs||[])],
      gap_refs:[...(baseUnit.gap_refs||[])],
      uncertainties:[...(baseUnit.uncertainties||[])],
    }];
    reviewRequired=true;
  }else{
    const untouchedRefs=uniqueStrings(repairScope?.untouched_source_refs||[]);
    const resultIds=(repairOutput.resulting_units||[]).map((unit)=>String(unit.learning_unit_id));
    replacementUnits=(repairOutput.resulting_units||[]).map((patchUnit)=>{
      const continuity=String(patchUnit.learning_unit_id)===targetUnitId;
      return {
        learning_unit_id:String(patchUnit.learning_unit_id),
        title:String(patchUnit.title),
        intended_competence:String(patchUnit.intended_competence),
        source_item_refs:uniqueStrings([...(continuity?untouchedRefs:[]),...(patchUnit.source_item_refs||[])]),
        topic_refs:[...(baseUnit.topic_refs||[])],
        subtopic_id:baseUnit.subtopic_id==null?null:String(baseUnit.subtopic_id),
        prerequisite_refs:uniqueStrings([...(continuity?(baseUnit.prerequisite_refs||[]):[]),...(patchUnit.prerequisite_refs||[])]),
        dependency_type_notes:patchUnit.dependency_type_notes==null?null:String(patchUnit.dependency_type_notes),
        criticality:String(patchUnit.criticality),
        criticality_basis:String(patchUnit.criticality_basis),
        proposed_exit_evidence:String(patchUnit.proposed_exit_evidence),
        gap_refs:continuity?[...(baseUnit.gap_refs||[])]:[],
        uncertainties:uniqueStrings([...(continuity?(baseUnit.uncertainties||[]):[]),...(patchUnit.uncertainties||[])]),
      };
    });
    structureChangeProposals.push({
      type:'split',
      affected_unit_refs:[targetUnitId],
      resulting_unit_refs:resultIds,
      source_item_refs_before:[...(baseUnit.source_item_refs||[])],
      source_item_refs_after:uniqueStrings(replacementUnits.flatMap((unit)=>unit.source_item_refs||[])),
      proposal:`Split ${targetUnitId} into independently teachable and verifiable competence units.`,
      reason:String(repairOutput.split_reason),
    });
  }

  const unresolvedRepair=repairOutput.decision==='unresolved';
  const unresolvedItems=unresolvedRepair
    ? uniqueUnresolved([
      ...(baseOutput.unresolved_items||[]),
      {
        unresolved_id:`decomposition-repair:${targetUnitId}`,
        issue:'Learning Unit decomposition could not be resolved from the bounded evidence.',
        source_item_refs:uniqueStrings(repairScope?.repair_source_refs||[]),
        why_unresolved:String(repairOutput.unresolved_reason),
        required_next_input_or_review:String(repairOutput.required_next_input_or_review),
        blocks_responsible_planning:true,
      },
    ])
    : [...(baseOutput.unresolved_items||[])];
  const merged={
    ...baseOutput,
    topics:(baseOutput.topics||[]).map((topic)=>({...topic,source_item_refs:[...(topic.source_item_refs||[])],subtopics:(topic.subtopics||[]).map((subtopic)=>({...subtopic}))})),
    learning_units:[...untouchedUnits,...replacementUnits],
    structure_change_proposals:structureChangeProposals,
    unresolved_items:unresolvedItems,
    status:unresolvedRepair?strongerStatus(baseOutput.status,'unresolved'):baseOutput.status,
    review_required:reviewRequired,
    review_reasons:uniqueStrings(reviewReasons),
    source_inventory:[...preparedInventory],
    audit_scope:{...baseOutput.audit_scope,source_walk:[...preparedSourceWalk]},
    student_facing_summary_candidate:unresolvedRepair?null:baseOutput.student_facing_summary_candidate,
  };
  return canonicalizeSynthesisSourceScope(merged,preparedInventory);
}

function decompositionRepairRequest({
  course,
  sources,
  baseOutput,
  preparedInventory,
  preparedSourceWalk,
  decompositionState,
}={}){
  const repairScope=selectDecompositionRepairScope({baseOutput,decompositionState,sources});
  if(!repairScope){
    const error=new Error('TPF-02 decomposition repair was requested without a repairable Learning Unit.');
    error.code='TEACHING_TPF02_DECOMPOSITION_REPAIR_SCOPE_EMPTY';
    throw error;
  }
  const academicBase=buildTpf02AcademicInput({
    course,
    sources:repairScope.scoped_sources,
    taskMode:'SPLIT_UNIT',
    executionStage:EXECUTION_STAGES.SINGLE_PASS,
  });
  const repairRefSet=new Set(repairScope.repair_source_refs);
  const canonicalInventory=(preparedInventory||[]).filter((item)=>repairRefSet.has(String(item.source_item_ref)));
  if(canonicalInventory.length!==repairScope.repair_source_refs.length){
    const error=new Error('TPF-02 decomposition repair is missing prepared source accounting for its bounded evidence set.');
    error.code='TEACHING_TPF02_DECOMPOSITION_REPAIR_INVENTORY_MISMATCH';
    throw error;
  }
  const academicInput=Object.freeze({
    ...academicBase,
    decomposition_repair_context:Object.freeze({
      mode:'DECOMPOSITION_REPAIR',
      repair_scope:Object.freeze({
        target_unit_id:repairScope.target_unit_id,
        target_unit_flag:repairScope.target_unit_flag,
        repair_source_refs:repairScope.repair_source_refs,
        untouched_source_refs:repairScope.untouched_source_refs,
        course_ratio_flag:repairScope.course_ratio_flag,
        course_ratio_justified:repairScope.course_ratio_justified,
        unit_required_ratio:repairScope.unit_required_ratio,
        min_units_per_required_source:repairScope.min_units_per_required_source,
      }),
      canonical_source_inventory:Object.freeze(canonicalInventory.map((item)=>Object.freeze({...item}))),
      current_topics:repairScope.current_topics,
      current_learning_unit:repairScope.target_unit,
      all_unit_outline:repairScope.all_unit_outline,
      existing_assumed_prerequisite_refs:Object.freeze((baseOutput.assumed_prerequisites||[]).map((item)=>String(item.assumed_prerequisite_id))),
      existing_gap_refs:Object.freeze((baseOutput.coverage_gaps||[]).map((item)=>String(item.gap_id))),
    }),
  });
  const outputSchema=tpf02DecompositionPatchOutputSchema();
  const fullAcademicInput=buildTpf02AcademicInput({
    course,
    sources,
    taskMode:'DEEP_AUDIT',
    executionStage:EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const fullValidationContext=validationContextFor(fullAcademicInput,{allowDecompositionRepair:true});
  const sourceRefs=fullAcademicInput.source_items.map((item)=>item.source_item_ref);
  const request=base({
    capabilityId:'teaching.curriculum.learning_unit_decomposition',
    course,
    taskMode:'SPLIT_UNIT',
    outputSchema,
    contextSpec:tpf02ContextSpec(course,repairScope.scoped_sources,'curriculum_decomposition_repair'),
    academicInput,
    provenanceRefs:sourceRefs,
  });
  return {
    ...request,
    directive:{
      ...request.directive,
      bounded_actions:[
        'repair exactly one deterministic TPF-02 decomposition target with bounded source evidence',
        'split only the flagged Learning Unit while preserving all unexamined source lineage on its continuity unit',
      ],
      allowed_operations:[
        'split the target Learning Unit using only the supplied repair source evidence',
        'retain the target unit id as the continuity unit and add bounded new Learning Units inside the same Topic/Subtopic placement',
        'record a concise decomposition justification when the target genuinely passes T1-T5 despite a proxy flag',
      ],
      prohibited_operations:[
        'mutate authoritative state',
        'reclassify source scope',
        'drop or move unexamined source lineage',
        'rewrite unaffected Learning Units or Topics',
        'merge Learning Units',
        'invent source identity',
        'change non-structural Curriculum Audit findings',
        'select provider or model',
      ],
      evidence_purpose:'curriculum_decomposition_repair',
    },
    modelContentMode:'TPF02_DIRECT',
    generation:tpf02Generation(academicInput,TPF02_DECOMPOSITION_PATCH_RESPONSE_SCHEMA),
    schemaValidator:out=>validateTpf02DecompositionPatchSchema(canonicalizeTpf02RuntimeEnvelope(out,academicInput,{canonicalizeAuditScope:false})),
    domainValidator:async out=>{
      const patch=validateDecompositionRepairPatch(out,{academicInput,baseOutput,repairScope});
      if(!patch.ok)return patch;
      const merged=applyDecompositionRepair(baseOutput,patch.value,{preparedInventory,preparedSourceWalk,repairScope});
      return validateTpf02Domain(merged,fullValidationContext);
    },
    provenanceValidator:fullProvenanceValidator(sourceRefs),
    validationContext:fullValidationContext,
    repairScope,
  };
}


function shouldUseProgressiveStructure({sources=[]}={}){
  return Array.isArray(sources)&&sources.length>TPF02_PROGRESSIVE_STRUCTURE_SOURCE_COUNT_THRESHOLD;
}

function validateStructurePassPatch(output,{academicInput,canonicalInventory=[]}={}){
  const schema=validateTpf02Schema(output);
  if(!schema.ok)return schema;
  const expectedRefs=academicInput.source_items.map((item)=>item.source_item_ref);
  const expectedSet=new Set(expectedRefs);
  const inventoryByRef=new Map((canonicalInventory||[]).map((item)=>[String(item.source_item_ref),item]));
  const eligibleSet=new Set(
    [...inventoryByRef.values()]
      .filter((item)=>['required','supplementary'].includes(String(item.proposed_scope_classification||'')))
      .map((item)=>String(item.source_item_ref))
  );
  if(inventoryByRef.size!==expectedSet.size||expectedRefs.some((ref)=>!inventoryByRef.has(ref))){
    return {ok:false,reason:'TPF02_STRUCTURE_PASS_PREPARED_CENSUS_MISMATCH'};
  }
  if(output.input_state_reference!==academicInput.input_state_reference)return {ok:false,reason:'TPF02_STRUCTURE_PASS_STATE_REFERENCE_MISMATCH'};
  if(output.task_mode!=='LEARNING_UNIT_DECOMPOSITION')return {ok:false,reason:'TPF02_STRUCTURE_PASS_TASK_MODE_MISMATCH'};
  if(output.execution_stage!==EXECUTION_STAGES.SINGLE_PASS)return {ok:false,reason:'TPF02_STRUCTURE_PASS_STAGE_MISMATCH'};
  if(!sameStringSet(output.audit_scope?.source_refs||[],expectedRefs))return {ok:false,reason:'TPF02_STRUCTURE_PASS_SOURCE_CENSUS_MISMATCH'};
  if(String(output.audit_scope?.trusted_scope_version||'')!==String(academicInput.audit_scope.trusted_scope_version||'')){
    return {ok:false,reason:'TPF02_STRUCTURE_PASS_SCOPE_VERSION_MISMATCH'};
  }
  if((output.source_inventory||[]).length!==0)return {ok:false,reason:'TPF02_STRUCTURE_PASS_MUST_DEFER_SOURCE_INVENTORY'};
  if((output.audit_scope?.source_walk||[]).length!==0)return {ok:false,reason:'TPF02_STRUCTURE_PASS_MUST_DEFER_SOURCE_WALK'};
  for(const field of ['source_conflicts','coverage_gaps','structure_change_proposals','unresolved_items']){
    if((output[field]||[]).length!==0)return {ok:false,reason:`TPF02_STRUCTURE_PASS_SCOPE_EXCEEDED:${field}`};
  }
  if((output.source_to_unit_reconciliation?.required_item_map||[]).length
    ||(output.source_to_unit_reconciliation?.unmapped_required_refs||[]).length){
    return {ok:false,reason:'TPF02_STRUCTURE_PASS_RECONCILIATION_SERVER_OWNED'};
  }
  if(output.status!=='ok'||output.review_required!==false||(output.review_reasons||[]).length!==0||output.student_facing_summary_candidate!=null){
    return {ok:false,reason:'TPF02_STRUCTURE_PASS_COMPLETION_STATE_INVALID'};
  }

  const topicIds=new Set();
  for(const topic of output.topics||[]){
    const id=String(topic?.topic_id||'').trim();
    if(!id||topicIds.has(id))return {ok:false,reason:'TPF02_STRUCTURE_PASS_TOPIC_ID_INVALID'};
    topicIds.add(id);
    if((topic.source_item_refs||[]).some((ref)=>!eligibleSet.has(String(ref)))){
      return {ok:false,reason:'TPF02_STRUCTURE_PASS_TOPIC_SOURCE_SCOPE_INVALID'};
    }
  }

  const assumedIds=new Set();
  for(const item of output.assumed_prerequisites||[]){
    const id=String(item?.assumed_prerequisite_id||'').trim();
    if(!id||assumedIds.has(id))return {ok:false,reason:'TPF02_STRUCTURE_PASS_ASSUMED_ID_INVALID'};
    assumedIds.add(id);
  }
  const unitIds=new Set();
  for(const unit of output.learning_units||[]){
    const id=String(unit?.learning_unit_id||'').trim();
    if(!id||unitIds.has(id))return {ok:false,reason:'TPF02_STRUCTURE_PASS_UNIT_ID_INVALID'};
    unitIds.add(id);
  }
  for(const unit of output.learning_units||[]){
    const refs=uniqueStrings(unit.source_item_refs||[]);
    if(!refs.length||refs.some((ref)=>!eligibleSet.has(ref)))return {ok:false,reason:'TPF02_STRUCTURE_PASS_UNIT_SOURCE_SCOPE_INVALID'};
    if(unit.criticality==='enrichment'&&refs.some((ref)=>inventoryByRef.get(ref)?.proposed_scope_classification==='required')){
      return {ok:false,reason:'TPF02_STRUCTURE_PASS_REQUIRED_SOURCE_ENRICHMENT_FORBIDDEN'};
    }
    if((unit.topic_refs||[]).some((ref)=>!topicIds.has(String(ref))))return {ok:false,reason:'TPF02_STRUCTURE_PASS_TOPIC_REF_UNKNOWN'};
    if((unit.gap_refs||[]).length)return {ok:false,reason:'TPF02_STRUCTURE_PASS_GAP_REF_FORBIDDEN'};
    if((unit.prerequisite_refs||[]).some((ref)=>{
      const normalized=String(ref);
      return normalized===String(unit.learning_unit_id)||(!unitIds.has(normalized)&&!assumedIds.has(normalized));
    }))return {ok:false,reason:'TPF02_STRUCTURE_PASS_PREREQUISITE_REF_UNKNOWN'};
  }
  const hierarchy=validateHierarchy(output);if(!hierarchy.ok)return hierarchy;
  // A bounded progressive structure pass is a provisional hint, not the
  // authoritative whole-Course decomposition. Preserve hard schema, provenance
  // and hierarchy checks here, but carry an obvious G11 breadth signal forward
  // to whole-curriculum synthesis instead of cancelling the entire audit before
  // synthesis can inspect the complete source evidence. The assembled audit
  // still runs G11 and the bounded SPLIT_UNIT repair path fail-closed.
  const decomposition=validateDecomposition(output,inventoryByRef,{
    decompositionLimits:academicInput.constraints?.decomposition_limits,
    allowDecompositionRepair:true,
  });
  if(!decomposition.ok)return decomposition;
  return {ok:true,value:output};
}

function structurePassRequest({course,sources,preparedInventory,batchIndex=0,regenerationContext=null}={}){
  const academicBase=buildTpf02AcademicInput({
    course,
    sources,
    taskMode:'LEARNING_UNIT_DECOMPOSITION',
    executionStage:EXECUTION_STAGES.SINGLE_PASS,
  });
  const batchRefs=new Set(academicBase.source_items.map((item)=>item.source_item_ref));
  const canonicalInventory=(preparedInventory||[]).filter((item)=>batchRefs.has(String(item.source_item_ref)));
  if(canonicalInventory.length!==academicBase.source_items.length){
    const error=new Error('TPF-02 bounded structure pass is missing prepared source accounting.');
    error.code='TEACHING_TPF02_STRUCTURE_PASS_PREPARED_CENSUS_MISMATCH';
    throw error;
  }
  const academicInput=Object.freeze({
    ...academicBase,
    ...(regenerationContext?{regeneration_context:regenerationContext}:{}),
    structure_pass_context:Object.freeze({
      mode:'BOUNDED_CURRICULUM_STRUCTURE',
      batch_index:Number(batchIndex),
      canonical_source_inventory:Object.freeze(canonicalInventory.map((item)=>Object.freeze({...item}))),
    }),
  });
  const outputSchema=tpf02OutputSchema();
  const request=base({
    capabilityId:'teaching.curriculum.learning_unit_decomposition',
    course,
    taskMode:'LEARNING_UNIT_DECOMPOSITION',
    outputSchema,
    contextSpec:tpf02ContextSpec(course,sources,'bounded_curriculum_structure'),
    academicInput,
    provenanceRefs:academicBase.source_items.map((item)=>item.source_item_ref),
  });
  return {
    ...request,
    directive:{
      ...request.directive,
      bounded_actions:[
        'build a competence-level candidate curriculum structure for this bounded prepared source batch without collapsing distinct assessable capabilities',
        'preserve runtime source identity and prepared source classification',
      ],
      allowed_operations:[
        'propose candidate Topics and non-authoritative Learning Units for this batch',
        'propose batch-local assumed prerequisites when supported',
      ],
      prohibited_operations:[
        'mutate authoritative state',
        'reclassify prepared sources',
        'reference source items outside this batch',
        'make whole-course completeness claims',
        'select provider or model',
      ],
      evidence_purpose:'bounded_curriculum_structure',
    },
    modelContentMode:'TPF02_DIRECT',
    generation:tpf02Generation(academicInput),
    schemaValidator:out=>validateTpf02Schema(canonicalizeStructurePassOutput(out,{academicInput,canonicalInventory})),
    domainValidator:async out=>validateStructurePassPatch(out,{academicInput,canonicalInventory}),
    provenanceValidator:async out=>{
      const allowed=new Set(academicBase.source_items.map((item)=>item.source_item_ref));
      const used=uniqueStrings([
        ...(out?.topics||[]).flatMap((topic)=>topic.source_item_refs||[]),
        ...(out?.learning_units||[]).flatMap((unit)=>unit.source_item_refs||[]),
      ]);
      return {ok:used.every((ref)=>allowed.has(ref)),reason:'TPF02_STRUCTURE_PASS_PROVENANCE_INVALID'};
    },
  };
}

function compactStructureCandidates(stageResults=[]){
  return Object.freeze(stageResults.map((result,batchIndex)=>{
    const output=result?.validatedResult?.output;
    if(!output)throw Object.assign(new Error('Validated TPF-02 structure pass produced no candidate artifact.'),{code:'TEACHING_TPF02_STRUCTURE_PASS_OUTPUT_MISSING'});
    const topicById=new Map((output.topics||[]).map((topic)=>[String(topic.topic_id),topic]));
    const subtopicTitleById=new Map();
    for(const topic of output.topics||[]){
      for(const subtopic of topic.subtopics||[])subtopicTitleById.set(String(subtopic.subtopic_id),String(subtopic.title));
    }
    return Object.freeze({
      batch_index:batchIndex,
      learning_units:Object.freeze((output.learning_units||[]).map((unit)=>Object.freeze({
        candidate_unit_ref:`batch-${batchIndex}:unit:${String(unit.learning_unit_id)}`,
        title:String(unit.title),
        intended_competence:String(unit.intended_competence),
        source_item_refs:Object.freeze(uniqueStrings(unit.source_item_refs||[])),
        topic_titles:Object.freeze(uniqueStrings((unit.topic_refs||[]).map((ref)=>String(topicById.get(String(ref))?.title||ref)))),
        subtopic_title:unit.subtopic_id==null?null:(subtopicTitleById.get(String(unit.subtopic_id))||String(unit.subtopic_id)),
        proposed_exit_evidence:String(unit.proposed_exit_evidence),
        criticality:String(unit.criticality),
        prerequisite_candidate_refs:Object.freeze(uniqueStrings(unit.prerequisite_refs||[])),
      }))),
      assumed_prerequisites:Object.freeze((output.assumed_prerequisites||[]).map((item)=>Object.freeze({
        capability:String(item.capability),
        why_required:String(item.why_required),
      }))),
    });
  }));
}

function compactProgressiveSourceEvidence(sourceItems=[]){
  // The inventory and structure stages have already consumed the raw material.
  // Re-sending it here duplicates the largest part of the context and defeats
  // staging for large Courses. Final synthesis needs only stable source
  // identity; its academic evidence comes from the validated prepared
  // inventory and bounded structure candidates.
  return Object.freeze((sourceItems||[]).map((item)=>Object.freeze({
    source_item_ref:String(item.source_item_ref),
    source_kind:item.source_kind==null?null:String(item.source_kind),
  })));
}

function assertProgressiveSynthesisInputBudget(academicInput){
  const bytes=Buffer.byteLength(JSON.stringify(academicInput),'utf8');
  if(bytes>TPF02_PROGRESSIVE_SYNTHESIS_INPUT_BYTES_LIMIT){
    const error=new Error(`TPF-02 progressive whole-Course synthesis input exceeded the governed context budget (${bytes} bytes).`);
    error.code='TEACHING_TPF02_PROGRESSIVE_SYNTHESIS_INPUT_TOO_LARGE';
    throw error;
  }
  return bytes;
}

function mergeSourceInventoryStages(stageResults,fullAcademicInput){
  const expectedRefs=fullAcademicInput.source_items.map((item)=>item.source_item_ref);
  const inventoryByRef=new Map();
  const walkByRef=new Map();
  let status='ok';
  let reviewRequired=false;
  const reviewReasons=[];
  const unresolvedItems=[];

  for(const stageResult of stageResults){
    const output=stageResult?.validatedResult?.output;
    if(!output)throw Object.assign(new Error('Validated TPF-02 SOURCE_INVENTORY stage produced no candidate artifact.'),{code:'TEACHING_TPF02_STAGE_OUTPUT_MISSING'});
    status=strongerStatus(status,output.status);
    reviewRequired=reviewRequired||output.review_required===true;
    reviewReasons.push(...(output.review_reasons||[]));
    unresolvedItems.push(...(output.unresolved_items||[]));
    for(const item of output.source_inventory||[]){
      const ref=String(item?.source_item_ref||'');
      if(!ref||inventoryByRef.has(ref))throw Object.assign(new Error('TPF-02 SOURCE_INVENTORY stages produced duplicate or invalid source references.'),{code:'TEACHING_TPF02_STAGE_SOURCE_CENSUS_INVALID'});
      inventoryByRef.set(ref,item);
    }
    for(const item of output.audit_scope?.source_walk||[]){
      const ref=String(item?.source_item_ref||'');
      if(!ref||walkByRef.has(ref))throw Object.assign(new Error('TPF-02 SOURCE_INVENTORY stages produced duplicate or invalid source-walk references.'),{code:'TEACHING_TPF02_STAGE_SOURCE_WALK_INVALID'});
      walkByRef.set(ref,item);
    }
  }

  if(inventoryByRef.size!==expectedRefs.length||expectedRefs.some((ref)=>!inventoryByRef.has(ref))){
    throw Object.assign(new Error('TPF-02 staged source inventory did not account for the complete Course source census.'),{code:'TEACHING_TPF02_STAGE_SOURCE_CENSUS_INVALID'});
  }
  if(walkByRef.size!==expectedRefs.length||expectedRefs.some((ref)=>!walkByRef.has(ref))){
    throw Object.assign(new Error('TPF-02 staged source walk did not account for the complete Course source census.'),{code:'TEACHING_TPF02_STAGE_SOURCE_WALK_INVALID'});
  }

  return Object.freeze({
    sourceInventory:Object.freeze(expectedRefs.map((ref)=>inventoryByRef.get(ref))),
    sourceWalk:Object.freeze(expectedRefs.map((ref)=>walkByRef.get(ref))),
    findings:Object.freeze({
      status,
      review_required:reviewRequired,
      review_reasons:Object.freeze(uniqueStrings(reviewReasons)),
      unresolved_items:Object.freeze(uniqueUnresolved(unresolvedItems)),
    }),
  });
}

function assembleStagedAudit(output,preparedInventory,preparedSourceWalk,stageFindings){
  const reviewReasons=uniqueStrings([...(stageFindings.review_reasons||[]),...(output.review_reasons||[])]);
  const unresolvedItems=uniqueUnresolved([...(stageFindings.unresolved_items||[]),...(output.unresolved_items||[])]);
  let status=strongerStatus(stageFindings.status,output.status);
  if(status==='ok'&&unresolvedItems.some((item)=>item.blocks_responsible_planning===true))status='unresolved';
  if(status==='ok'&&(preparedSourceWalk||[]).some((item)=>item.analysis_status!=='complete'))status='unresolved';
  const reviewRequired=Boolean(stageFindings.review_required||output.review_required||reviewReasons.length||status!=='ok');
  return {
    ...output,
    status,
    review_required:reviewRequired,
    review_reasons:reviewReasons,
    source_inventory:[...preparedInventory],
    audit_scope:{...output.audit_scope,source_walk:[...preparedSourceWalk]},
    unresolved_items:unresolvedItems,
    student_facing_summary_candidate:status==='ok'?output.student_facing_summary_candidate:null,
  };
}

function curriculumSynthesisRequest({course,sources,preparedInventory,preparedSourceWalk,stageFindings,preparedStructureCandidates=[],regenerationContext=null}){
  const fullAcademicInput=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE});
  const sourceRefs=fullAcademicInput.source_items.map((item)=>item.source_item_ref);
  const eligibleLearningUnitSourceRefs=Object.freeze(learningUnitEligibleSourceRefs(preparedInventory));
  const progressiveCandidates=Array.isArray(preparedStructureCandidates)?preparedStructureCandidates:[];
  const progressive=progressiveCandidates.length>0;
  const academicInput=Object.freeze({
    ...fullAcademicInput,
    ...(regenerationContext?{regeneration_context:regenerationContext}:{}),
    source_items:Object.freeze([]),
    source_evidence_items:progressive
      ? compactProgressiveSourceEvidence(fullAcademicInput.source_items)
      : Object.freeze([...fullAcademicInput.source_items]),
    prepared_source_inventory:Object.freeze([...preparedInventory]),
    eligible_learning_unit_source_refs:eligibleLearningUnitSourceRefs,
    source_inventory_stage_findings:stageFindings,
    progressive_structure_candidates:Object.freeze([...progressiveCandidates]),
  });
  if(progressive)assertProgressiveSynthesisInputBudget(academicInput);
  const outputSchema=tpf02OutputSchema();
  const validationContext=validationContextFor(fullAcademicInput,{allowDecompositionRepair:true});
  return {
    ...base({
      capabilityId:'teaching.curriculum.deep_curriculum_audit',
      course,
      taskMode:'DEEP_AUDIT',
      outputSchema,
      contextSpec:tpf02ContextSpec(course,sources,'whole_curriculum_synthesis'),
      academicInput,
      provenanceRefs:sourceRefs,
    }),
    modelContentMode:'TPF02_DIRECT',
    generation:tpf02Generation(academicInput),
    validationContext,
    schemaValidator:out=>validateTpf02Schema(canonicalizeTpf02RuntimeEnvelope(out,academicInput)),
    domainValidator:async out=>{
      const rawSchema=validateTpf02Schema(out);
      if(!rawSchema.ok)return rawSchema;
      if(out.source_inventory.length!==0)return {ok:false,reason:'TPF02_STAGED_SYNTHESIS_MUST_DEFER_SOURCE_INVENTORY'};
      const scoped=canonicalizeSynthesisSourceScope(out,preparedInventory,fullAcademicInput.audit_scope);
      const assembled=assembleStagedAudit(scoped,preparedInventory,preparedSourceWalk,stageFindings);
      const validated=validateTpf02Domain(assembled,validationContext);
      if(validated.ok)return validated;
      if(!['TPF02_OK_STATUS_HAS_UNMAPPED_REQUIRED_SOURCE','TPF02_UNMAPPED_REQUIRED_SOURCE_NOT_BLOCKED'].includes(validated.reason)){
        return validated;
      }
      const deferred=deferUnmappedRequiredSources(assembled);
      return validateTpf02Domain(deferred,validationContext);
    },
    provenanceValidator:fullProvenanceValidator(sourceRefs),
  };
}

function shouldStageCurriculumAudit({course,sources}){
  if((sources||[]).length>TPF02_STAGED_SOURCE_COUNT_THRESHOLD)return true;
  const input=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.SINGLE_PASS});
  return Buffer.byteLength(JSON.stringify(input),'utf8')>TPF02_STAGED_INPUT_BYTES_THRESHOLD;
}

function chunkSources(sources,size=TPF02_SOURCE_INVENTORY_BATCH_SIZE){
  const result=[];
  for(let index=0;index<sources.length;index+=size)result.push(sources.slice(index,index+size));
  return result;
}

async function mapConcurrent(items,limit,worker){
  const results=new Array(items.length);
  let cursor=0;
  async function run(){
    while(true){
      const index=cursor++;
      if(index>=items.length)return;
      results[index]=await worker(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));
  return results;
}

async function executeAdaptiveLineageRepair({baseOutput,repairRefs=[],executeBatch}={}){
  if(typeof executeBatch!=='function')throw new TypeError('Adaptive TPF-02 lineage repair requires executeBatch().');
  const refs=uniqueStrings(repairRefs);
  if(!refs.length)return Object.freeze({accepted:true,result:null,output:baseOutput,attemptedBatchSizes:Object.freeze([])});
  const attemptedBatchSizes=[];

  async function run(output,batch){
    attemptedBatchSizes.push(batch.length);
    const result=await executeBatch(output,batch);
    if(result?.accepted){
      const nextOutput=result.validatedResult?.output;
      if(!nextOutput){
        return {
          accepted:false,
          result:{accepted:false,errorCode:'TEACHING_TPF02_LINEAGE_REPAIR_OUTPUT_MISSING',reason:'TPF02_LINEAGE_REPAIR_OUTPUT_MISSING'},
          output,
        };
      }
      return {accepted:true,result,output:nextOutput};
    }

    // A validator can reject a multi-source patch even when the same academic
    // work is valid in smaller bounded slices. Never bypass validation: shrink
    // the batch until the rejected scope is isolated. Stale/cancelled work is a
    // state-control failure, not a patch-size problem, so it must propagate.
    if(batch.length<=1||result?.stale===true||result?.cancelled===true){
      return {accepted:false,result,output};
    }

    const splitAt=Math.ceil(batch.length/2);
    const first=await run(output,batch.slice(0,splitAt));
    if(!first.accepted)return first;
    return run(first.output,batch.slice(splitAt));
  }

  const repaired=await run(baseOutput,refs);
  return Object.freeze({
    ...repaired,
    attemptedBatchSizes:Object.freeze([...attemptedBatchSizes]),
  });
}

function diagnosticRequest({course,requirement,audit}){
  const outputSchema={id:'d07.targeted-diagnostic',version:'1',uncertainty_states:['INSUFFICIENT_EVIDENCE','REVIEW_NEEDED'],review_needed_field:'review_needed',declared_fields:['purpose','targets','opportunities','critical_criteria','non_graded'],validate:async out=>{if(!out||out.non_graded!==true||!Array.isArray(out.targets)||!Array.isArray(out.opportunities)||out.opportunities.length<2)return {ok:false,reason:'TARGETED_DIAGNOSTIC_SCHEMA_INVALID'};const allowed=new Set(requirement.targets);if(out.targets.some(x=>!allowed.has(String(x))))return {ok:false,reason:'DIAGNOSTIC_TARGET_OUT_OF_SCOPE'};return {ok:true,value:out};}};
  return {...base({capabilityId:'teaching.curriculum.targeted_placement_prior_knowledge_diagnostic_design',course,taskMode:'targeted_placement_diagnostic_design',outputSchema,contextSpec:{authoritative_refs:[{ref:`course:${course.course_id}`},{ref:`curriculum-audit:${audit.curriculum_audit_id}`}],context_kind:'diagnostic_design',access_purpose:'prior_knowledge_verification'},academicInput:{target_refs:requirement.targets,non_graded:true},provenanceRefs:[`curriculum-audit:${audit.curriculum_audit_id}`]}),schemaValidator:outputSchema.validate,domainValidator:outputSchema.validate,provenanceValidator:async out=>({ok:out.targets.every(x=>requirement.targets.includes(String(x))),reason:'DIAGNOSTIC_PROVENANCE_INVALID'})};
}

function vpkInterpretationRequest({course,target,evidenceRefs=[]}){
  const refs=evidenceRefs.map(String);
  const outputSchema={id:'d07.validated-prior-knowledge-interpretation',version:'1',uncertainty_states:['INSUFFICIENT_EVIDENCE','CONTRADICTORY_EVIDENCE','REVIEW_NEEDED'],review_needed_field:'review_needed',declared_fields:['target_ref','evidence_summary','critical_criteria_support','contradiction_state','planning_recommendation','uncertainty'],validate:async out=>{if(!out||String(out.target_ref)!==String(target.targetRef)||!Array.isArray(out.evidence_summary)||!Array.isArray(out.critical_criteria_support))return {ok:false,reason:'VPK_INTERPRETATION_SCHEMA_INVALID'};if(Object.hasOwn(out,'decision_status')||Object.hasOwn(out,'assessment_eligible')||Object.hasOwn(out,'certified'))return {ok:false,reason:'VPK_INTERPRETATION_MUST_NOT_CERTIFY'};return {ok:true,value:out};}};
  return {...base({capabilityId:'teaching.curriculum.validated_prior_knowledge_interpretation',course,taskMode:'validated_prior_knowledge_evidence_interpretation',outputSchema,contextSpec:{authoritative_refs:[{ref:`course:${course.course_id}`},...refs.map(ref=>({ref:`evidence:${ref}`}))],context_kind:'validated_prior_knowledge',access_purpose:'bounded_evidence_interpretation'},academicInput:{target_kind:target.targetKind,target_ref:target.targetRef,evidence_refs:refs},provenanceRefs:refs.map(ref=>`evidence:${ref}`)}),schemaValidator:outputSchema.validate,domainValidator:outputSchema.validate,provenanceValidator:async out=>({ok:String(out.target_ref)===String(target.targetRef),reason:'VPK_INTERPRETATION_PROVENANCE_INVALID'})};
}

function createD07Intelligence({orchestrator}={}){
  if(!orchestrator||typeof orchestrator.execute!=='function')throw new TypeError('D07 intelligence requires the Teaching Orchestrator.');

  async function refineCurriculumAudit(args={}){
    if(isMergeCompressionChangeRequest(args.changeRequest)){
      return orchestrator.execute(mergeCompressionRefinementRequest(args));
    }

    // A full-audit refinement restates both the complete prior artifact and a
    // complete replacement. That grows with Course size in both directions and
    // eventually exceeds provider input/output limits. Reuse the normal audit
    // pipeline instead: large Courses take the staged path, the student's
    // request remains available as regeneration context, and the result still
    // passes the complete schema, domain, lineage, and provenance validators.
    return runCurriculumAudit({
      ...args,
      regenerationReason:args.changeRequest,
      previousAudit:args.previousAudit,
    });
  }

  async function runCurriculumAudit(args={}){
    const course=args.course;
    const sources=Array.isArray(args.sources)?args.sources:[];
    const regenerationContext=buildRegenerationContext({
      regenerationReason:args.regenerationReason,
      previousAudit:args.previousAudit,
    });
    if(!shouldStageCurriculumAudit({course,sources})){
      let currentResult=await orchestrator.execute(curriculumAuditRequest({course,sources,regenerationContext}));
      if(!currentResult?.accepted)return currentResult;
      let currentOutput=currentResult.validatedResult?.output;
      const preparedInventory=currentOutput?.source_inventory||[];
      const preparedSourceWalk=currentOutput?.audit_scope?.source_walk||[];
      for(let attempt=0;attempt<TPF02_DECOMPOSITION_REPAIR_MAX_ATTEMPTS;attempt++){
        const inventoryByRef=new Map(preparedInventory.map((item)=>[String(item.source_item_ref),item]));
        const state=decompositionRepairState(currentOutput,inventoryByRef,{
          decompositionLimits:buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.SINGLE_PASS}).constraints.decomposition_limits,
        });
        if(!state.repair_required)return currentResult;
        const repaired=await orchestrator.execute(decompositionRepairRequest({
          course,sources,baseOutput:currentOutput,preparedInventory,preparedSourceWalk,decompositionState:state,
        }));
        if(!repaired?.accepted)return repaired;
        currentResult=repaired;
        currentOutput=repaired.validatedResult?.output;
        if(currentOutput?.status&&currentOutput.status!=='ok')return currentResult;
      }
      const finalInventoryByRef=new Map(preparedInventory.map((item)=>[String(item.source_item_ref),item]));
      const finalState=decompositionRepairState(currentOutput,finalInventoryByRef,{decompositionLimits:buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.SINGLE_PASS}).constraints.decomposition_limits});
      if(finalState.repair_required)return {accepted:false,errorCode:'TEACHING_TPF02_DECOMPOSITION_REPAIR_EXHAUSTED',reason:'TPF02_DECOMPOSITION_REPAIR_REQUIRED'};
      return currentResult;
    }

    const fullAcademicInput=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT',executionStage:EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE});
    const batches=chunkSources(sources);
    const stageResults=await mapConcurrent(
      batches,
      TPF02_SOURCE_INVENTORY_CONCURRENCY,
      async (batch)=>orchestrator.execute(sourceInventoryRequest({course,sources:batch}))
    );
    const rejected=stageResults.find((result)=>!result?.accepted);
    if(rejected)return rejected;

    const prepared=mergeSourceInventoryStages(stageResults,fullAcademicInput);
    let preparedStructureCandidates=[];
    if(shouldUseProgressiveStructure({sources})){
      const sourceByRuntimeRef=new Map(sources.map((source)=>[`source:${String(source?.source_content_item_id||'').trim()}`,source]));
      const eligibleRefs=new Set(learningUnitEligibleSourceRefs(prepared.sourceInventory));
      const eligibleSources=[...eligibleRefs].map((ref)=>sourceByRuntimeRef.get(ref)).filter(Boolean);
      if(eligibleSources.length!==eligibleRefs.size){
        throw Object.assign(new Error('TPF-02 progressive structure could not resolve every eligible runtime source.'),{code:'TEACHING_TPF02_STRUCTURE_PASS_SOURCE_MISSING'});
      }
      const structureBatches=chunkSources(eligibleSources,TPF02_STRUCTURE_BATCH_SIZE);
      const structureResults=await mapConcurrent(
        structureBatches,
        TPF02_STRUCTURE_CONCURRENCY,
        async (batch,index)=>orchestrator.execute(structurePassRequest({
          course,
          sources:batch,
          preparedInventory:prepared.sourceInventory,
          batchIndex:index,
          regenerationContext,
        }))
      );
      const structureRejected=structureResults.find((result)=>!result?.accepted);
      if(structureRejected)return structureRejected;
      preparedStructureCandidates=compactStructureCandidates(structureResults);
    }
    let currentResult=await orchestrator.execute(curriculumSynthesisRequest({
      course,
      sources,
      preparedInventory:prepared.sourceInventory,
      preparedSourceWalk:prepared.sourceWalk,
      stageFindings:prepared.findings,
      preparedStructureCandidates,
      regenerationContext,
    }));
    if(!currentResult?.accepted)return currentResult;

    let currentOutput=currentResult.validatedResult?.output;
    let pendingRefs=uniqueStrings(currentOutput?.source_to_unit_reconciliation?.unmapped_required_refs||[]);
    while(pendingRefs.length){
      const batch=pendingRefs.slice(0,TPF02_LINEAGE_REPAIR_BATCH_SIZE);
      const repaired=await executeAdaptiveLineageRepair({
        baseOutput:currentOutput,
        repairRefs:batch,
        executeBatch:(baseOutput,repairRefs)=>orchestrator.execute(lineageRepairRequest({
          course,
          sources,
          baseOutput,
          preparedInventory:prepared.sourceInventory,
          preparedSourceWalk:prepared.sourceWalk,
          stageFindings:prepared.findings,
          repairRefs,
        })),
      });
      if(!repaired.accepted)return repaired.result||{accepted:false,errorCode:'TEACHING_TPF02_LINEAGE_REPAIR_REJECTED',reason:'TPF02_LINEAGE_REPAIR_REJECTED'};
      currentResult=repaired.result||currentResult;
      currentOutput=repaired.output;
      const nextPending=uniqueStrings(currentOutput?.source_to_unit_reconciliation?.unmapped_required_refs||[]);
      if(nextPending.length>=pendingRefs.length&&batch.every((ref)=>nextPending.includes(ref)))break;
      pendingRefs=nextPending;
    }
    if(pendingRefs.length)return {accepted:false,errorCode:'TEACHING_TPF02_LINEAGE_REPAIR_EXHAUSTED',reason:'TPF02_UNMAPPED_REQUIRED_SOURCE_REMAINS'};

    for(let attempt=0;attempt<TPF02_DECOMPOSITION_REPAIR_MAX_ATTEMPTS;attempt++){
      const inventoryByRef=new Map(prepared.sourceInventory.map((item)=>[String(item.source_item_ref),item]));
      const state=decompositionRepairState(currentOutput,inventoryByRef,{decompositionLimits:fullAcademicInput.constraints.decomposition_limits});
      if(!state.repair_required)return currentResult;
      const repaired=await orchestrator.execute(decompositionRepairRequest({
        course,
        sources,
        baseOutput:currentOutput,
        preparedInventory:prepared.sourceInventory,
        preparedSourceWalk:prepared.sourceWalk,
        decompositionState:state,
      }));
      if(!repaired?.accepted)return repaired;
      currentResult=repaired;
      currentOutput=repaired.validatedResult?.output;
      if(currentOutput?.status&&currentOutput.status!=='ok')return currentResult;
    }
    const finalInventoryByRef=new Map(prepared.sourceInventory.map((item)=>[String(item.source_item_ref),item]));
    const finalState=decompositionRepairState(currentOutput,finalInventoryByRef,{decompositionLimits:fullAcademicInput.constraints.decomposition_limits});
    if(finalState.repair_required)return {accepted:false,errorCode:'TEACHING_TPF02_DECOMPOSITION_REPAIR_EXHAUSTED',reason:'TPF02_DECOMPOSITION_REPAIR_REQUIRED'};
    return currentResult;
  }

  return Object.freeze({
    extractIntake:args=>orchestrator.execute(intakeRequest(args)),
    runCurriculumAudit,
    refineCurriculumAudit,
    designDiagnostic:args=>orchestrator.execute(diagnosticRequest(args)),
    interpretPriorKnowledge:args=>orchestrator.execute(vpkInterpretationRequest(args)),
  });
}

module.exports={
  TPF02_SOURCE_INVENTORY_BATCH_SIZE,
  TPF02_SOURCE_INVENTORY_CONCURRENCY,
  TPF02_STAGED_SOURCE_COUNT_THRESHOLD,
  TPF02_STAGED_INPUT_BYTES_THRESHOLD,
  TPF02_PROGRESSIVE_STRUCTURE_SOURCE_COUNT_THRESHOLD,
  TPF02_STRUCTURE_BATCH_SIZE,
  TPF02_STRUCTURE_CONCURRENCY,
  TPF02_LINEAGE_REPAIR_BATCH_SIZE,
  TPF02_DECOMPOSITION_REPAIR_MAX_ATTEMPTS,
  TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE,
  TPF02_PROGRESSIVE_SYNTHESIS_INPUT_BYTES_LIMIT,
  executeAdaptiveLineageRepair,
  intakeRequest,
  buildRegenerationContext,
  withRegenerationContext,
  buildRefinementContext,
  validateRefinementOutput,
  curriculumRefinementRequest,
  mergeCompressionRefinementRequest,
  isMergeCompressionChangeRequest,
  buildMergeCompressionContext,
  validateMergeCompressionPatch,
  applyMergeCompressionPatch,
  curriculumAuditRequest,
  sourceInventoryRequest,
  curriculumSynthesisRequest,
  shouldStageCurriculumAudit,
  shouldUseProgressiveStructure,
  structurePassRequest,
  validateStructurePassPatch,
  compactStructureCandidates,
  mergeSourceInventoryStages,
  assembleStagedAudit,
  learningUnitEligibleSourceRefs,
  canonicalizeTpf02RuntimeEnvelope,
  canonicalizeStructurePassOutput,
  canonicalizeLineageRepairOutput,
  canonicalizeSynthesisSourceScope,
  deferUnmappedRequiredSources,
  applyLineageRepair,
  validateLineageRepairPatch,
  lineageRepairRequest,
  selectDecompositionRepairScope,
  validateDecompositionRepairPatch,
  applyDecompositionRepair,
  decompositionRepairRequest,
  diagnosticRequest,
  vpkInterpretationRequest,
  createD07Intelligence,
  validateCurriculumAuditSchema,
  validateCurriculumAuditDomain,
};
