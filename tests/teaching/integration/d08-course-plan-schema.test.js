'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertNonProductionDatabase, integrationConfig, createIntegrationPool } = require('./test-db');

const { connectionString: url, projectRef: ref, skipReason: skip } = integrationConfig('D08');

function guard() { return assertNonProductionDatabase({ connectionString: url, projectRef: ref }); }

test('D08 integration guard refuses production', () => {
  assert.throws(() => {
    const candidate = PROD;
    if (candidate === PROD) throw new Error('D08 integration refuses production Supabase.');
  }, /refuses production/);
});

test('D08 schema has RLS, owner read policies, service-only mutation, lineage columns and indexes', { skip }, async () => {
  guard();
  const pool = createIntegrationPool(url);
  try {
    const names = [
      'teaching_course_plan_prerequisites','teaching_course_plan_source_mappings','teaching_course_plan_exclusions',
      'teaching_coverage_audits','teaching_course_scope_changes','teaching_course_scope_change_applications',
    ];
    const { rows: tables } = await pool.query(
      `select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`,
      [names],
    );
    assert.equal(tables.length, names.length);
    assert.ok(tables.every((row) => row.relrowsecurity));

    const { rows: dml } = await pool.query(
      `select table_name,privilege_type from information_schema.role_table_grants
       where table_schema='public' and table_name=any($1::text[]) and grantee='authenticated'
         and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      [names],
    );
    assert.deepEqual(dml, []);

    const { rows: sourceColumns } = await pool.query(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='teaching_source_content_items'
         and column_name in ('scope_version_no','supersedes_source_content_item_id','discovered_scope_change_id','superseded_at')`,
    );
    assert.equal(sourceColumns.length, 4);

    const { rows: planColumns } = await pool.query(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='teaching_course_plans'
         and column_name in ('curriculum_audit_id','plan_contract_version','source_inventory_digest','scope_diff_summary','review_summary')`,
    );
    assert.equal(planColumns.length, 5);

    const { rows: indexes } = await pool.query(
      `select indexname from pg_indexes where schemaname='public'
       and indexname in (
         'teaching_source_content_current_ref_uidx','teaching_source_content_scope_change_idx',
         'teaching_course_plans_curriculum_audit_idx','teaching_course_plan_mappings_coverage_idx',
         'teaching_course_plan_mappings_source_idx','teaching_course_plan_mappings_unit_idx',
         'teaching_course_plan_prerequisites_vpk_idx','teaching_course_plan_exclusions_source_idx',
         'teaching_coverage_audits_plan_idx','teaching_coverage_audits_course_idx','teaching_course_scope_apps_plan_idx'
       )`,
    );
    assert.equal(indexes.length, 11);

    const { rows: triggers } = await pool.query(
      `select tgname from pg_trigger where not tgisinternal and tgname in (
        'teaching_course_plan_d08_update_guard','teaching_course_plan_prerequisites_immutable',
        'teaching_course_plan_mappings_immutable','teaching_course_plan_exclusions_immutable',
        'teaching_coverage_audits_immutable','teaching_course_scope_applications_immutable'
      )`,
    );
    assert.equal(triggers.length, 6);

    const { rows: functionConfig } = await pool.query(
      `select proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='teaching_guard_d08_course_plan_update'`,
    );
    assert.ok(functionConfig[0]?.proconfig?.some((entry) => entry === 'search_path=pg_catalog, public'));
  } finally {
    await pool.end();
  }
});
