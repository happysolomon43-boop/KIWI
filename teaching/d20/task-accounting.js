'use strict';

const D20_TASK_IDS=Object.freeze([
  'TCH-0057','TCH-0058',
  'TCH-0395','TCH-0396','TCH-0397','TCH-0398','TCH-0399','TCH-0400','TCH-0401','TCH-0402',
  'TCH-0403','TCH-0404','TCH-0405','TCH-0406','TCH-0407','TCH-0408','TCH-0409','TCH-0410',
  'TCH-0411','TCH-0412','TCH-0413','TCH-0414','TCH-0415','TCH-0416','TCH-0417','TCH-0418',
  'TCH-0419','TCH-0420','TCH-0421','TCH-0422','TCH-0423','TCH-0424','TCH-0425','TCH-0426',
  'TCH-0760','TCH-0761','TCH-0762','TCH-0763',
]);

const D20_IMPLEMENTATION_SURFACES=Object.freeze({
  persistence:Object.freeze(['TCH-0057','TCH-0058','TCH-0403','TCH-0404','TCH-0407','TCH-0408','TCH-0419','TCH-0420']),
  deterministicMarking:Object.freeze(['TCH-0395','TCH-0397','TCH-0399','TCH-0400','TCH-0410','TCH-0411','TCH-0412','TCH-0417','TCH-0418','TCH-0762']),
  controlledAI:Object.freeze(['TCH-0396','TCH-0398','TCH-0401','TCH-0402','TCH-0405','TCH-0760','TCH-0761']),
  gradebookDerivation:Object.freeze(['TCH-0406','TCH-0409','TCH-0413','TCH-0414','TCH-0415','TCH-0416']),
  product:Object.freeze(['TCH-0421','TCH-0422','TCH-0423']),
  assurance:Object.freeze(['TCH-0424','TCH-0425','TCH-0426','TCH-0763']),
});

function assertD20TaskAccounting(){
  const seen=new Set();
  for(const ids of Object.values(D20_IMPLEMENTATION_SURFACES))for(const id of ids){if(seen.has(id))throw new Error(`D20 task is accounted twice: ${id}`);seen.add(id);}
  if(D20_TASK_IDS.length!==38)throw new Error(`D20 must account for exactly 38 tasks, found ${D20_TASK_IDS.length}.`);
  const missing=D20_TASK_IDS.filter(id=>!seen.has(id));
  const extra=[...seen].filter(id=>!D20_TASK_IDS.includes(id));
  if(missing.length||extra.length)throw new Error(`D20 task accounting mismatch. Missing=${missing.join(',')}; Extra=${extra.join(',')}`);
  return Object.freeze({delivery:'D20',taskCount:D20_TASK_IDS.length,taskIds:D20_TASK_IDS,surfaces:D20_IMPLEMENTATION_SURFACES});
}

module.exports={D20_TASK_IDS,D20_IMPLEMENTATION_SURFACES,assertD20TaskAccounting};
