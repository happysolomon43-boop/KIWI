'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createReckoningStore,
  ReckoningContractError,
} = require('../../services/reckoning');

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

test('Phase 2 migration is additive and keeps legacy Reckoning authoritative by default', () => {
  assert.match(migration, /engine_version integer NOT NULL DEFAULT 1/);
  assert.match(migration, /engine_mode text NOT NULL DEFAULT 'LEGACY'/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS engine_phase/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS state_version/);

  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /DROP\s+COLUMN/i);
  assert.doesNotMatch(migration, /ALTER\s+COLUMN[\s\S]*\sTYPE\s/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
});

test('Phase 2 creates backend-only persistent evidence with RLS enabled', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.reckoning_evidence/);
  assert.match(migration, /REFERENCES public\.reckoning_sessions\(id\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES public\.cards\(id\) ON DELETE SET NULL/);
  assert.match(migration, /ALTER TABLE public\.reckoning_evidence ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.reckoning_evidence FROM anon, authenticated/
  );
  assert.match(
    migration,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.reckoning_evidence TO service_role/
  );
});

test('Phase 2 persists the accepted evidence and question-role vocabulary', () => {
  for (const role of ['DIAGNOSTIC', 'CONTROL', 'CHALLENGE', 'CONFIRMATION']) {
    assert.match(migration, new RegExp(role));
  }

  for (const level of ['CRITICAL', 'HIGH', 'SUPPORTING']) {
    assert.match(migration, new RegExp(level));
  }

  for (const status of [
    'UNTESTED',
    'PROVISIONAL',
    'CHALLENGE_REQUIRED',
    'CONFIRMATION_REQUIRED',
    'RECOVERED',
    'UNRESOLVED',
    'INVALIDATED',
  ]) {
    assert.match(migration, new RegExp(status));
  }
});

test('Phase 2 only adds nullable/default-safe metadata to exam_questions', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reckoning_evidence_id text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reckoning_role text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS variant_index integer/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reckoning_blueprint jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS is_unlocked boolean/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS response_time_ms integer/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS evidence_effect jsonb/);
});

test('Reckoning store stays inert until a database query adapter is injected', async () => {
  const store = createReckoningStore();

  await assert.rejects(
    () => store.getSession('reckoning-1'),
    (error) =>
      error instanceof ReckoningContractError &&
      error.code === 'ERR_RECKONING_CONTRACT'
  );
});

test('Reckoning store creates evidence using text IDs and JSON snapshots', async () => {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: values[0], concept_key: values[5] }] };
  };

  const store = createReckoningStore({
    query,
    randomUUID: () => 'evidence-fixed-id',
  });

  const row = await store.createEvidence({
    reckoningId: 'reckoning-1',
    userId: 'user-1',
    subjectId: 'subject-1',
    sourceCardId: 'card-1',
    conceptKey: 'card:card-1',
    sourceSnapshot: { front: 'A', back: 'B' },
    sourceHash: 'sha256:test',
    originalCardState: 'STUCK',
    riskScore: 88,
    riskLevel: 'CRITICAL',
    riskReasons: ['STUCK', 'low_retrievability'],
    requiredConfirmations: 1,
  });

  assert.equal(row.id, 'evidence-fixed-id');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO reckoning_evidence/);
  assert.equal(calls[0].values[0], 'evidence-fixed-id');
  assert.equal(calls[0].values[1], 'reckoning-1');
  assert.equal(calls[0].values[5], 'card:card-1');
  assert.equal(calls[0].values[6], JSON.stringify({ front: 'A', back: 'B' }));
  assert.equal(calls[0].values[11], JSON.stringify(['STUCK', 'low_retrievability']));
});

test('Reckoning store restricts session updates to the Phase 2 persistence contract', async () => {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: values[0], engine_version: 2 }] };
  };

  const store = createReckoningStore({ query });

  await store.saveSession('reckoning-1', {
    engineVersion: 2,
    engineMode: 'SHADOW',
    enginePhase: 'PREPARING',
    questionsUsed: 0,
    stateVersion: 1,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE reckoning_sessions/);
  assert.match(calls[0].sql, /engine_version = \$2/);
  assert.match(calls[0].sql, /engine_mode = \$3/);
  assert.match(calls[0].sql, /state_version = \$6/);

  await assert.rejects(
    () => store.saveSession('reckoning-1', { scorePct: 100 }),
    /Unsupported reckoning_sessions field: scorePct/
  );
});

test('Reckoning store serializes JSON evidence updates and rejects empty patches', async () => {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: values[0] }] };
  };

  const store = createReckoningStore({ query });

  await store.saveEvidence('evidence-1', {
    riskReasons: ['GHOST', 'exam_failure'],
    evidenceStatus: 'PROVISIONAL',
  });

  assert.match(calls[0].sql, /risk_reasons = \$2::jsonb/);
  assert.equal(calls[0].values[1], JSON.stringify(['GHOST', 'exam_failure']));

  await assert.rejects(
    () => store.saveEvidence('evidence-1', {}),
    /No fields supplied for reckoning_evidence update/
  );
});

test('Delivery D outcome lock uses a transaction-scoped PostgreSQL advisory lock', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const transaction = async (work) => work(client);

  const store = createReckoningStore({
    query: async () => ({ rows: [] }),
    transaction,
  });

  let ran = false;
  const result = await store.withOutcomeLock('reckoning-lock-1', async () => {
    ran = true;
    return 'done';
  });

  assert.equal(ran, true);
  assert.equal(result, 'done');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(calls[0].values, ['reckoning-v2-outcome:reckoning-lock-1']);
});
