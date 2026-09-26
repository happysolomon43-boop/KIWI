'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const PRODUCTION_PROJECT_REF = 'nqdwifqskxkblgdgeutn';

function assertNonProductionDatabase({ connectionString, projectRef }) {
  if (!connectionString) throw new Error('TEACHING_TEST_DATABASE_URL is required.');
  if (!projectRef) throw new Error('TEACHING_TEST_PROJECT_REF is required.');
  if (projectRef === PRODUCTION_PROJECT_REF || connectionString.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Teaching D05 integration tests refuse to run against production KIWI Supabase.');
  }
  return true;
}

const connectionString = process.env.TEACHING_TEST_DATABASE_URL;
const projectRef = process.env.TEACHING_TEST_PROJECT_REF;
const skipReason = (!connectionString || !projectRef)
  ? 'No non-production Supabase branch/project configured for Teaching D05 integration tests.'
  : false;

test('D05 integration guard refuses production Supabase', () => {
  assert.throws(
    () => assertNonProductionDatabase({
      connectionString: `postgresql://example.${PRODUCTION_PROJECT_REF}@localhost/test`,
      projectRef: PRODUCTION_PROJECT_REF,
    }),
    /refuse to run against production/
  );
});

test('D05 runtime schema preserves RLS and narrow service boundaries', { skip: skipReason }, async () => {
  assertNonProductionDatabase({ connectionString, projectRef });
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const { rows: tables } = await pool.query(`
      select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='teaching_runtime'
         and c.relname in ('orchestration_executions','event_outbox')
       order by c.relname
    `);
    assert.deepEqual(tables, [
      { schema_name: 'teaching_runtime', table_name: 'event_outbox', rls_enabled: true },
      { schema_name: 'teaching_runtime', table_name: 'orchestration_executions', rls_enabled: true },
    ]);

    const { rows: browserDml } = await pool.query(`
      select table_name,grantee,privilege_type
        from information_schema.role_table_grants
       where table_schema='teaching_runtime'
         and table_name in ('orchestration_executions','event_outbox')
         and grantee in ('anon','authenticated')
         and privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')
    `);
    assert.deepEqual(browserDml, []);

    const { rows: domainPrivileges } = await pool.query(`
      select table_name,privilege_type
        from information_schema.role_table_grants
       where table_schema='teaching_runtime'
         and table_name in ('event_outbox','due_events')
         and grantee='teaching_domain_service'
       order by table_name,privilege_type
    `);
    assert.deepEqual(domainPrivileges, [
      { table_name: 'due_events', privilege_type: 'INSERT' },
      { table_name: 'due_events', privilege_type: 'SELECT' },
      { table_name: 'event_outbox', privilege_type: 'INSERT' },
      { table_name: 'event_outbox', privilege_type: 'SELECT' },
    ]);

    const { rows: forbiddenServiceDeletes } = await pool.query(`
      select table_name,grantee,privilege_type
        from information_schema.role_table_grants
       where table_schema='teaching_runtime'
         and table_name in ('orchestration_executions','event_outbox')
         and grantee in ('service_role','teaching_domain_service')
         and privilege_type in ('DELETE','TRUNCATE')
    `);
    assert.deepEqual(forbiddenServiceDeletes, []);

    const { rows: policies } = await pool.query(`
      select tablename,cmd
        from pg_policies
       where schemaname='teaching_runtime'
         and tablename in ('event_outbox','due_events')
         and 'teaching_domain_service'=any(roles)
       order by tablename,cmd
    `);
    assert.deepEqual(policies, [
      { tablename: 'due_events', cmd: 'INSERT' },
      { tablename: 'due_events', cmd: 'SELECT' },
      { tablename: 'event_outbox', cmd: 'INSERT' },
      { tablename: 'event_outbox', cmd: 'SELECT' },
    ]);

    const { rows: protectedLeak } = await pool.query(`
      select grantee,privilege_type
        from information_schema.role_table_grants
       where table_schema='teaching_protected'
         and table_name='prepared_artifact_payloads'
         and grantee='teaching_domain_service'
    `);
    assert.deepEqual(protectedLeak, []);
  } finally {
    await pool.end();
  }
});

module.exports = { assertNonProductionDatabase };
