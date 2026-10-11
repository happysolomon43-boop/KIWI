'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createD17AssessmentRepository}=require('../../../teaching/repositories/d17-assessments');
const source={classId:'class-1',reviewRef:'owner-review-1',
 sourceLineage:{classroomRecordRef:'classroom-record:r1@'+'a'.repeat(64),
 classClosureRef:'class-closure:c1',reviewedProposalHash:'b'.repeat(64)}};
async function exercise({recordHash='a'.repeat(64),course='course-1',state='CLOSED',closure='c1',prior=false}={}){
 const seen=[];
 const tx={query:async(sql,params)=>{
  seen.push(sql);
  if(sql.includes('idempotency_key=$2')&&sql.includes('teaching_assessment_blueprints'))return {rows:prior?[{assessment_blueprint_id:'previous-bp'}]:[]};
  if(sql.includes('select * from public.teaching_assessments'))return {rows:[{assessment_id:'assess-1',course_id:'course-1'}]};
  if(sql.includes('from public.teaching_classroom_delivery d'))return {rows:[{session_id:'session-1',course_id:course,lifecycle_state:state}]};
  if(sql.includes('from public.teaching_classroom_reconciliation_versions'))return {rows:[{record_id:'r1',content_hash:recordHash}]};
  if(sql.includes('from public.teaching_class_closure_facts'))return {rows:[{closure_fact_id:closure}]};
  if(sql.includes('from public.teaching_assessment_blueprints')&&sql.includes('version_no desc'))return {rows:[]};
  if(sql.startsWith('insert into public.teaching_assessment_blueprints'))return {rows:[{assessment_blueprint_id:'bp-1'}]};
  throw Error('Unexpected mock SQL: '+sql);
 }};
 const repo=createD17AssessmentRepository({query:tx.query,withTransaction:fn=>fn(tx),randomUUID:()=> 'mock-uuid'});
 const input={studentId:'student-1',assessment:{assessment_id:'assess-1',course_id:'course-1'},
 normalized:{slots:[],responseFormArchitecture:{},totalMarks:0,durationMinutes:0,timerModel:'NONE',resourcePolicy:{},accommodationPolicy:{},singleModeJustification:null,sourceStateVersions:{},provenanceRefs:[]},
 lane:'FORECAST_PLANNING',maturity:'DRAFT',idempotencyKey:'review-1',classroomSource:source};
 try{return {result:await repo.appendBlueprint(input),seen};}
 catch(error){return {error,seen};}
}
test('D17 accepted owner Blueprint holds delivery lock through current-record check',async()=>{
 const {result,error,seen}=await exercise();
 assert.ifError(error);assert.equal(result.blueprint.assessment_blueprint_id,'bp-1');
 assert.match(seen.find(s=>s.includes('from public.teaching_classroom_delivery d')),/for update of d/);
 assert.ok(seen.some(s=>s.startsWith('insert into public.teaching_assessment_blueprints')));
});
test('D17 stale late evaluation, changed closure and foreign Course fail before Blueprint insert',async()=>{
 for(const overrides of [{recordHash:'c'.repeat(64)},{course:'foreign'},{state:'ACTIVE'},{closure:'another'}]){
  const {error,seen}=await exercise(overrides);
  assert.equal(error?.status,409);assert.equal(seen.some(s=>s.startsWith('insert into public.teaching_assessment_blueprints')),false);
 }
});

test('D17 Classroom Blueprint idempotency replay cannot return stale owner-approved evidence',async()=>{
 const stale=await exercise({prior:true,recordHash:'c'.repeat(64)});
 assert.equal(stale.error?.code,'TEACHING_D17_CLASSROOM_SOURCE_STALE');
 assert.equal(stale.seen.some(sql=>sql.startsWith('insert into public.teaching_assessment_blueprints')),false);
 const current=await exercise({prior:true});
 assert.ifError(current.error);
 assert.equal(current.result?.idempotent,true);
 assert.equal(current.result?.blueprint.assessment_blueprint_id,'previous-bp');
});
