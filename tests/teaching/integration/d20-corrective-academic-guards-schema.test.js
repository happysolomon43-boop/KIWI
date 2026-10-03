'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D20 corrective academic guards');

test('D20 corrective integration guard refuses production',()=>{
  assert.throws(()=>assertNonProductionDatabase({connectionString:'postgresql://x@localhost/x',projectRef:PRODUCTION_PROJECT_REF}),/production/);
});

test('D20 criterion credit is database-bounded by the locked criterion maximum',{skip},async()=>{
  const pool=createIntegrationPool(url);try{
    const {rows}=await pool.query("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.teaching_marking_criterion_judgments'::regclass and conname='teaching_marking_criterion_judgments_credit_upper_bound_check'");
    assert.equal(rows.length,1);assert.match(rows[0].definition,/proposed_credit.*criterion_max_marks/i);
  }finally{await pool.end();}
});

test('D20 result creation is guarded by authoritative final-snapshot integrity',{skip},async()=>{
  const pool=createIntegrationPool(url);try{
    const {rows}=await pool.query("select t.tgname,pg_get_triggerdef(t.oid,true) definition,p.proname,p.proconfig from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.teaching_assessment_results'::regclass and t.tgname='teaching_d20_result_snapshot_integrity_guard' and not t.tgisinternal");
    assert.equal(rows.length,1);assert.match(rows[0].definition,/BEFORE INSERT/i);assert.equal(rows[0].proname,'teaching_d20_guard_result_snapshot_integrity');
    assert.ok((rows[0].proconfig||[]).some(v=>String(v).replace(/\s/g,'')==='search_path=pg_catalog,public'));
    const source=await pool.query("select pg_get_functiondef('public.teaching_d20_guard_result_snapshot_integrity()'::regprocedure) definition");
    assert.match(source.rows[0].definition,/final_snapshot/i);assert.match(source.rows[0].definition,/teaching_assessment_responses/i);assert.match(source.rows[0].definition,/AWAITING_MARKING/i);
  }finally{await pool.end();}
});

test('D20 persisted follow-through credit is guarded by the locked rubric',{skip},async()=>{
  const pool=createIntegrationPool(url);try{
    const {rows}=await pool.query("select t.tgname,pg_get_triggerdef(t.oid,true) definition,p.proname,p.proconfig from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.teaching_marking_criterion_judgments'::regclass and t.tgname='teaching_d20_follow_through_authorization_guard' and not t.tgisinternal");
    assert.equal(rows.length,1);assert.match(rows[0].definition,/BEFORE INSERT/i);assert.equal(rows[0].proname,'teaching_d20_guard_follow_through_authorization');
    assert.ok((rows[0].proconfig||[]).some(v=>String(v).replace(/\s/g,'')==='search_path=pg_catalog,public'));
    const source=await pool.query("select pg_get_functiondef('public.teaching_d20_guard_follow_through_authorization()'::regprocedure) definition");
    assert.match(source.rows[0].definition,/protected_marking_payload/i);assert.match(source.rows[0].definition,/follow_through_policy/i);assert.match(source.rows[0].definition,/conditional/i);
  }finally{await pool.end();}
});

test('D20 corrective trigger functions are not browser-executable',{skip},async()=>{
  const pool=createIntegrationPool(url);try{
    const {rows}=await pool.query("select routine_name,grantee,privilege_type from information_schema.role_routine_grants where routine_schema='public' and routine_name in ('teaching_d20_guard_result_snapshot_integrity','teaching_d20_guard_follow_through_authorization') and grantee in ('anon','authenticated')");
    assert.deepEqual(rows,[]);
  }finally{await pool.end();}
});
