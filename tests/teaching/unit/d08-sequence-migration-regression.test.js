'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Learning Unit sequence migration backfills plan-local order and indexes D11 lookup',()=>{
  const sql=fs.readFileSync(path.resolve(__dirname,'../../../migrations/20261005_teaching_learning_unit_sequence.sql'),'utf8');
  assert.match(sql,/add column if not exists sequence_no integer/i);
  assert.match(sql,/row_number\(\) over/i);
  assert.match(sql,/partition by u\.course_plan_id/i);
  assert.match(sql,/teaching_learning_units_plan_sequence_idx/i);
});
