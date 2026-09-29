'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCTION_PROJECT_REF, assertNonProductionDatabase, integrationConfig, createIntegrationPool } = require('./test-db');



const { connectionString, projectRef, skipReason } = integrationConfig('D02');

test('D02 integration guard refuses production Supabase', () => {
  assert.throws(
    () => assertNonProductionDatabase({
      connectionString: `postgresql://example.${PRODUCTION_PROJECT_REF}@localhost/test`,
      projectRef: PRODUCTION_PROJECT_REF,
    }),
    /production/
  );
});

test('D02 private runtime schema exists and is not granted to browser roles', { skip: skipReason }, async () => {
  assertNonProductionDatabase({ connectionString, projectRef });

  const pool = createIntegrationPool(connectionString);

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
