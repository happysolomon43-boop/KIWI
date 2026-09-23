'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    'migrations',
    '20260923_reckoning_v2_delivery_e_activation.sql'
  ),
  'utf8'
);

test('Delivery E migration adds only persisted checkpoint and final-report state', () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS checkpoint_pending boolean NOT NULL DEFAULT false/
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS checkpoint_next_question_id text/
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS final_report jsonb/
  );
  assert.match(migration, /reckoning_sessions_checkpoint_consistency_ck/);
  assert.match(migration, /WHERE checkpoint_pending = true/);

  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /DROP\s+COLUMN/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(
    migration,
    /UPDATE\s+public\.reckoning_sessions\s+SET\s+engine_version/i
  );
});
