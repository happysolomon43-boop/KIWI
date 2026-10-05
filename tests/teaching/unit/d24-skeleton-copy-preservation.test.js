'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D24 skeleton keeps the live loading node in place rather than deleting its semantics',()=>{
  const css=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d24.css'),'utf8');
  assert.match(css,/\.tf-page > \.tf-action-status:only-child:not\(:empty\)/);
  assert.match(css,/color:\s*transparent/);
  assert.match(css,/prefers-reduced-motion/);
});
