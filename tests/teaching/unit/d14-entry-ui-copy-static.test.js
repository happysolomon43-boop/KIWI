'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Classroom presentation tells students entry is available before live teaching starts',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-experience-enhancements.js'),'utf8');
  assert.match(source,/Enter pre-class/);
  assert.match(source,/lesson still waits for the scheduled start/);
  assert.match(source,/Classroom unlocks one hour before Class/);
});
