'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('Integrity Session Guard amendment');

const TABLES=['kiwi_integrity_sessions','kiwi_integrity_session_events','teaching_submission_verification_gates','kiwi_verification_sessions','kiwi_verification_items','kiwi_verification_responses'];

test('Integrity amendment integration guard refuses production',()=>{
  assert.throws(()=>assertNonProductionDatabase({connectionString:'postgresql://x@localhost/x',projectRef:PRODUCTION_PROJECT_REF}),/production/);
});

test('Integrity amendment tables are RLS-protected with no browser DML',{skip},async()=>{
  assertNonProductionDatabase({connectionString:url,projectRef:ref});
  const pool=createIntegrationPool(url);
  try{
    const found=await pool.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",[TABLES]);
    assert.equal(found.rows.length,TABLES.length);
    assert.ok(found.rows.every((row)=>row.relrowsecurity));
    const browser=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('anon','authenticated')",[TABLES]);
    assert.deepEqual(browser.rows,[]);
  }finally{await pool.end();}
});

test('append-only integrity evidence cannot be mutated by service role',{skip},async()=>{
  const pool=createIntegrationPool(url);
  try{
    const grants=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee='service_role'",[['kiwi_integrity_session_events','kiwi_verification_responses']]);
    assert.ok(grants.rows.some((row)=>row.table_name==='kiwi_integrity_session_events'&&row.privilege_type==='INSERT'));
    assert.ok(grants.rows.some((row)=>row.table_name==='kiwi_verification_responses'&&row.privilege_type==='INSERT'));
    assert.equal(grants.rows.some((row)=>['UPDATE','DELETE','TRUNCATE'].includes(row.privilege_type)),false);
  }finally{await pool.end();}
});

test('verification items expose only timer-start mutation and keep protected validation server-side',{skip},async()=>{
  const pool=createIntegrationPool(url);
  try{
    const columns=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='kiwi_verification_items'");
    const names=new Set(columns.rows.map((row)=>row.column_name));
    for(const name of ['prompt_payload','protected_validation_payload','started_at','expires_at'])assert.ok(names.has(name));
    const grants=await pool.query("select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='kiwi_verification_items' and grantee='service_role'");
    assert.ok(grants.rows.some((row)=>row.privilege_type==='SELECT'));
    assert.ok(grants.rows.some((row)=>row.privilege_type==='INSERT'));
    assert.equal(grants.rows.some((row)=>['DELETE','TRUNCATE'].includes(row.privilege_type)),false);
  }finally{await pool.end();}
});

test('session history allows a new session after close but only one live owner-policy session',{skip},async()=>{
  const pool=createIntegrationPool(url);
  try{
    const indexes=await pool.query("select indexname,indexdef from pg_indexes where schemaname='public' and tablename='kiwi_integrity_sessions'");
    const live=indexes.rows.find((row)=>row.indexname==='kiwi_integrity_sessions_live_owner_uq');
    assert.ok(live);
    assert.match(live.indexdef,/UNIQUE/i);
    assert.match(live.indexdef,/status.*CLOSED/i);
  }finally{await pool.end();}
});

test('legacy exam owner carries shared lock and review fields without a competing attempt table',{skip},async()=>{
  const pool=createIntegrationPool(url);
  try{
    const columns=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='exam_sessions'");
    const names=new Set(columns.rows.map((row)=>row.column_name));
    for(const name of ['status','is_reckoning','integrity_policy_version','integrity_session_state','integrity_departure_count','integrity_warning_at','integrity_locked_at','integrity_lock_reason','verification_pending','updated_at'])assert.ok(names.has(name),name);
    const accidental=await pool.query("select tablename from pg_tables where schemaname='public' and tablename in ('kiwi_exam_attempts','teaching_assignment_attempts','integrity_exam_attempts')");
    assert.deepEqual(accidental.rows,[]);
  }finally{await pool.end();}
});

test('D16 receipt kinds and verification gates preserve receipt-before-finalization semantics',{skip},async()=>{
  const pool=createIntegrationPool(url);
  try{
    const constraints=await pool.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.teaching_assignment_submissions'::regclass");
    const joined=constraints.rows.map((row)=>row.def).join('\n');
    assert.match(joined,/PENDING_FINAL/);
    assert.match(joined,/PENDING_CORRECTION/);
    const gateColumns=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='teaching_submission_verification_gates'");
    const names=new Set(gateColumns.rows.map((row)=>row.column_name));
    for(const name of ['receipt_submission_id','accepted_event_at','final_submission_id','verification_session_id','state_version'])assert.ok(names.has(name));
  }finally{await pool.end();}
});
