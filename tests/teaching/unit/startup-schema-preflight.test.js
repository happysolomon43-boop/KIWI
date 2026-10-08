'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {migrationTargets,selectMissingBootMigrations,planStartupSchemaMigrations}=require('../../../startup-schema-preflight');
test('catalog preflight skips DDL for existing columns without changing migration content',()=>{
  const migrations=[
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT ''",
    "ALTER TABLE cards ADD COLUMN IF NOT EXISTS new_column numeric DEFAULT NULL",
    "ALTER TABLE IF EXISTS ai_model_catalog ALTER COLUMN family DROP NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_cards_new_column ON cards(new_column)",
  ];
  const columns=[
    {table_name:'users',column_name:'full_name',is_nullable:'YES'},
    {table_name:'users',column_name:'avatar_url',is_nullable:'YES'},
    {table_name:'ai_model_catalog',column_name:'family',is_nullable:'YES'},
  ];
  const plan=selectMissingBootMigrations(migrations,columns);
  assert.equal(plan.skipped,3);
  assert.deepEqual(plan.pending,[migrations[2],migrations[4]]);
  assert.equal(plan.usedCatalog,true);
  assert.deepEqual(migrations[0],"ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text DEFAULT ''");
});
test('preflight does not suppress missing columns, unresolved table targets or needed DROP NOT NULL',()=>{
  const statements=[
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz',
    'ALTER TABLE users ALTER COLUMN is_active DROP NOT NULL',
    'ALTER TABLE unknown_table ADD COLUMN IF NOT EXISTS should_be_created text'
  ];
  const known=[{table_name:'users',column_name:'is_active',is_nullable:'NO'}];
  assert.equal(selectMissingBootMigrations(statements,known).pending.length,3);
  assert.equal(migrationTargets(statements[0]).column,'last_login_at');
});
test('preflight works from read-only catalog queries; if metadata query fails, runs normal schema path',async()=>{
  const migrations=[
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text DEFAULT ''",
    'ALTER TABLE cards ADD COLUMN IF NOT EXISTS fsrs_stability numeric'
  ];
  let calls=0;
  const result=await planStartupSchemaMigrations(async(sql,args)=>{
    calls+=1;assert.match(sql,/information_schema\.columns/);
    assert.deepEqual(args,[['users','cards']]);
    return {rows:[{table_name:'users',column_name:'full_name',is_nullable:'YES'}]};
  },migrations);
  assert.equal(calls,1);
  assert.equal(result.skipped,1);
  assert.deepEqual(result.pending,[migrations[1]]);
  const fail=await planStartupSchemaMigrations(async()=>{throw new Error('catalog unavailable')},migrations);
  assert.equal(fail.usedCatalog,false);
  assert.deepEqual(fail.pending,migrations);
});
test('boot path uses migration preflight before iterative DDL, with a log confirming skipped work',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.resolve(__dirname,'../../../index.js'),'utf8');
  assert.match(source,/planStartupSchemaMigrations\(query, migrations\)/);
  assert.match(source,/for \(const sql of bootstrapPlan\.pending\)/);
  assert.doesNotMatch(source,/for \(const sql of migrations\) \{\s*try \{\s*await query\(sql\)/);
});
