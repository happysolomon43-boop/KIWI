'use strict';

const D25_TASK_IDS=Object.freeze(Array.from({length:18},(_,i)=>`TCH-${String(522+i).padStart(4,'0')}`));
function assertD25TaskAccounting(){
  if(D25_TASK_IDS.length!==18)throw new Error('D25 must account for exactly 18 tasks.');
  const unique=new Set(D25_TASK_IDS);if(unique.size!==18)throw new Error('D25 task accounting contains duplicates.');
  for(let i=522;i<=539;i+=1){const id=`TCH-${String(i).padStart(4,'0')}`;if(!unique.has(id))throw new Error(`D25 missing ${id}.`);}
  return true;
}
module.exports={D25_TASK_IDS,assertD25TaskAccounting};
