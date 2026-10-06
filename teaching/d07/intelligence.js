'use strict';
const { validateCurriculumAuditSchema, validateCurriculumAuditDomain, normalizeIntakeExtraction } = require('./contracts');
const { getCapability } = require('../capability-registry');
const {
  TPF02_OUTPUT_SCHEMA_ID,
  TPF02_OUTPUT_SCHEMA_VERSION,
  TPF02_MAX_OUTPUT_TOKENS,
  TPF02_TOP_LEVEL_FIELDS,
  buildTpf02AcademicInput,
  validateTpf02Schema,
  validateTpf02Domain,
} = require('./tpf02-direct');

const TPF02_SOURCE_INVENTORY_BATCH_SIZE = 24;
const TPF02_SOURCE_INVENTORY_CONCURRENCY = 2;
const TPF02_STAGED_SOURCE_COUNT_THRESHOLD = 48;
const TPF02_STAGED_INPUT_BYTES_THRESHOLD = 192 * 1024;
const TPF02_STATUS_PRIORITY = Object.freeze({
  ok: 0,
  unresolved: 1,
  blocked_insufficient_sources: 2,
  blocked_authority_conflict: 3,
});
const TPF02_SYNTHESIS_EMPTY_FIELDS = Object.freeze([
  'topics',
  'learning_units',
  'assumed_prerequisites',
  'source_conflicts',
  'coverage_gaps',
  'structure_change_proposals',
]);

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

function validationContextFor(academicInput){
  return {
    inputStateReference:academicInput.input_state_reference,
    trustedScopeVersion:academicInput.audit_scope.trusted_scope_version,
    sourceItems:academicInput.source_items,
  };
}

function fullProvenanceValidator(sourceRefs){
  return async out=>{
    const refs=new Set(out?.source_inventory?.map((item)=>String(item.source_item_ref))||[]);
    return {ok:sourceRefs.length===refs.size&&sourceRefs.every((ref)=>refs.has(ref)),reason:'CURRICULUM_SOURCE_PROVENANCE_INCOMPLETE'};
  };
}

function curriculumAuditRequest({course,sources}){
  const academicInput=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT'});
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
  const validationContext=validationContextFor(academicInput);
  return {
    ...request,
    modelContentMode:'TPF02_DIRECT',
    generation:Object.freeze({maxOutputTokens:TPF02_MAX_OUTPUT_TOKENS,structuredOutput:Object.freeze({mimeType:'application/json'})}),
    validationContext,
    schemaValidator:validateTpf02Schema,
    domainValidator:async out=>validateTpf02Domain(out,validationContext),
    provenanceValidator:fullProvenanceValidator(sourceRefs),
  };
}

function sourceInventoryRequest({course,sources}){
  const academicInput=buildTpf02AcademicInput({course,sources,taskMode:'SOURCE_INVENTORY'});
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
    generation:Object.freeze({maxOutputTokens:TPF02_MAX_OUTPUT_TOKENS,structuredOutput:Object.freeze({mimeType:'application/json'})}),
    validationContext,
    schemaValidator:validateTpf02Schema,
    domainValidator:async out=>{
      const domain=validateTpf02Domain(out,validationContext);
      if(!domain.ok)return domain;
      if(TPF02_SYNTHESIS_EMPTY_FIELDS.some((field)=>out[field].length>0)){
        return {ok:false,reason:'TPF02_SOURCE_INVENTORY_STAGE_SCOPE_EXCEEDED'};
      }
      if(out.student_facing_summary_candidate!=null){
        return {ok:false,reason:'TPF02_SOURCE_INVENTORY_STAGE_SUMMARY_FORBIDDEN'};
      }
      return domain;
    },
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
    const key=JSON.stringify([
      item.issue,
      item.why_unresolved,
      item.required_next_input_or_review,
      item.blocks_responsible_planning===true,
    ]);
    if(seen.has(key))continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergeSourceInventoryStages(stageResults,fullAcademicInput){
  const expectedRefs=fullAcademicInput.source_items.map((item)=>item.source_item_ref);
  const inventoryByRef=new Map();
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
      if(!ref||inventoryByRef.has(ref)){
        throw Object.assign(new Error('TPF-02 SOURCE_INVENTORY stages produced duplicate or invalid source references.'),{code:'TEACHING_TPF02_STAGE_SOURCE_CENSUS_INVALID'});
      }
      inventoryByRef.set(ref,item);
    }
  }

  if(inventoryByRef.size!==expectedRefs.length||expectedRefs.some((ref)=>!inventoryByRef.has(ref))){
    throw Object.assign(new Error('TPF-02 staged source inventory did not account for the complete Course source census.'),{code:'TEACHING_TPF02_STAGE_SOURCE_CENSUS_INVALID'});
  }

  return Object.freeze({
    sourceInventory:Object.freeze(expectedRefs.map((ref)=>inventoryByRef.get(ref))),
    findings:Object.freeze({
      status,
      review_required:reviewRequired,
      review_reasons:Object.freeze(uniqueStrings(reviewReasons)),
      unresolved_items:Object.freeze(uniqueUnresolved(unresolvedItems)),
    }),
  });
}

function assembleStagedAudit(output,preparedInventory,stageFindings){
  const reviewReasons=uniqueStrings([...(stageFindings.review_reasons||[]),...(output.review_reasons||[])]);
  const unresolvedItems=uniqueUnresolved([...(stageFindings.unresolved_items||[]),...(output.unresolved_items||[])]);
  let status=strongerStatus(stageFindings.status,output.status);
  if(status==='ok'&&unresolvedItems.some((item)=>item.blocks_responsible_planning===true))status='unresolved';
  const reviewRequired=Boolean(
    stageFindings.review_required||
    output.review_required||
    reviewReasons.length||
    status==='blocked_authority_conflict'
  );
  return {
    ...output,
    status,
    review_required:reviewRequired,
    review_reasons:reviewReasons,
    source_inventory:[...preparedInventory],
    unresolved_items:unresolvedItems,
  };
}

function curriculumSynthesisRequest({course,sources,preparedInventory,stageFindings}){
  const fullAcademicInput=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT'});
  const sourceRefs=fullAcademicInput.source_items.map((item)=>item.source_item_ref);
  const academicInput=Object.freeze({
    ...fullAcademicInput,
    source_items:Object.freeze([]),
    source_evidence_items:fullAcademicInput.source_items,
    prepared_source_inventory:Object.freeze([...preparedInventory]),
    source_inventory_stage_findings:stageFindings,
  });
  const outputSchema=tpf02OutputSchema();
  const validationContext=validationContextFor(fullAcademicInput);
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
    generation:Object.freeze({maxOutputTokens:TPF02_MAX_OUTPUT_TOKENS,structuredOutput:Object.freeze({mimeType:'application/json'})}),
    validationContext,
    schemaValidator:validateTpf02Schema,
    domainValidator:async out=>{
      if(out.source_inventory.length!==0)return {ok:false,reason:'TPF02_STAGED_SYNTHESIS_MUST_DEFER_SOURCE_INVENTORY'};
      const assembled=assembleStagedAudit(out,preparedInventory,stageFindings);
      return validateTpf02Domain(assembled,validationContext);
    },
    provenanceValidator:fullProvenanceValidator(sourceRefs),
  };
}

function shouldStageCurriculumAudit({course,sources}){
  if((sources||[]).length>TPF02_STAGED_SOURCE_COUNT_THRESHOLD)return true;
  const input=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT'});
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

  async function runCurriculumAudit(args={}){
    const course=args.course;
    const sources=Array.isArray(args.sources)?args.sources:[];
    if(!shouldStageCurriculumAudit({course,sources})){
      return orchestrator.execute(curriculumAuditRequest({course,sources}));
    }

    const fullAcademicInput=buildTpf02AcademicInput({course,sources,taskMode:'DEEP_AUDIT'});
    const batches=chunkSources(sources);
    const stageResults=await mapConcurrent(
      batches,
      TPF02_SOURCE_INVENTORY_CONCURRENCY,
      async (batch)=>orchestrator.execute(sourceInventoryRequest({course,sources:batch}))
    );
    const rejected=stageResults.find((result)=>!result?.accepted);
    if(rejected)return rejected;

    const prepared=mergeSourceInventoryStages(stageResults,fullAcademicInput);
    return orchestrator.execute(curriculumSynthesisRequest({
      course,
      sources,
      preparedInventory:prepared.sourceInventory,
      stageFindings:prepared.findings,
    }));
  }

  return Object.freeze({
    extractIntake:args=>orchestrator.execute(intakeRequest(args)),
    runCurriculumAudit,
    designDiagnostic:args=>orchestrator.execute(diagnosticRequest(args)),
    interpretPriorKnowledge:args=>orchestrator.execute(vpkInterpretationRequest(args)),
  });
}

module.exports={
  TPF02_SOURCE_INVENTORY_BATCH_SIZE,
  TPF02_SOURCE_INVENTORY_CONCURRENCY,
  TPF02_STAGED_SOURCE_COUNT_THRESHOLD,
  TPF02_STAGED_INPUT_BYTES_THRESHOLD,
  intakeRequest,
  curriculumAuditRequest,
  sourceInventoryRequest,
  curriculumSynthesisRequest,
  shouldStageCurriculumAudit,
  mergeSourceInventoryStages,
  assembleStagedAudit,
  diagnosticRequest,
  vpkInterpretationRequest,
  createD07Intelligence,
  validateCurriculumAuditSchema,
  validateCurriculumAuditDomain,
};
