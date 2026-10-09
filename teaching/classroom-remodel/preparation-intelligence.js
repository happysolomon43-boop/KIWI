'use strict';
const {getCapability}=require('../capability-registry');
const {lessonPlanRequest,normalizeD11AcademicInput}=require('../d11/intelligence');
const {validateLessonBlueprintProposal}=require('../d11/contracts');
const {getModeSchema}=require('./mode-schemas');
const {createCandidateInvocationBinding}=require('./invocation-binding');
const {hash,validateContinuation,validateDepth}=require('./academic-artifacts');
const {fail}=require('./contracts');
function createClassroomPreparationIntelligence({orchestrator,repository,d11Repository}={}) {
 if(typeof orchestrator?.execute!=='function')throw new TypeError('Classroom preparation requires central Teaching orchestration');
 async function call(role,{context,requirements,producer,previousChapter=null,chapter=null,plan=null,guide=null,directive=null,operationKey,mode=null}) {
  mode=mode||producer.mode;
  const studentId=String(context.classRow.student_id),classId=context.classRow.class_id;
  const requestHash=hash(normalizeD11AcademicInput({role,mode,operationKey,requirements,previousChapter,chapter,plan,guide,directive}));
  if(repository){const cached=await repository.loadOperation(studentId,classId,'generation',operationKey);if(cached){if(cached.validity_state!=='CURRENT'||cached.generation_context.requestHash!==requestHash)fail('CLASSROOM_GENERATION_OPERATION_STALE');return cached.payload;}}
  const base=lessonPlanRequest({context,signals:requirements.signals||{},requestKey:operationKey, reservePolicy:requirements.reservePolicy});
  const capability=getCapability(producer.capabilityId),schema=getModeSchema(role,mode,{chapter,directive,supportedBoardOperations:requirements.supportedBoardOperations||[]});
  const validate=async output=>{
   const result=await schema.validate(output);if(!result.ok)return result;
   try {
    if(role==='author'&&output.artifacts.chapter){validateDepth(output.artifacts.chapter,requirements.depth);if(previousChapter?.completeness==='partial')validateContinuation(previousChapter,output.artifacts.chapter);if(previousChapter?.completeness==='complete'&&hash(previousChapter)!==hash(output.artifacts.chapter))fail('CLASSROOM_REUSED_CHAPTER_CHANGED');}
    if(role==='author'&&output.status==='ok'){
     const legacy=output.artifacts.controller_blueprint;if(!legacy)fail('CLASSROOM_CONTROLLER_BLUEPRINT_REQUIRED');
     const checked=validateLessonBlueprintProposal(legacy,{learningUnits:context.learningUnits,scheduledStartAt:context.classRow.scheduled_start_at,scheduledEndAt:context.classRow.scheduled_end_at,...(requirements.reservePolicy?{reservePolicy:requirements.reservePolicy}:{})});
     if(!checked.ok)fail(checked.reason);
     const proposedPlan=output.artifacts.teaching_plan;if(proposedPlan.time_ledger.reserve_minutes!==checked.value.adaptive_reserve_minutes||proposedPlan.phases.reduce((sum,p)=>sum+p.minutes,0)!==checked.value.segments.reduce((sum,s)=>sum+s.planned_minutes,0)||proposedPlan.time_ledger.usable_minutes>checked.value.scheduled_minutes)fail('CLASSROOM_CONTROLLER_PLAN_TIME_MISMATCH');
     const allowed=new Set(output.artifacts.teaching_plan.objectives.map(o=>o.ref.id));if(checked.value.objectives.some(o=>!allowed.has(o.learning_unit_ref))||allowed.size!==new Set(checked.value.objectives.map(o=>o.learning_unit_ref)).size)fail('CLASSROOM_CONTROLLER_PLAN_SCOPE_MISMATCH');
    }
    return {ok:true,value:output};
   }catch(error){return {ok:false,reason:error.code||'CLASSROOM_ACADEMIC_CONTRACT_INVALID'};}
  };
  const request={...base,capabilityId:capability.id,declaredAuthorityLevel:capability.authority_ceiling,taskMode:mode,outputSchema:schema,commit:false,
   candidatePromptBinding:createCandidateInvocationBinding({capabilityId:capability.id,familyId:producer.familyId,mode}),
   directive:{...base.directive,evidence_purpose:'Prepare a bounded provisional classroom artifact; do not publish or claim teaching',downstream_handoff:{...base.directive.downstream_handoff,commit_owner_boundary:capability.authoritative_owner_boundary}},
   resultContract:{...base.resultContract,output_schema_id:schema.id,output_schema_version:schema.version},
   academicInput:normalizeD11AcademicInput({approved_scope:requirements.scope,depth_requirements:requirements.depth,source_material:requirements.sourceMaterial,verified_history:requirements.verifiedHistory,source_dependencies:requirements.dependencies,previous_chapter:previousChapter,chapter,teaching_plan:plan,explanation_guide:guide,interaction_directive:directive,legacy_controller_output_contract:{...base.academicInput.lesson_time_budget,declared_fields:base.outputSchema.declared_fields,placement:'artifacts.controller_blueprint'},candidate_numeric_policy:requirements.numericPolicy}),
   schemaValidator:validate,domainValidator:validate,provenanceValidator:validate,
   ...(repository?{provisionalResultSink:async (validated,execution)=>{
     const prep=await d11Repository.ensurePreparationWorkspace({studentId,classId});
     if(!prep?.workspace)fail('CLASSROOM_PPL_WORKSPACE_UNAVAILABLE');
     return repository.saveCandidate({studentId,classId,coursePlanId:context.plan.course_plan_id,workspaceId:prep.workspace.workspace_id,inputBundleId:prep.workspace.current_authoritative_input_bundle_ref,expectedScheduleVersion:context.classRow.schedule_version,expectedPlanVersion:context.plan.version_no,operationKey,logicalId:classId+':'+operationKey,logicalVersion:'1',kind:'generation',payload:validated.output,producer,context:{role,mode,chapter,directive,supportedBoardOperations:requirements.supportedBoardOperations||[]},dependencies:requirements.dependencies,generationContext:{requestHash,executionId:execution.executionId,modelMetadata:execution.modelMetadata}});
   }}:{}),
  };
  const result=await orchestrator.execute(request);
  if(result.replay)fail('CLASSROOM_EXECUTION_REPLAY_REQUIRES_DURABLE_ARTIFACT');
  if(!result.accepted||!result.validatedResult?.output)fail(result.rejectionReason||'CLASSROOM_MODEL_ARTIFACT_REJECTED');
  return result.validatedResult.output;
 }
 return Object.freeze({author:args=>call('author',args),coordinator:args=>call('coordinator',args),presenter:args=>call('presenter',args)});
}
module.exports={createClassroomPreparationIntelligence};
