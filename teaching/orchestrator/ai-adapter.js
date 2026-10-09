'use strict';
const {composeTeachingModelContent}=require('../prompt-runtime/prompt-composer');
const {composeTpf02DirectModelContent,TPF02_OUTPUT_SCHEMA_ID,TPF02_DECOMPOSITION_PATCH_SCHEMA_ID,tpf02OutputTokenBudget}=require('../d07/tpf02-direct');
const {TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_ID}=require('../d07/tpf02-merge-compression');
const {authorityAtLeast}=require('../ai/contracts');
const {getD28RuntimeService}=require('../d28/runtime-bridge');

const LONG_RUNNING_ANALYSIS_PROFILE='LONG_RUNNING_ANALYSIS';
const TPF02_EXECUTION_PROFILE=LONG_RUNNING_ANALYSIS_PROFILE;
const LONG_RUNNING_CAPABILITY_IDS=new Set([
 'teaching.scheduling.instructional_load_estimation',
]);

const DIRECT_TPF02_SCHEMA_IDS=new Set([TPF02_OUTPUT_SCHEMA_ID,TPF02_DECOMPOSITION_PATCH_SCHEMA_ID,TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_ID]);
function isDirectTpf02(invocation){return invocation?.prompt?.family_id==='TPF-02'&&DIRECT_TPF02_SCHEMA_IDS.has(String(invocation?.output_schema?.id||''));}
function executionProfileForInvocation(invocation){
 return isDirectTpf02(invocation)||LONG_RUNNING_CAPABILITY_IDS.has(String(invocation?.capability?.id||''))
  ?LONG_RUNNING_ANALYSIS_PROFILE
  :null;
}

function createTeachingAIAdapter({promptControl,aiBoundary,resolveCentralTaskId=null,assertRouteExecutable=null,allowCandidateEvaluation=false}={}){
 if(!promptControl||typeof promptControl.createInvocation!=='function')throw new TypeError('Teaching AI adapter requires the D03 prompt control plane.');
 if(!aiBoundary||typeof aiBoundary.execute!=='function')throw new TypeError('Teaching AI adapter requires the D02 central AI execution boundary.');
 const routeGuard=assertRouteExecutable||((route)=>promptControl.assertRouteQualified(route));
 function prepare({envelope,taskMode,directive,contextLanes,contextAllowlist=null,outputSchema,capabilityCriticalityOverride=null,preparation=null,candidatePromptBinding=null}={}){if(candidatePromptBinding&&!allowCandidateEvaluation)throw Object.assign(new Error('Candidate prompt execution requires an explicit isolated evaluation adapter'),{code:'CLASSROOM_CANDIDATE_EVALUATION_DISABLED'});if(!envelope?.capability?.id)throw new TypeError('Teaching AI adapter requires an execution envelope.');return promptControl.createInvocation({capabilityId:envelope.capability.id,taskMode,directive,contextLanes,contextAllowlist,stateReference:envelope.state_reference,outputSchema,capabilityCriticalityOverride,preparation,candidatePromptBinding,audit:{correlation_id:envelope.correlation_id,causation_id:envelope.causation_id}});}
 async function execute({invocation,academicInput={},generation={},schemaValidator,domainValidator,provenanceValidator=null,deterministicChecks=[],validationContext={},safeCommunicationFallback=null,signal=null,beforeAttempt=null}={}){
  if(invocation?.prompt?.candidate_binding&&!allowCandidateEvaluation)throw Object.assign(new Error('Candidate execution is not authorized'),{code:'CLASSROOM_CANDIDATE_EVALUATION_DISABLED'});
  if(!invocation?.capability?.id)throw new TypeError('Teaching AI execution requires a prepared structural invocation.');
  if(authorityAtLeast(invocation.capability.authority_ceiling,'T2')&&typeof provenanceValidator!=='function'){const error=new Error('T2–T4 Teaching execution requires explicit provenance validation.');error.code='TEACHING_D05_PROVENANCE_VALIDATOR_REQUIRED';throw error;}
  const d28=getD28RuntimeService();let lease=null,completed=false;
  try{
   if(invocation.preparation&&d28?.governPplInvocation)lease=await d28.governPplInvocation({invocation});
   routeGuard(invocation.route_control);
   if(typeof resolveCentralTaskId!=='function'){const error=new Error('No qualified central KIWI AI task route has been bound for Teaching yet.');error.code='TEACHING_CENTRAL_ROUTE_UNBOUND';throw error;}
   const centralRoute=await resolveCentralTaskId(invocation.route_control,invocation);const taskId=typeof centralRoute==='object'?centralRoute?.taskId:centralRoute;const preparationRoutePosture=typeof centralRoute==='object'?centralRoute?.preparationRoutePosture:null;if(!String(taskId||'').trim()){const error=new Error('Qualified Teaching route resolved no central KIWI AI task.');error.code='TEACHING_CENTRAL_ROUTE_UNBOUND';throw error;}
   const effectiveChecks=[...deterministicChecks];if(typeof provenanceValidator==='function')effectiveChecks.push(Object.freeze({id:'d05.provenance.validation',async evaluate(candidate,context){return provenanceValidator(candidate,{...context,capabilityId:invocation.capability.id,promptFamilyId:invocation.prompt.family_id});}}));
   const directTpf02=isDirectTpf02(invocation);
   const executionProfile=executionProfileForInvocation(invocation);
   const content=directTpf02?composeTpf02DirectModelContent({invocation,academicInput}):composeTeachingModelContent({invocation,academicInput});
   // Every model-backed Teaching contract is a structured artifact contract.
   // MAIN_CBT does not enable JSON mode at the task-registry level, so leaving
   // this implicit allowed otherwise valid prompt families to return prose or
   // fenced JSON that repeatedly failed their deterministic validators.
   const requestedGeneration=requestGeneration(generation);
   const modelGeneration=Object.freeze({
    ...requestedGeneration,
    ...(directTpf02?{maxOutputTokens:tpf02OutputTokenBudget(academicInput)}:{}),
    structuredOutput:Object.freeze({mimeType:'application/json',...(requestedGeneration.structuredOutput||{})}),
   });
   const request=Object.freeze({content,generation:modelGeneration});
   // Long-running Teaching generation is selected from an allowlisted capability
   // policy at this shared boundary. Features cannot supply raw provider timeouts,
   // change model order, or move academic authority. TPF-02 deep audits and D09's
   // TPF-10 instructional-load estimation stay on MAIN_CBT while receiving the
   // centrally governed LONG_RUNNING_ANALYSIS deadline/admission profile.
   const result=await aiBoundary.execute({taskId:String(taskId).trim(),centralRouteOptions:Object.freeze({preparationRoutePosture:preparationRoutePosture||null,executionProfile,...(typeof beforeAttempt==='function'?{beforeAttempt}:{})}),request,responsibilityKey:invocation.capability.id,capabilityId:invocation.capability.id,intelligenceClass:invocation.capability.execution_class,authorityLevel:invocation.capability.authority_ceiling,authoritativeOwner:invocation.capability.authoritative_owner_boundary,correlationId:invocation.audit.correlation_id,causationId:invocation.audit.causation_id,promptFamilyId:invocation.prompt.family_id,promptFamilyVersion:invocation.prompt.family_version,constitutionVersion:invocation.constitution.version,outputSchemaId:invocation.output_schema.id,outputSchemaVersion:invocation.output_schema.version,schemaValidator,domainValidator,deterministicChecks:effectiveChecks,validationContext,safeCommunicationFallback,signal});
   if(lease&&d28?.completePplInvocation){await d28.completePplInvocation(lease,{modelMetadata:result.modelMetadata||{},validationOutcome:result.accepted?'ACCEPTED':result.fallbackUsed?'SAFE_FALLBACK':'REJECTED'});completed=true;}
   return result;
  }finally{if(lease&&!completed&&d28?.releasePplInvocation)d28.releasePplInvocation(lease);}
 }
 return Object.freeze({prepare,execute});
}

 function requestGeneration(value){
  if(value==null)return Object.freeze({});
  if(typeof value!=='object'||Array.isArray(value))throw new TypeError('Teaching generation controls must be an object.');
  return value;
 }
module.exports={createTeachingAIAdapter,TPF02_EXECUTION_PROFILE,LONG_RUNNING_ANALYSIS_PROFILE,LONG_RUNNING_CAPABILITY_IDS,DIRECT_TPF02_SCHEMA_IDS,executionProfileForInvocation};
