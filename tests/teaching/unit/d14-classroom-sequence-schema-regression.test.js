'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('D11 Classroom ordering query is backed by the D08 sequence schema migration',()=>{
  const repo=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');
  const migration=fs.readFileSync(path.resolve(__dirname,'../../../migrations/20261005_teaching_learning_unit_sequence.sql'),'utf8');
  assert.match(repo,/order by sequence_no,learning_unit_id/);
  assert.match(migration,/sequence_no integer/);
});
