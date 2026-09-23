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
    '20260923_reckoning_v2_source_card_fk_index.sql'
  ),
  'utf8'
);

test('Reckoning evidence source-card foreign key has a covering partial index', () => {
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS idx_reckoning_evidence_source_card/
  );
  assert.match(
    migration,
    /ON public\.reckoning_evidence \(source_card_id\)/
  );
  assert.match(
    migration,
    /WHERE source_card_id IS NOT NULL/
  );
});
