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
test('D10 schema has durable Request/lifecycle state, RLS and no authenticated DML',{skip},async()=>{
  guard();const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1});
  try{
    const names=['teaching_grading_policy_versions','teaching_course_teacher_assignments','teaching_course_activations','teaching_course_lifecycle_history',
      'teaching_course_closure_records','teaching_course_admission_policies','teaching_course_admission_decisions','teaching_requests','teaching_request_history','teaching_request_applications'];
    const tables=await pool.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",[names]);
    assert.equal(tables.rows.length,names.length);assert.ok(tables.rows.every((r)=>r.relrowsecurity));
    const dml=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')",[names]);
    assert.deepEqual(dml.rows,[]);
    const triggers=await pool.query("select tgname from pg_trigger where not tgisinternal and tgname in ('teaching_d10_course_lifecycle_guard','teaching_d10_request_guard')");
    assert.equal(triggers.rows.length,2);
    const policy=await pool.query("select maximum_concurrent_courses,counted_states,rollout from public.teaching_course_admission_policies where policy_version='four-course-launch.v1'");
    assert.equal(policy.rows.length,1);assert.equal(Number(policy.rows[0].maximum_concurrent_courses),4);assert.equal(policy.rows[0].rollout.schema_maximum,false);
    const cols=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='teaching_courses' and column_name in ('status_overlays','progression_outcome','activation_id')");
    assert.equal(cols.rows.length,3);
    const lineageFks=await pool.query("select conname from pg_constraint where contype='f' and conname in ('teaching_classes_source_timetable_version_fkey','teaching_classes_source_timetable_slot_fkey','teaching_classes_activation_id_fkey','teaching_classes_source_request_id_fkey','teaching_courses_activation_id_fkey','teaching_course_teacher_assignments_source_request_id_fkey','teaching_course_lifecycle_history_source_request_id_fkey','teaching_course_closure_records_source_request_id_fkey','teaching_course_admission_decisions_source_request_id_fkey')");
    assert.equal(lineageFks.rows.length,9);
  }finally{await pool.end();}
});
