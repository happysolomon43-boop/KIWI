'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Teaching Request presentation maps canonical owners and exposes bounded decision windows without mutating authority',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-experience-enhancements.js'),'utf8');
  for(const owner of ['scheduler','attendance','teacher_identity','work','course_lifecycle'])assert.match(source,new RegExp(`${owner}:`));
  assert.match(source,/usually within seconds, allow up to 2 min/);
  assert.match(source,/No fixed ETA/);
  assert.doesNotMatch(source,/\/review.*method:\s*['"]POST/);
});
