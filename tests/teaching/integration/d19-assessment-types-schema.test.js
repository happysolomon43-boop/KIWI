'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D19');

const assessmentTables=['teaching_assessments','teaching_assessment_blueprints','teaching_assessment_packages','teaching_assessment_attempts','teaching_assessment_responses'];

test('D19 integration guard refuses production',()=>{assert.throws(()=>assertNonProductionDatabase({connectionString:'postgresql://x@localhost/x',projectRef:PRODUCTION_PROJECT_REF}),/production/);});

test('D19 reuses D17 authoritative persistence carriers and creates no shadow type-policy table',{skip},async()=>{
  assertNonProductionDatabase({connectionString:url,projectRef:ref});const pool=createIntegrationPool(url);
  try{
    const {rows}=await pool.query("select table_name,column_name from information_schema.columns where table_schema='public' and ((table_name='teaching_assessments' and column_name in ('assessment_type','purpose','graded','announced_scope','policy_version','source_lineage')) or (table_name='teaching_assessment_blueprints' and column_name in ('blueprint_payload','source_state_versions')) or (table_name='teaching_assessment_packages' and column_name='policy_snapshot')) order by table_name,column_name");
    assert.equal(rows.length,9);
    const shadow=await pool.query("select tablename from pg_tables where schemaname='public' and (tablename like 'teaching_d19%' or tablename in ('teaching_assessment_type_policies','teaching_measurement_behaviors'))");
    assert.deepEqual(shadow.rows,[]);
  }finally{await pool.end();}
});

test('D19 preserves no direct browser DML on authoritative Assessment tables',{skip},async()=>{
  const pool=createIntegrationPool(url);try{const {rows}=await pool.query("select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE') order by table_name,grantee,privilege_type",[assessmentTables]);assert.deepEqual(rows,[]);}finally{await pool.end();}
});

test('D19 source-of-truth carriers retain JSON and versionable policy shapes',{skip},async()=>{
  const pool=createIntegrationPool(url);try{const {rows}=await pool.query("select table_name,column_name,data_type from information_schema.columns where table_schema='public' and ((table_name='teaching_assessments' and column_name in ('announced_scope','source_lineage')) or (table_name='teaching_assessment_blueprints' and column_name='source_state_versions') or (table_name='teaching_assessment_packages' and column_name='policy_snapshot')) order by table_name,column_name");assert.equal(rows.length,4);for(const row of rows)assert.equal(row.data_type,'jsonb');}finally{await pool.end();}
});
