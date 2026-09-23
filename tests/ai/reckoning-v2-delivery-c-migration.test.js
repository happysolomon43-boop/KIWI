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
    '20260923_reckoning_v2_delivery_c_spacing.sql'
  ),
  'utf8'
);

test('Delivery C revisit-spacing migration is additive and bounded', () => {
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS next_eligible_question integer/
  );
  assert.match(
    migration,
    /next_eligible_question IS NULL\s+OR next_eligible_question >= 0/
  );
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /DROP\s+COLUMN/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
});
