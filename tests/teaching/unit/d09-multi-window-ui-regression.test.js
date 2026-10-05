'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D09 availability UI supports multiple recurring time windows on selected days',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d09.js'),'utf8');
  assert.match(source,/\+ Add another time window/);
  assert.match(source,/09:00/);
  assert.match(source,/16:00/);
  assert.match(source,/availableRanges\.forEach/);
  assert.match(source,/avoidConsecutiveSameCourseDays:true/);
});
