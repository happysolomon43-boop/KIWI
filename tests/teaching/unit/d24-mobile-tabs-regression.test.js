'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Teaching Course tabs remain horizontally scrollable and visually active on mobile',()=>{
  const css=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d24.css'),'utf8');
  assert.match(css,/\.teaching-course-nav\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(css,/scrollbar-width:\s*none/);
  assert.match(css,/\.teaching-course-nav__item:is\(\[aria-current="page"\]/);
  assert.match(css,/@media \(max-width: 699px\)[\s\S]*scroll-snap-type:\s*x proximity/);
});
