'use strict';
// Lossless internal extension for non-classroom callers. This is not a route
// switch: the retained service still performs its own acceptance/commit.
const crypto=require('node:crypto');
const {exact,string,noAuthority,fail}=require('./contracts');
const proposal=require('./migration-proposal.v1.json');
const VERSION='classroom-legacy-consumer.v1';
const validatedExtensions=new WeakMap();
function clone(value){return JSON.parse(JSON.stringify(value));}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function requestIdentity(request){
 const capabilityId=request?.capabilityId;
 const binding=proposal.bindings.find(b=>b.capabilityId===capabilityId);
 if(!binding)fail('CLASSROOM_LEGACY_CAPABILITY_UNMAPPED');
 const schema=request.outputSchema;string(schema?.id,'legacy.schema.id');string(schema?.version,'legacy.schema.version');
 for(const name of ['schemaValidator','domainValidator','provenanceValidator'])if(typeof request[name]!=='function')fail('CLASSROOM_LEGACY_VALIDATOR_REQUIRED',name);
 return {binding,schema};
}
async function validatedPayload(request,payload){
 requestIdentity(request);noAuthority(payload);
 // Use the original immutable payload in every lane; never substitute a model
// summary or a previously normalized object for the original evidence.
 for(const name of ['schemaValidator','domainValidator','provenanceValidator']){
  const result=await request[name](clone(payload));
  if(result?.ok!==true)fail(result?.reason||'CLASSROOM_LEGACY_VALIDATION_FAILED',name);
 }
 return payload;
}
async function wrapLegacyConsumer({request,payload,mode}){
 const {binding,schema}=requestIdentity(request);
 if(!binding.modes.includes(mode))fail('CLASSROOM_LEGACY_MODE_MISMATCH');
 await validatedPayload(request,payload);
 return {schema_version:VERSION,capability_id:request.capabilityId,coordinator_mode:mode,legacy_schema_id:schema.id,legacy_schema_version:schema.version,authority_owner:binding.owner,authority_ceiling:binding.authorityCeiling,payload:clone(payload),payload_sha256:digest(payload),acceptance:'CANDIDATE_NOT_COMMITTED'};
}
async function unwrapLegacyConsumer({request,extension}){
 exact(extension,['schema_version','capability_id','coordinator_mode','legacy_schema_id','legacy_schema_version','authority_owner','authority_ceiling','payload','payload_sha256','acceptance'],'legacy_consumer');
 const {binding,schema}=requestIdentity(request);
 if(extension.schema_version!==VERSION||extension.capability_id!==request.capabilityId||!binding.modes.includes(extension.coordinator_mode)||extension.legacy_schema_id!==schema.id||extension.legacy_schema_version!==schema.version||extension.authority_owner!==binding.owner||extension.authority_ceiling!==binding.authorityCeiling||extension.acceptance!=='CANDIDATE_NOT_COMMITTED')fail('CLASSROOM_LEGACY_BINDING_MISMATCH');
 if(digest(extension.payload)!==extension.payload_sha256)fail('CLASSROOM_LEGACY_PAYLOAD_CHANGED');
 await validatedPayload(request,extension.payload);
 validatedExtensions.set(extension,{mode:extension.coordinator_mode,digest:digest(extension)});
 return clone(extension.payload);
}
function assertValidatedExtension(extension,mode){const proof=validatedExtensions.get(extension);if(!proof||proof.mode!==mode||proof.digest!==digest(extension))fail('CLASSROOM_LEGACY_EXTENSION_UNVALIDATED');return true;}
module.exports={VERSION,wrapLegacyConsumer,unwrapLegacyConsumer,assertValidatedExtension};
