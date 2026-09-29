'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}=require('./test-db');

const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D11');
function guard(){return assertNonProductionDatabase({connectionString:url,projectRef:ref});}

test('D11 integration guard refuses production',()=>assert.throws(
  ()=>assertNonProductionDatabase({connectionString:'postgresql://example@localhost/test',projectRef:PRODUCTION_PROJECT_REF}),
  /production/
));

test('D11 schema extends the Class kernel with durable Controller/closure/translation state',{skip},async()=>{
  guard();
  const pool=createIntegrationPool(url);
  try{
    const names=['teaching_class_controller_history','teaching_class_closure_facts','teaching_class_summaries','teaching_post_class_teacher_notes'];
    const tables=await pool.query(
      "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",
      [names]
    );
    assert.equal(tables.rows.length,names.length);
    assert.ok(tables.rows.every((r)=>r.relrowsecurity));

    const sessionCols=await pool.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='teaching_class_sessions' and column_name=any($1::text[])",
      [[
        'course_id','course_plan_id','source_course_state_version','source_course_plan_version',
        'source_class_schedule_version','source_timetable_version_id','scheduled_start_at_snapshot',
        'scheduled_end_at_snapshot','event_cursor','cycle_phase','current_learning_evidence_descriptor',
        'current_assistance_level','resume_instructional_substate','break_started_at','break_ends_at',
        'overtime_started_at','overtime_ceiling_at','closure_reason','progress_state','controller_contract_version',
      ]]
    );
    assert.equal(sessionCols.rows.length,20);

    const blueprintCols=await pool.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='teaching_lesson_blueprints' and column_name=any($1::text[])",
      [[
        'blueprint_state','source_course_state_version','source_course_plan_version','source_class_schedule_version',
        'source_timetable_version_id','blueprint_contract_version','blueprint_payload','validation_metadata',
        'generation_provenance','supersedes_lesson_blueprint_id',
      ]]
    );
    assert.equal(blueprintCols.rows.length,10);

    const authDml=await pool.query(
      "select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')",
      [names]
    );
    assert.deepEqual(authDml.rows,[]);

    const summaryRead=await pool.query(
      "select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='teaching_class_summaries' and grantee='authenticated' and privilege_type='SELECT'"
    );
    assert.equal(summaryRead.rows.length,1);
    const teacherRead=await pool.query(
      "select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='teaching_post_class_teacher_notes' and grantee='authenticated' and privilege_type='SELECT'"
    );
    assert.equal(teacherRead.rows.length,0);

    const policies=await pool.query(
      "select tablename,policyname from pg_policies where schemaname='public' and tablename=any($1::text[])",
      [names]
    );
    assert.ok(policies.rows.some((r)=>r.tablename==='teaching_class_summaries'&&r.policyname==='teaching_class_summaries_student_select'));
    assert.ok(!policies.rows.some((r)=>r.tablename==='teaching_post_class_teacher_notes'&&/student/i.test(r.policyname)));

    const immutable=await pool.query(
      "select tgname from pg_trigger where not tgisinternal and tgname=any($1::text[])",
      [[
        'teaching_class_controller_history_immutable',
        'teaching_class_closure_facts_immutable',
        'teaching_class_summaries_immutable',
        'teaching_post_class_teacher_notes_immutable',
      ]]
    );
    assert.equal(immutable.rows.length,4);

    const constraints=await pool.query(
      "select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.teaching_class_sessions'::regclass"
    );
    assert.ok(constraints.rows.some((r)=>/overtime_ceiling_at.*(?:15 minutes|00:15:00)/i.test(r.def)));
    assert.ok(constraints.rows.some((r)=>/break_ends_at.*scheduled_end_at_snapshot/i.test(r.def)));

    const unindexedD11Fks=await pool.query(`
      with fks as (
        select con.conname,con.conrelid,con.conkey,n.nspname,c.relname
        from pg_constraint con
        join pg_class c on c.oid=con.conrelid
        join pg_namespace n on n.oid=c.relnamespace
        where con.contype='f' and n.nspname='public'
          and c.relname=any($1::text[])
      ),
      idx as (
        select indrelid,indkey::smallint[] as indkey
        from pg_index where indisvalid and indisready
      )
      select f.relname,f.conname
      from fks f
      where not exists (
        select 1 from idx i
        where i.indrelid=f.conrelid
          and i.indkey[0:cardinality(f.conkey)-1]=f.conkey
      )
    `,[[
      'teaching_lesson_blueprints','teaching_class_sessions','teaching_class_controller_history',
      'teaching_class_closure_facts','teaching_class_summaries','teaching_post_class_teacher_notes',
    ]]);
    assert.deepEqual(unindexedD11Fks.rows,[]);

    const pplIndex=await pool.query(
      "select indexdef from pg_indexes where schemaname='teaching_preparation' and indexname='teaching_preparation_d11_next_class_workspace_uidx'"
    );
    assert.equal(pplIndex.rows.length,1);
    assert.match(pplIndex.rows[0].indexdef,/target_kind = 'next_class'/i);
  }finally{
    await pool.end();
  }
});
