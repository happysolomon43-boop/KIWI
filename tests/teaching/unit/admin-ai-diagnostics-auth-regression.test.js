'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {authorize}=require('../../../teaching/admin-ai-diagnostics');

test('Teaching Admin AI diagnostics require DB admin role or configured master token',()=>{
  const env={ADMIN_MASTER_TOKEN:'secret-token'};
  assert.equal(authorize({user:{role:'admin'},headers:{}},env),true);
  assert.equal(authorize({user:{role:'user'},headers:{'x-admin-token':'secret-token'}},env),true);
  assert.equal(authorize({user:{role:'user'},headers:{'x-admin-token':'wrong'}},env),false);
  assert.equal(authorize({user:{role:'user'},headers:{}},{}),false);
});
