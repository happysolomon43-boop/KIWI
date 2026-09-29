'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');
const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D12');
function guard(){return assertNonProductionDatabase({connectionString:url,projectRef:ref});}

test('D12 integration guard refuses production',()=>assert.throws(()=>assertNonProductionDatabase({connectionString:'postgresql://example@localhost/test',projectRef:PRODUCTION_PROJECT_REF}),/production/));

test('D12 schema preserves Response Evaluator/Pedagogy artifacts without creating D13 SKM truth',{skip},async()=>{
  guard();const pool=createIntegrationPool(url);
  try{
    const names=['teaching_response_evaluations','teaching_pedagogy_decisions','teaching_learning_unit_pedagogy_profiles','teaching_teacher_corrections','teaching_evidence_recheck_handoffs'];
    const tables=await pool.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",[names]);
    assert.equal(tables.rows.length,names.length);assert.ok(tables.rows.every((r)=>r.relrowsecurity));

    const responseCols=await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='teaching_student_responses' and column_name=any($1::text[])",[['learning_unit_id','controller_version','idempotency_key']]);
    assert.equal(responseCols.rows.length,3);

    const confidence=await pool.query("select data_type from information_schema.columns where table_schema='public' and table_name='teaching_response_evaluations' and column_name='evaluator_confidence'");
    assert.equal(confidence.rows[0].data_type,'text');

    const authDml=await pool.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee='authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')",[names]);
    assert.deepEqual(authDml.rows,[]);

    const immutable=await pool.query("select tgname from pg_trigger where not tgisinternal and tgname=any($1::text[])",[[
      'teaching_response_evaluations_immutable','teaching_pedagogy_decisions_immutable','teaching_learning_unit_pedagogy_profiles_immutable','teaching_teacher_corrections_immutable','teaching_evidence_recheck_handoffs_immutable'
    ]]);
    assert.equal(immutable.rows.length,5);

    const durableFlag=await pool.query("select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.teaching_pedagogy_decisions'::regclass");
    assert.ok(durableFlag.rows.some((r)=>/durable_state_committed.*false/i.test(r.def)));

    const accidentalSkm=await pool.query("select tablename from pg_tables where schemaname='public' and tablename=any($1::text[])",[['teaching_skm_states','teaching_persistent_misconceptions','teaching_mastery_states']]);
    assert.deepEqual(accidentalSkm.rows,[]);

    const unindexed=await pool.query(`
      with fks as (
        select con.conname,con.conrelid,con.conkey,n.nspname,c.relname
        from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
        where con.contype='f' and n.nspname='public' and c.relname=any($1::text[])
      ), idx as (
        select indrelid,indkey::smallint[] indkey from pg_index where indisvalid and indisready
      )
      select f.relname,f.conname from fks f where not exists (
        select 1 from idx i where i.indrelid=f.conrelid and i.indkey[0:cardinality(f.conkey)-1]=f.conkey
      )`,[names]);
    assert.deepEqual(unindexed.rows,[]);
  }finally{await pool.end();}
});
