'use strict';

const D23_TASK_IDS=Object.freeze([
  ...Array.from({length:25},(_,i)=>`TCH-${String(479+i).padStart(4,'0')}`),
  'TCH-0911',
]);

function assertD23TaskAccounting(){
  if(D23_TASK_IDS.length!==26)throw new Error('D23 must account for exactly 26 canonical tasks.');
  if(new Set(D23_TASK_IDS).size!==D23_TASK_IDS.length)throw new Error('D23 task accounting contains duplicates.');
  return true;
}

module.exports={D23_TASK_IDS,assertD23TaskAccounting};
