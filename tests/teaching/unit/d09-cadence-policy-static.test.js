'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const scheduler=require('../../../teaching/d09/scheduler');

test('D09 exports the canonical preferred same-day Class gap band',()=>{
  assert.equal(scheduler.PREFERRED_SAME_DAY_GAP_MINUTES,180);
  assert.equal(scheduler.PREFERRED_SAME_DAY_GAP_MAX_MINUTES,480);
});
