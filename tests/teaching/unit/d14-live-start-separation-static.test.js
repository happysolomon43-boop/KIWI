'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D14 entry contract explicitly separates Classroom entry from live teaching start',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d14/service.js'),'utf8');
  assert.match(source,/liveTeachingStarted:false/);
  assert.match(source,/liveStartAllowed/);
  assert.match(source,/PRE_CLASS/);
});
