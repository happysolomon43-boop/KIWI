'use strict';
const {hash}=require('./academic-artifacts');
const {evaluateRelease}=require('./release-qualification');
const {failure}=require('./presentation-policy');
const ENGINE_VERSION='classroom-engine.v1';
const HOLD='CLASSROOM_RELEASE_COMPATIBILITY_HOLD';
function runtimeIdentity(versions){return {...versions,promptBindings:(versions.promptBindings||[]).map(({artifact_version_id,...pin})=>pin)};}
function sessionSupport(control,delivery){
 const pin=delivery.authority?.releaseManifestHash;
 return !!pin&&Array.isArray(control?.supported_manifest_hashes)&&control.supported_manifest_hashes.includes(pin);
}
function createClassroomReleaseControl({withTransaction,trustRoots={},clock=()=>new Date()}={}){
 if(typeof withTransaction!=='function')throw new TypeError('Release controls require the existing transaction owner');
 const readUsing=async tx=>(await tx.query('select * from public.teaching_classroom_release_control where singleton=true for share')).rows[0];
 async function transition({operationKey,expectedRevision,state,manifest=null,policy=null,attestations=[],cohortStudentIds=[],supportedManifestHashes=[],reasonRef}={}){
  if(!operationKey||!reasonRef||!Number.isSafeInteger(expectedRevision)||!['STOPPED','COHORT','GENERAL','ROLLBACK'].includes(state)||!Array.isArray(cohortStudentIds)||cohortStudentIds.some(x=>typeof x!=='string'||!x)||!Array.isArray(supportedManifestHashes)||supportedManifestHashes.some(x=>!/^[a-f0-9]{64}$/.test(x)))throw failure('CLASSROOM_RELEASE_CONTROL_INVALID',422);
  // No public route exposes this operator method or the configured trust roots.
  const activating=['COHORT','GENERAL'].includes(state),decision=activating?evaluateRelease({manifest,policy,attestations,trustRoots,now:clock(),stage:state}):null;
  if(activating&&(decision.status!=='QUALIFIED'||state==='COHORT'&&!cohortStudentIds.length))throw failure('CLASSROOM_RELEASE_ACCEPTANCE_HELD',503);
  const manifestHash=activating?hash(manifest):null;
  const requestHash=hash({state,manifestHash,cohortStudentIds,supportedManifestHashes,reasonRef,expectedRevision});
  return withTransaction(async tx=>{
   const current=(await tx.query('select * from public.teaching_classroom_release_control where singleton=true for update')).rows[0];
   if(!current)throw failure('CLASSROOM_RELEASE_CONTROL_UNAVAILABLE',503);
   const prior=(await tx.query('select request_hash,result from public.teaching_classroom_release_operations where operation_key=$1',[operationKey])).rows[0];
   if(prior){if(prior.request_hash!==requestHash)throw failure('CLASSROOM_RELEASE_IDEMPOTENCY_CONFLICT');return {...prior.result,replay:true};}
   if(Number(current.revision)!==expectedRevision)throw failure('CLASSROOM_RELEASE_REVISION_CONFLICT');
   // Retain only previously adopted manifests; arbitrary strings cannot authorize
   // an old worker or an unqualified candidate to continue a session.
   const allowed=new Set(current.supported_manifest_hashes||[]);if(current.manifest_hash)allowed.add(current.manifest_hash);if(manifestHash)allowed.add(manifestHash);
   if(supportedManifestHashes.some(h=>!allowed.has(h)))throw failure('CLASSROOM_RELEASE_UNADOPTED_COMPATIBILITY');
   const supported=[...new Set([...supportedManifestHashes,...(manifestHash?[manifestHash]:[])])];
   const result={revision:Number(current.revision)+1,state,manifestHash,newAdmissionEnabled:activating};
   await tx.query('update public.teaching_classroom_release_control set revision=$1,state=$2,manifest_hash=$3,manifest=$4::jsonb,cohort_student_ids=$5::jsonb,supported_manifest_hashes=$6::jsonb,reason_ref=$7,updated_at=clock_timestamp() where singleton=true',[result.revision,state,manifestHash,JSON.stringify(manifest),JSON.stringify(cohortStudentIds),JSON.stringify(supported),reasonRef]);
   await tx.query('insert into public.teaching_classroom_release_operations(operation_key,request_hash,result,decision) values($1,$2,$3::jsonb,$4::jsonb)',[operationKey,requestHash,JSON.stringify(result),JSON.stringify(decision)]);
   return result;
  });
 }
 async function admissionUsing(tx,{studentId,classId,blueprintId}={}){
  const control=await readUsing(tx);
  if(!control||!['COHORT','GENERAL'].includes(control.state)||control.state==='COHORT'&&!control.cohort_student_ids.includes(studentId))return {engine:'LEGACY'};
  const binding=(await tx.query('select * from public.teaching_classroom_preparation_bindings where student_id=$1 and class_id=$2 and lesson_blueprint_id=$3 for share',[studentId,classId,blueprintId])).rows[0];
  if(!binding||binding.readiness_receipt?.pplReady!==true||binding.readiness_receipt?.routesQualified!==true)throw failure('CLASSROOM_RELEASE_PREPARATION_HELD',503);
  return {engine:'CLASSROOM_V1',chapterId:binding.chapter_artifact_id,bindingVersion:Number(binding.binding_version),releaseManifestHash:control.manifest_hash};
 }
 async function admissionForDeliveryUsing(tx,a,policy){
  const control=await readUsing(tx);
  if(!control||!['COHORT','GENERAL'].includes(control.state)||control.state==='COHORT'&&!control.cohort_student_ids.includes(a.student_id)||!a.classroom_release_manifest_hash||control.manifest_hash!==a.classroom_release_manifest_hash||control.manifest.policyHash!==hash(policy)||control.manifest.runtimeHash!==hash(runtimeIdentity(a.runtimeVersions)))throw failure('CLASSROOM_RELEASE_ADMISSION_HELD',503);
  return control.manifest_hash;
 }
 return {readUsing,transition,admissionUsing,admissionForDeliveryUsing,sessionSupport};
}
module.exports={ENGINE_VERSION,HOLD,runtimeIdentity,sessionSupport,createClassroomReleaseControl};
