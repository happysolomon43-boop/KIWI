'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCTION_PROJECT_REF, assertNonProductionDatabase, integrationConfig, createIntegrationPool } = require('./test-db');



test('integration-test guard rejects production Supabase', () => {
  assert.throws(
    () => assertNonProductionDatabase({
      connectionString: `postgresql://example.${PRODUCTION_PROJECT_REF}@localhost/test`,
      projectRef: PRODUCTION_PROJECT_REF,
    }),
    /production/
  );
});

const { connectionString, projectRef, skipReason } = integrationConfig('D01');

test('non-production Supabase exposes existing KIWI foundation tables read-only', { skip: skipReason }, async () => {
  assertNonProductionDatabase({ connectionString, projectRef });

  const pool = createIntegrationPool(connectionString);

  try {
    const { rows } = await pool.query(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name`,
      [['exam_sessions', 'notifications', 'subjects']]
    );
    assert.deepEqual(rows.map((row) => row.table_name), ['exam_sessions', 'notifications', 'subjects']);
  } finally {
    await pool.end();
  }
});

module.exports = { assertNonProductionDatabase };
