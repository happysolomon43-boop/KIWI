'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const PRODUCTION_PROJECT_REF = 'nqdwifqskxkblgdgeutn';

function assertNonProductionDatabase({ connectionString, projectRef }) {
  if (!connectionString) throw new Error('TEACHING_TEST_DATABASE_URL is required.');
  if (!projectRef) throw new Error('TEACHING_TEST_PROJECT_REF is required.');
  if (projectRef === PRODUCTION_PROJECT_REF || connectionString.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Teaching D04 integration tests refuse to run against production KIWI Supabase.');
  }
  return true;
}

const connectionString = process.env.TEACHING_TEST_DATABASE_URL;
const projectRef = process.env.TEACHING_TEST_PROJECT_REF;
const skipReason = (!connectionString || !projectRef)
  ? 'No non-production Supabase branch/project configured for Teaching D04 integration tests.'
  : false;

test('D04 integration guard refuses production Supabase', () => {
  assert.throws(
    () => assertNonProductionDatabase({
      connectionString: `postgresql://example.${PRODUCTION_PROJECT_REF}@localhost/test`,
      projectRef: PRODUCTION_PROJECT_REF,
    }),
    /refuse to run against production/
  );
});

test('D04 schema, RLS and protected preparation boundaries exist', { skip: skipReason }, async () => {
  assertNonProductionDatabase({ connectionString, projectRef });
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const { rows: publicTables } = await pool.query(`
      select table_name
        from information_schema.tables
       where table_schema='public'
         and table_name = any($1::text[])
       order by table_name
    `, [[
      'teaching_courses',
      'teaching_course_plans',
      'teaching_student_course_intakes',
      'teaching_course_coverage',
      'teaching_assessment_eligibility',
      'teaching_academic_audit_log',
    ]]);
    assert.deepEqual(publicTables.map((row) => row.table_name), [
      'teaching_academic_audit_log',
      'teaching_assessment_eligibility',
      'teaching_course_coverage',
      'teaching_course_plans',
      'teaching_courses',
      'teaching_student_course_intakes',
    ]);

    const { rows: privateTables } = await pool.query(`
      select table_schema, table_name
        from information_schema.tables
       where (table_schema='teaching_preparation' and table_name in ('workspaces','artifact_versions','review_findings'))
          or (table_schema='teaching_protected' and table_name='prepared_artifact_payloads')
       order by table_schema, table_name
    `);
    assert.deepEqual(privateTables.map((row) => `${row.table_schema}.${row.table_name}`), [
      'teaching_preparation.artifact_versions',
      'teaching_preparation.review_findings',
      'teaching_preparation.workspaces',
      'teaching_protected.prepared_artifact_payloads',
    ]);

    const { rows: browserDml } = await pool.query(`
      select table_schema, table_name, grantee, privilege_type
        from information_schema.role_table_grants
       where ((table_schema='public' and table_name like 'teaching_%')
          or table_schema in ('teaching_preparation','teaching_protected'))
         and grantee in ('anon','authenticated')
         and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    `);
    assert.deepEqual(browserDml, []);

    const { rows: protectedBrowserGrants } = await pool.query(`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema='teaching_protected'
         and table_name='prepared_artifact_payloads'
         and grantee in ('anon','authenticated','teaching_domain_service')
    `);
    assert.deepEqual(protectedBrowserGrants, []);

    const { rows: rlsOff } = await pool.query(`
      select n.nspname, c.relname
        from pg_class c
        join pg_namespace n on n.oid=c.relnamespace
       where c.relkind='r'
         and ((n.nspname='public' and c.relname like 'teaching_%')
           or n.nspname in ('teaching_preparation','teaching_protected'))
         and not c.relrowsecurity
    `);
    assert.deepEqual(rlsOff, []);
  } finally {
    await pool.end();
  }
});

module.exports = { assertNonProductionDatabase };
