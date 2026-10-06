'use strict';
const {composeTeachingModelContent}=require('../prompt-runtime/prompt-composer');
const {composeTpf02DirectModelContent,TPF02_OUTPUT_SCHEMA_ID,TPF02_MAX_OUTPUT_TOKENS}=require('../d07/tpf02-direct');
const {authorityAtLeast}=require('../ai/contracts');
const {getD28RuntimeService}=require('../d28/runtime-bridge');

const TPF02_EXECUTION_PROFILE='LONG_RUNNING_ANALYSIS';

function createTeachingAIAdapter({promptControl,aiBoundary,resolveCentralTaskId=null,assertRouteExecutable=null}={}){
 if(!promptControl||typeof promptControl.createInvocation!=='function')throw new TypeError('Teaching AI adapter requires the D03 prompt control plane.');
 if(!aiBoundary||typeof aiBoundary.execute!=='function')throw new TypeError('Teaching AI adapter requires the D02 central AI execution boundary.');
 const routeGuard=assertRouteExecutable||((route)=>promptControl.assertRouteQualified(route));
 function prepare({envelope,taskMode,directive,contextLanes,contextAllowlist=null,outputSchema,capabilityCriticalityOverride=null,preparation=null}={}){if(!envelope?.capability?.id)throw new TypeError('Teaching AI adapter requires an execution envelope.');return promptControl.createInvocation({capabilityId:envelope.capability.id,taskMode,directive,contextLanes,contextAllowlist,stateReference:envelope.state_reference,outputSchema,capabilityCriticalityOverride,preparation,audit:{correlation_id:envelope.correlation_id,causation_id:envelope.causation_id}});}
 function isDirectTpf02(invocation){return invocation?.prompt?.family_id==='TPF-02'&&invocation?.output_schema?.id===TPF02_OUTPUT_SCHEMA_ID;}
 async function execute({invocation,academicInput={},generation={},schemaValidator,domainValidator,provenanceValidator=null,deterministicChecks=[],validationContext={},safeCommunicationFallback=null}={}){
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
   const content=directTpf02?composeTpf02DirectModelContent({invocation,academicInput}):composeTeachingModelContent({invocation,academicInput});
   // Every model-backed Teaching contract is a structured artifact contract.
   // MAIN_CBT does not enable JSON mode at the task-registry level, so leaving
   // this implicit allowed otherwise valid prompt families to return prose or
   // fenced JSON that repeatedly failed their deterministic validators.
   const requestedGeneration=requestGeneration(generation);
   const modelGeneration=Object.freeze({
    ...requestedGeneration,
    ...(directTpf02?{maxOutputTokens:TPF02_MAX_OUTPUT_TOKENS}:{}),
    structuredOutput:Object.freeze({mimeType:'application/json',...(requestedGeneration.structuredOutput||{})}),
   });
   const request=Object.freeze({content,generation:modelGeneration});
   // TPF-02 is the one Teaching family whose complete-source census can be a
   // genuinely long-running artifact generation. It stays on MAIN_CBT and its
   // normal provider/model ordering, but asks the central orchestrator for its
   // named bounded long-running execution profile. No raw/provider timeout is
   // feature-controlled here, and all other Teaching/CBT calls keep defaults.
   const result=await aiBoundary.execute({taskId:String(taskId).trim(),centralRouteOptions:Object.freeze({preparationRoutePosture:preparationRoutePosture||null,executionProfile:directTpf02?TPF02_EXECUTION_PROFILE:null}),request,responsibilityKey:invocation.capability.id,capabilityId:invocation.capability.id,intelligenceClass:invocation.capability.execution_class,authorityLevel:invocation.capability.authority_ceiling,authoritativeOwner:invocation.capability.authoritative_owner_boundary,correlationId:invocation.audit.correlation_id,causationId:invocation.audit.causation_id,promptFamilyId:invocation.prompt.family_id,promptFamilyVersion:invocation.prompt.family_version,constitutionVersion:invocation.constitution.version,outputSchemaId:invocation.output_schema.id,outputSchemaVersion:invocation.output_schema.version,schemaValidator,domainValidator,deterministicChecks:effectiveChecks,validationContext,safeCommunicationFallback});
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
module.exports={createTeachingAIAdapter,TPF02_EXECUTION_PROFILE};
