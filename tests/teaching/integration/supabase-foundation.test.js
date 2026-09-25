'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const PRODUCTION_PROJECT_REF = 'nqdwifqskxkblgdgeutn';

function assertNonProductionDatabase({ connectionString, projectRef }) {
  if (!connectionString) throw new Error('TEACHING_TEST_DATABASE_URL is required.');
  if (!projectRef) throw new Error('TEACHING_TEST_PROJECT_REF is required.');
  if (projectRef === PRODUCTION_PROJECT_REF || connectionString.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Teaching integration tests refuse to run against the production KIWI Supabase project.');
  }
  return true;
}

test('integration-test guard rejects production Supabase', () => {
  assert.throws(
    () => assertNonProductionDatabase({
      connectionString: `postgresql://example.${PRODUCTION_PROJECT_REF}@localhost/test`,
      projectRef: PRODUCTION_PROJECT_REF,
    }),
    /refuse to run against the production/
  );
});

const connectionString = process.env.TEACHING_TEST_DATABASE_URL;
const projectRef = process.env.TEACHING_TEST_PROJECT_REF;
const skipReason = (!connectionString || !projectRef)
  ? 'No non-production Supabase branch/project configured for D01 integration tests.'
  : false;

test('non-production Supabase exposes existing KIWI foundation tables read-only', { skip: skipReason }, async () => {
  assertNonProductionDatabase({ connectionString, projectRef });

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

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
