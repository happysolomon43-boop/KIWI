'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {createClassroomAcademicRepository}=require('../../../teaching/repositories/classroom-academic-artifacts');
const f=require('../fixtures/classroom-remodel-academic');
const {Pool}=require('pg');
const {connectionString,projectRef,skipReason:skip}=integrationConfig('Classroom academic artifacts');
async function fixture(client){
 const prefix='classroom-fixture-'+randomUUID();const ids={studentId:prefix,subject:prefix+'-subject',semester:prefix+'-semester',course:prefix+'-course',classId:prefix+'-class',coursePlanId:prefix+'-plan',workspaceId:prefix+'-workspace',inputBundleId:prefix+'-bundle',blueprint:prefix+'-blueprint',audit:prefix+'-audit',profile:prefix+'-profile',timetable:prefix+'-timetable'};
 await client.query('insert into public.users(id) values($1)',[ids.studentId]);
 await client.query('insert into public.subjects(id,user_id,name) values($1,$2,$3)',[ids.subject,ids.studentId,'Academic fixture']);
 await client.query("insert into public.teaching_semesters(semester_id,student_id,name,timezone) values($1,$2,'Fixture','UTC')",[ids.semester,ids.studentId]);
 await client.query("insert into public.teaching_courses(course_id,student_id,subject_id,semester_id,title,lifecycle_state) values($1,$2,$3,$4,'Fixture','ACTIVE')",[ids.course,ids.studentId,ids.subject,ids.semester]);
 await client.query("insert into public.teaching_curriculum_audits(curriculum_audit_id,student_id,course_id,audit_version,subject_snapshot_ref,source_inventory_digest,capability_id,prompt_family_id,prompt_family_version,output_schema_version,status,audit_output,provenance_refs,validation_metadata) values($1,$2,$3,1,'fixture','fixture','FIXTURE_ONLY','TPF-02','1','1','VALIDATED_CANDIDATE','{}','[]','{}')",[ids.audit,ids.studentId,ids.course]);
 await client.query("insert into public.teaching_course_plans(course_plan_id,student_id,course_id,version_no,created_by,plan_state,curriculum_audit_id,plan_contract_version,source_inventory_digest,source_snapshot_ref) values($1,$2,$3,1,'fixture','REVIEW_READY',$4,'fixture','fixture','fixture')",[ids.coursePlanId,ids.studentId,ids.course,ids.audit]);
 await client.query("insert into public.teaching_schedule_profiles(profile_id,student_id,semester_id,version_no,semester_state_version,timezone,headroom_policy_version,created_by) values($1,$2,$3,1,1,'UTC','fixture','fixture')",[ids.profile,ids.studentId,ids.semester]);
 await client.query("insert into public.teaching_timetable_versions(timetable_version_id,student_id,semester_id,profile_id,version_no,timetable_state,state_digest,source_kind,created_by) values($1,$2,$3,$4,1,'APPROVED','fixture','FIXTURE_ONLY','fixture')",[ids.timetable,ids.studentId,ids.semester,ids.profile]);
 await client.query("insert into public.teaching_classes(class_id,student_id,course_id,scheduled_start_at,scheduled_end_at,timezone,source_timetable_version_id) values($1,$2,$3,now()+interval '1 day',now()+interval '1 day 1 hour','UTC',$4)",[ids.classId,ids.studentId,ids.course,ids.timetable]);
 await client.query("insert into teaching_preparation.workspaces(workspace_id,student_id,workspace_type,target_kind,target_ref,authoritative_owner_ref,preparation_profile_ref,protected_content_class,current_authoritative_input_bundle_ref) values($1,$2,'LESSON','next_class',$3,'D11','fixture','UNPROTECTED',$4)",[ids.workspaceId,ids.studentId,ids.classId,ids.inputBundleId]);
 await client.query("insert into teaching_preparation.authoritative_input_bundles(input_bundle_id,workspace_id,student_id,bundle_version,captured_at,authoritative_refs,content_digest) values($1,$2,$3,1,now(),'[]','fixture')",[ids.inputBundleId,ids.workspaceId,ids.studentId]);
 await client.query("insert into public.teaching_lesson_blueprints(lesson_blueprint_id,student_id,class_id,course_plan_id,version_no,objective_summary,source_class_schedule_version,source_course_plan_version,source_course_state_version,source_timetable_version_id) values($1,$2,$3,$4,1,'Fixture',1,1,(select state_version from public.teaching_courses where course_id=$5),$6)",[ids.blueprint,ids.studentId,ids.classId,ids.coursePlanId,ids.course,ids.timetable]);
 return ids;
}
test('classroom academic migration keeps every typed table private with RLS',{skip},async()=>{
 assertNonProductionDatabase({connectionString,projectRef});const pool=createIntegrationPool(connectionString);
 try{const tables=(await pool.query("select relname,relrowsecurity from pg_class where relname=any($1::text[])",[['teaching_classroom_academic_artifacts','teaching_classroom_academic_private','teaching_classroom_source_elements','teaching_classroom_artifact_dependencies','teaching_classroom_preparation_bindings']])).rows;assert.equal(tables.length,5);assert.ok(tables.every(t=>t.relrowsecurity));assert.equal((await pool.query("select * from information_schema.role_table_grants where table_name like 'teaching_classroom_%' and grantee in ('anon','authenticated')")).rows.length,0);}finally{await pool.end();}
});
test('real repository saves, reviews, binds and invalidates artifacts without publication or duplicate retries',{skip},async()=>{
 assertNonProductionDatabase({connectionString,projectRef});const pool=createIntegrationPool(connectionString);const client=await pool.connect();
 try{
  await client.query('BEGIN');const ids=await fixture(client);let ordinal=0;
  const withTransaction=async fn=>{const name='classroom_save_'+(++ordinal);await client.query('SAVEPOINT '+name);try{const result=await fn(client);await client.query('RELEASE SAVEPOINT '+name);return result;}catch(e){await client.query('ROLLBACK TO SAVEPOINT '+name);await client.query('RELEASE SAVEPOINT '+name);throw e;}};
  const repository=createClassroomAcademicRepository({query:(...args)=>client.query(...args),withTransaction,randomUUID});await repository.assertReady();
  const base={...ids,expectedScheduleVersion:1,expectedPlanVersion:1};
  const input={...base,operationKey:'chapter-op',logicalId:'chapter1',logicalVersion:'1',kind:'chapter',payload:f.chapter(),producer:f.producer('chapter'),context:{requiredUnits:['U01']},dependencies:[{kind:'source',ref:'source1',version:'1',artifactId:null}]};
  const chapter=await repository.saveCandidate(input);assert.equal(chapter.validation_state,'CANDIDATE');assert.equal(chapter.completeness,'complete');assert.equal((await repository.saveCandidate(input)).artifact_version_id,chapter.artifact_version_id);
  const changed=f.clone(input);changed.payload.title='Changed';await assert.rejects(()=>repository.saveCandidate(changed),{code:'CLASSROOM_ARTIFACT_IDEMPOTENCY_CONFLICT'});
  assert.equal((await client.query('select count(*)::int n from public.teaching_classroom_source_elements where artifact_version_id=$1',[chapter.artifact_version_id])).rows[0].n,3);
  assert.equal(await repository.loadArtifact('different-student',chapter.artifact_version_id),null);
  await assert.rejects(()=>withTransaction(tx=>tx.query("update public.teaching_classroom_academic_private set payload='{}' where artifact_version_id=$1",[chapter.artifact_version_id])),/IMMUTABLE/);
  await assert.rejects(()=>withTransaction(tx=>tx.query("update public.teaching_classroom_academic_artifacts set validation_state='VALIDATED' where artifact_version_id=$1",[chapter.artifact_version_id])),/check constraint/);
  const dep=(kind,a)=>({kind,ref:a.logical_id,version:a.logical_version,artifactId:a.artifact_version_id});
  const plan=await repository.saveCandidate({...base,operationKey:'plan-op',logicalId:'plan1',logicalVersion:'1',kind:'plan',payload:f.plan(),producer:f.producer('plan'),context:{chapter:chapter.payload},dependencies:[dep('chapter',chapter),{kind:'schedule',ref:ids.classId,version:'1',artifactId:null}]});
  const guide=await repository.saveCandidate({...base,operationKey:'guide-op',logicalId:'guide1',logicalVersion:'1',kind:'guide',payload:f.guide(),producer:f.producer('guide'),context:{chapter:chapter.payload,essentialAnchors:['U01.E01']},dependencies:[dep('chapter',chapter),dep('plan',plan)]});
  const opening=await repository.saveCandidate({...base,operationKey:'opening-op',logicalId:'opening1',logicalVersion:'1',kind:'opening',payload:f.opening(),producer:f.producer('opening'),context:{chapter:chapter.payload,directive:f.directive(),supportedBoardOperations:[]},dependencies:[dep('guide',guide)]});
  for(const a of [chapter,plan,guide,opening]){if(a.artifact_kind==='chapter')assert.equal(a.public_payload.units[0].objective_refs,undefined);else assert.deepEqual(a.public_payload,{});await repository.recordValidation({studentId:ids.studentId,artifactId:a.artifact_version_id,receipt:{accepted:true,independent:true,routeQualified:true,reviewId:'FIXTURE_REVIEW_NOT_LIVE',contentHash:a.content_sha256}});}
  const binding=await repository.bindReady({...base,blueprintId:ids.blueprint,chapterId:chapter.artifact_version_id,planId:plan.artifact_version_id,guideId:guide.artifact_version_id,openingId:opening.artifact_version_id,receipt:{ready:true,delivery1GatePassed:true,routesQualified:true,pplReady:true,evidenceKind:'FIXTURE'}});assert.equal(binding.prepared,true);assert.equal(binding.published,false);
  const stale=await repository.invalidate({studentId:ids.studentId,kind:'schedule',ref:ids.classId,currentVersion:'2'});assert.equal(stale.length,3);assert.equal((await repository.loadArtifact(ids.studentId,chapter.artifact_version_id)).validity_state,'CURRENT');assert.equal((await repository.loadArtifact(ids.studentId,opening.artifact_version_id)).validity_state,'STALE');
  const sourceStale=await repository.invalidate({studentId:ids.studentId,kind:'source',ref:'source1',currentVersion:'2'});assert.equal(sourceStale.length,1);
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
test('concurrent identical saves commit exactly one PPL version and one set of source anchors',{skip},async()=>{
 assertNonProductionDatabase({connectionString,projectRef});const local=['localhost','127.0.0.1','::1'].includes(new URL(connectionString).hostname);const pool=new Pool({connectionString,ssl:local?false:{rejectUnauthorized:false},max:3});let ids;
 const withTransaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const out=await fn(client);await client.query('COMMIT');return out;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}};
 try{ids=await withTransaction(fixture);const repository=createClassroomAcademicRepository({query:(...args)=>pool.query(...args),withTransaction,randomUUID});
  const input={...ids,expectedScheduleVersion:1,expectedPlanVersion:1,operationKey:'concurrent-op',logicalId:'chapter1',logicalVersion:'1',kind:'chapter',payload:f.chapter(),producer:f.producer('chapter'),context:{requiredUnits:['U01']},dependencies:[]};
  const results=await Promise.all([repository.saveCandidate(input),repository.saveCandidate(input)]);assert.equal(results[0].artifact_version_id,results[1].artifact_version_id);
  const counts=(await pool.query('select count(*)::int n from teaching_preparation.artifact_versions where workspace_id=$1',[ids.workspaceId])).rows[0];assert.equal(counts.n,1);
  assert.equal((await pool.query('select count(*)::int n from public.teaching_classroom_source_elements where artifact_version_id=$1',[results[0].artifact_version_id])).rows[0].n,3);
 }finally{
  // Concurrent transactions commit independently. Keep their uniquely named,
  // explicitly marked fixture history: PPL input bundles forbid deletion as
  // well as updates. CI owns and discards this isolated database; never weaken
  // the immutable trigger merely to remove test data.
  await pool.end();
 }
});
