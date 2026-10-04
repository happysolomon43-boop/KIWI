'use strict';
const IDS=Object.freeze([...Array.from({length:23},(_,i)=>`TCH-${String(540+i).padStart(4,'0')}`),'TCH-0677','TCH-0898','TCH-0912','TCH-0913']);
function assertD26TaskAccounting(ids=IDS){const actual=[...new Set(ids)].sort();const expected=[...IDS].sort();if(JSON.stringify(actual)!==JSON.stringify(expected)){const e=new Error('D26 task accounting must contain exactly the 27 canonical task IDs.');e.code='TEACHING_D26_TASK_ACCOUNTING_MISMATCH';throw e;}return Object.freeze({delivery:'D26',taskCount:27,taskIds:IDS});}
module.exports={D26_TASK_IDS:IDS,assertD26TaskAccounting};
