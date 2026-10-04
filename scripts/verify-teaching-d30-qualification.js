'use strict';
const d30=require('../teaching/d30');
const expected=['TCH-0819','TCH-0820','TCH-0821','TCH-0822','TCH-0823','TCH-0824','TCH-0825','TCH-0826','TCH-0827','TCH-0828','TCH-0829','TCH-0830','TCH-0831','TCH-0832','TCH-0834','TCH-0835','TCH-0836','TCH-0837','TCH-0838','TCH-0839','TCH-0840','TCH-0841','TCH-0842','TCH-0843','TCH-0844','TCH-0845','TCH-0846','TCH-0847','TCH-0848','TCH-0849','TCH-0850','TCH-0851','TCH-0852','TCH-0853','TCH-0854','TCH-0855','TCH-0857','TCH-0860','TCH-0861','TCH-0862','TCH-0863','TCH-0864','TCH-0865','TCH-0866','TCH-0902','TCH-0920'];
if(JSON.stringify(d30.D30_TASK_IDS)!==JSON.stringify(expected)) throw new Error('D30 task census drift');
if(d30.ISOLATED_FAMILY_CORPUS.length!==1832||d30.CROSS_FAMILY_CORPUS.length!==72||d30.TPF20_CORPUS.length!==96) throw new Error('D30 corpus floor drift');
console.log(JSON.stringify({delivery:'D30',taskCount:46,phase16Isolated:1832,crossFamily:72,tpf20:96,totalDistinctCases:d30.FULL_CORPUS.length,productionAuthorizationGate:'D31',status:'IMPLEMENTATION_VERIFIED_EMPIRICAL_EXECUTION_REQUIRED'},null,2));
