'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTeachingFoundation}=require('../../../teaching');

test('Teaching foundation composes D27 from persistent dependencies without changing AI qualification',()=>{
  const query=async()=>({rows:[]});
  const withTransaction=async(fn)=>fn(async()=>({rows:[]}));
  let id=0;
  const foundation=createTeachingFoundation({
    env:{NODE_ENV:'test',TEACHING_D27_KS_WRITE_ENABLED:'false',TEACHING_D27_MASTERY_WRITE_ENABLED:'false',TEACHING_D27_STUDY_PROMOTION_ENABLED:'false'},
    subjectSource:{findManyWithDecks:async()=>[],getCorpusForUser:async()=>null},
    query,withTransaction,randomUUID:()=>`id-${++id}`,
  });
  assert.ok(foundation.d27);
  assert.equal(foundation.d27.service.status().taskCount,17);
  assert.equal(foundation.d27.service.status().integrationWriteGates.ksWrite,false);
  assert.equal(foundation.d27.service.status().promptQualificationChanged,false);
  assert.equal(foundation.d27.service.status().centralAIOrchestratorOnly,true);
});
