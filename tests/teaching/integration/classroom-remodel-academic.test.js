'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {createClassroomAcademicRepository}=require('../../../teaching/repositories/classroom-academic-artifacts');
const f=require('../fixtures/classroom-remodel-academic');
const {Pool}=require('pg');
const {connectionString,projectRef,skipReason:skip}=integrationConfig('Classroom academic artifacts');
const {fixture}=require('../fixtures/classroom-database');
test('classroom academic migration keeps every typed table private with RLS',{skip},async()=>{
 assertNonProductionDatabase({connectionString,projectRef});const pool=createIntegrationPool(connectionString);
 try{const tables=(await pool.query("select relname,relrowsecurity from pg_class where relname=any($1::text[])",[['teaching_classroom_academic_artifacts','teaching_classroom_academic_private','teaching_classroom_source_elements','teaching_classroom_artifact_dependencies','teaching_classroom_preparation_bindings','teaching_classroom_preparation_binding_history','teaching_classroom_anchor_remaps']])).rows;assert.equal(tables.length,7);assert.ok(tables.every(t=>t.relrowsecurity));assert.equal((await pool.query("select * from information_schema.role_table_grants where table_name like 'teaching_classroom_%' and grantee in ('anon','authenticated')")).rows.length,0);}finally{await pool.end();}
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
  assert.equal(binding.bindingVersion,1);assert.equal((await repository.loadBindingHistory(ids.studentId,ids.classId,1)).chapter_artifact_id,chapter.artifact_version_id);
  const replacement=await repository.saveCandidate({...base,operationKey:'opening-revision',logicalId:'opening1',logicalVersion:'2',kind:'opening',payload:f.opening(),producer:f.producer('opening'),context:{chapter:chapter.payload,directive:f.directive(),supportedBoardOperations:[]},dependencies:[dep('guide',guide)]});
  await repository.recordValidation({studentId:ids.studentId,artifactId:replacement.artifact_version_id,receipt:{accepted:true,independent:true,routeQualified:true,reviewId:'FIXTURE_REVIEW_NOT_LIVE',contentHash:replacement.content_sha256}});
  const revisedInput={...base,blueprintId:ids.blueprint,chapterId:chapter.artifact_version_id,planId:plan.artifact_version_id,guideId:guide.artifact_version_id,openingId:replacement.artifact_version_id,receipt:{ready:true,delivery1GatePassed:true,routesQualified:true,pplReady:true,evidenceKind:'FIXTURE'}};
  await assert.rejects(()=>repository.bindReady(revisedInput),{code:'CLASSROOM_BINDING_REVISION_REQUIRED'});
  const revised=await repository.bindReady({...revisedInput,expectedBindingVersion:1});assert.equal(revised.bindingVersion,2);assert.equal((await repository.loadBindingHistory(ids.studentId,ids.classId,1)).opening_artifact_id,opening.artifact_version_id);
  await client.query("insert into public.teaching_class_sessions(class_session_id,student_id,class_id,course_id,course_plan_id,lesson_blueprint_id,lifecycle_state,instructional_substate,state_version,started_at,classroom_engine,classroom_chapter_artifact_id,classroom_binding_version) values($1,$2,$3,$4,$5,$6,'ACTIVE','INSTRUCTION',1,now(),'CLASSROOM_V1',$7,2)",[ids.classId+'-session',ids.studentId,ids.classId,ids.course,ids.coursePlanId,ids.blueprint,chapter.artifact_version_id]);
  const d11Repository=require('../../../teaching/repositories/d11-lesson-controller').createD11LessonControllerRepository({query:(...args)=>client.query(...args),withTransaction,randomUUID});
  const chapterService=require('../../../teaching/classroom-remodel/preparation-service').createClassroomPreparationService({repository,d11Repository,preparationRepository:{getWorkspaceSnapshot:async()=>null},releaseGate:async()=>({delivery1GatePassed:true,routesQualified:true,evidence:'FIXTURE'}),currentDependencyVersion:async()=> '1'});
  const publicChapter=await chapterService.getPublicChapter({id:ids.studentId},ids.classId);assert.equal(publicChapter.units[0].elements.length,2);assert.equal(publicChapter.units[0].objective_refs,undefined);
  await assert.rejects(()=>chapterService.getPublicChapter({id:'different-student'},ids.classId));
  await assert.rejects(()=>withTransaction(tx=>tx.query("update public.teaching_class_sessions set classroom_binding_version=1 where class_id=$1",[ids.classId])),/CLASSROOM_SESSION_PIN_IMMUTABLE/);
  await assert.rejects(()=>repository.bindReady({...revisedInput,openingId:opening.artifact_version_id,expectedBindingVersion:2}),/CLASSROOM_SESSION_BINDING_PINNED/);
  await client.query("update public.teaching_class_sessions set instructional_substate='ASSESSMENT' where class_id=$1",[ids.classId]);await assert.rejects(()=>chapterService.getPublicChapter({id:ids.studentId},ids.classId),{code:'CLASSROOM_CHAPTER_PROTECTED_MODE'});
  const stale=await repository.invalidate({studentId:ids.studentId,kind:'schedule',ref:ids.classId,currentVersion:'2'});assert.equal(stale.length,4);assert.equal((await repository.loadArtifact(ids.studentId,chapter.artifact_version_id)).validity_state,'CURRENT');assert.equal((await repository.loadArtifact(ids.studentId,opening.artifact_version_id)).validity_state,'STALE');
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

test('chapter corrections preserve old anchors and store explicit remaps in native PostgreSQL',{skip},async()=>{
 assertNonProductionDatabase({connectionString,projectRef});const pool=createIntegrationPool(connectionString),client=await pool.connect();await client.query('BEGIN');let sequence=0;
 const withTransaction=async fn=>{const point='revision_'+(++sequence);await client.query('SAVEPOINT '+point);try{const value=await fn(client);await client.query('RELEASE SAVEPOINT '+point);return value;}catch(error){await client.query('ROLLBACK TO SAVEPOINT '+point);throw error;}};
 try{
  const ids=await fixture(client),repository=createClassroomAcademicRepository({query:(...args)=>client.query(...args),withTransaction,randomUUID});
  const base={...ids,expectedScheduleVersion:1,expectedPlanVersion:1,kind:'chapter',logicalId:'chapter1',producer:f.producer('chapter'),context:{requiredUnits:['U01']},dependencies:[{kind:'source',ref:'source1',version:'1',artifactId:null}]};
  const original=await repository.saveCandidate({...base,logicalVersion:'1',operationKey:'original',payload:f.chapter()});
  const corrected=f.chapter();corrected.version='2';corrected.prior_version='1';corrected.units[0].elements[0].text+=' Explicitly clarified inertial-frame condition.';
  await assert.rejects(()=>repository.saveCandidate({...base,logicalVersion:'2',operationKey:'no-remap',parentId:original.artifact_version_id,payload:corrected}),{code:'CLASSROOM_CHANGED_ANCHOR_REMAP_REQUIRED'});
  corrected.remaps=[{prior_version:'1',from:'U01',to:['U01'],reason:'Contains corrected passage'},{prior_version:'1',from:'U01.E01',to:['U01.E01'],reason:'Source-grounded correction'}];
  const revision=await repository.saveCandidate({...base,logicalVersion:'2',operationKey:'corrected',parentId:original.artifact_version_id,payload:corrected});
  const remaps=(await client.query('select prior_artifact_version_id,prior_anchor,target_anchors from public.teaching_classroom_anchor_remaps where artifact_version_id=$1 order by prior_anchor',[revision.artifact_version_id])).rows;
  assert.equal(remaps.length,2);assert.ok(remaps.every(r=>r.prior_artifact_version_id===original.artifact_version_id));assert.deepEqual(remaps[1].target_anchors,['U01.E01']);assert.equal((await repository.loadArtifact(ids.studentId,original.artifact_version_id)).payload.units[0].elements[0].text,f.chapter().units[0].elements[0].text);
  await assert.rejects(()=>withTransaction(tx=>tx.query("update public.teaching_classroom_anchor_remaps set reason='changed' where artifact_version_id=$1",[revision.artifact_version_id])),/IMMUTABLE/);
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
