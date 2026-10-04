'use strict';
const D28_TASK_IDS=Object.freeze([
'TCH-0599','TCH-0600','TCH-0601','TCH-0602','TCH-0603','TCH-0604','TCH-0605','TCH-0606','TCH-0607','TCH-0608','TCH-0609','TCH-0610','TCH-0611','TCH-0612','TCH-0613','TCH-0614','TCH-0615','TCH-0616','TCH-0617','TCH-0618','TCH-0619','TCH-0620','TCH-0621','TCH-0622','TCH-0623','TCH-0624','TCH-0625','TCH-0626','TCH-0627','TCH-0628','TCH-0678','TCH-0777','TCH-0867','TCH-0868','TCH-0869','TCH-0870','TCH-0899','TCH-0900','TCH-0916']);
function assertD28TaskAccounting(ids=D28_TASK_IDS){const got=[...new Set(ids)].sort();const want=[...D28_TASK_IDS].sort();if(got.length!==39||JSON.stringify(got)!==JSON.stringify(want)){const e=new Error('D28 task accounting must contain exactly the canonical 39 tasks.');e.code='TEACHING_D28_TASK_ACCOUNTING_INVALID';throw e;}return true;}
module.exports={D28_TASK_IDS,assertD28TaskAccounting};
