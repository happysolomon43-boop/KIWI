'use strict';
const D22_TASK_IDS=Object.freeze(Array.from({length:17},(_,i)=>`TCH-${String(462+i).padStart(4,'0')}`));
function assertD22TaskAccounting(){if(D22_TASK_IDS.length!==17)throw new Error(`D22 task accounting expected 17 tasks, got ${D22_TASK_IDS.length}.`);if(new Set(D22_TASK_IDS).size!==17)throw new Error('D22 task accounting contains duplicates.');return true;}
module.exports={D22_TASK_IDS,assertD22TaskAccounting};
