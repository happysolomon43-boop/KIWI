'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createD11LessonControllerRepository}=require('../../../teaching/repositories/d11-lesson-controller');

const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');

test('PPL inheritance cancellation respects NOT NULL retry timestamps and does not resurrect CLAIMED jobs',()=>{
  const section=source.slice(source.indexOf('  async function inheritRescheduledPreparation('),
    source.indexOf('  async function getGovernedRequest('));
  assert.match(section,/update teaching_runtime\.event_outbox set status='CANCELLED'/);
  assert.match(section,/where aggregate_id=\$1 and event_type like 'teaching\.preparation\.\%'/);
  assert.match(section,/and status in \('PENDING','RETRY_WAIT'\)/);
  assert.match(section,/update teaching_runtime\.due_events set status='SUPERSEDED'/);
  assert.match(section,/resolution='SUPERSEDED'/);
  assert.doesNotMatch(section,/next_attempt_at\s*=\s*(?:null|NULL)/);
  assert.match(section,/last_error_code='TEACHING_D11_BLUEPRINT_ALREADY_INHERITED'/);
  assert.match(section,/claim_token=null,claimed_by=null,claimed_at=null,claim_expires_at=null/);
  assert.doesNotMatch(section,/delete\s+from\s+teaching_runtime\.(?:event_outbox|due_events)/i);
});

test('Single PostgreSQL transaction client is never concurrently queried during D11 class context reads',async()=>{
  let busy=false,completed=0;
  const calls=[];
  const row={student_id:'student-1',class_id:'class-1',course_id:'course-1',scheduled_start_at:'2027-04-01T10:00:00Z'};
  const query=async(sql)=>{
    if(busy)throw new Error('concurrent query on a single transaction client');
    busy=true;calls.push(sql);
    await new Promise(resolve=>setImmediate(resolve));
    busy=false;completed++;
    if(sql.includes('from public.teaching_classes c'))return {rows:[row]};
    if(sql.includes('from public.teaching_course_plans'))return {rows:[{course_plan_id:'plan-1',version_no:1}]};
    return {rows:[]};
  };
  const repository=createD11LessonControllerRepository({
    query,withTransaction:async handler=>handler({query}),randomUUID:()=> 'uuid'
  });
  const result=await repository.getClassContext('student-1','class-1',{query});
  assert.equal(result.classRow.class_id,'class-1');
  assert.equal(result.plan.course_plan_id,'plan-1');
  assert.deepEqual(result.learningUnits,[]);
  assert.equal(result.blueprint,null);
  assert.equal(result.session,null);
  assert.equal(result.workspace,null);
  assert.equal(completed,8,'class, plan, 6 related reads all serialized');
  assert.match(source,/const results=runner/);
  assert.doesNotMatch(source.slice(
    source.indexOf('  async function inheritRescheduledPreparation('),
    source.indexOf('  async function getGovernedRequest(')),/await Promise\.all\(\[\s*tx\.query/);
});

test('D11 PPL inheritance keeps the immutable timetable/session gates and one atomic transaction',()=>{
  const part=source.slice(source.indexOf('  async function inheritRescheduledPreparation('),
    source.indexOf('  async function getGovernedRequest('));
  assert.match(part,/return withTransaction\(async tx=>/);
  assert.match(part,/order by class_id for update/);
  assert.match(part,/sourceHasSession/);
  assert.match(part,/targetHasSession/);
  assert.match(part,/evaluateLessonInheritance/);
  assert.match(part,/saveBlueprintUsing\(tx/);
  assert.match(part,/recordPreparationArtifactUsing\(tx/);
  assert.match(part,/lesson\.preparation\.revalidated_inheritance/);
  assert.doesNotMatch(part,/update public\.teaching_class_sessions|update public\.teaching_attendance_records/);
});
