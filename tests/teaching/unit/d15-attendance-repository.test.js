'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createD15AttendanceRepository}=require('../../../teaching/repositories/d15-attendance');

function repositoryWith(query){
  return createD15AttendanceRepository({
    query,
    withTransaction:async(fn)=>fn({query}),
    randomUUID:()=> 'uuid-d15-test',
  });
}

test('D15 serializes immutable attendance versions without row UPDATE locks',async()=>{
  const calls=[];
  const runner={
    query:async(sql,params=[])=>{
      calls.push({sql,params});
      if(/pg_advisory_xact_lock/i.test(sql)) return {rows:[{pg_advisory_xact_lock:null}]};
      return {rows:[{attendance_record_id:'a1'}]};
    },
  };
  const repository=repositoryWith(runner.query);
  const row=await repository.latestRecord('u1','class:c1:schedule-v1',runner,true);

  assert.equal(row.attendance_record_id,'a1');
  assert.equal(calls.length,2);
  assert.match(calls[0].sql,/pg_advisory_xact_lock\(hashtextextended\(\$1,0\)\)/i);
  assert.deepEqual(calls[0].params,['u1:class:c1:schedule-v1']);
  assert.match(calls[1].sql,/from public\.teaching_attendance_records/i);
  assert.doesNotMatch(calls[1].sql,/for update/i);
});

test('D15 concern lookup uses only real concern columns and stable ordering',async()=>{
  const calls=[];
  const query=async(sql,params=[])=>{calls.push({sql,params});return {rows:[]};};
  const repository=repositoryWith(query);

  const concern=await repository.latestConcern('u1','co1');

  assert.equal(concern,null);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/order by opened_at desc,attendance_concern_id desc/i);
  assert.doesNotMatch(calls[0].sql,/created_at/i);
});
