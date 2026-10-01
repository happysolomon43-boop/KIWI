'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D16');

const TABLES=[
  'teaching_assignments','teaching_assignment_history','teaching_assignment_submissions',
  'teaching_assignment_integrity_reviews','teaching_assignment_evaluations','teaching_assignment_solution_material',
];

test('D16 integration guard refuses production',()=>{
  assert.throws(()=>assertNonProductionDatabase({connectionString:'postgresql://x@localhost/x',projectRef:PRODUCTION_PROJECT_REF}),/production/);
});

test('D16 creates RLS-protected Assignment owner tables with no browser-authoritative DML',{skip},async()=>{
  assertNonProductionDatabase({connectionString:url,projectRef:ref});
  const pool=createIntegrationPool(url);
  try{
    const found=await pool.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",[TABLES]);
    assert.equal(found.rows.length,TABLES.length);assert.ok(found.rows.every((row)=>row.relrowsecurity));
    const browser=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('anon','authenticated')",[TABLES]);
    assert.deepEqual(browser.rows,[]);
    const service=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee='service_role'",[TABLES]);
    assert.ok(service.rows.some((row)=>row.table_name==='teaching_assignments'&&row.privilege_type==='UPDATE'));
    for(const immutable of TABLES.filter((name)=>name!=='teaching_assignments')){
      assert.equal(service.rows.some((row)=>row.table_name===immutable&&['UPDATE','DELETE','TRUNCATE'].includes(row.privilege_type)),false,`${immutable} must remain append-only`);
    }
  }finally{await pool.end();}
});

test('D16 schema preserves integrity uncertainty without cheating probability or permanent labels',{skip},async()=>{
  const pool=createIntegrationPool(url);
  try{
    const columns=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='teaching_assignment_integrity_reviews'");
    const names=new Set(columns.rows.map((row)=>row.column_name));
    for(const required of ['policy_version_at_event','rule_alignment','capability_evidence','contextual_signals','verification_state','prior_misconduct_proven'])assert.ok(names.has(required));
    for(const forbidden of ['guilt_probability','cheating_probability','authorship_probability','permanent_student_label','misconduct_score'])assert.equal(names.has(forbidden),false);
    const constraints=await pool.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.teaching_assignment_integrity_reviews'::regclass");
    assert.ok(constraints.rows.some((row)=>/prior_misconduct_proven = false/i.test(row.def)));
    assert.ok(constraints.rows.some((row)=>/active_formal_assessment = false.*deferred_to_post_attempt = true/i.test(row.def)));
  }finally{await pool.end();}
});

test('D16 submissions persist event-time policy and append-only attempt lineage',{skip},async()=>{
  const pool=createIntegrationPool(url);
  try{
    const columns=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='teaching_assignment_submissions'");
    const names=new Set(columns.rows.map((row)=>row.column_name));
    for(const required of ['version_no','submission_kind','accepted_event_at','policy_version_at_event','deadline_policy_version_at_event','assistance_mode_at_event','prior_submission_id','correction_of_submission_id','idempotency_key'])assert.ok(names.has(required));
    const constraints=await pool.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.teaching_assignment_submissions'::regclass");
    assert.ok(constraints.rows.some((row)=>/version_no = 1.*prior_submission_id is not null/i.test(row.def)));
  }finally{await pool.end();}
});

test('D16 evaluation table cannot become an official Gradebook owner',{skip},async()=>{
  const pool=createIntegrationPool(url);
  try{
    const constraints=await pool.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.teaching_assignment_evaluations'::regclass");
    assert.ok(constraints.rows.some((row)=>/official_mark_committed = false/i.test(row.def)));
    const accidental=await pool.query("select tablename from pg_tables where schemaname='public' and tablename in ('teaching_assignment_cheating_scores','teaching_assignment_gradebook','teaching_assignment_mastery')");
    assert.deepEqual(accidental.rows,[]);
  }finally{await pool.end();}
});
