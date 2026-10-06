'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {representativeCases}=require('../../../teaching/admin-ai-diagnostics');

test('Admin Teaching AI live smoke selects exactly one empirical fixture per frozen family',()=>{
  const cases=representativeCases();
  assert.equal(cases.length,20);
  assert.equal(new Set(cases.map((item)=>item.familyId)).size,20);
  assert.ok(cases.every((item)=>item.capabilityId&&item.familyVersion&&item.id));
});
