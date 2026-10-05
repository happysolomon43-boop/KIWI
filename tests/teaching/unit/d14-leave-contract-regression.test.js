'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Classroom keeps explicit student leave confirmation and the LEAVE interaction',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(source,/Leave the Classroom\?/);
  assert.match(source,/kind:'LEAVE'|kind: 'LEAVE'/);
});
