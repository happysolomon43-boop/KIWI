'use strict';
const D21_TASK_IDS=Object.freeze(['TCH-0037','TCH-0063',...Array.from({length:35},(_,i)=>`TCH-${String(427+i).padStart(4,'0')}`),'TCH-0732','TCH-0890']);
function assertD21TaskAccounting(){if(D21_TASK_IDS.length!==39)throw new Error(`D21 task accounting expected 39 tasks, got ${D21_TASK_IDS.length}.`);if(new Set(D21_TASK_IDS).size!==39)throw new Error('D21 task accounting contains duplicates.');return true;}
module.exports={D21_TASK_IDS,assertD21TaskAccounting};
