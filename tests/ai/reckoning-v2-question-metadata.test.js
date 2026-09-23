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
    '20260923_reckoning_v2_phase2_persistence.sql'
  ),
  'utf8'
);

const backend = fs.readFileSync(
  path.join(__dirname, '..', '..', 'index.js'),
  'utf8'
);

function examQuestionsAlterBlock() {
  const start = migration.indexOf('ALTER TABLE public.exam_questions');
  assert.notEqual(start, -1, 'missing exam_questions V2 metadata migration');
  const end = migration.indexOf('DO $$', start);
  assert.notEqual(end, -1, 'missing end marker for exam_questions metadata block');
  return migration.slice(start, end);
}

test('normal CBT rows are not required to populate Reckoning V2 metadata', () => {
  const block = examQuestionsAlterBlock();

  for (const column of [
    'reckoning_evidence_id',
    'reckoning_role',
    'variant_index',
    'reckoning_blueprint',
    'is_unlocked',
    'unlocked_at',
    'response_time_ms',
    'evidence_effect',
  ]) {
    const line = block
      .split('\n')
      .find((candidate) => candidate.includes(`ADD COLUMN IF NOT EXISTS ${column}`));

    assert.ok(line, `missing nullable metadata column: ${column}`);
    assert.doesNotMatch(line, /NOT NULL/i, `${column} must remain optional for normal CBT`);
    assert.doesNotMatch(line, /DEFAULT/i, `${column} must not alter legacy CBT inserts`);
  }
});

test('Reckoning question indexes are partial and cannot reshape normal CBT rows', () => {
  assert.match(
    migration,
    /idx_exam_questions_reckoning_evidence[\s\S]*WHERE reckoning_evidence_id IS NOT NULL/
  );
  assert.match(
    migration,
    /idx_exam_questions_reckoning_unlocked[\s\S]*WHERE reckoning_evidence_id IS NOT NULL/
  );
});

test('legacy backend does not read or write Reckoning V2 question metadata yet', () => {
  for (const identifier of [
    'reckoning_evidence_id',
    'reckoning_role',
    'variant_index',
    'reckoning_blueprint',
    'is_unlocked',
    'response_time_ms',
    'evidence_effect',
  ]) {
    assert.doesNotMatch(
      backend,
      new RegExp(identifier),
      `production index.js unexpectedly references V2 field: ${identifier}`
    );
  }
});

test('existing student flag and AI audit columns are not redefined by V2 migration', () => {
  const block = examQuestionsAlterBlock();
  assert.doesNotMatch(block, /flagged_by_student/);
  assert.doesNotMatch(block, /ai_audit_status/);
  assert.doesNotMatch(block, /bonus_awarded/);
});
