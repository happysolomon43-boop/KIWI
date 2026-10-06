'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D24 disabled controls use intentional Teaching styling instead of browser-grey defaults',()=>{
  const css=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d24.css'),'utf8');
  assert.match(css,/button\):disabled[\s\S]*cursor:\s*not-allowed/);
  assert.match(css,/background:\s*linear-gradient/);
  assert.match(css,/filter:\s*saturate/);
});
