'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D15');

test('D15 integration guard refuses production',()=>{
  assert.throws(()=>assertNonProductionDatabase({connectionString:'postgresql://x@localhost/x',projectRef:PRODUCTION_PROJECT_REF}),/production/);
});

test('D15 creates immutable RLS-protected attendance owner tables',{skip},async()=>{
  assertNonProductionDatabase({connectionString:url,projectRef:ref});
  const pool=createIntegrationPool(url);
  try{
    const tables=['teaching_attendance_records','teaching_attendance_concerns','teaching_attendance_system_interruptions'];
    const found=await pool.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",[tables]);
    assert.equal(found.rows.length,3);assert.ok(found.rows.every((row)=>row.relrowsecurity));

    const browserGrants=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('anon','authenticated')",[tables]);
    assert.deepEqual(browserGrants.rows,[]);

    const serviceGrants=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee='service_role' order by table_name,privilege_type",[tables]);
    assert.ok(serviceGrants.rows.some((row)=>row.table_name==='teaching_attendance_records'&&row.privilege_type==='INSERT'));
    assert.equal(serviceGrants.rows.some((row)=>row.privilege_type==='UPDATE'||row.privilege_type==='DELETE'),false);

    const constraints=await pool.query("select conrelid::regclass::text table_name,pg_get_constraintdef(oid) def from pg_constraint where conrelid in ('public.teaching_attendance_records'::regclass,'public.teaching_attendance_concerns'::regclass,'public.teaching_attendance_system_interruptions'::regclass)");
    assert.ok(constraints.rows.some((row)=>/version_no.*supersedes_record_id/i.test(row.def)));
    assert.ok(constraints.rows.some((row)=>/subject_mark_reduction = false/i.test(row.def)));
    assert.ok(constraints.rows.some((row)=>/verified = true/i.test(row.def)));

    const indexes=await pool.query("select indexname from pg_indexes where schemaname='public' and tablename=any($1::text[])",[tables]);
    const names=new Set(indexes.rows.map((row)=>row.indexname));
    assert.ok(names.has('teaching_attendance_records_obligation_idx'));
    assert.ok(names.has('teaching_attendance_records_course_idx'));
    assert.ok(names.has('teaching_attendance_system_interruptions_class_idx'));

    const accidental=await pool.query("select tablename from pg_tables where schemaname='public' and tablename in ('teaching_attendance_scores','teaching_attendance_grade_penalties','teaching_attendance_assessment_attempts')");
    assert.deepEqual(accidental.rows,[]);
  }finally{await pool.end();}
});
