'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('Teaching and main Admin bootstraps load their modular interaction extensions',()=>{const root=path.resolve(__dirname,'../../..');assert.match(fs.readFileSync(path.join(root,'public/teaching-display.js'),'utf8'),/teaching-interaction-system/);assert.match(fs.readFileSync(path.join(root,'public/kiwi-runtime-config.js'),'utf8'),/admin-teaching-ai-diagnostics/);});
