'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Teaching shared UI explicitly preserves reduced-motion, high-contrast and forced-colors behavior',()=>{
  const base=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-ui-system.css'),'utf8');
  const a11y=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-ui-accessibility.js'),'utf8');
  const display=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-display.js'),'utf8');
  assert.match(base,/prefers-reduced-motion:reduce/);
  assert.match(a11y,/prefers-contrast: more/);
  assert.match(a11y,/forced-colors: active/);
  assert.match(a11y,/background:Highlight;color:HighlightText/);
  assert.match(a11y,/outline:3px solid Highlight/);
  assert.match(display,/teaching-ui-accessibility\.js/);
});
