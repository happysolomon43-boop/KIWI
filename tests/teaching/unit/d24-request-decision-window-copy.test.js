'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Request decision-window copy distinguishes deterministic review from future-owner uncertainty',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-experience-enhancements.js'),'utf8');
  assert.match(source,/usually within seconds, allow up to 2 min/);
  assert.match(source,/Priority path · usually immediate–30 sec/);
  assert.match(source,/No fixed ETA · waiting for that owner to be available/);
});
