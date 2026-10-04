'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..','..','..');

function read(relative){
  return fs.readFileSync(path.join(root,relative),'utf8');
}

test('D30 exact-run human review foreign key has a dedicated covering index',()=>{
  const identity=read('migrations/20261004_teaching_d30_human_review_run_identity.sql');
  const hardening=read('migrations/20261004_teaching_d30_human_review_fk_index.sql');
  assert.match(identity,/foreign key \(run_id\)[\s\S]*d30_case_results\(id\)/i);
  assert.match(hardening,/create index if not exists d30_human_reviews_run_fk_idx[\s\S]*d30_human_reviews\(run_id\)/i);
});
