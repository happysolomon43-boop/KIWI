'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D09 explains separate availability windows and natural Class spacing',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d09.js'),'utf8');
  assert.match(source,/large break/);
  assert.match(source,/prefer spacing Classes/);
  assert.match(source,/doesn’t automatically fill every day|does not automatically fill every day/);
});
