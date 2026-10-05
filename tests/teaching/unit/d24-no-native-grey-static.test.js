'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D24 neutralizes native button/select appearance before applying Teaching styling',()=>{
  const css=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d24.css'),'utf8');
  assert.match(css,/-webkit-appearance:\s*none/);
  assert.match(css,/appearance:\s*none/);
});
