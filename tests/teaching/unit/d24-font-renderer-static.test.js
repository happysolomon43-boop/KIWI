'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D24 applies body and display typography across Teaching controls',()=>{
  const css=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d24.css'),'utf8');
  assert.match(css,/--font-body/);
  assert.match(css,/--font-display/);
  assert.match(css,/--font-mono/);
});
