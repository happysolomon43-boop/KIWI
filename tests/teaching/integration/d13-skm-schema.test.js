'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');

const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D13');
function guard(){return assertNonProductionDatabase({connectionString:url,projectRef:ref});}

test('D13 integration guard refuses production',()=>{
  assert.throws(()=>assertNonProductionDatabase({connectionString:'postgresql://example@localhost/test',projectRef:PRODUCTION_PROJECT_REF}),/production/);
});

test('D13 schema extends canonical Evidence Events and creates only SKM-owned durable truth',{skip},async()=>{
  guard();
  const pool=createIntegrationPool(url);
  try{
    const tables=['teaching_student_knowledge_state_versions','teaching_skm_evidence_applications','teaching_persistent_misconception_versions'];
    const found=await pool.query(
      "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",
      [tables]
    );
    assert.equal(found.rows.length,tables.length);
    assert.ok(found.rows.every(r=>r.relrowsecurity));

    const evidenceColumns=[
      'source_interpretation_ref','source_owner','task_ref','evidence_claim','demand_vector',
      'instructional_lineage_refs','support_context','answer_or_method_exposed','permitted_tools',
      'accessibility_support','control_context','confidence_sample','misconception_context',
      'prerequisite_context','path_context','evidence_validity','evidential_strength',
      'information_gain','comparability_group','redundancy','normalization_version'
    ];
    const cols=await pool.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='teaching_evidence_events' and column_name=any($1::text[])",
      [evidenceColumns]
    );
    assert.equal(cols.rows.length,evidenceColumns.length);

    const parallelEvidence=await pool.query(
      "select tablename from pg_tables where schemaname='public' and tablename=any($1::text[])",
      [['teaching_skm_evidence_events','teaching_knowledge_evidence_events','teaching_mastery_evidence']]
    );
    assert.deepEqual(parallelEvidence.rows,[]);

    const browserOwnerAccess=await pool.query(
      "select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('anon','authenticated')",
      [tables]
    );
    assert.deepEqual(browserOwnerAccess.rows,[]);

    const browserDml=await pool.query(
      "select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name like 'teaching_%' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')"
    );
    assert.deepEqual(browserDml.rows,[]);

    const exposedInternalEvidence=await pool.query(
      "select column_name from information_schema.column_privileges where table_schema='public' and table_name='teaching_evidence_events' and grantee='authenticated' and privilege_type='SELECT' and column_name=any($1::text[])",
      [evidenceColumns]
    );
    assert.deepEqual(exposedInternalEvidence.rows,[]);

    const legacyEvidenceRead=await pool.query(
      "select column_name from information_schema.column_privileges where table_schema='public' and table_name='teaching_evidence_events' and grantee='authenticated' and privilege_type='SELECT'"
    );
    const granted=new Set(legacyEvidenceRead.rows.map(r=>r.column_name));
    for(const col of ['evidence_event_id','student_id','course_id','evidence_kind','evidence_purpose','response_quality','observed_errors','occurred_at','created_at']){
      assert.ok(granted.has(col),'expected legacy safe Evidence Event column grant for '+col);
    }

    const triggers=await pool.query(
      "select tgname from pg_trigger where not tgisinternal and tgname=any($1::text[])",
      [[
        'teaching_student_knowledge_state_versions_immutable',
        'teaching_skm_evidence_applications_immutable',
        'teaching_persistent_misconception_versions_immutable'
      ]]
    );
    assert.equal(triggers.rows.length,3);

    const stateChecks=await pool.query(
      "select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.teaching_student_knowledge_state_versions'::regclass"
    );
    assert.ok(stateChecks.rows.some(r=>/EVIDENCE_QUALITY_STATE_MACHINE_V1/i.test(r.def)));
    assert.ok(stateChecks.rows.some(r=>/UNSEEN.*INTRODUCED.*ASSISTED.*EMERGING.*INDEPENDENT.*SECURE.*TRANSFERABLE/i.test(r.def)));

    const replayUnique=await pool.query(
      "select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.teaching_skm_evidence_applications'::regclass and contype='u'"
    );
    assert.ok(replayUnique.rows.some(r=>/student_id.*evidence_event_id.*learning_unit_id.*algorithm_version/i.test(r.def)));

    const accidentalOwners=await pool.query(
      "select tablename from pg_tables where schemaname='public' and (tablename like 'teaching_d13_gradebook%' or tablename like 'teaching_d13_progression%' or tablename like 'teaching_mastery_score%')"
    );
    assert.deepEqual(accidentalOwners.rows,[]);

    const unindexed=await pool.query(`
      with fks as (
        select con.conname,con.conrelid,con.conkey,n.nspname,c.relname
        from pg_constraint con
        join pg_class c on c.oid=con.conrelid
        join pg_namespace n on n.oid=c.relnamespace
        where con.contype='f' and n.nspname='public' and c.relname=any($1::text[])
      ), idx as (
        select indrelid,indkey::smallint[] indkey from pg_index where indisvalid and indisready
      )
      select f.relname,f.conname from fks f where not exists (
        select 1 from idx i where i.indrelid=f.conrelid and i.indkey[0:cardinality(f.conkey)-1]=f.conkey
      )`,[tables]);
    assert.deepEqual(unindexed.rows,[]);
  }finally{
    await pool.end();
  }
});
