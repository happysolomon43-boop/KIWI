'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {materializePlanGraph}=require('../../../teaching/repositories/d08/plan-graph');

test('D08 persists zero-based plan-local Learning Unit sequence for D11 lesson ordering',async()=>{
  const calls=[];
  let id=0;
  const ctx={
    randomUUID:()=>`id-${++id}`,
    json:(value)=>JSON.stringify(value),
    q:async(_tx,sql,params)=>{calls.push({sql,params});return {rows:[]};},
  };
  const plan={
    topics:[{key:'topic-1',title:'Topic 1',ordinal:0,subtopics:[{key:'sub-1',title:'Sub 1',ordinal:0}]}],
    learning_units:[
      {key:'lu-a',topic_key:'topic-1',subtopic_key:'sub-1',title:'A',intended_competence:'A competence',exit_conditions:[],criticality:'HIGH',foundational:false,instructional_load_min_minutes:30,instructional_load_max_minutes:60,instructional_treatment:'FULL_INSTRUCTION'},
      {key:'lu-b',topic_key:'topic-1',subtopic_key:'sub-1',title:'B',intended_competence:'B competence',exit_conditions:[],criticality:'MEDIUM',foundational:false,instructional_load_min_minutes:30,instructional_load_max_minutes:60,instructional_treatment:'FULL_INSTRUCTION'},
    ],
    dependencies:[],assumed_prerequisites:[],
  };
  await materializePlanGraph(ctx,{}, {studentId:'student-1',coursePlanId:'plan-1',setup:{vpkDecisions:[]},plan});
  const inserts=calls.filter((call)=>call.sql.includes('insert into public.teaching_learning_units'));
  assert.equal(inserts.length,2);
  assert.match(inserts[0].sql,/sequence_no/);
  assert.equal(inserts[0].params[5],0);
  assert.equal(inserts[1].params[5],1);
  assert.equal(inserts[0].params[6],'A');
  assert.equal(inserts[1].params[6],'B');
});
