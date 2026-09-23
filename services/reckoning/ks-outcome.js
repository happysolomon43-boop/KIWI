'use strict';

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function persistedSnapshot(exam = {}) {
  if (!exam?.ks_processed_at) return null;
  return Object.freeze({
    before: finiteNumber(exam.ks_before),
    after: finiteNumber(exam.ks_after),
    delta: finiteNumber(exam.ks_delta),
    processedAt: exam.ks_processed_at,
    replayed: true,
  });
}

async function finalizeKsSnapshot({
  userId,
  exam,
  scorePct,
  baselineOverride = null,
  persistScore,
  updateExam,
  emitChange,
  logger = console,
  clock = () => new Date(),
} = {}) {
  if (!exam?.id || !exam?.subject_id) {
    return Object.freeze({
      before: null,
      after: null,
      delta: null,
      processedAt: null,
      replayed: false,
    });
  }

  const replay = persistedSnapshot(exam);
  if (replay) return replay;

  if (typeof persistScore !== 'function' || typeof updateExam !== 'function') {
    throw new TypeError('finalizeKsSnapshot requires persistScore and updateExam.');
  }

  const before =
    finiteNumber(baselineOverride) ?? finiteNumber(exam.ks_before);

  let persisted = null;
  try {
    persisted = await persistScore(userId, exam.subject_id);
  } catch (error) {
    logger?.error?.('[KIWI] Failed to persist post-exam KS:', error?.message || String(error));
  }

  const after = finiteNumber(persisted?.score);
  let delta =
    before !== null && after !== null
      ? parseFloat((after - before).toFixed(2))
      : null;

  if (Number(scorePct) === 0 && delta !== null && delta > 0) {
    logger?.error?.(
      '[KIWI] KS integrity guard: zero-score exam produced positive delta',
      {
        examId: exam.id,
        before,
        after,
        computedDelta: delta,
      }
    );
    delta = 0;
  }

  const processedAt = clock();
  const update = {
    ks_after: after,
    ks_delta: delta,
    ks_processed_at: processedAt,
  };
  if (before !== null) update.ks_before = before;

  await updateExam(userId, exam.id, update);

  // Mirror the durable row in the caller's exam object. This matters when a
  // retry happens in the same process without a fresh SELECT.
  exam.ks_after = after;
  exam.ks_delta = delta;
  exam.ks_processed_at = processedAt;
  if (before !== null) exam.ks_before = before;

  if (delta !== null && delta !== 0 && typeof emitChange === 'function') {
    emitChange(userId, {
      subject_id: exam.subject_id,
      ks_delta: delta,
      new_ks: after,
    });
  }

  return Object.freeze({
    before,
    after,
    delta,
    processedAt,
    replayed: false,
  });
}

module.exports = {
  finiteNumber,
  persistedSnapshot,
  finalizeKsSnapshot,
};
