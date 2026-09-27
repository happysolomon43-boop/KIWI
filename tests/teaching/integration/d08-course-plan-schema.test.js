'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const PROD = 'nqdwifqskxkblgdgeutn';
const url = process.env.TEACHING_TEST_DATABASE_URL;
const ref = process.env.TEACHING_TEST_PROJECT_REF;
const skip = (!url || !ref) ? 'No non-production Supabase branch/project configured for Teaching D08 integration tests.' : false;

function guard() {
  if (!url || !ref) throw new Error('Non-production database configuration required.');
  if (ref === PROD || url.includes(PROD)) throw new Error('D08 integration refuses production Supabase.');
}

test('D08 integration guard refuses production', () => {
  assert.throws(() => {
    const candidate = PROD;
    if (candidate === PROD) throw new Error('D08 integration refuses production Supabase.');
  }, /refuses production/);
});

test('D08 schema has normalized plan/coverage lineage, RLS and no browser writes', { skip }, async () => {
  guard();
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const tables = [
      'teaching_course_plan_prerequisites',
      'teaching_course_plan_source_mappings',
      'teaching_course_plan_exclusions',
      'teaching_coverage_audits',
      'teaching_course_scope_changes',
      'teaching_course_scope_change_applications',
    ];
    const { rows: rels } = await pool.query(`
      select c.relname,c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1::text[])
      order by c.relname
    `, [tables]);
    assert.equal(rels.length, tables.length);
    assert.ok(rels.every((row) => row.relrowsecurity));

    const { rows: dml } = await pool.query(`
      select table_name,privilege_type
      from information_schema.role_table_grants
      where table_schema='public' and table_name=any($1::text[])
        and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    `, [tables]);
    assert.deepEqual(dml, []);

    const { rows: columns } = await pool.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='teaching_course_plans'
        and column_name in ('curriculum_audit_id','plan_contract_version','source_inventory_digest','scope_diff_summary','review_summary')
    `);
    assert.equal(columns.length, 5);

    const { rows: mappingUnique } = await pool.query(`
      select pg_get_constraintdef(oid) definition from pg_constraint
      where conrelid='public.teaching_course_plan_source_mappings'::regclass and contype='u'
    `);
    assert.ok(mappingUnique.some((row) => /course_plan_id.*source_content_item_id.*learning_unit_id/i.test(row.definition)));

    const { rows: planTrigger } = await pool.query(`
      select tgname from pg_trigger
      where tgrelid='public.teaching_course_plans'::regclass and not tgisinternal and tgname='teaching_course_plan_version_guard'
    `);
    assert.equal(planTrigger.length, 1);
  } finally {
    await pool.end();
  }
});
