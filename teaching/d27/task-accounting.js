'use strict';

const D27_TASK_IDS = Object.freeze([
  ...Array.from({ length:15 }, (_, index) => `TCH-${String(563 + index).padStart(4, '0')}`),
  'TCH-0914',
  'TCH-0915',
]);

function assertD27TaskAccounting(ids = D27_TASK_IDS) {
  const actual = [...new Set(ids)].sort();
  const expected = [...D27_TASK_IDS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const error = new Error('D27 task accounting must contain exactly the 17 canonical task IDs.');
    error.code = 'TEACHING_D27_TASK_ACCOUNTING_MISMATCH';
    throw error;
  }
  return Object.freeze({ delivery:'D27',taskCount:17,taskIds:D27_TASK_IDS });
}

module.exports = { D27_TASK_IDS, assertD27TaskAccounting };
