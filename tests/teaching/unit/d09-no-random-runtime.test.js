'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D09 natural cadence never uses nondeterministic Math.random()',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d09/scheduler.js'),'utf8');
  assert.doesNotMatch(source,/Math\.random\s*\(/);
  assert.match(source,/stableVariation/);
});
