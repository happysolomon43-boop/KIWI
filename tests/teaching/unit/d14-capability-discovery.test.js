'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {listCapabilities}=require('../../../teaching/capability-registry');
test('D14 uses registered Teaching communication capabilities, not a browser-only chatbot',()=>{
  const all=listCapabilities();
  const relevant=all.filter(c=>/student.*question|teacher.*respond|class.*question|clarif|student.*help|dialog|convers|communication|classroom|teacher.*turn/i.test([c.id,c.purpose,c.commit_posture].join(' ')));
  console.log('KIWI_TPF08_CAPABILITY_CENSUS '+JSON.stringify(all.filter(c=>c.prompt_family_id==='TPF-08').map(c=>({id:c.id,purpose:c.purpose,owner:c.authoritative_owner_boundary,authority:c.authority_ceiling}))).slice(0,30000));
  console.log('KIWI_D14_DISCOVERED_CAPABILITIES '+JSON.stringify(relevant.map(c=>({id:c.id,purpose:c.purpose,authority:c.authority_ceiling,family:c.prompt_family_id,owner:c.authoritative_owner_boundary}))).slice(0,17000));
  assert.ok(relevant.length>0,'Expected at least one qualified Teaching communication capability');
});
