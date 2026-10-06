'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D24 global renderer owns typography, active tabs, disabled states and overview skeletons',()=>{
  const css=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d24.css'),'utf8');
  assert.match(css,/font-family:\s*var\(--font-body/);
  assert.match(css,/\.teaching-course-nav__item:is\(\[aria-current="page"\]/);
  assert.match(css,/button\):disabled/);
  assert.match(css,/\.tf-page > \.tf-action-status:only-child:not\(:empty\)/);
  assert.match(css,/teaching-skeleton-sweep/);
});

test('D24 loads the cross-surface renderer for Classroom locking and Request owner metadata',()=>{
  const d24=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d24.js'),'utf8');
  const experience=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-experience-enhancements.js'),'utf8');
  assert.match(d24,/teaching-experience-enhancements\.js/);
  assert.match(experience,/Reviewed by/);
  assert.match(experience,/Decision window/);
  assert.match(experience,/Get decision now/);
  assert.match(experience,/Opens/);
  assert.match(experience,/Enter pre-class/);
  assert.match(experience,/60\*60\*1000/);
});
