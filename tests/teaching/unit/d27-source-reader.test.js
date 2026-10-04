'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SOURCE_QUERIES,createD27SourceVersionReader}=require('../../../teaching/d27/source-reader');

test('D27 source mappings use each authoritative owner version field',()=>{
  assert.equal(SOURCE_QUERIES.Assessment.version,'state_version');
  assert.equal(SOURCE_QUERIES.StudentKnowledgeState.version,'version_no');
  assert.equal(SOURCE_QUERIES.GradebookEntry.version,'version_no');
  assert.equal(SOURCE_QUERIES.CourseResult.version,'version_no');
  assert.equal(SOURCE_QUERIES.Course.version,'state_version');
  assert.equal(SOURCE_QUERIES.Class.version,'schedule_version');
  assert.equal(SOURCE_QUERIES.Assignment.version,'state_version');
});

test('D27 source reader scopes every owner read to the student and entity id',async()=>{
  const calls=[];
  const read=createD27SourceVersionReader({query:async(sql,params)=>{calls.push({sql,params});return {rows:[{version:7}]};}});
  const result=await read('student-1',{entityType:'Class',entityId:'class-1'});
  assert.equal(result.version,'7');
  assert.match(calls[0].sql,/schedule_version AS version/);
  assert.match(calls[0].sql,/student_id=\$1 AND class_id=\$2/);
  assert.deepEqual(calls[0].params,['student-1','class-1']);
});
