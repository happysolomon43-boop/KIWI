'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const PRODUCTION_PROJECT_REF = 'nqdwifqskxkblgdgeutn';

function assertNonProductionDatabase({ connectionString, projectRef }) {
  if (!connectionString) throw new Error('TEACHING_TEST_DATABASE_URL is required.');
  if (!projectRef) throw new Error('TEACHING_TEST_PROJECT_REF is required.');
  if (projectRef === PRODUCTION_PROJECT_REF || connectionString.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Teaching D02 integration tests refuse to run against production KIWI Supabase.');
  }
  return true;
}

const connectionString = process.env.TEACHING_TEST_DATABASE_URL;
const projectRef = process.env.TEACHING_TEST_PROJECT_REF;
const skipReason = (!connectionString || !projectRef)
  ? 'No non-production Supabase branch/project configured for Teaching D02 integration tests.'
  : false;

test('D02 integration guard refuses production Supabase', () => {
  assert.throws(
    () => assertNonProductionDatabase({
      connectionString: `postgresql://example.${PRODUCTION_PROJECT_REF}@localhost/test`,
      projectRef: PRODUCTION_PROJECT_REF,
    }),
    /refuse to run against production/
  );
});

test('D02 private runtime schema exists and is not granted to browser roles', { skip: skipReason }, async () => {
  assertNonProductionDatabase({ connectionString, projectRef });

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const { rows: tables } = await pool.query(
      `select table_name
         from information_schema.tables
        where table_schema = 'teaching_runtime'
          and table_name = any($1::text[])
        order by table_name`,
      [['due_events', 'event_attempts', 'ai_execution_audit']]
    );
    assert.deepEqual(
      tables.map((row) => row.table_name),
      ['ai_execution_audit', 'due_events', 'event_attempts']
    );

    const { rows: exposed } = await pool.query(
      `select grantee, table_name, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'teaching_runtime'
          and grantee in ('anon', 'authenticated')`
    );
    assert.deepEqual(exposed, []);

    const { rows: rls } = await pool.query(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'teaching_runtime'
          and c.relname = any($1::text[])
        order by c.relname`,
      [['due_events', 'event_attempts', 'ai_execution_audit']]
    );
    assert.deepEqual(
      rls.map((row) => [row.relname, row.relrowsecurity]),
      [
        ['ai_execution_audit', true],
        ['due_events', true],
        ['event_attempts', true],
      ]
    );
  } finally {
    await pool.end();
  }
});

module.exports = { assertNonProductionDatabase };
