'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D09');
function guard(){return assertNonProductionDatabase({connectionString:url,projectRef:ref});}
test('D09 integration guard refuses production',()=>assert.throws(
  ()=>assertNonProductionDatabase({connectionString:'postgresql://example@localhost/test',projectRef:PRODUCTION_PROJECT_REF}),
  /production/
));
test('D09 schema has RLS, student read-only access, versioning and timetable guard',{skip},async()=>{
 guard();const pool=createIntegrationPool(url);
 try{
  const names=['teaching_schedule_profiles','teaching_availability_windows','teaching_schedule_blocks','teaching_schedule_deadlines','teaching_schedule_reserves','teaching_timetable_versions','teaching_timetable_slots','teaching_schedule_feasibility','teaching_schedule_debt_entries'];
  const tables=await pool.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",[names]);
  assert.equal(tables.rows.length,names.length);assert.ok(tables.rows.every((r)=>r.relrowsecurity));
  const dml=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')",[names]);
  assert.deepEqual(dml.rows,[]);
  const cols=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='teaching_semesters' and column_name='state_version'");
  assert.equal(cols.rows.length,1);
  const triggers=await pool.query("select tgname from pg_trigger where not tgisinternal and tgname='teaching_d09_timetable_update_guard'");
  assert.equal(triggers.rows.length,1);
  const indexes=await pool.query("select indexname from pg_indexes where schemaname='public' and indexname in ('teaching_schedule_profiles_current_idx','teaching_timetable_current_idx','teaching_timetable_slots_time_idx','teaching_schedule_feasibility_current_idx','teaching_schedule_debt_semester_idx')");
  assert.equal(indexes.rows.length,5);
 }finally{await pool.end();}
});
