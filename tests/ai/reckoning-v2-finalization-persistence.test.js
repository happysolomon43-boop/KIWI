'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createReckoningStore } = require('../../services/reckoning/store');

test('adaptive exam finalization replaces the zero default with server-derived elapsed duration', async () => {
  let captured = null;
  const store = createReckoningStore({
    query: async (sql, values) => {
      captured = { sql, values };
      return { rows: [{ id: 'exam-1', status: 'completed' }] };
    },
  });

  await store.completeExecutionExam('user-1', 'exam-1', {
    rawAccuracy: 80,
    answeredCount: 5,
    correctCount: 4,
  });

  assert.match(
    captured.sql,
    /WHEN COALESCE\(duration_seconds, 0\) > 0 THEN duration_seconds/
  );
  assert.match(
    captured.sql,
    /EXTRACT\(EPOCH FROM \(now\(\) - COALESCE\(started_at, now\(\)\)\)\)/
  );
  assert.deepEqual(captured.values, ['exam-1', 'user-1', 80, 4, 5]);
});
