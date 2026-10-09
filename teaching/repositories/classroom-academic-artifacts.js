'use strict';
const {hash,prepareArtifact,validateContinuation}=require('../classroom-remodel/academic-artifacts');
const {fail,string,exact}=require('../classroom-remodel/contracts');
const {getCapability}=require('../capability-registry');
const {resolveCandidateFamily}=require('../classroom-remodel/candidate-registry');
const migration=require('../classroom-remodel/migration-proposal.v1.json');
function createClassroomAcademicRepository({query,withTransaction,randomUUID}={}){
 if(typeof query!=='function'||typeof withTransaction!=='function'||typeof randomUUID!=='function')throw new TypeError('Classroom academic repository requires trusted PostgreSQL dependencies');
 const run=(tx,sql,args=[])=>tx?tx.query(sql,args):query(sql,args);
 async function assertReady(){const r=await query("select to_regclass('public.teaching_classroom_academic_artifacts') as artifacts,to_regclass('public.teaching_classroom_preparation_bindings') as bindings");if(!r.rows?.[0]?.artifacts||!r.rows?.[0]?.bindings)fail('CLASSROOM_ACADEMIC_SCHEMA_MISSING');return true;}
 async function loadArtifact(studentId,id,tx=null){return (await run(tx,`select a.*,p.payload,p.generation_context,v.workspace_id,v.validity_state,v.input_bundle_id,v.created_by_capability_id,v.prompt_family_ref
 from public.teaching_classroom_academic_artifacts a join public.teaching_classroom_academic_private p using(artifact_version_id)
 join teaching_preparation.artifact_versions v using(artifact_version_id) where a.student_id=$1 and a.artifact_version_id=$2`,[studentId,id])).rows?.[0]||null;}
 function producerFor(kind,producer){
  exact(producer,['capabilityId','familyId','mode','schemaVersion','promptSha256'],'producer');
  const cap=getCapability(producer.capabilityId);const family=resolveCandidateFamily(producer.familyId);
  const expected={chapter:'TPF-05',plan:'TPF-05',guide:'TPF-21',opening:'TPF-08'}[kind];
  if(family.canonicalId!==expected||!family.modes.includes(producer.mode)||family.sha256!==producer.promptSha256)fail('CLASSROOM_PRODUCER_BINDING_INVALID');
  if(expected==='TPF-21'){if(!migration.bindings.some(b=>b.capabilityId===cap.id&&b.modes.includes(producer.mode)))fail('CLASSROOM_PRODUCER_CAPABILITY_INVALID');}
  else if(cap.prompt_family_id!==expected)fail('CLASSROOM_PRODUCER_CAPABILITY_INVALID');
  const modes={chapter:['pre_class_lesson_blueprint'],plan:['pre_class_lesson_blueprint','live_lesson_replan','lateness_replan'],guide:['prepare_guidance'],opening:['natural_teacher_instruction','board_instructional_content']}[kind];
  if(!modes.includes(producer.mode))fail('CLASSROOM_ARTIFACT_MODE_MISMATCH');if(producer.schemaVersion!==require('../classroom-remodel/contracts').VERSION)fail('CLASSROOM_PRODUCER_SCHEMA_INVALID');
  const specific={pre_class_lesson_blueprint:'teaching.lesson.pre_class_lesson_planning',live_lesson_replan:'teaching.lesson.live_lesson_replanning',lateness_replan:'teaching.scheduling.lateness_lesson_replanning',natural_teacher_instruction:'teaching.pedagogy.natural_teacher_explanation_generation',board_instructional_content:'teaching.pedagogy.board_instructional_content_generation'};
  if(specific[producer.mode]&&cap.id!==specific[producer.mode])fail('CLASSROOM_PRODUCER_CAPABILITY_INVALID');return {cap,family};
 }
 async function saveCandidate(input){
  const {studentId,classId,coursePlanId,workspaceId,inputBundleId,operationKey,logicalId,logicalVersion,kind,payload,context,producer,dependencies=[],parentId=null,expectedScheduleVersion,expectedPlanVersion,generationContext={}}=input;
  for(const [k,v]of Object.entries({studentId,classId,coursePlanId,workspaceId,inputBundleId,operationKey,logicalId,logicalVersion}))string(v,k);
  const {cap,family}=producerFor(kind,producer);const artifact=prepareArtifact({kind,payload,context});
  if(['chapter','plan'].includes(kind)&&(payload.id!==logicalId||payload.version!==logicalVersion))fail('CLASSROOM_ARTIFACT_LOGICAL_IDENTITY_MISMATCH');
  for(const d of dependencies){exact(d,['kind','ref','version','artifactId'],'dependency');for(const k of ['kind','ref','version'])string(d[k],k);}
  const requestHash=hash({kind,payload,completeness:artifact.completeness,producer,dependencies,parentId,workspaceId,inputBundleId,coursePlanId,logicalId,logicalVersion,expectedScheduleVersion,expectedPlanVersion,generationContext});
  return withTransaction(async tx=>{
   const authority=(await tx.query(`select c.*,co.lifecycle_state course_lifecycle_state,p.version_no plan_version,p.plan_state
    from public.teaching_classes c join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id
    join public.teaching_course_plans p on p.course_id=c.course_id and p.student_id=c.student_id and p.course_plan_id=$3
    where c.class_id=$2 and c.student_id=$1 and c.scheduled_end_at>clock_timestamp() for update of c,co,p`,[studentId,classId,coursePlanId])).rows?.[0];
   if(!authority||authority.lifecycle_state!=='SCHEDULED'||authority.course_lifecycle_state!=='ACTIVE'||authority.plan_state==='SUPERSEDED'||String(authority.schedule_version)!==String(expectedScheduleVersion)||String(authority.plan_version)!==String(expectedPlanVersion))fail('CLASSROOM_PREPARATION_AUTHORITY_CHANGED');
   const prior=(await tx.query('select artifact_version_id,request_sha256 from public.teaching_classroom_academic_artifacts where class_id=$1 and artifact_kind=$2 and operation_key=$3',[classId,kind,operationKey])).rows?.[0];
   if(prior){if(prior.request_sha256!==requestHash)fail('CLASSROOM_ARTIFACT_IDEMPOTENCY_CONFLICT');return loadArtifact(studentId,prior.artifact_version_id,tx);}
   const workspace=(await tx.query(`select w.* from teaching_preparation.workspaces w
    join teaching_preparation.authoritative_input_bundles b on b.workspace_id=w.workspace_id and b.student_id=w.student_id and b.input_bundle_id=$3
    where w.workspace_id=$2 and w.student_id=$1 for update of w`,[studentId,workspaceId,inputBundleId])).rows?.[0];
   if(!workspace||!['ACTIVE','FINALIZATION_DUE'].includes(workspace.lifecycle_state)||workspace.protected_content_class!=='UNPROTECTED'||workspace.current_authoritative_input_bundle_ref!==inputBundleId||workspace.target_kind!=='next_class'||workspace.target_ref!==classId)fail('CLASSROOM_PPL_INPUT_NOT_CURRENT');
   const latest=(await tx.query(`select artifact_version_id,revision_no from public.teaching_classroom_academic_artifacts
    where class_id=$1 and artifact_kind=$2 and logical_id=$3 and logical_version=$4 order by revision_no desc limit 1`,[classId,kind,logicalId,logicalVersion])).rows?.[0];
   if(latest&&parentId!==latest.artifact_version_id)fail('CLASSROOM_ARTIFACT_BASE_STALE');
   if(parentId){const parent=await loadArtifact(studentId,parentId,tx);if(!parent||parent.class_id!==classId||parent.artifact_kind!==kind||parent.course_plan_id!==coursePlanId)fail('CLASSROOM_ARTIFACT_PARENT_INVALID');if(kind==='chapter'&&parent.logical_version===logicalVersion)validateContinuation(parent.payload,payload);}
   for(const d of dependencies)if(d.artifactId){const dependency=await loadArtifact(studentId,d.artifactId,tx);if(!dependency||dependency.class_id!==classId||dependency.logical_version!==d.version||dependency.validity_state!=='CURRENT')fail('CLASSROOM_ARTIFACT_DEPENDENCY_INVALID');}
   const id=randomUUID();const version=(await tx.query('select coalesce(max(version_no),0)+1 next_version from teaching_preparation.artifact_versions where workspace_id=$1',[workspaceId])).rows[0].next_version;
   await tx.query(`insert into teaching_preparation.artifact_versions(artifact_version_id,workspace_id,student_id,artifact_kind,version_no,input_bundle_id,parent_artifact_version_id,created_by_capability_id,prompt_family_ref,schema_version,artifact_digest,protected_content_class,validity_state)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'UNPROTECTED','CURRENT')`,[id,workspaceId,studentId,'classroom.'+kind,version,inputBundleId,parentId,cap.id,family.canonicalId+'@'+family.version,producer.schemaVersion,artifact.contentHash]);
   await tx.query(`insert into public.teaching_classroom_academic_artifacts(artifact_version_id,student_id,class_id,course_id,course_plan_id,artifact_kind,logical_id,logical_version,revision_no,operation_key,request_sha256,parent_artifact_version_id,task_mode,prompt_sha256,schema_version,completeness,content_sha256,public_payload)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,[id,studentId,classId,authority.course_id,coursePlanId,kind,logicalId,logicalVersion,(latest?.revision_no||0)+1,operationKey,requestHash,parentId,producer.mode,producer.promptSha256,producer.schemaVersion,artifact.completeness,artifact.contentHash,JSON.stringify(artifact.publicPayload)]);
   await tx.query('insert into public.teaching_classroom_academic_private(artifact_version_id,payload,generation_context) values($1,$2::jsonb,$3::jsonb)',[id,JSON.stringify(payload),JSON.stringify(generationContext)]);
   for(const e of artifact.components)await tx.query('insert into public.teaching_classroom_source_elements(artifact_version_id,anchor,parent_anchor,element_kind,sequence_no,content_sha256,public_payload) values($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,e.anchor,e.parent,e.kind,e.sequence,e.hash,JSON.stringify(e.publicPayload)]);
   for(const d of dependencies)await tx.query('insert into public.teaching_classroom_artifact_dependencies(artifact_version_id,dependency_kind,aggregate_ref,version_ref,dependency_artifact_version_id) values($1,$2,$3,$4,$5)',[id,d.kind,d.ref,d.version,d.artifactId]);
   return loadArtifact(studentId,id,tx);
  });
 }
 async function recordValidation({studentId,artifactId,receipt}){
  if(receipt?.accepted!==true||receipt.independent!==true||receipt.routeQualified!==true||!receipt.reviewId)fail('CLASSROOM_INDEPENDENT_REVIEW_REQUIRED');
  return withTransaction(async tx=>{await tx.query('select a.artifact_version_id from public.teaching_classroom_academic_artifacts a join teaching_preparation.artifact_versions v using(artifact_version_id) where a.student_id=$1 and a.artifact_version_id=$2 for update of a,v',[studentId,artifactId]);const a=await loadArtifact(studentId,artifactId,tx);if(!a||a.completeness!=='complete'||a.validity_state!=='CURRENT'||receipt.contentHash!==a.content_sha256)fail('CLASSROOM_REVIEW_ARTIFACT_MISMATCH');
   if(a.validation_state==='VALIDATED'){if(hash(a.validation_receipt)!==hash(receipt))fail('CLASSROOM_REVIEW_RECEIPT_CONFLICT');return a;}
   await tx.query("update public.teaching_classroom_academic_artifacts set validation_state='VALIDATED',validation_receipt=$3::jsonb where artifact_version_id=$2 and student_id=$1",[studentId,artifactId,JSON.stringify(receipt)]);return loadArtifact(studentId,artifactId,tx);});
 }
 async function invalidate({studentId,kind,ref,currentVersion}){
  return withTransaction(async tx=>{const result=await tx.query(`with recursive affected(id) as (
   select d.artifact_version_id from public.teaching_classroom_artifact_dependencies d join public.teaching_classroom_academic_artifacts a using(artifact_version_id)
   where a.student_id=$1 and d.dependency_kind=$2 and d.aggregate_ref=$3 and d.version_ref<>$4
   union select d.artifact_version_id from public.teaching_classroom_artifact_dependencies d join affected p on d.dependency_artifact_version_id=p.id)
   update teaching_preparation.artifact_versions v set validity_state='STALE' from affected where v.artifact_version_id=affected.id and v.student_id=$1 and v.validity_state='CURRENT' returning v.artifact_version_id`,[studentId,kind,ref,currentVersion]);return result.rows;});
 }
 async function getDependencies(studentId,id){return (await query(`select d.* from public.teaching_classroom_artifact_dependencies d join public.teaching_classroom_academic_artifacts a using(artifact_version_id) where a.student_id=$1 and a.artifact_version_id=$2`,[studentId,id])).rows;}
 async function bindReady({studentId,classId,blueprintId,chapterId,planId,guideId,openingId,expectedScheduleVersion,expectedPlanVersion,receipt}){
  if(receipt?.ready!==true||receipt?.delivery1GatePassed!==true||receipt?.routesQualified!==true||receipt?.pplReady!==true)fail('CLASSROOM_PREPARATION_NOT_READY');
  return withTransaction(async tx=>{
   const b=(await tx.query(`select b.*,c.schedule_version,p.version_no plan_version,c.course_id from public.teaching_lesson_blueprints b
    join public.teaching_classes c on c.class_id=b.class_id and c.student_id=b.student_id
    join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id
    join public.teaching_course_plans p on p.course_plan_id=b.course_plan_id and p.student_id=b.student_id
    join public.teaching_timetable_versions tv on tv.timetable_version_id=c.source_timetable_version_id and tv.student_id=c.student_id
    where b.lesson_blueprint_id=$3 and b.class_id=$2 and b.student_id=$1 and b.blueprint_state='VALIDATED'
    and c.lifecycle_state='SCHEDULED' and co.lifecycle_state='ACTIVE' and p.plan_state='REVIEW_READY' and tv.timetable_state='APPROVED' and b.source_timetable_version_id=tv.timetable_version_id
    and b.source_class_schedule_version=c.schedule_version and b.source_course_plan_version=p.version_no and b.source_course_state_version=co.state_version
    for update of b,c,co,p`,[studentId,classId,blueprintId])).rows?.[0];
   if(!b||String(b.schedule_version)!==String(expectedScheduleVersion)||String(b.plan_version)!==String(expectedPlanVersion))fail('CLASSROOM_BINDING_AUTHORITY_CHANGED');
   for(const [id,kind]of [[chapterId,'chapter'],[planId,'plan'],[guideId,'guide'],[openingId,'opening']]){await tx.query('select v.artifact_version_id from teaching_preparation.artifact_versions v where v.artifact_version_id=$1 for update',[id]);const a=await loadArtifact(studentId,id,tx);if(!a||a.class_id!==classId||a.course_plan_id!==b.course_plan_id||a.artifact_kind!==kind||a.completeness!=='complete'||a.validation_state!=='VALIDATED'||a.validity_state!=='CURRENT')fail('CLASSROOM_BINDING_ARTIFACT_NOT_READY');}
   const prior=(await tx.query('select * from public.teaching_classroom_preparation_bindings where class_id=$1',[classId])).rows?.[0];
   const ids=[chapterId,planId,guideId,openingId];if(prior&&(prior.lesson_blueprint_id!==blueprintId||String(prior.schedule_version)!==String(expectedScheduleVersion)||String(prior.course_plan_version)!==String(expectedPlanVersion)))fail('CLASSROOM_BINDING_REVISION_REQUIRED');
   if(prior&&[prior.chapter_artifact_id,prior.plan_artifact_id,prior.guide_artifact_id,prior.opening_artifact_id].some((id,i)=>id!==ids[i]))fail('CLASSROOM_BINDING_REVISION_REQUIRED');
   await tx.query(`insert into public.teaching_classroom_preparation_bindings(class_id,student_id,course_id,course_plan_id,lesson_blueprint_id,chapter_artifact_id,plan_artifact_id,guide_artifact_id,opening_artifact_id,schedule_version,course_plan_version,readiness_receipt)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) on conflict(class_id) do nothing`,[classId,studentId,b.course_id,b.course_plan_id,blueprintId,...ids,expectedScheduleVersion,expectedPlanVersion,JSON.stringify(receipt)]);return {classId,chapterId,planId,guideId,openingId,prepared:true,published:false};
  });
 }
 async function loadBinding(studentId,classId){return (await query('select * from public.teaching_classroom_preparation_bindings where student_id=$1 and class_id=$2',[studentId,classId])).rows?.[0]||null;}
 async function loadOperation(studentId,classId,kind,operationKey){const a=(await query('select artifact_version_id from public.teaching_classroom_academic_artifacts where student_id=$1 and class_id=$2 and artifact_kind=$3 and operation_key=$4',[studentId,classId,kind,operationKey])).rows?.[0];return a?loadArtifact(studentId,a.artifact_version_id):null;}
 return {assertReady,loadArtifact,saveCandidate,recordValidation,invalidate,getDependencies,bindReady,loadBinding,loadOperation};
}
module.exports={createClassroomAcademicRepository};
