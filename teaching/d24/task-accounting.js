'use strict';

const D24_TASK_IDS = Object.freeze([
  ...Array.from({ length: 18 }, (_, index) => `TCH-${String(504 + index).padStart(4, '0')}`),
  ...Array.from({ length: 17 }, (_, index) => `TCH-${String(582 + index).padStart(4, '0')}`),
]);

function assertD24TaskAccounting() {
  if (D24_TASK_IDS.length !== 35) throw new Error('D24 must account for exactly 35 canonical tasks.');
  if (new Set(D24_TASK_IDS).size !== D24_TASK_IDS.length) throw new Error('D24 task accounting contains duplicates.');
  return true;
}

module.exports = { D24_TASK_IDS, assertD24TaskAccounting };
