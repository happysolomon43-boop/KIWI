'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const PROD='nqdwifqskxkblgdgeutn';
const url=process.env.TEACHING_TEST_DATABASE_URL;
const ref=process.env.TEACHING_TEST_PROJECT_REF;
const skip=(!url||!ref)?'No non-production Supabase branch/project configured for Teaching D10 integration tests.':false;
function guard(){if(!url||!ref)throw new Error('Non-production database configuration required.');if(ref===PROD||url.includes(PROD))throw new Error('D10 integration refuses production Supabase.');}

test('D10 integration guard refuses production',()=>{assert.throws(()=>{if(PROD===PROD)throw new Error('D10 integration refuses production Supabase.');},/refuses production/);});

test('D10 schema has durable lifecycle/Request truth, RLS and browser read-only access',{skip},async()=>{
 guard();const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1});
 try{
  const names=['teaching_grading_policy_versions','teaching_course_teacher_assignments','teaching_course_activations','teaching_course_lifecycle_history','teaching_course_closure_records','teaching_course_admission_policies','teaching_course_admission_decisions','teaching_requests','teaching_request_history','teaching_request_applications'];
  const tables=await pool.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",[names]);
  assert.equal(tables.rows.length,names.length);assert.ok(tables.rows.every((r)=>r.relrowsecurity));
  const studentTables=names.filter((n)=>n!=='teaching_course_admission_policies');
  const dml=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')",[studentTables]);
  assert.deepEqual(dml.rows,[]);
  const columns=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='teaching_courses' and column_name in ('status_overlays','progression_outcome','activated_at','academic_record_started_at','activation_id')");
  assert.equal(columns.rows.length,5);
  const classColumns=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='teaching_classes' and column_name in ('source_timetable_version_id','source_timetable_slot_id','activation_id','source_request_id')");
  assert.equal(classColumns.rows.length,4);
  const triggers=await pool.query("select tgname from pg_trigger where not tgisinternal and tgname in ('teaching_d10_course_lifecycle_guard','teaching_d10_request_guard')");
  assert.equal(triggers.rows.length,2);
  const oneApplication=await pool.query("select indexdef from pg_indexes where schemaname='public' and tablename='teaching_request_applications'");
  assert.ok(oneApplication.rows.some((r)=>/UNIQUE.*\(request_id\)/i.test(r.indexdef)||/teaching_request_applications_request_id_key/i.test(r.indexdef)));
  const policy=await pool.query("select policy_version,maximum_concurrent_courses,counted_states,rollout from public.teaching_course_admission_policies where policy_version='four-course-launch.v1'");
  assert.equal(policy.rows.length,1);assert.equal(Number(policy.rows[0].maximum_concurrent_courses),4);
  assert.deepEqual(policy.rows[0].counted_states,['READY','ACTIVE','PAUSED','INCOMPLETE']);
  assert.equal(policy.rows[0].rollout.schema_maximum,false);
 }finally{await pool.end();}
});
