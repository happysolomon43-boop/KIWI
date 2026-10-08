'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {integrationConfig,createIntegrationPool}=require('./test-db');
const {createD14ClassroomRepository}=require('../../../teaching/repositories/d14-classroom');
const {connectionString,skipReason:skip}=integrationConfig('D14 visual assets');
test('private visual persistence fences leases, per-Class budget, publication, owners and protected/history retrieval',{skip},async()=>{
 const pool=createIntegrationPool(connectionString),client=await pool.connect();
 const id=()=>randomUUID(),student=id(),other=id(),subject=id(),semester=id(),course=id(),klass=id(),session=id();
 try{
  await client.query('begin');
  await client.query('insert into public.users(id) values($1),($2)',[student,other]);
  await client.query("insert into public.subjects(id,user_id,name) values($1,$2,'Visual integration')",[subject,student]);
  await client.query("insert into public.teaching_semesters(semester_id,student_id,name,timezone) values($1,$2,'Visual integration','Africa/Lagos')",[semester,student]);
  await client.query("insert into public.teaching_courses(course_id,student_id,subject_id,semester_id,title) values($1,$2,$3,$4,'Visual integration')",[course,student,subject,semester]);
  await client.query("insert into public.teaching_classes(class_id,student_id,course_id,scheduled_start_at,scheduled_end_at,timezone) values($1,$2,$3,now(),now()+interval '1 hour','Africa/Lagos')",[klass,student,course]);
  await client.query("insert into public.teaching_class_sessions(class_session_id,student_id,class_id,course_id,lifecycle_state,instructional_substate,state_version) values($1,$2,$3,$4,'ACTIVE','INSTRUCTION',1)",[session,student,klass,course]);
  const repo=createD14ClassroomRepository({query:client.query.bind(client),withTransaction:fn=>fn(client),randomUUID:id,d11Repository:{}});
  const args={studentId:student,classId:klass,sessionId:session,key:'first',binding:'lesson-authority'};
  const job=await repo.claimVisual(args);assert.equal(job.state,'GENERATING');assert.equal(await repo.claimVisual(args),null);
  const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal(await repo.finishVisual({job:{...job,lease_token:'wrong'},state:'READY',bytes,mimeType:'image/svg+xml',metadata:{altText:'A diagram'}}),null);
  assert.ok(await repo.finishVisual({job,state:'READY',bytes,mimeType:'image/svg+xml',metadata:{altText:'A diagram'}}));
  assert.equal((await repo.claimVisual(args)).state,'READY');
  assert.equal(await repo.visualAsset(student,klass,job.asset_id),null,'unpublished asset must be private');
  const scene=id();await client.query("insert into public.teaching_board_scenes(board_scene_id,student_id,class_session_id,ordinal,scene_type) values($1,$2,$3,0,'TEACHER_TURN')",[scene,student,session]);
  await client.query("insert into public.teaching_board_items(board_item_id,student_id,board_scene_id,ordinal,block_type,content) values($1,$2,$3,0,'diagram',$4::jsonb)",[id(),student,scene,JSON.stringify({assetId:job.asset_id})]);
  assert.deepEqual((await repo.visualAsset(student,klass,job.asset_id)).asset_bytes,bytes);
  assert.equal(await repo.visualAsset(other,klass,job.asset_id),null);
  assert.equal(await repo.visualAsset(student,id(),job.asset_id),null);
  await client.query("update public.teaching_class_sessions set instructional_substate='ASSESSMENT' where class_session_id=$1",[session]);
  assert.equal(await repo.visualAsset(student,klass,job.asset_id),null);
  await client.query("update public.teaching_class_sessions set lifecycle_state='CLOSED',instructional_substate='CLOSURE' where class_session_id=$1",[session]);
  assert.ok(await repo.visualAsset(student,klass,job.asset_id),'historical published visuals remain available');
  for(let n=1;n<12;n++)assert.ok(await repo.claimVisual({...args,key:'budget-'+n}));
  assert.equal(await repo.claimVisual({...args,key:'budget-exhausted'}),null);
  const grants=await client.query("select privilege_type from information_schema.role_table_grants where table_schema='teaching_runtime' and table_name='classroom_visual_assets' and grantee in ('anon','authenticated')");assert.deepEqual(grants.rows,[]);
  const rls=await client.query("select relrowsecurity from pg_class where oid='teaching_runtime.classroom_visual_assets'::regclass");assert.equal(rls.rows[0].relrowsecurity,true);
 }finally{await client.query('rollback');client.release();await pool.end();}
});
