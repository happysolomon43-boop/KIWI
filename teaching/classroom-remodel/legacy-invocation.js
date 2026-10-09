'use strict';

const proposal=require('./migration-proposal.v1.json');
const {getModeSchema}=require('./mode-schemas');
const {wrapLegacyConsumer,unwrapLegacyConsumer}=require('./legacy-consumer-adapter');
const {createCandidateInvocationBinding}=require('./invocation-binding');
const {fail}=require('./contracts');
const {validateModelOutput}=require('../ai/output-validation');
const {getCapability}=require('../capability-registry');
function buildLegacyCoordinatorRequest(request,{mode=null}={}) {
 const binding=proposal.bindings.find(b=>b.capabilityId===request?.capabilityId);
 if(!binding)fail('CLASSROOM_LEGACY_CAPABILITY_UNMAPPED');
 mode=mode||binding.modes[0];
 if(!binding.modes.includes(mode))fail('CLASSROOM_LEGACY_MODE_MISMATCH');
 if(request.commit===true)fail('CLASSROOM_CANDIDATE_COMMIT_FORBIDDEN');
 for(const key of ['schemaValidator','domainValidator','provenanceValidator'])if(typeof request[key]!=='function')fail('CLASSROOM_LEGACY_VALIDATOR_REQUIRED',key);
 const outputSchema=getModeSchema('coordinator',mode,{legacyRequest:request});
 const validate=async output=>{
  try {
   let value=output;
   const extension=output?.artifacts?.legacy_consumer;
   if(extension&&Object.keys(extension).length===1&&Object.hasOwn(extension,'payload')) {
    // The model supplies academic content; the server supplies its identity,
    // hash, authority binding and candidate disposition after original checks.
    value={...output,artifacts:{...output.artifacts,legacy_consumer:await wrapLegacyConsumer({request,payload:extension.payload,mode})}};
   }
   return outputSchema.validate(value);
  }catch(error){return {ok:false,reason:error.code||'CLASSROOM_LEGACY_VALIDATION_FAILED'};}
 };
 return {
  ...request,taskMode:mode,commit:false,outputSchema,
  directive:{...request.directive,evidence_purpose:request.directive?.evidence_purpose||request.contextSpec?.access_purpose||'bounded legacy consumer compatibility evaluation'},
  candidatePromptBinding:createCandidateInvocationBinding({capabilityId:request.capabilityId,familyId:'TPF-21',mode}),
  // Keep original context references, state fences, owner and ceilings. Model
  // output is unwrapped only after all three original validation lanes pass.
  academicInput:{legacy_task_mode:request.taskMode,legacy_contract:{schema_id:request.outputSchema.id,schema_version:request.outputSchema.version,declared_fields:request.outputSchema.declared_fields||[],extension_schema_version:'classroom-legacy-consumer.v1',capability_id:request.capabilityId,coordinator_mode:mode,authority_owner:binding.owner,authority_ceiling:binding.authorityCeiling,acceptance:'CANDIDATE_NOT_COMMITTED'},legacy_input:request.academicInput||{}},
  resultContract:{...request.resultContract,output_schema_id:outputSchema.id,output_schema_version:outputSchema.version},
  schemaValidator:validate,domainValidator:validate,provenanceValidator:validate,
 };
}
function createLegacyCoordinatorExecutor({orchestrator}={}) {
 if(typeof orchestrator?.execute!=='function')throw new TypeError('Legacy coordinator requires the existing Teaching orchestrator');
 return Object.freeze({async execute(request,options={}) {
  const result=await orchestrator.execute(buildLegacyCoordinatorRequest(request,options));
  if(!result.accepted||!result.validatedResult)return result;
  const payload=await unwrapLegacyConsumer({request,extension:result.validatedResult.output.artifacts.legacy_consumer});
  const validated=await validateModelOutput({output:payload,authorityLevel:getCapability(request.capabilityId).authority_ceiling,schemaValidator:request.schemaValidator,domainValidator:request.domainValidator,deterministicChecks:[...(request.deterministicChecks||[]),{id:'legacy.provenance',evaluate:request.provenanceValidator}],context:request.validationContext||{}});
  if(!validated.accepted)fail('CLASSROOM_LEGACY_REVALIDATION_FAILED');
  return {...result,validatedResult:validated,coordinatorContract:'classroom-contracts.v1',legacyContract:request.outputSchema.id,authoritativeMutationPerformed:false};
 }});
}
module.exports={buildLegacyCoordinatorRequest,createLegacyCoordinatorExecutor};
