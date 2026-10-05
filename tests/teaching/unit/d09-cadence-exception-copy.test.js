'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D09 records when same-day cadence must be compressed by feasible capacity',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d09/scheduler.js'),'utf8');
  assert.match(source,/CONDENSED_SAME_DAY_PLACEMENT_REQUIRED_BY_FEASIBLE_CAPACITY/);
  assert.match(source,/CONSECUTIVE_SAME_COURSE_DAY_PLACEMENT_REQUIRED_BY_FEASIBLE_CAPACITY/);
});
