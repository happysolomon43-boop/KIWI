'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  requireAnalyticsPseudonymSecret,
  extractOptionOrder,
  extractSelectedOptionId,
}=require('../../../teaching/d28/runtime-service');

test('D28 analytics pseudonym secret fails closed when no private server secret is configured',()=>{
  assert.throws(()=>requireAnalyticsPseudonymSecret({}),error=>error?.code==='TEACHING_D28_ANALYTICS_PSEUDONYM_SECRET_REQUIRED');
  assert.equal(requireAnalyticsPseudonymSecret({TEACHING_D28_ANALYTICS_PSEUDONYM_SECRET:'private-d28-secret'}),'private-d28-secret');
  assert.equal(requireAnalyticsPseudonymSecret({SESSION_SECRET:'existing-private-session-secret'}),'existing-private-session-secret');
});

test('D28 locked option lineage accepts stable ids from canonical choice-set variants without positional guessing',()=>{
  assert.deepEqual(extractOptionOrder({stable_option_ids:['opt-a','opt-b','opt-a']},{}),['opt-a','opt-b']);
  assert.deepEqual(extractOptionOrder({options:[{option_id:'A'},{optionId:'B'},{id:'C'},{choice_id:'D'}]},{}),['A','B','C','D']);
  assert.deepEqual(extractOptionOrder({}, {options:[{optionId:'x'},{option_id:'y'}]}),['x','y']);
  assert.equal(extractSelectedOptionId({choice_id:'D'}),'D');
  assert.equal(extractSelectedOptionId({option_id:'A'}),'A');
});
