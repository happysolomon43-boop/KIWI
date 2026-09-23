'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  finalizeKsSnapshot,
  persistedSnapshot,
} = require('../../services/reckoning/ks-outcome');

test('KS finalization persists and emits exactly once, then replays the stored snapshot', async () => {
  const exam = {
    id: 'exam-ks-1',
    subject_id: 'subject-1',
    ks_before: 42,
    ks_after: null,
    ks_delta: null,
    ks_processed_at: null,
  };

  let persistCalls = 0;
  let updateCalls = 0;
  const emitted = [];

  const first = await finalizeKsSnapshot({
    userId: 'user-1',
    exam,
    scorePct: 80,
    persistScore: async () => {
      persistCalls += 1;
      return { score: 50 };
    },
    updateExam: async (_userId, _examId, update) => {
      updateCalls += 1;
      Object.assign(exam, update);
    },
    emitChange: (userId, payload) => emitted.push({ userId, payload }),
    clock: () => new Date('2026-09-23T10:00:00.000Z'),
  });

  assert.equal(first.replayed, false);
  assert.equal(first.before, 42);
  assert.equal(first.after, 50);
  assert.equal(first.delta, 8);
  assert.equal(persistCalls, 1);
  assert.equal(updateCalls, 1);
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], {
    userId: 'user-1',
    payload: {
      subject_id: 'subject-1',
      ks_delta: 8,
      new_ks: 50,
    },
  });

  const replay = await finalizeKsSnapshot({
    userId: 'user-1',
    exam,
    scorePct: 80,
    persistScore: async () => {
      persistCalls += 1;
      return { score: 999 };
    },
    updateExam: async () => {
      updateCalls += 1;
    },
    emitChange: (userId, payload) => emitted.push({ userId, payload }),
  });

  assert.equal(replay.replayed, true);
  assert.equal(replay.before, 42);
  assert.equal(replay.after, 50);
  assert.equal(replay.delta, 8);
  assert.equal(persistCalls, 1);
  assert.equal(updateCalls, 1);
  assert.equal(emitted.length, 1);
});

test('a fresh exam object with ks_processed_at is replayed without another KS write or event', async () => {
  const storedExam = {
    id: 'exam-ks-2',
    subject_id: 'subject-2',
    ks_before: '31.5',
    ks_after: '28',
    ks_delta: '-3.5',
    ks_processed_at: '2026-09-23T10:05:00.000Z',
  };

  let sideEffects = 0;
  const replay = await finalizeKsSnapshot({
    userId: 'user-2',
    exam: storedExam,
    scorePct: 40,
    persistScore: async () => {
      sideEffects += 1;
      return { score: 0 };
    },
    updateExam: async () => {
      sideEffects += 1;
    },
    emitChange: () => {
      sideEffects += 1;
    },
  });

  assert.deepEqual(replay, persistedSnapshot(storedExam));
  assert.equal(replay.replayed, true);
  assert.equal(replay.before, 31.5);
  assert.equal(replay.after, 28);
  assert.equal(replay.delta, -3.5);
  assert.equal(sideEffects, 0);
});

test('zero-score integrity guard never records a positive KS contribution', async () => {
  const exam = {
    id: 'exam-ks-zero',
    subject_id: 'subject-zero',
    ks_before: 10,
    ks_processed_at: null,
  };
  const errors = [];
  const emitted = [];
  let saved = null;

  const result = await finalizeKsSnapshot({
    userId: 'user-zero',
    exam,
    scorePct: 0,
    persistScore: async () => ({ score: 15 }),
    updateExam: async (_userId, _examId, update) => {
      saved = update;
    },
    emitChange: (_userId, payload) => emitted.push(payload),
    logger: { error: (...args) => errors.push(args) },
    clock: () => new Date('2026-09-23T10:10:00.000Z'),
  });

  assert.equal(result.before, 10);
  assert.equal(result.after, 15);
  assert.equal(result.delta, 0);
  assert.equal(saved.ks_delta, 0);
  assert.equal(emitted.length, 0);
  assert.equal(errors.length, 1);
});

test('missing exam identity returns a neutral snapshot without side effects', async () => {
  let calls = 0;

  const result = await finalizeKsSnapshot({
    userId: 'user-missing',
    exam: null,
    scorePct: 100,
    persistScore: async () => {
      calls += 1;
      return { score: 100 };
    },
    updateExam: async () => {
      calls += 1;
    },
    emitChange: () => {
      calls += 1;
    },
  });

  assert.deepEqual(result, {
    before: null,
    after: null,
    delta: null,
    processedAt: null,
    replayed: false,
  });
  assert.equal(calls, 0);
});
