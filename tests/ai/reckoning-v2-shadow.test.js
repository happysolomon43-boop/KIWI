'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createShadowIntelligence } = require('../../services/reckoning');

test('shadow runner persists evidence and marks SHADOW without changing engine_version', async () => {
  const calls = [];
  let idCounter = 0;

  const query = async (sql, values = []) => {
    calls.push({ sql, values });

    if (sql.includes('FROM review_logs')) {
      return { rows: [{ card_id: 'card-1', recent_again_hard: 3 }] };
    }
    if (sql.includes('FROM exam_questions')) {
      return { rows: [{ card_id: 'card-1', recent_exam_misses: 2 }] };
    }
    if (sql.includes('INSERT INTO reckoning_evidence')) {
      return { rows: [{ id: values[0], reckoning_id: values[1], source_card_id: values[4] }] };
    }
    if (sql.includes('UPDATE reckoning_sessions')) {
      return { rows: [{ id: values[0] }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const shadow = createShadowIntelligence({
    query,
    randomUUID: () => `evidence-${++idCounter}`,
    clock: () => new Date('2026-09-23T08:00:00.000Z').getTime(),
  });

  const plan = await shadow.analyzeAndPersist({
    reckoning: { id: 'reckoning-1', state_version: 0 },
    userId: 'user-1',
    subjectId: 'subject-1',
    pressureScore: 24,
    subjectExamDate: new Date('2026-10-01T08:00:00.000Z'),
    cards: [
      {
        id: 'card-1',
        front_content: 'Q1',
        back_content: 'A1',
        stage: 2,
        fsrs_stability: 1,
        last_reviewed_at: '2026-09-20T08:00:00.000Z',
      },
      {
        id: 'card-2',
        front_content: 'Q2',
        back_content: 'A2',
        stage: 4,
        verified: true,
      },
      {
        id: 'card-3',
        front_content: 'Q3',
        back_content: 'A3',
        stage: 4,
        verified: true,
      },
      {
        id: 'card-4',
        front_content: 'Q4',
        back_content: 'A4',
        stage: 4,
        verified: true,
      },
      {
        id: 'card-5',
        front_content: 'Q5',
        back_content: 'A5',
        stage: 4,
        verified: true,
      },
      {
        id: 'card-6',
        front_content: 'Q6',
        back_content: 'A6',
        stage: 4,
        verified: true,
      },
    ],
    states: [
      { card_id: 'card-1', state: 'STUCK', verified: false, learning_debt: true },
      { card_id: 'card-2', state: 'STABLE', verified: true },
      { card_id: 'card-3', state: 'STABLE', verified: true },
      { card_id: 'card-4', state: 'STABLE', verified: true },
      { card_id: 'card-5', state: 'STABLE', verified: true },
      { card_id: 'card-6', state: 'STABLE', verified: true },
    ],
    bubbleCardIds: ['card-1'],
  });

  assert.equal(plan.mode, 'SHADOW');
  assert.ok(plan.evidence.length >= 1);

  const sessionUpdate = calls.find((call) => call.sql.includes('UPDATE reckoning_sessions'));
  assert.ok(sessionUpdate);
  assert.match(sessionUpdate.sql, /engine_mode/);
  assert.doesNotMatch(sessionUpdate.sql, /engine_version/);
  assert.ok(sessionUpdate.values.includes('SHADOW'));

  const evidenceWrites = calls.filter((call) => call.sql.includes('INSERT INTO reckoning_evidence'));
  assert.ok(evidenceWrites.length >= 1);
  assert.ok(evidenceWrites.some((call) => call.values.includes('card-1')));
});

test('production trigger runs shadow only after legacy question count and session creation are fixed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
  const start = source.indexOf('async function triggerReckoning');
  const end = source.indexOf('async function deferReckoning', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);

  const questionCount = block.indexOf('const questionCount = Math.min(25, Math.max(5, flaggedCards.length))');
  const create = block.indexOf('reckoning = await db.reckoningSessions.create');
  const shadow = block.indexOf('reckoningShadow.analyzeSafely');
  const scheduled = block.indexOf('setImmediate(async () =>');

  assert.ok(questionCount >= 0);
  assert.ok(create > questionCount);
  assert.ok(scheduled > create);
  assert.ok(shadow > scheduled);
  assert.match(block, /question_count:\s*questionCount/);
  assert.doesNotMatch(block, /questionCount\s*=\s*.*shadow/i);
});

test('shadow failures are explicitly non-fatal', async () => {
  const warnings = [];
  const shadow = createShadowIntelligence({
    query: async () => {
      throw new Error('database unavailable');
    },
    randomUUID: () => 'id',
    logger: { warn: (...args) => warnings.push(args) },
  });

  const result = await shadow.analyzeSafely({
    reckoning: { id: 'reckoning-1' },
    userId: 'user-1',
    subjectId: 'subject-1',
    cards: [{ id: 'card-1', front_content: 'Q', back_content: 'A' }],
    states: [{ card_id: 'card-1', state: 'STUCK' }],
  });

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
});
